import {
  DEFAULT_RISK_RULES,
  evaluateRiskAndAnomalies,
  normalizeDate,
  preprocessAndTagClaims,
  runMonteCarloSimulation,
  standardizeIcd10,
} from './claimsEngine';
import { decryptPatientId, encryptPatientId, getOrCreateSessionCrypto } from './crypto';
import { RawClaimRow } from '../types/claims';

export interface ValidationTestResult {
  id: string;
  category: 'Unit' | 'Security' | 'Integration';
  name: string;
  passed: boolean;
  details: string;
}

export async function runPlatformValidationSuite(): Promise<ValidationTestResult[]> {
  const results: ValidationTestResult[] = [];

  // 1. Date Normalization Unit Test
  const d1 = normalizeDate('11/04/2025');
  const d2 = normalizeDate('2026/01/09');
  const dInvalid = normalizeDate('');
  results.push({
    id: 'unit-date-norm',
    category: 'Unit',
    name: 'Heterogeneous Date Normalization (MM/DD/YYYY & YYYY/MM/DD → ISO)',
    passed: d1?.iso === '2025-11-04' && d2?.iso === '2026-01-09' && dInvalid === null,
    details: `Parsed 11/04/2025 → ${d1?.iso}, 2026/01/09 → ${d2?.iso}`,
  });

  // 2. ICD-10 Standardization Unit Test
  const icd1 = standardizeIcd10('e119');
  const icd2 = standardizeIcd10(' j18.9 ');
  results.push({
    id: 'unit-icd10-std',
    category: 'Unit',
    name: 'ICD-10 Code Formatting & Clinical Chapter Mapping',
    passed:
      icd1.code === 'E11.9' &&
      icd1.category === 'Endocrine & Metabolic' &&
      icd2.code === 'J18.9' &&
      icd2.category === 'Respiratory',
    details: `e119 → ${icd1.code} (${icd1.category})`,
  });

  // 3. AES-256-GCM Encryption & Decryption Round-Trip
  const ctx = await getOrCreateSessionCrypto();
  const encrypted = await encryptPatientId('PAT-88412', ctx);
  const decrypted = await decryptPatientId(encrypted.encryptedPatientId, ctx);
  results.push({
    id: 'sec-aes256-roundtrip',
    category: 'Security',
    name: 'Web Crypto AES-256-GCM Patient ID Encryption & HIPAA Masking',
    passed:
      encrypted.encryptedPatientId.startsWith('AES256:') &&
      encrypted.maskedPatientId.startsWith('PT-') &&
      !encrypted.encryptedPatientId.includes('PAT-88412') &&
      decrypted === 'PAT-88412',
    details: `Masked token ${encrypted.maskedPatientId}, key fingerprint ${encrypted.fingerprint}`,
  });

  // 4. Preprocessing Cleaning, Imputation & Anomaly Detection
  const rawBatch: RawClaimRow[] = [
    { claimId: 'T1', patientId: 'P1', serviceDate: '2026-01-10', amount: 420, claimType: 'Outpatient', icd10Code: 'I10', patientAge: 40, region: 'West', policyType: 'PPO', comorbidities: 0 },
    { claimId: 'T2', patientId: 'P2', serviceDate: '2026-01-11', amount: 510, claimType: 'Pharmacy', icd10Code: 'E11.9', patientAge: '', region: 'South', policyType: 'HMO', comorbidities: 1 },
    { claimId: 'T3', patientId: 'P3', serviceDate: '2026-01-12', amount: 480, claimType: 'Diagnostics', icd10Code: 'M54.5', patientAge: 52, region: 'Midwest', policyType: 'EPO', comorbidities: 1 },
    { claimId: 'T4', patientId: 'P4', serviceDate: '2026-01-13', amount: 495, claimType: 'Outpatient', icd10Code: 'Z00.0', patientAge: 33, region: 'Northeast', policyType: 'PPO', comorbidities: 0 },
    { claimId: 'T5', patientId: 'P5', serviceDate: '2026-01-14', amount: 530, claimType: 'Outpatient', icd10Code: 'J06.9', patientAge: 29, region: 'West', policyType: 'HDHP', comorbidities: 0 },
    { claimId: 'T6', patientId: 'P6', serviceDate: '2026-01-15', amount: 460, claimType: 'Pharmacy', icd10Code: 'K21.9', patientAge: 45, region: 'South', policyType: 'PPO', comorbidities: 1 },
    { claimId: 'T7', patientId: 'P7', serviceDate: '2026-01-16', amount: 64000, claimType: 'Inpatient', icd10Code: 'I25.10', patientAge: 71, region: 'Northeast', policyType: 'Medicare Advantage', comorbidities: 4 },
    { claimId: 'T-BAD', patientId: 'P8', serviceDate: '2026-01-17', amount: -100, claimType: 'Outpatient', icd10Code: 'I10', patientAge: 35, region: 'West', policyType: 'PPO', comorbidities: 0 },
  ];

  const processed = await preprocessAndTagClaims(
    rawBatch,
    'test-ds',
    'test-owner',
    'private',
    DEFAULT_RISK_RULES,
    ctx,
  );
  const highRiskClaim = processed.claims.find((c) => c.claimId === 'T7');
  const imputedClaim = processed.claims.find((c) => c.claimId === 'T2');
  results.push({
    id: 'int-preprocess-risk',
    category: 'Integration',
    name: 'Module 1 Cleaning, Median Imputation, Anomaly Flagging & Risk Tagging',
    passed:
      processed.report.validRowsRetained === 7 &&
      processed.report.droppedInvalidRows === 1 &&
      processed.report.missingValuesImputed >= 1 &&
      Boolean(imputedClaim && imputedClaim.patientAge > 0) &&
      Boolean(highRiskClaim?.isAnomaly && highRiskClaim?.riskSegment === 'High Risk'),
    details: `Retained ${processed.report.validRowsRetained}/8, dropped ${processed.report.droppedInvalidRows} negative claim, flagged ${processed.report.anomaliesFlagged} outlier`,
  });

  // 5. Dynamic Risk Rule Re-evaluation & Module 3 Monte Carlo Consistency
  const stricterRules = { ...DEFAULT_RISK_RULES, highAmountThreshold: 300, mediumAmountThreshold: 100 };
  const retagged = evaluateRiskAndAnomalies(processed.claims, stricterRules);
  const mc = runMonteCarloSimulation(retagged, {
    trials: 1000,
    volatilityMultiplier: 1.0,
    frequencyDeltaPct: -10,
    severityDeltaPct: 0,
    highRiskReductionPct: 15,
    coveredMembers: 500,
  });
  results.push({
    id: 'int-module1-to-module3',
    category: 'Integration',
    name: 'Custom Rule Re-Tagging → Module 3 Monte Carlo & Scenario Pipeline',
    passed:
      retagged.filter((c) => c.riskSegment === 'High Risk').length >= 6 &&
      mc.p95AggregateLoss >= mc.medianAggregateLoss &&
      mc.medianAggregateLoss >= mc.p5AggregateLoss &&
      mc.monthlyFan.length === 12,
    details: `1,000 trials completed: P50 $${mc.medianAggregateLoss.toLocaleString()}, P95 $${mc.p95AggregateLoss.toLocaleString()}`,
  });

  return results;
}

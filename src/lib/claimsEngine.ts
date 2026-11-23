import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import {
  AgeGroup,
  ClaimType,
  MonteCarloSummary,
  PolicyType,
  PreprocessingReport,
  ProcessedClaim,
  RawClaimRow,
  Region,
  RiskRuleConfig,
  RiskSegment,
} from '../types/claims';
import {
  encryptPatientId,
  getOrCreateSessionCrypto,
  SessionCryptoContext,
} from './crypto';

export const DEFAULT_RISK_RULES: RiskRuleConfig = {
  id: 'default-actuarial-rules',
  name: 'Standard Actuarial Baseline',
  ownerId: 'system',
  visibility: 'shared',
  highAmountThreshold: 12000,
  mediumAmountThreshold: 3500,
  highComorbidityThreshold: 3,
  mediumComorbidityThreshold: 1,
  inpatientWeight: 25,
  ageThreshold: 60,
  ageWeight: 15,
  anomalyZScoreThreshold: 2.5,
};

const ICD10_CHAPTERS: Record<string, string> = {
  A: 'Infectious & Parasitic',
  B: 'Infectious & Parasitic',
  C: 'Oncology & Neoplasms',
  D: 'Hematology & Immune',
  E: 'Endocrine & Metabolic',
  F: 'Mental & Behavioral',
  G: 'Neurological',
  H: 'Ophthalmic & Otologic',
  I: 'Cardiovascular',
  J: 'Respiratory',
  K: 'Digestive System',
  L: 'Dermatological',
  M: 'Musculoskeletal',
  N: 'Genitourinary',
  O: 'Obstetric & Maternal',
  R: 'Clinical Symptoms',
  S: 'Injury & Trauma',
  T: 'Injury & Poisoning',
  Z: 'Preventive & Wellness',
};

export function standardizeIcd10(rawCode: unknown): {
  code: string;
  category: string;
  changed: boolean;
} {
  const original = String(rawCode ?? '').trim();
  const compact = original.toUpperCase().replace(/[^A-Z0-9.]/g, '');
  if (!compact || compact.length < 2) {
    return { code: 'Z00.0', category: 'Preventive & Wellness', changed: true };
  }
  let formatted = compact.replace(/\.+/g, '');
  if (formatted.length > 3) {
    formatted = `${formatted.slice(0, 3)}.${formatted.slice(3, 7)}`;
  }
  const chapterLetter = formatted.charAt(0);
  const category = ICD10_CHAPTERS[chapterLetter] ?? 'General Clinical';
  return {
    code: formatted,
    category,
    changed: formatted !== original,
  };
}

export function normalizeDate(rawDate: unknown): { iso: string; changed: boolean } | null {
  if (rawDate === null || rawDate === undefined || rawDate === '') return null;

  if (typeof rawDate === 'number' && Number.isFinite(rawDate)) {
    // Excel serial date number (1900 epoch)
    const utcDays = Math.floor(rawDate - 25569);
    const dt = new Date(utcDays * 86400 * 1000);
    if (!Number.isNaN(dt.getTime())) {
      return { iso: dt.toISOString().slice(0, 10), changed: true };
    }
  }

  const str = String(rawDate).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return { iso: str, changed: false };
  }

  // YYYY/MM/DD
  const slashYmd = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(str);
  if (slashYmd) {
    const [, y, m, d] = slashYmd;
    return {
      iso: `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`,
      changed: true,
    };
  }

  // MM/DD/YYYY or MM-DD-YYYY
  const mdy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(str);
  if (mdy) {
    const [, m, d, y] = mdy;
    const month = Number(m);
    const day = Number(d);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return {
        iso: `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`,
        changed: true,
      };
    }
  }

  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) {
    return { iso: parsed.toISOString().slice(0, 10), changed: true };
  }

  return null;
}

export function getAgeGroup(age: number): AgeGroup {
  if (age < 18) return '0-17';
  if (age < 35) return '18-34';
  if (age < 50) return '35-49';
  if (age < 65) return '50-64';
  return '65+';
}

function normalizeClaimType(raw: unknown): ClaimType {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s.includes('inpat') || s === 'ip' || s.includes('hosp')) return 'Inpatient';
  if (s.includes('pharm') || s.includes('rx') || s.includes('drug')) return 'Pharmacy';
  if (s.includes('diag') || s.includes('lab') || s.includes('imag')) return 'Diagnostics';
  return 'Outpatient';
}

function normalizeRegion(raw: unknown): Region {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s.includes('north')) return 'Northeast';
  if (s.includes('mid') || s.includes('central')) return 'Midwest';
  if (s.includes('south')) return 'South';
  if (s.includes('west')) return 'West';
  return 'Northeast';
}

function normalizePolicyType(raw: unknown): PolicyType {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s.includes('hmo')) return 'HMO';
  if (s.includes('epo')) return 'EPO';
  if (s.includes('hdhp') || s.includes('high')) return 'HDHP';
  if (s.includes('medicare')) return 'Medicare Advantage';
  return 'PPO';
}

function sanitizeId(raw: string, fallbackPrefix: string, index: number): string {
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!cleaned) return `${fallbackPrefix}_${index + 1}`;
  return cleaned.slice(0, 60);
}

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function evaluateRiskAndAnomalies(
  claims: ProcessedClaim[],
  rules: RiskRuleConfig,
): ProcessedClaim[] {
  if (claims.length === 0) return [];
  const amounts = claims.map((c) => c.amount);
  const sorted = [...amounts].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = Math.max(q3 - q1, 1);
  const tukeyUpper = q3 + 1.5 * iqr;
  const mean = amounts.reduce((s, v) => s + v, 0) / amounts.length;
  const variance =
    amounts.reduce((s, v) => s + (v - mean) * (v - mean), 0) / Math.max(amounts.length, 1);
  const stdDev = Math.max(Math.sqrt(variance), 1);

  return claims.map((c) => {
    const zScore = (c.amount - mean) / stdDev;
    const exceedsZ = zScore >= rules.anomalyZScoreThreshold;
    const exceedsTukey = c.amount > tukeyUpper && c.amount > rules.highAmountThreshold;
    const isAnomaly = exceedsZ || exceedsTukey;

    let anomalyReason = '';
    if (exceedsZ) {
      anomalyReason = `Z-score ${zScore.toFixed(1)}σ exceeds ${rules.anomalyZScoreThreshold.toFixed(1)}σ threshold`;
    } else if (exceedsTukey) {
      anomalyReason = `Exceeds Tukey 1.5×IQR fence ($${Math.round(tukeyUpper).toLocaleString()})`;
    }

    // Transparent weighted actuarial risk scoring (0-100)
    let score = 10;
    if (c.amount >= rules.highAmountThreshold) {
      score += 40;
    } else if (c.amount >= rules.mediumAmountThreshold) {
      score += 22;
    } else {
      score += Math.min(12, (c.amount / Math.max(rules.mediumAmountThreshold, 1)) * 12);
    }

    if (c.comorbidities >= rules.highComorbidityThreshold) {
      score += 24;
    } else if (c.comorbidities >= rules.mediumComorbidityThreshold) {
      score += 12;
    }

    if (c.claimType === 'Inpatient') {
      score += rules.inpatientWeight;
    } else if (c.claimType === 'Diagnostics') {
      score += rules.inpatientWeight * 0.35;
    }

    if (c.patientAge >= rules.ageThreshold) {
      score += rules.ageWeight;
    } else if (c.patientAge >= 45) {
      score += rules.ageWeight * 0.4;
    }

    if (isAnomaly) {
      score += 10;
    }

    const boundedScore = Math.min(100, Math.max(0, Math.round(score * 10) / 10));
    let riskSegment: RiskSegment = 'Low Risk';
    if (
      boundedScore >= 62 ||
      c.amount >= rules.highAmountThreshold ||
      c.comorbidities >= rules.highComorbidityThreshold + 1
    ) {
      riskSegment = 'High Risk';
    } else if (
      boundedScore >= 34 ||
      c.amount >= rules.mediumAmountThreshold ||
      c.comorbidities >= rules.mediumComorbidityThreshold
    ) {
      riskSegment = 'Medium Risk';
    }

    return {
      ...c,
      isAnomaly,
      anomalyReason,
      riskScore: boundedScore,
      riskSegment,
    };
  });
}

export async function preprocessAndTagClaims(
  rawRows: RawClaimRow[],
  datasetId: string,
  ownerId: string,
  visibility: 'private' | 'shared',
  rules: RiskRuleConfig,
  cryptoCtx?: SessionCryptoContext,
): Promise<{
  claims: ProcessedClaim[];
  report: PreprocessingReport;
  keyFingerprint: string;
}> {
  const session = cryptoCtx ?? (await getOrCreateSessionCrypto());
  const validAges: number[] = [];

  for (const row of rawRows) {
    const parsedAge = Number(row.patientAge);
    if (Number.isFinite(parsedAge) && parsedAge >= 0 && parsedAge <= 120) {
      validAges.push(Math.round(parsedAge));
    }
  }
  validAges.sort((a, b) => a - b);
  const medianAge = validAges.length > 0 ? validAges[Math.floor(validAges.length / 2)] : 46;

  let droppedInvalidRows = 0;
  let missingValuesImputed = 0;
  let datesNormalized = 0;
  let icdCodesStandardized = 0;

  const staged: ProcessedClaim[] = [];

  for (let i = 0; i < rawRows.length; i += 1) {
    const row = rawRows[i];
    const cleanAmountStr = String(row.amount ?? '')
      .replace(/[$,\s]/g, '')
      .trim();
    const amount = Number(cleanAmountStr);
    const dateResult = normalizeDate(row.serviceDate);

    if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000 || !dateResult) {
      droppedInvalidRows += 1;
      continue;
    }
    if (dateResult.changed) datesNormalized += 1;

    let age = Number(row.patientAge);
    if (!Number.isFinite(age) || age < 0 || age > 120) {
      age = medianAge;
      missingValuesImputed += 1;
    } else {
      age = Math.round(age);
    }

    let comorbidities = Number(row.comorbidities);
    if (!Number.isFinite(comorbidities) || comorbidities < 0 || comorbidities > 30) {
      comorbidities = 0;
      missingValuesImputed += 1;
    } else {
      comorbidities = Math.round(comorbidities);
    }

    const icd = standardizeIcd10(row.icd10Code);
    if (icd.changed) icdCodesStandardized += 1;

    const rawPatientId = String(row.patientId ?? `MEM-${10000 + i}`).trim() || `MEM-${10000 + i}`;
    const enc = await encryptPatientId(rawPatientId, session);

    const claimId = sanitizeId(String(row.claimId ?? ''), 'CLM', i);

    staged.push({
      claimId,
      datasetId,
      ownerId,
      visibility,
      encryptedPatientId: enc.encryptedPatientId,
      maskedPatientId: enc.maskedPatientId,
      rawPatientIdLocal: rawPatientId,
      serviceDate: dateResult.iso,
      amount: Math.round(amount * 100) / 100,
      claimType: normalizeClaimType(row.claimType),
      icd10Code: icd.code,
      icd10Category: icd.category,
      patientAge: age,
      ageGroup: getAgeGroup(age),
      region: normalizeRegion(row.region),
      policyType: normalizePolicyType(row.policyType),
      comorbidities,
      isAnomaly: false,
      anomalyReason: '',
      riskScore: 0,
      riskSegment: 'Low Risk',
    });
  }

  const tagged = evaluateRiskAndAnomalies(staged, rules);
  const anomaliesFlagged = tagged.filter((c) => c.isAnomaly).length;

  return {
    claims: tagged,
    report: {
      rawRowsRead: rawRows.length,
      validRowsRetained: tagged.length,
      droppedInvalidRows,
      missingValuesImputed,
      datesNormalized,
      icdCodesStandardized,
      anomaliesFlagged,
      encryptedIdentifiers: tagged.length,
    },
    keyFingerprint: session.fingerprint,
  };
}

function mapObjectKeysToRawClaim(obj: Record<string, unknown>): RawClaimRow {
  const norm: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    norm[k.toLowerCase().replace(/[^a-z0-9]/g, '')] = v;
  }
  return {
    claimId: (norm.claimid ?? norm.id ?? norm.claimnumber) as string | number | undefined,
    patientId: (norm.patientid ?? norm.memberid ?? norm.subscriberid) as string | number | undefined,
    serviceDate: (norm.servicedate ?? norm.date ?? norm.claimdate ?? norm.incurreddate) as
      | string
      | number
      | undefined,
    amount: (norm.amount ?? norm.claimamount ?? norm.paidamount ?? norm.cost) as
      | string
      | number
      | undefined,
    claimType: (norm.claimtype ?? norm.type ?? norm.servicetype ?? norm.category) as
      | string
      | undefined,
    icd10Code: (norm.icd10code ?? norm.icd10 ?? norm.diagnosiscode ?? norm.dx) as
      | string
      | undefined,
    patientAge: (norm.patientage ?? norm.age ?? norm.memberage) as string | number | undefined,
    region: (norm.region ?? norm.state ?? norm.geography) as string | undefined,
    policyType: (norm.policytype ?? norm.plan ?? norm.plantype) as string | undefined,
    comorbidities: (norm.comorbidities ?? norm.chronicconditions ?? norm.hcccount) as
      | string
      | number
      | undefined,
  };
}

export async function parseClaimsFile(file: File): Promise<RawClaimRow[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    const text = await file.text();
    const parsed = Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: true,
    });
    if (parsed.errors.length > 0 && parsed.data.length === 0) {
      throw new Error(`CSV parse error: ${parsed.errors[0].message}`);
    }
    return parsed.data.map(mapObjectKeysToRawClaim);
  }

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const firstSheet = wb.SheetNames[0];
    if (!firstSheet) throw new Error('Workbook contains no worksheets.');
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[firstSheet]);
    return rows.map(mapObjectKeysToRawClaim);
  }

  throw new Error('Unsupported file format. Upload a .csv, .xlsx, or .xls claims file.');
}

// Deterministic seeded PRNG for reproducible actuarial baseline portfolio
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateCuratedSampleRawRows(count = 320): RawClaimRow[] {
  const rand = mulberry32(20261123);
  const regions: Region[] = ['Northeast', 'Midwest', 'South', 'West'];
  const policies: PolicyType[] = ['PPO', 'HMO', 'EPO', 'HDHP', 'Medicare Advantage'];
  const icdPool = [
    { code: 'I10', weight: 0.16 },
    { code: 'E11.9', weight: 0.15 },
    { code: 'J06.9', weight: 0.14 },
    { code: 'J18.9', weight: 0.08 },
    { code: 'M54.5', weight: 0.12 },
    { code: 'Z00.00', weight: 0.12 },
    { code: 'I25.10', weight: 0.09 },
    { code: 'C50.9', weight: 0.05 },
    { code: 'K21.9', weight: 0.09 },
  ];

  // 12-month window ending 2026-10
  const months = [
    '2025-11',
    '2025-12',
    '2026-01',
    '2026-02',
    '2026-03',
    '2026-04',
    '2026-05',
    '2026-06',
    '2026-07',
    '2026-08',
    '2026-09',
    '2026-10',
  ];
  const seasonalWeights = [1.22, 1.38, 1.44, 1.3, 1.05, 0.88, 0.84, 0.86, 0.9, 0.94, 0.98, 1.08];
  const cumWeights: number[] = [];
  let sumW = 0;
  for (const w of seasonalWeights) {
    sumW += w;
    cumWeights.push(sumW);
  }

  const pickMonth = () => {
    const r = rand() * sumW;
    const idx = cumWeights.findIndex((cw) => r <= cw);
    return months[Math.max(0, idx)];
  };

  const rows: RawClaimRow[] = [];
  for (let i = 0; i < count; i += 1) {
    const ym = pickMonth();
    const monthNum = Number(ym.slice(5, 7));
    const isFluSeason = monthNum >= 11 || monthNum <= 3;
    const day = String(1 + Math.floor(rand() * 28)).padStart(2, '0');

    const policy = policies[Math.floor(rand() * policies.length)];
    const region = regions[Math.floor(rand() * regions.length)];

    let age =
      policy === 'Medicare Advantage'
        ? 65 + Math.floor(rand() * 24)
        : 18 + Math.floor(Math.pow(rand(), 0.85) * 58);

    const comorbidities = Math.min(
      7,
      Math.floor((age > 55 ? 1.4 : 0.4) + rand() * (age > 60 ? 4.2 : 2.3)),
    );

    const typeRoll = rand();
    let claimType: ClaimType = 'Outpatient';
    if (typeRoll < (isFluSeason ? 0.22 : 0.15)) claimType = 'Inpatient';
    else if (typeRoll < 0.56) claimType = 'Outpatient';
    else if (typeRoll < 0.82) claimType = 'Pharmacy';
    else claimType = 'Diagnostics';

    // Log-normal severity grounded in claim type + comorbidities + seasonal factor
    const u1 = Math.max(0.0001, rand());
    const u2 = rand();
    const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);

    const baseLogMean: Record<ClaimType, number> = {
      Inpatient: 9.25,
      Outpatient: 7.15,
      Pharmacy: 5.95,
      Diagnostics: 6.75,
    };
    const sigma = claimType === 'Inpatient' ? 0.72 : 0.58;
    const comorbidityMult = 1 + comorbidities * 0.16;
    const seasonalMult = isFluSeason && claimType === 'Inpatient' ? 1.15 : 1.0;

    let amount = Math.exp(baseLogMean[claimType] + sigma * z) * comorbidityMult * seasonalMult;
    // Inject a small realistic tail of extreme catastrophic claims (~2.5%)
    if (i === 18 || i === 94 || i === 173 || i === 248 || i === 295) {
      amount = 38500 + Math.round(rand() * 44000);
      claimType = 'Inpatient';
    }

    // Pick ICD-10
    let icdPick = icdPool[0].code;
    let rIcd = rand();
    for (const item of icdPool) {
      if (rIcd <= item.weight) {
        icdPick = item.code;
        break;
      }
      rIcd -= item.weight;
    }
    if (isFluSeason && rand() < 0.32) {
      icdPick = rand() < 0.5 ? 'J18.9' : 'J06.9';
    }

    // Intentionally include a few messy raw rows in sample CSV exports,
    // while keeping baseline dates clean or normalized cleanly
    rows.push({
      claimId: `CLM-${String(2026000 + i)}`,
      patientId: `PAT-${1000 + Math.floor(rand() * 190)}`,
      serviceDate: i % 29 === 0 ? `${ym.slice(5, 7)}/${day}/${ym.slice(0, 4)}` : `${ym}-${day}`,
      amount: Math.round(amount * 100) / 100,
      claimType,
      icd10Code: i % 23 === 0 ? icdPick.replace('.', '').toLowerCase() : icdPick,
      patientAge: i % 47 === 0 ? '' : age,
      region,
      policyType: policy,
      comorbidities,
    });
  }

  return rows;
}

export interface BoxPlotStats {
  group: string;
  count: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  mean: number;
  outliers: number[];
}

export function computeBoxPlotStats(group: string, values: number[]): BoxPlotStats {
  if (values.length === 0) {
    return { group, count: 0, min: 0, q1: 0, median: 0, q3: 0, max: 0, mean: 0, outliers: [] };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const median = quantile(sorted, 0.5);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const loFence = q1 - 1.5 * iqr;
  const hiFence = q3 + 1.5 * iqr;
  const inliers = sorted.filter((v) => v >= loFence && v <= hiFence);
  const outliers = sorted.filter((v) => v < loFence || v > hiFence);
  const min = inliers.length > 0 ? inliers[0] : sorted[0];
  const max = inliers.length > 0 ? inliers[inliers.length - 1] : sorted[sorted.length - 1];
  const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;

  return { group, count: sorted.length, min, q1, median, q3, max, mean, outliers };
}

export function computeCorrelationMatrix(claims: ProcessedClaim[]): {
  labels: string[];
  matrix: number[][];
} {
  const labels = ['Age', 'Comorbidities', 'Claim Amount', 'Risk Score', 'Inpatient'];
  if (claims.length < 2) {
    return {
      labels,
      matrix: labels.map((_, i) => labels.map((__, j) => (i === j ? 1 : 0))),
    };
  }

  const vectors = [
    claims.map((c) => c.patientAge),
    claims.map((c) => c.comorbidities),
    claims.map((c) => c.amount),
    claims.map((c) => c.riskScore),
    claims.map((c) => (c.claimType === 'Inpatient' ? 1 : 0)),
  ];

  const pearson = (x: number[], y: number[]) => {
    const n = x.length;
    const mx = x.reduce((s, v) => s + v, 0) / n;
    const my = y.reduce((s, v) => s + v, 0) / n;
    let num = 0;
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < n; i += 1) {
      const a = x[i] - mx;
      const b = y[i] - my;
      num += a * b;
      dx += a * a;
      dy += b * b;
    }
    const denom = Math.sqrt(dx * dy);
    return denom === 0 ? 0 : Math.round((num / denom) * 100) / 100;
  };

  const matrix = vectors.map((vx, i) =>
    vectors.map((vy, j) => (i === j ? 1 : pearson(vx, vy))),
  );
  return { labels, matrix };
}

export function runMonteCarloSimulation(
  claims: ProcessedClaim[],
  params: {
    trials: number;
    volatilityMultiplier: number;
    frequencyDeltaPct: number;
    severityDeltaPct: number;
    highRiskReductionPct: number;
    coveredMembers: number;
  },
): MonteCarloSummary {
  const rand = mulberry32(424242 + params.trials);
  const memberCount = Math.max(params.coveredMembers, claims.length, 100);

  if (claims.length === 0) {
    return {
      trials: params.trials,
      meanAggregateLoss: 0,
      medianAggregateLoss: 0,
      p5AggregateLoss: 0,
      p95AggregateLoss: 0,
      p99AggregateLoss: 0,
      purePremiumPerMember: 0,
      p95PurePremiumPerMember: 0,
      simulatedTotals: [],
      monthlyFan: [],
    };
  }

  const freqScale = Math.max(0.1, 1 + params.frequencyDeltaPct / 100);
  const sevScale = Math.max(0.1, 1 + params.severityDeltaPct / 100);
  const highRiskScale = Math.max(0, 1 - params.highRiskReductionPct / 100);

  const adjustedAmounts = claims.map((c) => {
    const segmentAdj = c.riskSegment === 'High Risk' ? highRiskScale : 1;
    return c.amount * sevScale * segmentAdj;
  });

  const meanSev = adjustedAmounts.reduce((s, v) => s + v, 0) / adjustedAmounts.length;
  const logAmounts = adjustedAmounts.map((v) => Math.log(Math.max(v, 1)));
  const muLog = logAmounts.reduce((s, v) => s + v, 0) / logAmounts.length;
  const varLog =
    logAmounts.reduce((s, v) => s + (v - muLog) * (v - muLog), 0) / logAmounts.length;
  const sigmaLog = Math.sqrt(varLog) * params.volatilityMultiplier;

  const baseCount = claims.length * freqScale;
  const totalBaseObserved = adjustedAmounts.reduce((s, v) => s + v, 0);

  const simulatedTotals: number[] = [];
  const boxMuller = () => {
    const u1 = Math.max(1e-6, rand());
    const u2 = rand();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };

  for (let t = 0; t < params.trials; t += 1) {
    // Compound frequency-severity stochastic draw (Normal approx to Poisson + Log-Normal severity)
    const zFreq = boxMuller();
    const simCount = Math.max(1, Math.round(baseCount + Math.sqrt(baseCount) * zFreq * params.volatilityMultiplier));
    // Central-limit + tail shock draw anchored to empirical log-variance
    const zSev = boxMuller();
    const zTail = Math.max(0, boxMuller() - 1.65) * 0.35 * params.volatilityMultiplier;
    const trialSevFactor = Math.exp(
      (sigmaLog / Math.sqrt(Math.max(claims.length * 0.18, 8))) * zSev + zTail,
    );
    const total = simCount * meanSev * trialSevFactor;
    simulatedTotals.push(Math.round(total));
  }

  const sortedTotals = [...simulatedTotals].sort((a, b) => a - b);
  const meanAggregateLoss =
    simulatedTotals.reduce((s, v) => s + v, 0) / simulatedTotals.length;
  const medianAggregateLoss = quantile(sortedTotals, 0.5);
  const p5AggregateLoss = quantile(sortedTotals, 0.05);
  const p95AggregateLoss = quantile(sortedTotals, 0.95);
  const p99AggregateLoss = quantile(sortedTotals, 0.99);

  // Build 12-month forward fan chart anchored to historical monthly weights
  const monthBuckets = new Map<string, number>();
  for (const c of claims) {
    const ym = c.serviceDate.slice(0, 7);
    const segmentAdj = c.riskSegment === 'High Risk' ? highRiskScale : 1;
    monthBuckets.set(ym, (monthBuckets.get(ym) ?? 0) + c.amount * sevScale * segmentAdj);
  }
  const sortedMonths = Array.from(monthBuckets.entries()).sort(([a], [b]) => a.localeCompare(b));
  const monthlyAvg = totalBaseObserved / Math.max(sortedMonths.length, 1);

  const monthlyFan = Array.from({ length: 12 }, (_, idx) => {
    const hist = sortedMonths[idx];
    const seasonalRatio = hist ? hist[1] / Math.max(monthlyAvg, 1) : 1;
    const baseMonth = (meanAggregateLoss / 12) * (0.7 + 0.3 * seasonalRatio);
    // Uncertainty widens over forecast horizon t = 1..12
    const horizonSpread = (0.11 + idx * 0.018) * params.volatilityMultiplier;
    return {
      month: `M+${idx + 1}`,
      p5: Math.round(baseMonth * Math.max(0.45, 1 - 1.645 * horizonSpread)),
      p25: Math.round(baseMonth * Math.max(0.65, 1 - 0.674 * horizonSpread)),
      p50: Math.round(baseMonth),
      p75: Math.round(baseMonth * (1 + 0.674 * horizonSpread)),
      p95: Math.round(baseMonth * (1 + 1.645 * horizonSpread)),
      actual: hist ? Math.round(hist[1]) : undefined,
    };
  });

  return {
    trials: params.trials,
    meanAggregateLoss: Math.round(meanAggregateLoss),
    medianAggregateLoss: Math.round(medianAggregateLoss),
    p5AggregateLoss: Math.round(p5AggregateLoss),
    p95AggregateLoss: Math.round(p95AggregateLoss),
    p99AggregateLoss: Math.round(p99AggregateLoss),
    purePremiumPerMember: Math.round(meanAggregateLoss / memberCount),
    p95PurePremiumPerMember: Math.round(p95AggregateLoss / memberCount),
    simulatedTotals,
    monthlyFan,
  };
}

function triggerDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportClaimsToCSV(claims: ProcessedClaim[], fileName: string) {
  const rows = claims.map((c) => ({
    claimId: c.claimId,
    maskedPatientId: c.maskedPatientId,
    encryptedPatientId: c.encryptedPatientId,
    serviceDate: c.serviceDate,
    amount: c.amount,
    claimType: c.claimType,
    icd10Code: c.icd10Code,
    icd10Category: c.icd10Category,
    patientAge: c.patientAge,
    ageGroup: c.ageGroup,
    region: c.region,
    policyType: c.policyType,
    comorbidities: c.comorbidities,
    isAnomaly: c.isAnomaly,
    anomalyReason: c.anomalyReason,
    riskScore: c.riskScore,
    riskSegment: c.riskSegment,
  }));
  const csv = Papa.unparse(rows);
  triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), fileName);
}

export function exportClaimsToExcel(claims: ProcessedClaim[], fileName: string) {
  const rows = claims.map((c) => ({
    ClaimID: c.claimId,
    MaskedPatientID: c.maskedPatientId,
    EncryptedPatientID: c.encryptedPatientId,
    ServiceDate: c.serviceDate,
    AmountUSD: c.amount,
    ClaimType: c.claimType,
    ICD10: c.icd10Code,
    ClinicalCategory: c.icd10Category,
    Age: c.patientAge,
    AgeGroup: c.ageGroup,
    Region: c.region,
    PolicyType: c.policyType,
    Comorbidities: c.comorbidities,
    Anomaly: c.isAnomaly ? 'Yes' : 'No',
    AnomalyReason: c.anomalyReason,
    RiskScore: c.riskScore,
    RiskSegment: c.riskSegment,
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'CleanedClaims');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  triggerDownload(
    new Blob([out], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    fileName,
  );
}

export function exportRiskTagsJSON(claims: ProcessedClaim[], fileName: string) {
  const tags = claims.map((c) => ({
    claimId: c.claimId,
    maskedPatientId: c.maskedPatientId,
    riskScore: c.riskScore,
    riskSegment: c.riskSegment,
    isAnomaly: c.isAnomaly,
    anomalyReason: c.anomalyReason || null,
  }));
  triggerDownload(
    new Blob([JSON.stringify(tags, null, 2)], { type: 'application/json' }),
    fileName,
  );
}

export function downloadSampleRawCSV() {
  const sample = generateCuratedSampleRawRows(80);
  // Add 2 invalid rows to demonstrate cleaning pipeline dropping corrupt records
  sample.splice(5, 0, {
    claimId: 'CLM-BAD-01',
    patientId: 'PAT-9991',
    serviceDate: '2026-02-14',
    amount: -450,
    claimType: 'Outpatient',
    icd10Code: 'i10',
    patientAge: 44,
    region: 'West',
    policyType: 'PPO',
    comorbidities: 1,
  });
  const csv = Papa.unparse(sample);
  triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), 'healthinsight_sample_claims_raw.csv');
}

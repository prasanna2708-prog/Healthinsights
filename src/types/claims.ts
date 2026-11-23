export type ClaimType = 'Inpatient' | 'Outpatient' | 'Pharmacy' | 'Diagnostics';
export type RiskSegment = 'Low Risk' | 'Medium Risk' | 'High Risk';
export type Region = 'Northeast' | 'Midwest' | 'South' | 'West';
export type AgeGroup = '0-17' | '18-34' | '35-49' | '50-64' | '65+';
export type PolicyType = 'PPO' | 'HMO' | 'EPO' | 'HDHP' | 'Medicare Advantage';
export type UserRole = 'admin' | 'analyst' | 'viewer';
export type NavSection = 'overview' | 'module1' | 'module2' | 'module3' | 'governance';

export interface RawClaimRow {
  claimId?: string | number;
  patientId?: string | number;
  serviceDate?: string | number;
  amount?: string | number;
  claimType?: string;
  icd10Code?: string;
  patientAge?: string | number;
  region?: string;
  policyType?: string;
  comorbidities?: string | number;
}

export interface ProcessedClaim {
  claimId: string;
  datasetId: string;
  ownerId: string;
  visibility: 'private' | 'shared';
  encryptedPatientId: string;
  maskedPatientId: string;
  rawPatientIdLocal?: string;
  serviceDate: string;
  amount: number;
  claimType: ClaimType;
  icd10Code: string;
  icd10Category: string;
  patientAge: number;
  ageGroup: AgeGroup;
  region: Region;
  policyType: PolicyType;
  comorbidities: number;
  isAnomaly: boolean;
  anomalyReason: string;
  riskScore: number;
  riskSegment: RiskSegment;
}

export interface ClaimsDatasetMeta {
  id: string;
  name: string;
  sourceFileName: string;
  ownerId: string;
  ownerName: string;
  visibility: 'private' | 'shared';
  totalClaims: number;
  cleanedClaims: number;
  anomaliesDetected: number;
  totalClaimAmount: number;
  avgClaimAmount: number;
  lowRiskCount: number;
  mediumRiskCount: number;
  highRiskCount: number;
  encryptionAlg: 'AES-256-GCM';
  keyFingerprint: string;
  isLocalOnly?: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PreprocessingReport {
  rawRowsRead: number;
  validRowsRetained: number;
  droppedInvalidRows: number;
  missingValuesImputed: number;
  datesNormalized: number;
  icdCodesStandardized: number;
  anomaliesFlagged: number;
  encryptedIdentifiers: number;
}

export interface RiskRuleConfig {
  id: string;
  name: string;
  ownerId: string;
  visibility: 'private' | 'shared';
  highAmountThreshold: number;
  mediumAmountThreshold: number;
  highComorbidityThreshold: number;
  mediumComorbidityThreshold: number;
  inpatientWeight: number;
  ageThreshold: number;
  ageWeight: number;
  anomalyZScoreThreshold: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface GlobalFilterState {
  search: string;
  region: Region | 'All';
  ageGroup: AgeGroup | 'All';
  policyType: PolicyType | 'All';
  claimType: ClaimType | 'All';
  riskSegment: RiskSegment | 'All';
  dateFrom: string;
  dateTo: string;
  amountMin: number;
  amountMax: number;
}

export interface PremiumScenario {
  id: string;
  name: string;
  datasetId: string;
  ownerId: string;
  visibility: 'private' | 'shared';
  frequencyDeltaPct: number;
  severityDeltaPct: number;
  highRiskReductionPct: number;
  adminLoadPct: number;
  targetLossRatioPct: number;
  baselinePurePremium: number;
  projectedPurePremium: number;
  projectedGrossPremium: number;
  p95AggregateLoss: number;
  createdAt?: unknown;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  role: UserRole;
  department: string;
  email?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AuditLogEntry {
  id: string;
  actorUid: string;
  actorRole: UserRole;
  action: string;
  resourcePath: string;
  details: string;
  createdAt?: unknown;
}

export interface MonteCarloSummary {
  trials: number;
  meanAggregateLoss: number;
  medianAggregateLoss: number;
  p5AggregateLoss: number;
  p95AggregateLoss: number;
  p99AggregateLoss: number;
  purePremiumPerMember: number;
  p95PurePremiumPerMember: number;
  simulatedTotals: number[];
  monthlyFan: {
    month: string;
    p5: number;
    p25: number;
    p50: number;
    p75: number;
    p95: number;
    actual?: number;
  }[];
}

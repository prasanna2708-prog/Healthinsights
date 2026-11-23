import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  DEFAULT_RISK_RULES,
  evaluateRiskAndAnomalies,
  generateCuratedSampleRawRows,
  parseClaimsFile,
  preprocessAndTagClaims,
} from '../lib/claimsEngine';
import {
  deriveKeyFromPassphrase,
  getOrCreateSessionCrypto,
  rotateSessionCryptoKey,
} from '../lib/crypto';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  ClaimsDatasetMeta,
  GlobalFilterState,
  PremiumScenario,
  PreprocessingReport,
  ProcessedClaim,
  RiskRuleConfig,
} from '../types/claims';
import { useAuth } from './AuthContext';

export const DEFAULT_FILTERS: GlobalFilterState = {
  search: '',
  region: 'All',
  ageGroup: 'All',
  policyType: 'All',
  claimType: 'All',
  riskSegment: 'All',
  dateFrom: '',
  dateTo: '',
  amountMin: 0,
  amountMax: 150000,
};

interface ClaimsDataContextValue {
  datasets: ClaimsDatasetMeta[];
  activeDataset: ClaimsDatasetMeta | null;
  claims: ProcessedClaim[];
  filteredClaims: ProcessedClaim[];
  filters: GlobalFilterState;
  setFilters: React.Dispatch<React.SetStateAction<GlobalFilterState>>;
  resetFilters: () => void;
  riskRules: RiskRuleConfig;
  savedRiskRules: RiskRuleConfig[];
  savedScenarios: PremiumScenario[];
  lastReport: PreprocessingReport | null;
  keyFingerprint: string;
  loadingData: boolean;
  syncingCloud: boolean;
  statusMessage: string | null;
  errorMessage: string | null;
  clearMessages: () => void;
  selectDataset: (datasetId: string) => Promise<void>;
  processUploadedFile: (
    file: File,
    datasetName: string,
    visibility: 'private' | 'shared',
    persistToCloud: boolean,
  ) => Promise<void>;
  loadSamplePortfolio: () => Promise<void>;
  applyRiskRules: (nextRules: RiskRuleConfig) => void;
  saveRiskRulePreset: (presetName: string, rules: RiskRuleConfig) => Promise<void>;
  saveScenarioToCloud: (
    scenario: Omit<PremiumScenario, 'id' | 'ownerId' | 'createdAt'>,
  ) => Promise<void>;
  deleteCloudDataset: (datasetId: string) => Promise<void>;
  rotateEncryptionKey: () => Promise<void>;
  setEncryptionPassphrase: (passphrase: string) => Promise<void>;
}

const ClaimsDataContext = createContext<ClaimsDataContextValue | null>(null);

export function ClaimsDataProvider({ children }: { children: React.ReactNode }) {
  const { firebaseUser, profile, effectiveRole, authReady, recordAuditEvent } = useAuth();

  const [localDataset, setLocalDataset] = useState<ClaimsDatasetMeta | null>(null);
  const [localClaims, setLocalClaims] = useState<ProcessedClaim[]>([]);
  const [cloudDatasets, setCloudDatasets] = useState<ClaimsDatasetMeta[]>([]);
  const [activeDatasetId, setActiveDatasetId] = useState<string>('baseline-q4-2026');
  const [activeCloudClaims, setActiveCloudClaims] = useState<ProcessedClaim[] | null>(null);

  const [filters, setFilters] = useState<GlobalFilterState>(DEFAULT_FILTERS);
  const [riskRules, setRiskRules] = useState<RiskRuleConfig>(DEFAULT_RISK_RULES);
  const [savedRiskRules, setSavedRiskRules] = useState<RiskRuleConfig[]>([DEFAULT_RISK_RULES]);
  const [savedScenarios, setSavedScenarios] = useState<PremiumScenario[]>([]);
  const [lastReport, setLastReport] = useState<PreprocessingReport | null>(null);
  const [keyFingerprint, setKeyFingerprint] = useState<string>('INITIALIZING');
  const [loadingData, setLoadingData] = useState<boolean>(true);
  const [syncingCloud, setSyncingCloud] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const clearMessages = useCallback(() => {
    setStatusMessage(null);
    setErrorMessage(null);
  }, []);

  // Load curated 320-claim actuarial baseline immediately on mount
  const loadSamplePortfolio = useCallback(async () => {
    setLoadingData(true);
    setErrorMessage(null);
    try {
      const ctx = await getOrCreateSessionCrypto();
      setKeyFingerprint(ctx.fingerprint);
      const raw = generateCuratedSampleRawRows(320);
      const result = await preprocessAndTagClaims(
        raw,
        'baseline-q4-2026',
        'system',
        'shared',
        riskRules,
        ctx,
      );
      const totalAmt = result.claims.reduce((s, c) => s + c.amount, 0);
      const meta: ClaimsDatasetMeta = {
        id: 'baseline-q4-2026',
        name: '2025–2026 Commercial & Medicare Claims Portfolio',
        sourceFileName: 'healthinsight_baseline_320.csv',
        ownerId: 'system',
        ownerName: 'Actuarial Baseline',
        visibility: 'shared',
        totalClaims: result.report.rawRowsRead,
        cleanedClaims: result.report.validRowsRetained,
        anomaliesDetected: result.report.anomaliesFlagged,
        totalClaimAmount: Math.round(totalAmt * 100) / 100,
        avgClaimAmount: Math.round((totalAmt / Math.max(result.claims.length, 1)) * 100) / 100,
        lowRiskCount: result.claims.filter((c) => c.riskSegment === 'Low Risk').length,
        mediumRiskCount: result.claims.filter((c) => c.riskSegment === 'Medium Risk').length,
        highRiskCount: result.claims.filter((c) => c.riskSegment === 'High Risk').length,
        encryptionAlg: 'AES-256-GCM',
        keyFingerprint: result.keyFingerprint,
        isLocalOnly: true,
      };
      setLocalDataset(meta);
      setLocalClaims(result.claims);
      setActiveCloudClaims(null);
      setActiveDatasetId(meta.id);
      setLastReport(result.report);
      setFilters(DEFAULT_FILTERS);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to initialize baseline data.');
    } finally {
      setLoadingData(false);
    }
  }, [riskRules]);

  useEffect(() => {
    void loadSamplePortfolio();
    // Run once on initial boot
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Real-time Firestore listeners (strictly attached when authReady && firebaseUser)
  useEffect(() => {
    if (!authReady || !firebaseUser) {
      setCloudDatasets([]);
      setSavedRiskRules([DEFAULT_RISK_RULES]);
      setSavedScenarios([]);
      return;
    }

    const sharedDsMap = new Map<string, ClaimsDatasetMeta>();
    const ownedDsMap = new Map<string, ClaimsDatasetMeta>();

    const mergeDatasets = () => {
      const merged = new Map<string, ClaimsDatasetMeta>([...sharedDsMap, ...ownedDsMap]);
      setCloudDatasets(Array.from(merged.values()));
    };

    const parseDatasetDoc = (d: Record<string, unknown>): ClaimsDatasetMeta => ({
      id: String(d.id),
      name: String(d.name),
      sourceFileName: String(d.sourceFileName),
      ownerId: String(d.ownerId),
      ownerName: String(d.ownerName),
      visibility: (d.visibility as 'private' | 'shared') ?? 'private',
      totalClaims: Number(d.totalClaims ?? 0),
      cleanedClaims: Number(d.cleanedClaims ?? 0),
      anomaliesDetected: Number(d.anomaliesDetected ?? 0),
      totalClaimAmount: Number(d.totalClaimAmount ?? 0),
      avgClaimAmount: Number(d.avgClaimAmount ?? 0),
      lowRiskCount: Number(d.lowRiskCount ?? 0),
      mediumRiskCount: Number(d.mediumRiskCount ?? 0),
      highRiskCount: Number(d.highRiskCount ?? 0),
      encryptionAlg: 'AES-256-GCM',
      keyFingerprint: String(d.keyFingerprint ?? ''),
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    });

    const unsubSharedDs = onSnapshot(
      query(collection(db, 'datasets'), where('visibility', '==', 'shared')),
      (snap) => {
        sharedDsMap.clear();
        snap.docs.forEach((docSnap) => {
          const item = parseDatasetDoc(docSnap.data());
          sharedDsMap.set(item.id, item);
        });
        mergeDatasets();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'datasets'),
    );

    const unsubOwnedDs = onSnapshot(
      query(collection(db, 'datasets'), where('ownerId', '==', firebaseUser.uid)),
      (snap) => {
        ownedDsMap.clear();
        snap.docs.forEach((docSnap) => {
          const item = parseDatasetDoc(docSnap.data());
          ownedDsMap.set(item.id, item);
        });
        mergeDatasets();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'datasets'),
    );

    // Risk rules listeners
    const sharedRules = new Map<string, RiskRuleConfig>();
    const ownedRules = new Map<string, RiskRuleConfig>();
    const mergeRules = () => {
      const merged = new Map<string, RiskRuleConfig>([
        [DEFAULT_RISK_RULES.id, DEFAULT_RISK_RULES],
        ...sharedRules,
        ...ownedRules,
      ]);
      setSavedRiskRules(Array.from(merged.values()));
    };

    const parseRuleDoc = (d: Record<string, unknown>): RiskRuleConfig => ({
      id: String(d.id),
      name: String(d.name),
      ownerId: String(d.ownerId),
      visibility: (d.visibility as 'private' | 'shared') ?? 'shared',
      highAmountThreshold: Number(d.highAmountThreshold),
      mediumAmountThreshold: Number(d.mediumAmountThreshold),
      highComorbidityThreshold: Number(d.highComorbidityThreshold),
      mediumComorbidityThreshold: Number(d.mediumComorbidityThreshold),
      inpatientWeight: Number(d.inpatientWeight),
      ageThreshold: Number(d.ageThreshold),
      ageWeight: Number(d.ageWeight),
      anomalyZScoreThreshold: Number(d.anomalyZScoreThreshold),
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    });

    const unsubSharedRules = onSnapshot(
      query(collection(db, 'riskRules'), where('visibility', '==', 'shared')),
      (snap) => {
        sharedRules.clear();
        snap.docs.forEach((docSnap) => {
          const item = parseRuleDoc(docSnap.data());
          sharedRules.set(item.id, item);
        });
        mergeRules();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'riskRules'),
    );

    const unsubOwnedRules = onSnapshot(
      query(collection(db, 'riskRules'), where('ownerId', '==', firebaseUser.uid)),
      (snap) => {
        ownedRules.clear();
        snap.docs.forEach((docSnap) => {
          const item = parseRuleDoc(docSnap.data());
          ownedRules.set(item.id, item);
        });
        mergeRules();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'riskRules'),
    );

    // Scenarios listeners
    const sharedScenarios = new Map<string, PremiumScenario>();
    const ownedScenarios = new Map<string, PremiumScenario>();
    const mergeScenarios = () => {
      const merged = new Map<string, PremiumScenario>([
        ...sharedScenarios,
        ...ownedScenarios,
      ]);
      setSavedScenarios(Array.from(merged.values()));
    };

    const parseScenarioDoc = (d: Record<string, unknown>): PremiumScenario => ({
      id: String(d.id),
      name: String(d.name),
      datasetId: String(d.datasetId),
      ownerId: String(d.ownerId),
      visibility: (d.visibility as 'private' | 'shared') ?? 'shared',
      frequencyDeltaPct: Number(d.frequencyDeltaPct),
      severityDeltaPct: Number(d.severityDeltaPct),
      highRiskReductionPct: Number(d.highRiskReductionPct),
      adminLoadPct: Number(d.adminLoadPct),
      targetLossRatioPct: Number(d.targetLossRatioPct),
      baselinePurePremium: Number(d.baselinePurePremium),
      projectedPurePremium: Number(d.projectedPurePremium),
      projectedGrossPremium: Number(d.projectedGrossPremium),
      p95AggregateLoss: Number(d.p95AggregateLoss),
      createdAt: d.createdAt,
    });

    const unsubSharedScenarios = onSnapshot(
      query(collection(db, 'scenarios'), where('visibility', '==', 'shared')),
      (snap) => {
        sharedScenarios.clear();
        snap.docs.forEach((docSnap) => {
          const item = parseScenarioDoc(docSnap.data());
          sharedScenarios.set(item.id, item);
        });
        mergeScenarios();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'scenarios'),
    );

    const unsubOwnedScenarios = onSnapshot(
      query(collection(db, 'scenarios'), where('ownerId', '==', firebaseUser.uid)),
      (snap) => {
        ownedScenarios.clear();
        snap.docs.forEach((docSnap) => {
          const item = parseScenarioDoc(docSnap.data());
          ownedScenarios.set(item.id, item);
        });
        mergeScenarios();
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'scenarios'),
    );

    return () => {
      unsubSharedDs();
      unsubOwnedDs();
      unsubSharedRules();
      unsubOwnedRules();
      unsubSharedScenarios();
      unsubOwnedScenarios();
    };
  }, [authReady, firebaseUser]);

  const datasets = useMemo(() => {
    const list: ClaimsDatasetMeta[] = [];
    if (localDataset) list.push(localDataset);
    cloudDatasets.forEach((cd) => {
      if (cd.id !== localDataset?.id) list.push(cd);
    });
    return list;
  }, [localDataset, cloudDatasets]);

  const activeDataset = useMemo(
    () => datasets.find((d) => d.id === activeDatasetId) ?? localDataset ?? datasets[0] ?? null,
    [datasets, activeDatasetId, localDataset],
  );

  const claims = useMemo(
    () => (activeCloudClaims !== null ? activeCloudClaims : localClaims),
    [activeCloudClaims, localClaims],
  );

  const selectDataset = useCallback(
    async (datasetId: string) => {
      setErrorMessage(null);
      if (localDataset && datasetId === localDataset.id) {
        setActiveCloudClaims(null);
        setActiveDatasetId(datasetId);
        setFilters(DEFAULT_FILTERS);
        return;
      }

      const target = cloudDatasets.find((d) => d.id === datasetId);
      if (!target || !firebaseUser) return;

      setLoadingData(true);
      const claimsPath = `datasets/${datasetId}/claims`;
      try {
        const q =
          target.ownerId === firebaseUser.uid
            ? query(collection(db, 'datasets', datasetId, 'claims'), where('ownerId', '==', firebaseUser.uid))
            : query(collection(db, 'datasets', datasetId, 'claims'), where('visibility', '==', 'shared'));
        const snap = await getDocs(q);
        const loaded: ProcessedClaim[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            claimId: String(d.claimId),
            datasetId: String(d.datasetId),
            ownerId: String(d.ownerId),
            visibility: (d.visibility as 'private' | 'shared') ?? 'private',
            encryptedPatientId: String(d.encryptedPatientId),
            maskedPatientId: String(d.maskedPatientId),
            serviceDate: String(d.serviceDate),
            amount: Number(d.amount),
            claimType: d.claimType,
            icd10Code: String(d.icd10Code),
            icd10Category: String(d.icd10Category),
            patientAge: Number(d.patientAge),
            ageGroup: d.ageGroup,
            region: d.region,
            policyType: d.policyType,
            comorbidities: Number(d.comorbidities),
            isAnomaly: Boolean(d.isAnomaly),
            anomalyReason: String(d.anomalyReason ?? ''),
            riskScore: Number(d.riskScore),
            riskSegment: d.riskSegment,
          };
        });

        setActiveCloudClaims(loaded);
        setActiveDatasetId(datasetId);
        setFilters(DEFAULT_FILTERS);
        setLastReport({
          rawRowsRead: target.totalClaims,
          validRowsRetained: loaded.length,
          droppedInvalidRows: Math.max(0, target.totalClaims - target.cleanedClaims),
          missingValuesImputed: 0,
          datesNormalized: 0,
          icdCodesStandardized: 0,
          anomaliesFlagged: loaded.filter((c) => c.isAnomaly).length,
          encryptedIdentifiers: loaded.length,
        });
        setStatusMessage(`Loaded cloud dataset "${target.name}" (${loaded.length} encrypted claims).`);
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, claimsPath);
      } finally {
        setLoadingData(false);
      }
    },
    [cloudDatasets, firebaseUser, localDataset],
  );

  const processUploadedFile = useCallback(
    async (
      file: File,
      datasetName: string,
      visibility: 'private' | 'shared',
      persistToCloud: boolean,
    ) => {
      setLoadingData(true);
      setErrorMessage(null);
      setStatusMessage(null);

      try {
        const rawRows = await parseClaimsFile(file);
        if (rawRows.length === 0) {
          throw new Error('Uploaded file contains zero rows.');
        }

        const dsId = `ds_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const ownerId = firebaseUser?.uid ?? 'local_session';
        const ctx = await getOrCreateSessionCrypto();
        setKeyFingerprint(ctx.fingerprint);

        const result = await preprocessAndTagClaims(
          rawRows,
          dsId,
          ownerId,
          visibility,
          riskRules,
          ctx,
        );

        if (result.claims.length === 0) {
          throw new Error(
            'All rows were rejected during validation (missing valid service date or positive claim amount).',
          );
        }

        const totalAmt = result.claims.reduce((s, c) => s + c.amount, 0);
        const lowCount = result.claims.filter((c) => c.riskSegment === 'Low Risk').length;
        const medCount = result.claims.filter((c) => c.riskSegment === 'Medium Risk').length;
        const highCount = result.claims.filter((c) => c.riskSegment === 'High Risk').length;

        const cleanName = (datasetName.trim() || file.name.replace(/\.[^.]+$/, '')).slice(0, 120);
        const meta: ClaimsDatasetMeta = {
          id: dsId,
          name: cleanName,
          sourceFileName: file.name.slice(0, 120),
          ownerId,
          ownerName: (profile?.displayName || firebaseUser?.displayName || 'Local Analyst').slice(0, 80),
          visibility,
          totalClaims: Math.round(result.report.rawRowsRead),
          cleanedClaims: Math.round(result.report.validRowsRetained),
          anomaliesDetected: Math.round(result.report.anomaliesFlagged),
          totalClaimAmount: Math.round(totalAmt * 100) / 100,
          avgClaimAmount: Math.round((totalAmt / result.claims.length) * 100) / 100,
          lowRiskCount: Math.round(lowCount),
          mediumRiskCount: Math.round(medCount),
          highRiskCount: Math.round(highCount),
          encryptionAlg: 'AES-256-GCM',
          keyFingerprint: result.keyFingerprint,
          isLocalOnly: !persistToCloud,
        };

        if (persistToCloud) {
          if (!firebaseUser) {
            throw new Error('Sign in with Google before saving datasets to Firestore.');
          }
          if (effectiveRole === 'viewer') {
            throw new Error(
              'Viewer accounts cannot persist datasets to Firestore. Ask an Admin to promote your role to Analyst.',
            );
          }

          setSyncingCloud(true);
          const dsPath = `datasets/${dsId}`;
          try {
            // Create parent dataset document first so subcollection exists() gate passes
            await setDoc(doc(db, 'datasets', dsId), {
              id: meta.id,
              name: meta.name,
              sourceFileName: meta.sourceFileName,
              ownerId: firebaseUser.uid,
              ownerName: meta.ownerName,
              visibility: meta.visibility,
              totalClaims: meta.totalClaims,
              cleanedClaims: meta.cleanedClaims,
              anomaliesDetected: meta.anomaliesDetected,
              totalClaimAmount: meta.totalClaimAmount,
              avgClaimAmount: meta.avgClaimAmount,
              lowRiskCount: meta.lowRiskCount,
              mediumRiskCount: meta.mediumRiskCount,
              highRiskCount: meta.highRiskCount,
              encryptionAlg: 'AES-256-GCM',
              keyFingerprint: meta.keyFingerprint,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });

            // Persist up to 450 normalized claims via chunked writeBatch (never storing rawPatientIdLocal!)
            const claimsToPersist = result.claims.slice(0, 450);
            for (let i = 0; i < claimsToPersist.length; i += 200) {
              const chunk = claimsToPersist.slice(i, i + 200);
              const batch = writeBatch(db);
              for (const c of chunk) {
                const claimRef = doc(db, 'datasets', dsId, 'claims', c.claimId);
                batch.set(claimRef, {
                  claimId: c.claimId,
                  datasetId: dsId,
                  ownerId: firebaseUser.uid,
                  visibility: meta.visibility,
                  encryptedPatientId: c.encryptedPatientId.slice(0, 256),
                  maskedPatientId: c.maskedPatientId.slice(0, 32),
                  serviceDate: c.serviceDate,
                  amount: c.amount,
                  claimType: c.claimType,
                  icd10Code: c.icd10Code.slice(0, 16),
                  icd10Category: c.icd10Category.slice(0, 64),
                  patientAge: Math.round(c.patientAge),
                  ageGroup: c.ageGroup,
                  region: c.region,
                  policyType: c.policyType,
                  comorbidities: Math.round(c.comorbidities),
                  isAnomaly: c.isAnomaly,
                  anomalyReason: c.anomalyReason.slice(0, 120),
                  riskScore: c.riskScore,
                  riskSegment: c.riskSegment,
                  createdAt: serverTimestamp(),
                });
              }
              await batch.commit();
            }

            await recordAuditEvent(
              'DATASET_INGEST_ENCRYPTED',
              dsPath,
              `Uploaded ${claimsToPersist.length} AES-256-GCM encrypted claims (${meta.sourceFileName})`,
            );

            setActiveCloudClaims(result.claims);
            setActiveDatasetId(dsId);
            setStatusMessage(
              `Preprocessed ${result.claims.length} claims, encrypted IDs (AES-256-GCM), and synced to Firestore.`,
            );
          } catch (err) {
            handleFirestoreError(err, OperationType.WRITE, dsPath);
          } finally {
            setSyncingCloud(false);
          }
        } else {
          setLocalDataset(meta);
          setLocalClaims(result.claims);
          setActiveCloudClaims(null);
          setActiveDatasetId(dsId);
          setStatusMessage(
            `Preprocessed ${result.claims.length} claims locally with AES-256-GCM pseudonymization.`,
          );
        }

        setLastReport(result.report);
        setFilters(DEFAULT_FILTERS);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'File preprocessing failed.');
      } finally {
        setLoadingData(false);
      }
    },
    [effectiveRole, firebaseUser, profile?.displayName, recordAuditEvent, riskRules],
  );

  const applyRiskRules = useCallback(
    (nextRules: RiskRuleConfig) => {
      setRiskRules(nextRules);
      if (activeCloudClaims !== null) {
        setActiveCloudClaims((prev) => (prev ? evaluateRiskAndAnomalies(prev, nextRules) : prev));
      } else {
        setLocalClaims((prev) => evaluateRiskAndAnomalies(prev, nextRules));
      }
      setStatusMessage(`Applied risk segmentation rules ("${nextRules.name}") across active claims.`);
    },
    [activeCloudClaims],
  );

  const saveRiskRulePreset = useCallback(
    async (presetName: string, rules: RiskRuleConfig) => {
      if (!firebaseUser) {
        setErrorMessage('Sign in with Google to save custom risk rule presets.');
        return;
      }
      if (effectiveRole === 'viewer') {
        setErrorMessage('Viewer accounts cannot save global risk rule presets.');
        return;
      }
      const ruleId = `rule_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const path = `riskRules/${ruleId}`;
      setSyncingCloud(true);
      try {
        await setDoc(doc(db, 'riskRules', ruleId), {
          id: ruleId,
          name: presetName.trim().slice(0, 100) || 'Custom Risk Rule',
          ownerId: firebaseUser.uid,
          visibility: 'shared',
          highAmountThreshold: Number(rules.highAmountThreshold),
          mediumAmountThreshold: Number(rules.mediumAmountThreshold),
          highComorbidityThreshold: Math.round(rules.highComorbidityThreshold),
          mediumComorbidityThreshold: Math.round(rules.mediumComorbidityThreshold),
          inpatientWeight: Number(rules.inpatientWeight),
          ageThreshold: Math.round(rules.ageThreshold),
          ageWeight: Number(rules.ageWeight),
          anomalyZScoreThreshold: Number(rules.anomalyZScoreThreshold),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await recordAuditEvent(
          'RISK_RULE_SAVED',
          path,
          `Saved risk rule preset "${presetName.slice(0, 60)}"`,
        );
        setStatusMessage(`Saved risk rule preset "${presetName}" to Firestore.`);
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, path);
      } finally {
        setSyncingCloud(false);
      }
    },
    [effectiveRole, firebaseUser, recordAuditEvent],
  );

  const saveScenarioToCloud = useCallback(
    async (scenario: Omit<PremiumScenario, 'id' | 'ownerId' | 'createdAt'>) => {
      if (!firebaseUser) {
        setErrorMessage('Sign in with Google to save premium cost scenarios.');
        return;
      }
      if (effectiveRole === 'viewer') {
        setErrorMessage('Viewer accounts cannot save scenarios to Firestore.');
        return;
      }
      const scenarioId = `scen_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const path = `scenarios/${scenarioId}`;
      setSyncingCloud(true);
      try {
        await setDoc(doc(db, 'scenarios', scenarioId), {
          id: scenarioId,
          name: scenario.name.trim().slice(0, 100) || 'Scenario Snapshot',
          datasetId: scenario.datasetId,
          ownerId: firebaseUser.uid,
          visibility: scenario.visibility,
          frequencyDeltaPct: Number(scenario.frequencyDeltaPct),
          severityDeltaPct: Number(scenario.severityDeltaPct),
          highRiskReductionPct: Number(scenario.highRiskReductionPct),
          adminLoadPct: Number(scenario.adminLoadPct),
          targetLossRatioPct: Number(scenario.targetLossRatioPct),
          baselinePurePremium: Number(scenario.baselinePurePremium),
          projectedPurePremium: Number(scenario.projectedPurePremium),
          projectedGrossPremium: Number(scenario.projectedGrossPremium),
          p95AggregateLoss: Number(scenario.p95AggregateLoss),
          createdAt: serverTimestamp(),
        });
        await recordAuditEvent(
          'SCENARIO_SAVED',
          path,
          `Saved scenario "${scenario.name.slice(0, 60)}" (Proj Pure: $${scenario.projectedPurePremium})`,
        );
        setStatusMessage(`Saved scenario "${scenario.name}" to Firestore.`);
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, path);
      } finally {
        setSyncingCloud(false);
      }
    },
    [effectiveRole, firebaseUser, recordAuditEvent],
  );

  const deleteCloudDataset = useCallback(
    async (datasetId: string) => {
      if (!firebaseUser) return;
      const path = `datasets/${datasetId}`;
      setSyncingCloud(true);
      try {
        await deleteDoc(doc(db, 'datasets', datasetId));
        await recordAuditEvent('DATASET_DELETED', path, `Deleted dataset ${datasetId}`);
        if (activeDatasetId === datasetId) {
          await loadSamplePortfolio();
        }
        setStatusMessage('Dataset removed from cloud catalog.');
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, path);
      } finally {
        setSyncingCloud(false);
      }
    },
    [activeDatasetId, firebaseUser, loadSamplePortfolio, recordAuditEvent],
  );

  const rotateEncryptionKey = useCallback(async () => {
    const ctx = await rotateSessionCryptoKey();
    setKeyFingerprint(ctx.fingerprint);
    await recordAuditEvent(
      'CRYPTO_KEY_ROTATED',
      'session/aes-256-gcm',
      `Rotated AES-256-GCM session key (${ctx.fingerprint})`,
    );
    setStatusMessage(`Rotated AES-256-GCM session key (Fingerprint: ${ctx.fingerprint}).`);
  }, [recordAuditEvent]);

  const setEncryptionPassphrase = useCallback(
    async (passphrase: string) => {
      if (passphrase.trim().length < 8) {
        setErrorMessage('Passphrase must be at least 8 characters for PBKDF2-SHA256 derivation.');
        return;
      }
      const ctx = await deriveKeyFromPassphrase(passphrase.trim());
      setKeyFingerprint(ctx.fingerprint);
      await recordAuditEvent(
        'CRYPTO_KEY_DERIVED',
        'session/pbkdf2-aes256',
        `Derived AES-256-GCM key via PBKDF2 (${ctx.fingerprint})`,
      );
      setStatusMessage(`Active AES-256-GCM key derived (Fingerprint: ${ctx.fingerprint}).`);
    },
    [recordAuditEvent],
  );

  const filteredClaims = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return claims.filter((c) => {
      if (filters.region !== 'All' && c.region !== filters.region) return false;
      if (filters.ageGroup !== 'All' && c.ageGroup !== filters.ageGroup) return false;
      if (filters.policyType !== 'All' && c.policyType !== filters.policyType) return false;
      if (filters.claimType !== 'All' && c.claimType !== filters.claimType) return false;
      if (filters.riskSegment !== 'All' && c.riskSegment !== filters.riskSegment) return false;
      if (filters.dateFrom && c.serviceDate < filters.dateFrom) return false;
      if (filters.dateTo && c.serviceDate > filters.dateTo) return false;
      if (c.amount < filters.amountMin || c.amount > filters.amountMax) return false;
      if (q) {
        const hit =
          c.claimId.toLowerCase().includes(q) ||
          c.maskedPatientId.toLowerCase().includes(q) ||
          c.icd10Code.toLowerCase().includes(q) ||
          c.icd10Category.toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [claims, filters]);

  const resetFilters = useCallback(() => setFilters(DEFAULT_FILTERS), []);

  return (
    <ClaimsDataContext.Provider
      value={{
        datasets,
        activeDataset,
        claims,
        filteredClaims,
        filters,
        setFilters,
        resetFilters,
        riskRules,
        savedRiskRules,
        savedScenarios,
        lastReport,
        keyFingerprint,
        loadingData,
        syncingCloud,
        statusMessage,
        errorMessage,
        clearMessages,
        selectDataset,
        processUploadedFile,
        loadSamplePortfolio,
        applyRiskRules,
        saveRiskRulePreset,
        saveScenarioToCloud,
        deleteCloudDataset,
        rotateEncryptionKey,
        setEncryptionPassphrase,
      }}
    >
      {children}
    </ClaimsDataContext.Provider>
  );
}

export function useClaimsData(): ClaimsDataContextValue {
  const ctx = useContext(ClaimsDataContext);
  if (!ctx) throw new Error('useClaimsData must be used inside ClaimsDataProvider');
  return ctx;
}

import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  KeyRound,
  Lock,
  RefreshCw,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useClaimsData } from '../context/ClaimsDataContext';
import {
  downloadSampleRawCSV,
  exportClaimsToCSV,
  exportClaimsToExcel,
  exportRiskTagsJSON,
} from '../lib/claimsEngine';
import { decryptPatientId } from '../lib/crypto';
import { RiskRuleConfig, RiskSegment } from '../types/claims';
import { RiskDonutChart, RiskExposureBarChart } from './charts/D3Charts';

export function Module1PreprocessingView() {
  const { firebaseUser, effectiveRole } = useAuth();
  const {
    activeDataset,
    datasets,
    filteredClaims,
    riskRules,
    savedRiskRules,
    lastReport,
    keyFingerprint,
    syncingCloud,
    processUploadedFile,
    loadSamplePortfolio,
    applyRiskRules,
    saveRiskRulePreset,
    deleteCloudDataset,
  } = useClaimsData();

  const [datasetName, setDatasetName] = useState('');
  const [visibility, setVisibility] = useState<'shared' | 'private'>('shared');
  const [persistCloud, setPersistCloud] = useState<boolean>(false);
  const [dragOver, setDragOver] = useState(false);

  const [draftRules, setDraftRules] = useState<RiskRuleConfig>(riskRules);
  const [presetName, setPresetName] = useState('Custom Actuarial Rules');
  const [onlyAnomalies, setOnlyAnomalies] = useState(false);
  const [sortBy, setSortBy] = useState<'amount' | 'riskScore' | 'serviceDate'>('riskScore');
  const [page, setPage] = useState(1);
  const [decryptedIds, setDecryptedIds] = useState<Record<string, string>>({});

  const canWriteCloud = Boolean(firebaseUser && effectiveRole !== 'viewer');

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    await processUploadedFile(
      file,
      datasetName || file.name.replace(/\.[^.]+$/, ''),
      visibility,
      persistCloud && canWriteCloud,
    );
    setPage(1);
  };

  const riskBreakdown = useMemo(() => {
    const segs: RiskSegment[] = ['Low Risk', 'Medium Risk', 'High Risk'];
    return segs.map((seg) => {
      const sub = filteredClaims.filter((c) => c.riskSegment === seg);
      return {
        segment: seg,
        count: sub.length,
        amount: sub.reduce((s, c) => s + c.amount, 0),
      };
    });
  }, [filteredClaims]);

  const tableRows = useMemo(() => {
    const base = onlyAnomalies ? filteredClaims.filter((c) => c.isAnomaly) : filteredClaims;
    return [...base].sort((a, b) => {
      if (sortBy === 'amount') return b.amount - a.amount;
      if (sortBy === 'riskScore') return b.riskScore - a.riskScore;
      return b.serviceDate.localeCompare(a.serviceDate);
    });
  }, [filteredClaims, onlyAnomalies, sortBy]);

  const pageSize = 12;
  const totalPages = Math.max(1, Math.ceil(tableRows.length / pageSize));
  const pagedRows = tableRows.slice((page - 1) * pageSize, page * pageSize);

  const handleInspectDecrypted = async (claimId: string, encryptedToken: string, localRaw?: string) => {
    if (decryptedIds[claimId]) {
      setDecryptedIds((prev) => {
        const next = { ...prev };
        delete next[claimId];
        return next;
      });
      return;
    }
    const plain = (await decryptPatientId(encryptedToken)) ?? localRaw ?? 'Session Key Unavailable';
    setDecryptedIds((prev) => ({ ...prev, [claimId]: plain }));
  };

  return (
    <div className="space-y-6">
      {/* Header & Upload Panel */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-7 bg-card border border-border rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-foreground">
                01. Claims Data Upload & Automated Preprocessing
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Ingest CSV or Excel (.xlsx/.xls) claims files. Missing values are imputed, dates
                normalized to ISO-8601, ICD-10 codes standardized, and patient IDs encrypted via
                AES-256-GCM.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={downloadSampleRawCSV}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-secondary-foreground bg-secondary hover:bg-muted rounded-lg cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Sample Raw CSV
              </button>
              <button
                type="button"
                onClick={() => void loadSamplePortfolio()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-secondary-foreground bg-secondary hover:bg-muted rounded-lg cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Reset 320-Claim Portfolio
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label htmlFor="dataset-name-input" className="block text-xs font-medium text-foreground mb-1">
                Dataset Label
              </label>
              <input
                id="dataset-name-input"
                type="text"
                value={datasetName}
                onChange={(e) => setDatasetName(e.target.value)}
                placeholder="e.g., Q4 Commercial Medical Claims"
                className="w-full px-3 py-2 text-xs bg-background border border-input rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label htmlFor="dataset-visibility" className="block text-xs font-medium text-foreground mb-1">
                Cloud Visibility
              </label>
              <select
                id="dataset-visibility"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as 'shared' | 'private')}
                className="w-full px-3 py-2 text-xs bg-background border border-input rounded-lg text-foreground focus:outline-none focus:border-primary"
              >
                <option value="shared">Shared Team Workspace</option>
                <option value="private">Private (Owner Only)</option>
              </select>
            </div>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void handleFile(e.dataTransfer.files[0]);
            }}
            className={`border border-dashed rounded-xl p-6 text-center transition-colors ${
              dragOver ? 'border-primary bg-accent' : 'border-border bg-muted/40'
            }`}
          >
            <Upload className="w-6 h-6 text-primary mx-auto mb-2" />
            <div className="text-xs font-medium text-foreground">
              Drag and drop a CSV or Excel claims workbook, or browse files
            </div>
            <div className="text-[11px] text-muted-foreground mt-1">
              Expected columns: claimId, patientId, serviceDate, amount, claimType, icd10Code,
              patientAge, region, policyType, comorbidities
            </div>
            <label className="mt-3 inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-primary-foreground bg-primary hover:bg-primary/90 rounded-lg cursor-pointer transition-colors">
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Select CSV / Excel File
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="sr-only"
                onChange={(e) => void handleFile(e.target.files?.[0])}
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs">
            <label className="inline-flex items-center gap-2 text-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={persistCloud && canWriteCloud}
                disabled={!canWriteCloud}
                onChange={(e) => setPersistCloud(e.target.checked)}
                className="rounded border-input accent-primary"
              />
              <span>Save AES-256-GCM encrypted dataset to Firestore</span>
            </label>
            <div className="text-muted-foreground font-mono text-[11px] flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-primary" />
              Key Fingerprint: {keyFingerprint}
            </div>
          </div>
          {!canWriteCloud && (
            <div className="text-[11px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-lg px-3 py-2">
              {firebaseUser
                ? 'Signed in as Viewer: local uploads are active, while Firestore cloud persistence requires Analyst or Admin privileges.'
                : 'Not signed in: uploads run in local browser memory with AES-256-GCM encryption. Sign in as Analyst/Admin to sync to Firestore.'}
            </div>
          )}
        </div>

        {/* Preprocessing Pipeline Metrics */}
        <div className="xl:col-span-5 bg-card border border-border rounded-xl p-5 flex flex-col justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Preprocessing & Hygiene Verification
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Automated pipeline output for {activeDataset?.sourceFileName ?? 'active dataset'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Raw Rows Read', val: lastReport?.rawRowsRead ?? 0 },
              { label: 'Valid Claims Retained', val: lastReport?.validRowsRetained ?? 0 },
              { label: 'Invalid Rows Dropped', val: lastReport?.droppedInvalidRows ?? 0 },
              { label: 'Missing Fields Imputed', val: lastReport?.missingValuesImputed ?? 0 },
              { label: 'Dates Normalized (ISO)', val: lastReport?.datesNormalized ?? 0 },
              { label: 'ICD-10 Standardized', val: lastReport?.icdCodesStandardized ?? 0 },
              { label: 'Anomalies Flagged', val: lastReport?.anomaliesFlagged ?? 0 },
              { label: 'IDs Encrypted (AES-256)', val: lastReport?.encryptedIdentifiers ?? 0 },
            ].map((item) => (
              <div key={item.label} className="border border-border rounded-lg p-3 bg-muted/40">
                <div className="text-[11px] text-muted-foreground">{item.label}</div>
                <div className="mt-1 text-base font-semibold font-mono tabular-nums text-foreground">
                  {item.val.toLocaleString()}
                </div>
              </div>
            ))}
          </div>

          {activeDataset && !activeDataset.isLocalOnly && canWriteCloud && (
            <div className="pt-2 border-t border-border flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Cloud dataset synced in Firestore</span>
              <button
                type="button"
                disabled={syncingCloud}
                onClick={() => void deleteCloudDataset(activeDataset.id)}
                className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 hover:underline font-medium cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete Cloud Dataset
              </button>
            </div>
          )}
          {datasets.length > 1 && (
            <div className="text-[11px] text-muted-foreground">
              {datasets.length} datasets available in workspace selector above.
            </div>
          )}
        </div>
      </section>

      {/* Customizable Risk-Segment Tagging Rules + Charts */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-5 bg-card border border-border rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Customizable Risk-Segment Tagging Rules
              </h2>
              <p className="text-xs text-muted-foreground">
                Adjust actuarial thresholds and re-score claims in real time.
              </p>
            </div>
            <select
              aria-label="Load saved risk rule preset"
              value={draftRules.id}
              onChange={(e) => {
                const found = savedRiskRules.find((r) => r.id === e.target.value);
                if (found) {
                  setDraftRules(found);
                  applyRiskRules(found);
                }
              }}
              className="px-2.5 py-1.5 text-xs bg-background border border-input rounded-lg text-foreground max-w-[170px] focus:outline-none focus:border-primary"
            >
              {savedRiskRules.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block text-muted-foreground mb-1">High-Risk Amount ($)</label>
              <input
                type="number"
                min={100}
                step={500}
                value={draftRules.highAmountThreshold}
                onChange={(e) =>
                  setDraftRules((r) => ({ ...r, highAmountThreshold: Number(e.target.value) || 0 }))
                }
                className="w-full px-3 py-1.5 font-mono tabular-nums bg-background border border-input rounded-lg text-foreground focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-muted-foreground mb-1">Medium-Risk Amount ($)</label>
              <input
                type="number"
                min={50}
                step={250}
                value={draftRules.mediumAmountThreshold}
                onChange={(e) =>
                  setDraftRules((r) => ({
                    ...r,
                    mediumAmountThreshold: Number(e.target.value) || 0,
                  }))
                }
                className="w-full px-3 py-1.5 font-mono tabular-nums bg-background border border-input rounded-lg text-foreground focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-muted-foreground mb-1">High Comorbidities (≥)</label>
              <input
                type="number"
                min={1}
                max={15}
                value={draftRules.highComorbidityThreshold}
                onChange={(e) =>
                  setDraftRules((r) => ({
                    ...r,
                    highComorbidityThreshold: Math.max(0, Number(e.target.value) || 0),
                  }))
                }
                className="w-full px-3 py-1.5 font-mono tabular-nums bg-background border border-input rounded-lg text-foreground focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-muted-foreground mb-1">Inpatient Risk Weight</label>
              <input
                type="number"
                min={0}
                max={50}
                value={draftRules.inpatientWeight}
                onChange={(e) =>
                  setDraftRules((r) => ({ ...r, inpatientWeight: Number(e.target.value) || 0 }))
                }
                className="w-full px-3 py-1.5 font-mono tabular-nums bg-background border border-input rounded-lg text-foreground focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-muted-foreground mb-1">Senior Age Threshold</label>
              <input
                type="number"
                min={30}
                max={95}
                value={draftRules.ageThreshold}
                onChange={(e) =>
                  setDraftRules((r) => ({ ...r, ageThreshold: Number(e.target.value) || 60 }))
                }
                className="w-full px-3 py-1.5 font-mono tabular-nums bg-background border border-input rounded-lg text-foreground focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-muted-foreground mb-1">Anomaly Z-Score (σ)</label>
              <input
                type="number"
                min={1.5}
                max={6}
                step={0.1}
                value={draftRules.anomalyZScoreThreshold}
                onChange={(e) =>
                  setDraftRules((r) => ({
                    ...r,
                    anomalyZScoreThreshold: Math.max(1, Number(e.target.value) || 2.5),
                  }))
                }
                className="w-full px-3 py-1.5 font-mono tabular-nums bg-background border border-input rounded-lg text-foreground focus:outline-none focus:border-primary"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={() => applyRiskRules(draftRules)}
              className="px-3.5 py-2 text-xs font-medium text-primary-foreground bg-primary hover:bg-primary/90 rounded-lg cursor-pointer transition-colors"
            >
              Apply Rules Live
            </button>
            <input
              type="text"
              aria-label="Risk rule preset name"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              className="flex-1 min-w-[140px] px-2.5 py-2 text-xs bg-background border border-input rounded-lg text-foreground focus:outline-none focus:border-primary"
            />
            <button
              type="button"
              disabled={!canWriteCloud || syncingCloud}
              onClick={() => void saveRiskRulePreset(presetName, draftRules)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-secondary-foreground bg-secondary hover:bg-muted disabled:opacity-50 rounded-lg cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              Save Preset
            </button>
          </div>
        </div>

        <div className="xl:col-span-7 grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="bg-card border border-border rounded-xl p-5">
            <RiskDonutChart counts={riskBreakdown} title="Tagged Risk Segment Breakdown" />
          </div>
          <div className="bg-card border border-border rounded-xl p-5">
            <RiskExposureBarChart counts={riskBreakdown} />
          </div>
        </div>
      </section>

      {/* Preprocessed Data Table & Exports */}
      <section className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Preprocessed & Pseudonymized Claims Ledger
            </h2>
            <p className="text-xs text-muted-foreground">
              Showing {pagedRows.length} of {tableRows.length.toLocaleString()} cleaned claims
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-xs text-foreground mr-2 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyAnomalies}
                onChange={(e) => {
                  setOnlyAnomalies(e.target.checked);
                  setPage(1);
                }}
                className="rounded border-input accent-primary"
              />
              Anomalies Only
            </label>

            <select
              aria-label="Sort preprocessed table"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'amount' | 'riskScore' | 'serviceDate')}
              className="px-2.5 py-1.5 text-xs bg-background border border-input rounded-lg text-foreground focus:outline-none focus:border-primary"
            >
              <option value="riskScore">Sort: Risk Score</option>
              <option value="amount">Sort: Claim Amount</option>
              <option value="serviceDate">Sort: Service Date</option>
            </select>

            <button
              type="button"
              onClick={() => exportClaimsToCSV(tableRows, 'healthinsight_cleaned_claims.csv')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-secondary-foreground bg-secondary hover:bg-muted rounded-lg cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => exportClaimsToExcel(tableRows, 'healthinsight_cleaned_claims.xlsx')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-secondary-foreground bg-secondary hover:bg-muted rounded-lg cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Export Excel
            </button>
            <button
              type="button"
              onClick={() => exportRiskTagsJSON(tableRows, 'healthinsight_risk_tags.json')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-secondary-foreground bg-secondary hover:bg-muted rounded-lg cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Risk Tags JSON
            </button>
          </div>
        </div>

        <div className="overflow-x-auto border border-border rounded-lg">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-muted/60 border-b border-border text-muted-foreground font-medium">
                <th className="py-2.5 px-3">Claim ID</th>
                <th className="py-2.5 px-3">Patient Token (HIPAA)</th>
                <th className="py-2.5 px-3">Service Date</th>
                <th className="py-2.5 px-3">Type</th>
                <th className="py-2.5 px-3">ICD-10</th>
                <th className="py-2.5 px-3 text-right">Age / Comorb</th>
                <th className="py-2.5 px-3 text-right">Amount</th>
                <th className="py-2.5 px-3 text-right">Risk Score</th>
                <th className="py-2.5 px-3">Segment & Anomaly</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pagedRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-muted-foreground">
                    No claims match the active filters.
                  </td>
                </tr>
              ) : (
                pagedRows.map((c) => {
                  const revealed = decryptedIds[c.claimId];
                  return (
                    <tr key={c.claimId} className="hover:bg-muted/40">
                      <td className="py-2.5 px-3 font-mono tabular-nums font-medium text-foreground">
                        {c.claimId}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-foreground">
                        <div className="flex items-center gap-1.5">
                          <span>{revealed ? revealed : c.maskedPatientId}</span>
                          {effectiveRole !== 'viewer' && (
                            <button
                              type="button"
                              title="Decrypt AES-256-GCM patient identifier with active session key"
                              onClick={() =>
                                void handleInspectDecrypted(
                                  c.claimId,
                                  c.encryptedPatientId,
                                  c.rawPatientIdLocal,
                                )
                              }
                              className="p-1 text-muted-foreground hover:text-primary rounded cursor-pointer"
                              aria-label={`Toggle decrypt patient ID for ${c.claimId}`}
                            >
                              <KeyRound className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums text-muted-foreground">
                        {c.serviceDate}
                      </td>
                      <td className="py-2.5 px-3 text-foreground">{c.claimType}</td>
                      <td className="py-2.5 px-3">
                        <span className="font-mono text-foreground">{c.icd10Code}</span>
                        <span className="text-muted-foreground ml-1.5 hidden md:inline">
                          {c.icd10Category}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-foreground">
                        {c.patientAge}y · {c.comorbidities}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums font-medium text-foreground">
                        ${c.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-foreground">
                        {c.riskScore.toFixed(1)}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1.5">
                          {c.riskSegment === 'High Risk' ? (
                            <AlertCircle className="w-3.5 h-3.5 text-red-600 dark:text-red-400 shrink-0" />
                          ) : (
                            <CheckCircle2
                              className={`w-3.5 h-3.5 shrink-0 ${
                                c.riskSegment === 'Medium Risk'
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-teal-600 dark:text-teal-400'
                              }`}
                            />
                          )}
                          <span
                            className={`font-medium ${
                              c.riskSegment === 'High Risk'
                                ? 'text-red-700 dark:text-red-400'
                                : c.riskSegment === 'Medium Risk'
                                  ? 'text-amber-700 dark:text-amber-400'
                                  : 'text-teal-700 dark:text-teal-400'
                            }`}
                          >
                            {c.riskSegment}
                          </span>
                          {c.isAnomaly && (
                            <span
                              title={c.anomalyReason}
                              className="text-primary font-mono text-[11px]"
                            >
                              · Outlier
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="font-mono tabular-nums">
            Page {page} of {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1.5 bg-secondary text-secondary-foreground hover:bg-muted disabled:opacity-40 rounded-lg font-medium cursor-pointer"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-3 py-1.5 bg-secondary text-secondary-foreground hover:bg-muted disabled:opacity-40 rounded-lg font-medium cursor-pointer"
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

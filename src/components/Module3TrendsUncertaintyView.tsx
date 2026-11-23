import React, { useMemo, useState } from 'react';
import { Play, Save } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useClaimsData } from '../context/ClaimsDataContext';
import { computeCorrelationMatrix, runMonteCarloSimulation } from '../lib/claimsEngine';
import {
  AgeAmountScatterChart,
  CorrelationHeatmapChart,
  MonteCarloFanChart,
  MonteCarloLossHistogram,
  TimeSeriesPoint,
  TimeSeriesTrendChart,
} from './charts/UncertaintyCharts';

export function Module3TrendsUncertaintyView() {
  const { firebaseUser, effectiveRole } = useAuth();
  const { activeDataset, filteredClaims, savedScenarios, saveScenarioToCloud, syncingCloud } =
    useClaimsData();

  const [trendMetric, setTrendMetric] = useState<'totalAmount' | 'avgCost' | 'claimCount'>(
    'totalAmount',
  );
  const [granularity, setGranularity] = useState<'monthly' | 'quarterly'>('monthly');
  const [highlightFluSeason, setHighlightFluSeason] = useState(true);

  // Monte Carlo & What-If Scenario Parameters
  const [trials, setTrials] = useState(2000);
  const [volatilityMultiplier, setVolatilityMultiplier] = useState(1.0);
  const [frequencyDeltaPct, setFrequencyDeltaPct] = useState(-10);
  const [severityDeltaPct, setSeverityDeltaPct] = useState(4);
  const [highRiskReductionPct, setHighRiskReductionPct] = useState(12);
  const [coveredMembers, setCoveredMembers] = useState(500);
  const [adminLoadPct, setAdminLoadPct] = useState(14);
  const [targetLossRatioPct, setTargetLossRatioPct] = useState(82);
  const [scenarioName, setScenarioName] = useState('Flu Care Management -10% Freq');

  const canSaveCloud = Boolean(firebaseUser && effectiveRole !== 'viewer');

  const timeSeriesData = useMemo<TimeSeriesPoint[]>(() => {
    const buckets = new Map<string, { total: number; count: number; isFlu: boolean }>();
    for (const c of filteredClaims) {
      const ym = c.serviceDate.slice(0, 7);
      const month = Number(ym.slice(5, 7));
      const year = ym.slice(0, 4);
      const isFlu = month >= 11 || month <= 3;

      const key =
        granularity === 'monthly'
          ? ym
          : `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
      const existing = buckets.get(key) ?? { total: 0, count: 0, isFlu: false };
      buckets.set(key, {
        total: existing.total + c.amount,
        count: existing.count + 1,
        isFlu: existing.isFlu || (granularity === 'monthly' ? isFlu : key.endsWith('Q1') || key.endsWith('Q4')),
      });
    }

    return Array.from(buckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, val]) => ({
        period,
        totalAmount: Math.round(val.total),
        avgCost: Math.round(val.total / Math.max(val.count, 1)),
        claimCount: val.count,
        isFluSeason: val.isFlu,
      }));
  }, [filteredClaims, granularity]);

  const seasonalComparison = useMemo(() => {
    const flu = timeSeriesData.filter((d) => d.isFluSeason);
    const off = timeSeriesData.filter((d) => !d.isFluSeason);
    const fluAvg =
      flu.length > 0 ? flu.reduce((s, d) => s + d.totalAmount, 0) / flu.length : 0;
    const offAvg =
      off.length > 0 ? off.reduce((s, d) => s + d.totalAmount, 0) / off.length : 0;
    const upliftPct = offAvg > 0 ? ((fluAvg - offAvg) / offAvg) * 100 : 0;
    return { fluAvg, offAvg, upliftPct };
  }, [timeSeriesData]);

  const correlation = useMemo(() => computeCorrelationMatrix(filteredClaims), [filteredClaims]);

  const baselineMonteCarlo = useMemo(
    () =>
      runMonteCarloSimulation(filteredClaims, {
        trials: 1000,
        volatilityMultiplier: 1.0,
        frequencyDeltaPct: 0,
        severityDeltaPct: 0,
        highRiskReductionPct: 0,
        coveredMembers,
      }),
    [filteredClaims, coveredMembers],
  );

  const scenarioMonteCarlo = useMemo(
    () =>
      runMonteCarloSimulation(filteredClaims, {
        trials,
        volatilityMultiplier,
        frequencyDeltaPct,
        severityDeltaPct,
        highRiskReductionPct,
        coveredMembers,
      }),
    [
      filteredClaims,
      trials,
      volatilityMultiplier,
      frequencyDeltaPct,
      severityDeltaPct,
      highRiskReductionPct,
      coveredMembers,
    ],
  );

  const pricingImpact = useMemo(() => {
    const basePure = baselineMonteCarlo.purePremiumPerMember;
    const projPure = scenarioMonteCarlo.purePremiumPerMember;
    const deltaPct = basePure > 0 ? ((projPure - basePure) / basePure) * 100 : 0;
    const lossRatioFactor = Math.max(0.4, targetLossRatioPct / 100);
    const adminMult = 1 + adminLoadPct / 100;
    const baseGross = Math.round((basePure / lossRatioFactor) * adminMult);
    const projGross = Math.round((projPure / lossRatioFactor) * adminMult);
    return { basePure, projPure, deltaPct, baseGross, projGross };
  }, [
    baselineMonteCarlo.purePremiumPerMember,
    scenarioMonteCarlo.purePremiumPerMember,
    adminLoadPct,
    targetLossRatioPct,
  ]);

  const handleSaveScenario = async () => {
    await saveScenarioToCloud({
      name: scenarioName,
      datasetId: activeDataset?.id ?? 'baseline-q4-2026',
      visibility: 'shared',
      frequencyDeltaPct,
      severityDeltaPct,
      highRiskReductionPct,
      adminLoadPct,
      targetLossRatioPct,
      baselinePurePremium: pricingImpact.basePure,
      projectedPurePremium: pricingImpact.projPure,
      projectedGrossPremium: pricingImpact.projGross,
      p95AggregateLoss: scenarioMonteCarlo.p95AggregateLoss,
    });
  };

  return (
    <div className="space-y-6">
      {/* Section 1: Time-Series & Seasonality */}
      <section className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              03. Claim Trends, Cost Drivers & Premium Uncertainty
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Time-series loss trajectory with seasonal flu-window overlays and probabilistic
              Monte Carlo premium pricing.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 p-1 bg-muted rounded-lg text-xs">
              {(
                [
                  { id: 'totalAmount', label: 'Total Spend' },
                  { id: 'avgCost', label: 'Avg Cost' },
                  { id: 'claimCount', label: 'Frequency' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setTrendMetric(m.id)}
                  className={`px-3 py-1.5 rounded-md font-medium cursor-pointer ${
                    trendMetric === m.id
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 p-1 bg-muted rounded-lg text-xs">
              {(['monthly', 'quarterly'] as const).map((gr) => (
                <button
                  key={gr}
                  type="button"
                  onClick={() => setGranularity(gr)}
                  className={`px-3 py-1.5 rounded-md font-medium capitalize cursor-pointer ${
                    granularity === gr
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground'
                  }`}
                >
                  {gr}
                </button>
              ))}
            </div>

            <label className="inline-flex items-center gap-1.5 text-xs text-foreground ml-2 cursor-pointer">
              <input
                type="checkbox"
                checked={highlightFluSeason}
                onChange={(e) => setHighlightFluSeason(e.target.checked)}
                className="rounded border-input accent-primary"
              />
              Flu Season Overlay (Nov–Mar)
            </label>
          </div>
        </div>

        {timeSeriesData.length === 0 ? (
          <div className="py-12 text-center text-xs text-muted-foreground">
            No time-series data for current filters.
          </div>
        ) : (
          <TimeSeriesTrendChart
            data={timeSeriesData}
            metric={trendMetric}
            highlightFluSeason={highlightFluSeason}
          />
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-border text-xs">
          <div>
            <span className="text-muted-foreground">Flu Season Avg Period Spend: </span>
            <span className="font-mono tabular-nums font-semibold text-foreground">
              ${Math.round(seasonalComparison.fluAvg).toLocaleString()}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Off-Peak Avg Period Spend: </span>
            <span className="font-mono tabular-nums font-semibold text-foreground">
              ${Math.round(seasonalComparison.offAvg).toLocaleString()}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Seasonal Cost Uplift: </span>
            <span className="font-mono tabular-nums font-semibold text-amber-600 dark:text-amber-400">
              {seasonalComparison.upliftPct >= 0 ? '+' : ''}
              {seasonalComparison.upliftPct.toFixed(1)}%
            </span>
          </div>
        </div>
      </section>

      {/* Section 2: Cost-Factor Correlation Matrix & Scatter Plot */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-5 bg-card border border-border rounded-xl p-5 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Cost-Factor Correlation Matrix (Pearson r)
            </h2>
            <p className="text-xs text-muted-foreground">
              Quantifies linear drivers across age, chronic comorbidities, inpatient stays, and spend
            </p>
          </div>
          <CorrelationHeatmapChart labels={correlation.labels} matrix={correlation.matrix} />
        </div>

        <div className="lg:col-span-7 bg-card border border-border rounded-xl p-5 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Patient Age vs. Claim Cost Dispersion
            </h2>
            <p className="text-xs text-muted-foreground">
              Encoded by both color and marker geometry for accessible risk-segment inspection
            </p>
          </div>
          {filteredClaims.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted-foreground">No claims available.</div>
          ) : (
            <AgeAmountScatterChart claims={filteredClaims} />
          )}
        </div>
      </section>

      {/* Section 3: Monte Carlo Simulation & What-If Premium Pricing */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-4 bg-card border border-border rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                What-If & Stochastic Controls
              </h2>
              <p className="text-xs text-muted-foreground">
                Simulate utilization, severity, and care-management shifts
              </p>
            </div>
            <Play className="w-4 h-4 text-primary" />
          </div>

          <div className="space-y-3.5 text-xs">
            <div>
              <div className="flex justify-between mb-1">
                <span className="text-foreground">Claim Frequency Change</span>
                <span className="font-mono tabular-nums font-semibold text-foreground">
                  {frequencyDeltaPct >= 0 ? '+' : ''}
                  {frequencyDeltaPct}%
                </span>
              </div>
              <input
                type="range"
                aria-label="Claim frequency delta percentage"
                min={-30}
                max={40}
                step={1}
                value={frequencyDeltaPct}
                onChange={(e) => setFrequencyDeltaPct(Number(e.target.value))}
                className="w-full accent-primary"
              />
            </div>

            <div>
              <div className="flex justify-between mb-1">
                <span className="text-foreground">Medical Cost Inflation (Severity)</span>
                <span className="font-mono tabular-nums font-semibold text-foreground">
                  {severityDeltaPct >= 0 ? '+' : ''}
                  {severityDeltaPct}%
                </span>
              </div>
              <input
                type="range"
                aria-label="Claim severity delta percentage"
                min={-20}
                max={40}
                step={1}
                value={severityDeltaPct}
                onChange={(e) => setSeverityDeltaPct(Number(e.target.value))}
                className="w-full accent-primary"
              />
            </div>

            <div>
              <div className="flex justify-between mb-1">
                <span className="text-foreground">High-Risk Care Mgmt Reduction</span>
                <span className="font-mono tabular-nums font-semibold text-foreground">
                  -{highRiskReductionPct}%
                </span>
              </div>
              <input
                type="range"
                aria-label="High risk reduction percentage"
                min={0}
                max={45}
                step={1}
                value={highRiskReductionPct}
                onChange={(e) => setHighRiskReductionPct(Number(e.target.value))}
                className="w-full accent-primary"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
              <div>
                <label className="block text-muted-foreground mb-1">Covered Members</label>
                <input
                  type="number"
                  min={100}
                  max={50000}
                  step={50}
                  value={coveredMembers}
                  onChange={(e) => setCoveredMembers(Math.max(100, Number(e.target.value) || 500))}
                  className="w-full px-2.5 py-1.5 font-mono tabular-nums bg-background border border-input rounded-lg text-foreground focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-muted-foreground mb-1">Monte Carlo Trials</label>
                <select
                  value={trials}
                  onChange={(e) => setTrials(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 font-mono bg-background border border-input rounded-lg text-foreground focus:outline-none focus:border-primary"
                >
                  <option value={1000}>1,000 trials</option>
                  <option value={2000}>2,000 trials</option>
                  <option value={5000}>5,000 trials</option>
                </select>
              </div>
              <div>
                <label className="block text-muted-foreground mb-1">Admin Load (%)</label>
                <input
                  type="number"
                  min={0}
                  max={35}
                  value={adminLoadPct}
                  onChange={(e) => setAdminLoadPct(Math.max(0, Math.min(35, Number(e.target.value) || 0)))}
                  className="w-full px-2.5 py-1.5 font-mono tabular-nums bg-background border border-input rounded-lg text-foreground focus:outline-none focus:border-primary"
                />
              </div>
              <div>
                <label className="block text-muted-foreground mb-1">Target Loss Ratio (%)</label>
                <input
                  type="number"
                  min={55}
                  max={95}
                  value={targetLossRatioPct}
                  onChange={(e) =>
                    setTargetLossRatioPct(Math.max(55, Math.min(95, Number(e.target.value) || 80)))
                  }
                  className="w-full px-2.5 py-1.5 font-mono tabular-nums bg-background border border-input rounded-lg text-foreground focus:outline-none focus:border-primary"
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between mb-1">
                <span className="text-foreground">Tail Volatility Multiplier</span>
                <span className="font-mono tabular-nums font-semibold text-foreground">
                  {volatilityMultiplier.toFixed(1)}×
                </span>
              </div>
              <input
                type="range"
                aria-label="Monte Carlo volatility multiplier"
                min={0.6}
                max={2.0}
                step={0.1}
                value={volatilityMultiplier}
                onChange={(e) => setVolatilityMultiplier(Number(e.target.value))}
                className="w-full accent-primary"
              />
            </div>
          </div>

          <div className="pt-3 border-t border-border space-y-2">
            <label className="block text-xs text-muted-foreground">Scenario Snapshot Name</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={scenarioName}
                onChange={(e) => setScenarioName(e.target.value)}
                className="flex-1 px-2.5 py-1.5 text-xs bg-background border border-input rounded-lg text-foreground focus:outline-none focus:border-primary"
              />
              <button
                type="button"
                disabled={!canSaveCloud || syncingCloud}
                onClick={() => void handleSaveScenario()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary-foreground bg-primary hover:bg-primary/90 disabled:opacity-45 rounded-lg whitespace-nowrap cursor-pointer transition-colors"
              >
                <Save className="w-3.5 h-3.5" />
                Save
              </button>
            </div>
            {!canSaveCloud && (
              <p className="text-[11px] text-muted-foreground">
                Sign in as Analyst or Admin to persist scenarios to Firestore.
              </p>
            )}
          </div>
        </div>

        <div className="xl:col-span-8 space-y-5">
          {/* Premium Pricing Impact KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="text-[11px] text-muted-foreground">Baseline Pure Premium</div>
              <div className="mt-1 text-lg font-bold font-mono tabular-nums text-foreground">
                ${pricingImpact.basePure.toLocaleString()}
              </div>
              <div className="text-[11px] text-muted-foreground">Per member-year</div>
            </div>

            <div className="bg-card border border-border rounded-xl p-4">
              <div className="text-[11px] text-muted-foreground">Projected Pure Premium</div>
              <div className="mt-1 text-lg font-bold font-mono tabular-nums text-foreground">
                ${pricingImpact.projPure.toLocaleString()}
              </div>
              <div
                className={`text-[11px] font-mono tabular-nums ${
                  pricingImpact.deltaPct <= 0
                    ? 'text-teal-600 dark:text-teal-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
              >
                {pricingImpact.deltaPct >= 0 ? '+' : ''}
                {pricingImpact.deltaPct.toFixed(1)}% vs baseline
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl p-4">
              <div className="text-[11px] text-muted-foreground">Projected Gross Premium</div>
              <div className="mt-1 text-lg font-bold font-mono tabular-nums text-foreground">
                ${pricingImpact.projGross.toLocaleString()}
              </div>
              <div className="text-[11px] text-muted-foreground">
                Loaded ({adminLoadPct}% admin · {targetLossRatioPct}% MLR)
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl p-4">
              <div className="text-[11px] text-muted-foreground">P95 Tail Aggregate Loss</div>
              <div className="mt-1 text-lg font-bold font-mono tabular-nums text-primary">
                ${scenarioMonteCarlo.p95AggregateLoss.toLocaleString()}
              </div>
              <div className="text-[11px] text-muted-foreground font-mono tabular-nums">
                P99 VaR: ${scenarioMonteCarlo.p99AggregateLoss.toLocaleString()}
              </div>
            </div>
          </div>

          {/* Monte Carlo Visualizations */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-card border border-border rounded-xl p-5">
              <div className="mb-3">
                <h3 className="text-sm font-semibold text-foreground">
                  12-Month Cost Uncertainty Fan Chart
                </h3>
                <p className="text-xs text-muted-foreground">
                  Confidence intervals across {trials.toLocaleString()} stochastic trials
                </p>
              </div>
              <MonteCarloFanChart summary={scenarioMonteCarlo} />
            </div>

            <div className="bg-card border border-border rounded-xl p-5">
              <div className="mb-3">
                <h3 className="text-sm font-semibold text-foreground">
                  Aggregate Portfolio Loss Distribution
                </h3>
                <p className="text-xs text-muted-foreground">
                  P50 Median vs. P95 Tail Risk (highlighted in scarlet)
                </p>
              </div>
              <MonteCarloLossHistogram summary={scenarioMonteCarlo} />
            </div>
          </div>

          {savedScenarios.length > 0 && (
            <div className="bg-card border border-border rounded-xl p-5">
              <h3 className="text-sm font-semibold text-foreground mb-3">
                Saved Cloud Scenario Benchmarks
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="py-2 pr-3">Scenario Name</th>
                      <th className="py-2 px-3 text-right">Freq Δ</th>
                      <th className="py-2 px-3 text-right">Sev Δ</th>
                      <th className="py-2 px-3 text-right">High-Risk Red.</th>
                      <th className="py-2 px-3 text-right">Proj Pure PMPY</th>
                      <th className="py-2 pl-3 text-right">Proj Gross PMPY</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border font-mono tabular-nums">
                    {savedScenarios.map((sc) => (
                      <tr key={sc.id}>
                        <td className="py-2 pr-3 font-sans font-medium text-foreground">
                          {sc.name}
                        </td>
                        <td className="py-2 px-3 text-right">
                          {sc.frequencyDeltaPct >= 0 ? '+' : ''}
                          {sc.frequencyDeltaPct}%
                        </td>
                        <td className="py-2 px-3 text-right">
                          {sc.severityDeltaPct >= 0 ? '+' : ''}
                          {sc.severityDeltaPct}%
                        </td>
                        <td className="py-2 px-3 text-right">-{sc.highRiskReductionPct}%</td>
                        <td className="py-2 px-3 text-right">
                          ${sc.projectedPurePremium.toLocaleString()}
                        </td>
                        <td className="py-2 pl-3 text-right font-semibold text-foreground">
                          ${sc.projectedGrossPremium.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

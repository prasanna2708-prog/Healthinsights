import React, { useMemo, useState } from 'react';
import { useClaimsData } from '../context/ClaimsDataContext';
import { computeBoxPlotStats } from '../lib/claimsEngine';
import { ClaimType, RiskSegment } from '../types/claims';
import { ClaimTypeDonutChart } from './charts/D3Charts';
import {
  AmountHistogramChart,
  BoxPlotChart,
  ClaimTypeStackedBarChart,
  EcdfCurveChart,
} from './charts/DistributionCharts';

export function Module2DistributionView() {
  const { filteredClaims, filters, setFilters } = useClaimsData();

  const [binCount, setBinCount] = useState(16);
  const [boxGroupBy, setBoxGroupBy] = useState<'claimType' | 'riskSegment'>('claimType');
  const [stackGroupBy, setStackGroupBy] = useState<'region' | 'riskSegment' | 'ageGroup'>('region');
  const [stackMode, setStackMode] = useState<'percent' | 'amount'>('percent');

  const statsSummary = useMemo(() => {
    const amounts = filteredClaims.map((c) => c.amount).sort((a, b) => a - b);
    const n = amounts.length;
    if (n === 0) {
      return { min: 0, q1: 0, median: 0, mean: 0, q3: 0, p95: 0, max: 0 };
    }
    const q = (p: number) => amounts[Math.min(n - 1, Math.floor(p * (n - 1)))];
    const mean = amounts.reduce((s, v) => s + v, 0) / n;
    return {
      min: amounts[0],
      q1: q(0.25),
      median: q(0.5),
      mean,
      q3: q(0.75),
      p95: q(0.95),
      max: amounts[n - 1],
    };
  }, [filteredClaims]);

  const boxPlotData = useMemo(() => {
    if (boxGroupBy === 'claimType') {
      const types: ClaimType[] = ['Inpatient', 'Outpatient', 'Pharmacy', 'Diagnostics'];
      return types.map((t) =>
        computeBoxPlotStats(
          t,
          filteredClaims.filter((c) => c.claimType === t).map((c) => c.amount),
        ),
      );
    }
    const segs: RiskSegment[] = ['Low Risk', 'Medium Risk', 'High Risk'];
    return segs.map((s) =>
      computeBoxPlotStats(
        s,
        filteredClaims.filter((c) => c.riskSegment === s).map((c) => c.amount),
      ),
    );
  }, [boxGroupBy, filteredClaims]);

  return (
    <div className="space-y-6">
      {/* Interactive Distribution Filter Controls */}
      <section className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              02. Claim Amount Distribution & Claim-Type Proportion
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Real-time distribution analysis across {filteredClaims.length.toLocaleString()} filtered
              claims. Adjust amount caps, service dates, or risk segments below.
            </p>
          </div>
          <div className="flex items-center gap-1 p-1 bg-muted rounded-lg">
            {(['All', 'Low Risk', 'Medium Risk', 'High Risk'] as const).map((seg) => (
              <button
                key={seg}
                type="button"
                onClick={() => setFilters((f) => ({ ...f, riskSegment: seg }))}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  filters.riskSegment === seg
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {seg}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pt-2 border-t border-border text-xs">
          <div>
            <div className="flex justify-between text-muted-foreground mb-1">
              <span>Max Claim Cap</span>
              <span className="font-mono tabular-nums text-foreground">
                ${filters.amountMax.toLocaleString()}
              </span>
            </div>
            <input
              type="range"
              aria-label="Maximum claim amount filter"
              min={1000}
              max={150000}
              step={1000}
              value={filters.amountMax}
              onChange={(e) => setFilters((f) => ({ ...f, amountMax: Number(e.target.value) }))}
              className="w-full accent-primary"
            />
          </div>

          <div>
            <div className="flex justify-between text-muted-foreground mb-1">
              <span>Histogram Bins</span>
              <span className="font-mono tabular-nums text-foreground">{binCount} bins</span>
            </div>
            <input
              type="range"
              aria-label="Histogram bin count"
              min={6}
              max={32}
              step={2}
              value={binCount}
              onChange={(e) => setBinCount(Number(e.target.value))}
              className="w-full accent-primary"
            />
          </div>

          <div>
            <label htmlFor="m2-date-from" className="block text-muted-foreground mb-1">
              Service Date From
            </label>
            <input
              id="m2-date-from"
              type="date"
              value={filters.dateFrom}
              onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
              className="w-full px-2.5 py-1.5 bg-background border border-input rounded-lg font-mono text-xs text-foreground focus:outline-none focus:border-primary"
            />
          </div>

          <div>
            <label htmlFor="m2-date-to" className="block text-muted-foreground mb-1">
              Service Date To
            </label>
            <input
              id="m2-date-to"
              type="date"
              value={filters.dateTo}
              onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
              className="w-full px-2.5 py-1.5 bg-background border border-input rounded-lg font-mono text-xs text-foreground focus:outline-none focus:border-primary"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2">
          <span className="text-xs text-muted-foreground mr-1">Claim Type Filter:</span>
          {(['All', 'Inpatient', 'Outpatient', 'Pharmacy', 'Diagnostics'] as const).map((ct) => (
            <button
              key={ct}
              type="button"
              onClick={() => setFilters((f) => ({ ...f, claimType: ct }))}
              className={`px-3 py-1 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                filters.claimType === ct
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card text-foreground border-border hover:bg-muted'
              }`}
            >
              {ct}
            </button>
          ))}
        </div>
      </section>

      {/* Quantile Summary Strip */}
      <section className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {[
          { label: 'Minimum', val: statsSummary.min },
          { label: 'Q1 (25th)', val: statsSummary.q1 },
          { label: 'Median (P50)', val: statsSummary.median },
          { label: 'Mean', val: statsSummary.mean },
          { label: 'Q3 (75th)', val: statsSummary.q3 },
          { label: 'Tail (P95)', val: statsSummary.p95 },
          { label: 'Maximum', val: statsSummary.max },
        ].map((q) => (
          <div key={q.label} className="bg-card border border-border rounded-xl p-3.5">
            <div className="text-[11px] text-muted-foreground">{q.label}</div>
            <div className="mt-1 text-sm font-semibold font-mono tabular-nums text-foreground">
              ${Math.round(q.val).toLocaleString()}
            </div>
          </div>
        ))}
      </section>

      {/* Distribution Charts: Histogram + Box Plot */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-foreground">
              Claim Amount Histogram & Central Tendency
            </h2>
            <p className="text-xs text-muted-foreground">
              Right-skewed severity distribution with Median and Mean reference lines
            </p>
          </div>
          {filteredClaims.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted-foreground">
              No claims in current filter window.
            </div>
          ) : (
            <AmountHistogramChart claims={filteredClaims} binCount={binCount} />
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Quartile Box Plot & Outlier Detection
              </h2>
              <p className="text-xs text-muted-foreground">
                Q1–Q3 interquartile range, median bar, 1.5×IQR whiskers, and outliers
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 bg-muted rounded-lg text-xs">
              <button
                type="button"
                onClick={() => setBoxGroupBy('claimType')}
                className={`px-2.5 py-1 rounded-md font-medium cursor-pointer ${
                  boxGroupBy === 'claimType'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground'
                }`}
              >
                By Type
              </button>
              <button
                type="button"
                onClick={() => setBoxGroupBy('riskSegment')}
                className={`px-2.5 py-1 rounded-md font-medium cursor-pointer ${
                  boxGroupBy === 'riskSegment'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground'
                }`}
              >
                By Risk
              </button>
            </div>
          </div>
          {filteredClaims.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted-foreground">
              No claims in current filter window.
            </div>
          ) : (
            <BoxPlotChart stats={boxPlotData} />
          )}
        </div>
      </section>

      {/* ECDF + Claim-Type Proportions */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-5 bg-card border border-border rounded-xl p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Cumulative Distribution Curve (ECDF)
            </h2>
            <p className="text-xs text-muted-foreground">
              Share of total claims falling below any given dollar threshold
            </p>
          </div>
          {filteredClaims.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted-foreground">No claims available.</div>
          ) : (
            <EcdfCurveChart claims={filteredClaims} />
          )}

          <div className="pt-4 border-t border-border">
            <div className="text-xs font-semibold text-foreground mb-3">
              Overall Claim-Type Spend Share
            </div>
            <ClaimTypeDonutChart claims={filteredClaims} />
          </div>
        </div>

        <div className="lg:col-span-7 bg-card border border-border rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Claim-Type Proportion Breakdown
              </h2>
              <p className="text-xs text-muted-foreground">
                Compare Inpatient, Outpatient, Pharmacy, and Diagnostics mix across cohorts
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 p-1 bg-muted rounded-lg text-xs">
                {(['region', 'riskSegment', 'ageGroup'] as const).map((grp) => (
                  <button
                    key={grp}
                    type="button"
                    onClick={() => setStackGroupBy(grp)}
                    className={`px-2.5 py-1 rounded-md font-medium cursor-pointer ${
                      stackGroupBy === grp
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {grp === 'region' ? 'Region' : grp === 'riskSegment' ? 'Risk' : 'Age'}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1 p-1 bg-muted rounded-lg text-xs">
                <button
                  type="button"
                  onClick={() => setStackMode('percent')}
                  className={`px-2.5 py-1 rounded-md font-medium cursor-pointer ${
                    stackMode === 'percent'
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground'
                  }`}
                >
                  % Share
                </button>
                <button
                  type="button"
                  onClick={() => setStackMode('amount')}
                  className={`px-2.5 py-1 rounded-md font-medium cursor-pointer ${
                    stackMode === 'amount'
                      ? 'bg-card text-foreground shadow-sm'
                      : 'text-muted-foreground'
                  }`}
                >
                  $ Spend
                </button>
              </div>
            </div>
          </div>

          {filteredClaims.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted-foreground">No claims available.</div>
          ) : (
            <ClaimTypeStackedBarChart
              claims={filteredClaims}
              groupBy={stackGroupBy}
              mode={stackMode}
            />
          )}
        </div>
      </section>
    </div>
  );
}

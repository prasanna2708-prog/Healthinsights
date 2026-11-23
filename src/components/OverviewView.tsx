import React, { useMemo } from 'react';
import { ArrowRight, BarChart3, FileSpreadsheet, ShieldCheck, TrendingUp } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useClaimsData } from '../context/ClaimsDataContext';
import { NavSection, RiskSegment } from '../types/claims';
import { ClaimTypeDonutChart, RiskDonutChart } from './charts/D3Charts';

interface OverviewViewProps {
  onNavigate: (section: NavSection) => void;
  onOpenGuide: () => void;
}

export function OverviewView({ onNavigate, onOpenGuide }: OverviewViewProps) {
  const { firebaseUser, effectiveRole } = useAuth();
  const {
    activeDataset,
    filteredClaims,
    datasets,
    savedScenarios,
    selectDataset,
    loadingData,
  } = useClaimsData();

  const metrics = useMemo(() => {
    const count = filteredClaims.length;
    const totalAmount = filteredClaims.reduce((s, c) => s + c.amount, 0);
    const avgAmount = count > 0 ? totalAmount / count : 0;
    const anomalies = filteredClaims.filter((c) => c.isAnomaly).length;
    const highRisk = filteredClaims.filter((c) => c.riskSegment === 'High Risk').length;
    const highRiskPct = count > 0 ? (highRisk / count) * 100 : 0;

    const segments: RiskSegment[] = ['Low Risk', 'Medium Risk', 'High Risk'];
    const riskBreakdown = segments.map((seg) => {
      const sub = filteredClaims.filter((c) => c.riskSegment === seg);
      return {
        segment: seg,
        count: sub.length,
        amount: sub.reduce((s, c) => s + c.amount, 0),
      };
    });

    return { count, totalAmount, avgAmount, anomalies, highRisk, highRiskPct, riskBreakdown };
  }, [filteredClaims]);

  const MODULES: {
    id: NavSection;
    title: string;
    subtitle: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    {
      id: 'module1',
      title: '01. Claims Preprocessing & Risk Tagging',
      subtitle: 'Ingestion · Cleaning · ICD-10 · AES-256-GCM',
      description:
        'Upload CSV or Excel claims files, normalize dates and ICD-10 codes, detect outliers, customize risk scoring rules, and export clean pseudonymized records.',
      icon: FileSpreadsheet,
    },
    {
      id: 'module2',
      title: '02. Claim Amount Distribution & Mix',
      subtitle: 'Histogram · Box Plot · ECDF · Service Mix',
      description:
        'Examine cost skewness across Inpatient, Outpatient, Pharmacy, and Diagnostics claims with real-time demographic, regional, and amount-range filters.',
      icon: BarChart3,
    },
    {
      id: 'module3',
      title: '03. Claim Trends & Cost Uncertainty',
      subtitle: 'Seasonality · Correlation · Monte Carlo · What-If',
      description:
        'Track monthly and flu-season loss trajectories, analyze clinical cost drivers, run Monte Carlo simulations, and model premium rate adjustments.',
      icon: TrendingUp,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Welcome Overview Section */}
      <section className="bg-card border border-border rounded-xl p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div className="max-w-2xl space-y-2">
          <div className="text-xs font-medium text-muted-foreground flex flex-wrap items-center gap-2">
            <span className="text-primary font-semibold">HealthInsight Actuarial Workspace</span>
            <span aria-hidden="true">·</span>
            <span>Active Cohort: {activeDataset?.name ?? 'Baseline Portfolio'}</span>
            <span aria-hidden="true">·</span>
            <span>Access Role: {firebaseUser ? effectiveRole : 'Local Preview'}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground text-balance">
            Health Insurance Claims & Premium Cost Visualization Platform
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Analyze normalized medical and pharmacy claims, isolate high-risk cost drivers, and run
            stochastic Monte Carlo simulations to price health insurance premiums with transparency.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('module1')}
            className="px-4 py-2.5 text-xs font-medium text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 transition-colors whitespace-nowrap cursor-pointer"
          >
            Ingest Claims Dataset
          </button>
          <button
            type="button"
            onClick={onOpenGuide}
            className="px-4 py-2.5 text-xs font-medium text-secondary-foreground bg-secondary rounded-lg hover:bg-muted transition-colors whitespace-nowrap cursor-pointer"
          >
            Platform Tutorial
          </button>
        </div>
      </section>

      {/* 4-Column KPI Summary Strip */}
      <section aria-label="Key portfolio metrics" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="text-xs font-medium text-muted-foreground">Total Filtered Claims</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-foreground">
            {loadingData ? '...' : metrics.count.toLocaleString()}
          </div>
          <div className="mt-1 text-xs text-muted-foreground font-mono tabular-nums">
            {metrics.anomalies} statistical anomalies flagged
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <div className="text-xs font-medium text-muted-foreground">Average Claim Amount</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-foreground">
            ${loadingData ? '...' : Math.round(metrics.avgAmount).toLocaleString()}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">Mean incurred severity per claim</div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <div className="text-xs font-medium text-muted-foreground">Total Incurred Loss</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-foreground">
            ${loadingData ? '...' : Math.round(metrics.totalAmount).toLocaleString()}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">Aggregate filtered claims spend</div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <div className="text-xs font-medium text-muted-foreground">High-Risk Segment Share</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-primary">
            {loadingData ? '...' : `${metrics.highRiskPct.toFixed(1)}%`}
          </div>
          <div className="mt-1 text-xs text-muted-foreground font-mono tabular-nums">
            {metrics.highRisk.toLocaleString()} high-severity claims
          </div>
        </div>
      </section>

      {/* Quick Links to the Three Modules */}
      <section aria-label="Analytical modules" className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {MODULES.map((mod) => {
          const Icon = mod.icon;
          return (
            <div
              key={mod.id}
              className="bg-card border border-border rounded-xl p-5 flex flex-col justify-between gap-4"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{mod.subtitle}</span>
                  <Icon className="w-4 h-4 text-primary shrink-0" />
                </div>
                <h2 className="text-base font-semibold text-foreground">{mod.title}</h2>
                <p className="text-xs text-muted-foreground leading-relaxed">{mod.description}</p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate(mod.id)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 cursor-pointer self-start"
              >
                Launch Module
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </section>

      {/* Visual Portfolio Summary */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-5">
          <RiskDonutChart
            counts={metrics.riskBreakdown}
            title="Risk Segment Distribution (Active Cohort)"
          />
        </div>
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="text-sm font-semibold text-foreground mb-3">
            Claim-Type Spend Proportion
          </div>
          <ClaimTypeDonutChart claims={filteredClaims} />
        </div>
      </section>

      {/* Cloud Datasets & Saved Scenarios Overview */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground">Available Claims Datasets</h2>
            <button
              type="button"
              onClick={() => onNavigate('module1')}
              className="text-xs font-medium text-primary hover:text-primary/80 cursor-pointer"
            >
              Manage Uploads
            </button>
          </div>
          <div className="divide-y divide-border">
            {datasets.map((ds) => (
              <div key={ds.id} className="py-2.5 flex items-center justify-between gap-4 text-xs">
                <div className="min-w-0">
                  <div className="font-medium text-foreground truncate">{ds.name}</div>
                  <div className="text-muted-foreground mt-0.5 font-mono tabular-nums">
                    {ds.cleanedClaims.toLocaleString()} claims · ${Math.round(ds.avgClaimAmount).toLocaleString()} avg · {ds.encryptionAlg}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void selectDataset(ds.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                    activeDataset?.id === ds.id
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-secondary-foreground hover:bg-muted'
                  }`}
                >
                  {activeDataset?.id === ds.id ? 'Active' : 'Load'}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground">Saved Premium Scenarios & Governance</h2>
            <button
              type="button"
              onClick={() => onNavigate('governance')}
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-primary" />
              Security & RBAC
            </button>
          </div>

          {savedScenarios.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground space-y-2">
              <p>
                No scenarios saved to Firestore yet. Model rate adjustments in Module 3 and save
                snapshots for stakeholder review.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('module3')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-secondary hover:bg-muted text-secondary-foreground rounded-lg font-medium cursor-pointer"
              >
                Open Scenario Simulator
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {savedScenarios.slice(0, 5).map((sc) => (
                <div key={sc.id} className="py-2.5 flex items-center justify-between gap-4 text-xs">
                  <div className="min-w-0">
                    <div className="font-medium text-foreground truncate">{sc.name}</div>
                    <div className="text-muted-foreground mt-0.5 font-mono tabular-nums">
                      Freq {sc.frequencyDeltaPct >= 0 ? '+' : ''}
                      {sc.frequencyDeltaPct}% · Sev {sc.severityDeltaPct >= 0 ? '+' : ''}
                      {sc.severityDeltaPct}% · High-Risk -{sc.highRiskReductionPct}%
                    </div>
                  </div>
                  <div className="text-right font-mono tabular-nums shrink-0">
                    <div className="font-semibold text-foreground">
                      ${sc.projectedGrossPremium.toLocaleString()}
                    </div>
                    <div className="text-[11px] text-muted-foreground">Gross PMPY</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

import React from 'react';
import { ArrowRight, CheckCircle2, Lock, ShieldCheck, X } from 'lucide-react';
import { NavSection } from '../types/claims';

interface OnboardingModalProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (section: NavSection) => void;
}

const STEPS: {
  step: string;
  title: string;
  description: string;
  target: NavSection;
  cta: string;
}[] = [
  {
    step: 'Step 1',
    title: '01. Preprocessing & Risk-Segment Tagging',
    description:
      'Upload CSV or Excel claims files, normalize heterogeneous dates and ICD-10 codes, flag statistical anomalies via Tukey IQR and Z-score rules, and encrypt patient identifiers with AES-256-GCM before Firestore storage.',
    target: 'module1',
    cta: 'Open Module 1',
  },
  {
    step: 'Step 2',
    title: '02. Claim Amount Distribution & Claim-Type Mix',
    description:
      'Inspect claim severity distributions using interactive histograms, quartile box plots, and ECDF curves alongside Inpatient, Outpatient, Pharmacy, and Diagnostics spend shares.',
    target: 'module2',
    cta: 'Open Module 2',
  },
  {
    step: 'Step 3',
    title: '03. Claim Trends & Cost-Factor Uncertainty',
    description:
      'Analyze monthly and flu-season claim trends, evaluate Pearson correlations across age and comorbidities, and run 1,000–5,000 Monte Carlo trials to quantify P95 tail risk and premium pricing scenarios.',
    target: 'module3',
    cta: 'Open Module 3',
  },
  {
    step: 'Step 4',
    title: 'Governance, RBAC & Validation',
    description:
      'Manage Admin, Analyst, and Viewer permissions, rotate AES-256-GCM session keys, inspect HIPAA/GDPR audit logs, and execute live unit and integration verification checks.',
    target: 'governance',
    cta: 'Open Governance',
  },
];

export function OnboardingModal({ open, onClose, onNavigate }: OnboardingModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div className="bg-card border border-border rounded-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
          <div>
            <h2 id="onboarding-title" className="text-lg font-semibold text-foreground">
              HealthInsight Workflow Guide
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              End-to-end actuarial pipeline from raw claims ingestion to probabilistic premium pricing.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close workflow guide"
            className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          {STEPS.map((item) => (
            <div
              key={item.step}
              className="border border-border rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="space-y-1">
                <div className="text-xs font-mono text-primary">{item.step}</div>
                <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{item.description}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  onNavigate(item.target);
                  onClose();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-secondary-foreground bg-secondary hover:bg-muted rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {item.cta}
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-5 pt-4 border-t border-border flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-primary" />
              AES-256-GCM Pseudonymization
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-primary" />
              Colorblind-Safe Charts
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
              Keyboard Navigable
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 transition-colors cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

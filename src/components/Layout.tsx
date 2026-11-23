import React, { useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  BookOpen,
  FileSpreadsheet,
  Home,
  LogIn,
  LogOut,
  Menu,
  Moon,
  RotateCcw,
  Search,
  Shield,
  Sun,
  TrendingUp,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useClaimsData } from '../context/ClaimsDataContext';
import { AgeGroup, NavSection, PolicyType, Region } from '../types/claims';

interface LayoutProps {
  activeSection: NavSection;
  onNavigate: (section: NavSection) => void;
  onOpenGuide: () => void;
  children: React.ReactNode;
}

const NAV_ITEMS: { id: NavSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'overview', label: 'Executive Overview', icon: Home },
  { id: 'module1', label: '01. Preprocessing & Risk', icon: FileSpreadsheet },
  { id: 'module2', label: '02. Distribution & Mix', icon: BarChart3 },
  { id: 'module3', label: '03. Trends & Uncertainty', icon: TrendingUp },
  { id: 'governance', label: 'Governance & Security', icon: Shield },
];

const SECTION_TITLES: Record<NavSection, string> = {
  overview: 'Executive Overview',
  module1: '01. Claims Preprocessing & Risk-Segment Tagging',
  module2: '02. Claim Amount Distribution & Claim-Type Proportion',
  module3: '03. Claim Trend & Cost-Factor Uncertainty',
  governance: 'Governance, RBAC & Validation',
};

export function Layout({ activeSection, onNavigate, onOpenGuide, children }: LayoutProps) {
  const { firebaseUser, profile, effectiveRole, signingIn, signInWithGoogle, logout } = useAuth();
  const {
    datasets,
    activeDataset,
    selectDataset,
    filters,
    setFilters,
    resetFilters,
    filteredClaims,
    claims,
    statusMessage,
    errorMessage,
    clearMessages,
  } = useClaimsData();

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isDark, setIsDark] = useState<boolean>(() => {
    try {
      return localStorage.getItem('healthinsight-theme') === 'dark';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem('healthinsight-theme', isDark ? 'dark' : 'light');
    } catch {
      // Ignore storage failures in restricted contexts
    }
  }, [isDark]);

  const hasActiveFilter =
    filters.search !== '' ||
    filters.region !== 'All' ||
    filters.ageGroup !== 'All' ||
    filters.policyType !== 'All' ||
    filters.claimType !== 'All' ||
    filters.riskSegment !== 'All' ||
    filters.dateFrom !== '' ||
    filters.dateTo !== '';

  const sidebarContent = (
    <div className="flex flex-col h-full bg-card border-r border-border">
      <div className="px-5 py-5 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center shrink-0">
            <Activity className="w-4 h-4" />
          </div>
          <span className="font-display text-lg font-bold tracking-tight text-foreground whitespace-nowrap">
            HealthInsight
          </span>
        </div>
        <button
          type="button"
          onClick={() => setMobileNavOpen(false)}
          className="lg:hidden p-1.5 text-muted-foreground hover:text-foreground rounded-md cursor-pointer"
          aria-label="Close navigation menu"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <nav aria-label="Primary modules" className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onNavigate(item.id);
                setMobileNavOpen(false);
              }}
              aria-current={active ? 'page' : undefined}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-medium rounded-lg transition-colors text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-primary ${
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-border space-y-2.5">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenGuide}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-secondary-foreground bg-secondary hover:bg-muted rounded-lg transition-colors whitespace-nowrap cursor-pointer"
          >
            <BookOpen className="w-3.5 h-3.5 shrink-0" />
            Workflow Guide
          </button>
          <button
            type="button"
            onClick={() => setIsDark((d) => !d)}
            aria-label={isDark ? 'Switch to Snow Light theme' : 'Switch to Scarlet Dark theme'}
            title={isDark ? 'Switch to Snow Light theme' : 'Switch to Scarlet Dark theme'}
            className="p-2 text-secondary-foreground bg-secondary hover:bg-muted rounded-lg transition-colors shrink-0 cursor-pointer"
          >
            {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>
        </div>

        {firebaseUser ? (
          <div className="pt-2 border-t border-border text-xs">
            <div className="font-medium text-foreground truncate">
              {profile?.displayName || firebaseUser.displayName || 'Authenticated User'}
            </div>
            <div className="text-muted-foreground mt-0.5 flex items-center gap-1.5">
              <span className="capitalize">{effectiveRole}</span>
              <span aria-hidden="true">·</span>
              <span className="truncate">{firebaseUser.email}</span>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        ) : (
          <div className="pt-2 border-t border-border text-xs text-muted-foreground">
            Local Analytical Session · Sign in to sync encrypted datasets to Firestore.
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-background text-foreground">
      {/* Desktop Fixed Sidebar */}
      <aside className="hidden lg:block w-[260px] shrink-0 sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="relative w-72 max-w-[85vw] h-full z-10">{sidebarContent}</div>
        </div>
      )}

      {/* Main Viewport */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar Contract: 3 zones separated by gap-8 */}
        <header className="bg-card border-b border-border px-6 py-3.5 flex items-center justify-between gap-8 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden p-2 -ml-2 text-muted-foreground hover:text-foreground rounded-lg cursor-pointer"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-sm font-medium text-foreground truncate">
              <span className="text-muted-foreground">HealthInsight</span>
              <span className="mx-2 text-border" aria-hidden="true">/</span>
              <span>{SECTION_TITLES[activeSection]}</span>
            </div>
          </div>

          <nav className="hidden xl:flex items-center gap-6 text-xs font-medium text-muted-foreground">
            <button
              type="button"
              onClick={() => onNavigate('overview')}
              className="hover:text-foreground transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Overview
            </button>
            <button
              type="button"
              onClick={() => onNavigate('module1')}
              className="hover:text-foreground transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Preprocessing
            </button>
            <button
              type="button"
              onClick={() => onNavigate('module2')}
              className="hover:text-foreground transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Distribution
            </button>
            <button
              type="button"
              onClick={() => onNavigate('module3')}
              className="hover:text-foreground transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Uncertainty
            </button>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            {firebaseUser ? (
              <button
                type="button"
                onClick={() => onNavigate('module1')}
                className="px-4 py-2 text-xs font-medium text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Upload Claims
              </button>
            ) : (
              <button
                type="button"
                disabled={signingIn}
                onClick={() => void signInWithGoogle()}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-primary-foreground bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <LogIn className="w-3.5 h-3.5" />
                {signingIn ? 'Signing In...' : 'Sign In with Google'}
              </button>
            )}
          </div>
        </header>

        {/* Workspace Subset Filter & Dataset Bar */}
        <div className="bg-card border-b border-border px-6 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                aria-label="Search claim ID, masked patient ID, or ICD-10 code"
                value={filters.search}
                onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                placeholder="Search Claim ID, ICD-10, Patient..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-background border border-input rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
              />
            </div>

            <select
              aria-label="Active dataset"
              value={activeDataset?.id ?? ''}
              onChange={(e) => void selectDataset(e.target.value)}
              className="px-3 py-1.5 text-xs bg-background border border-input rounded-lg text-foreground max-w-[240px] focus:outline-none focus:border-primary"
            >
              {datasets.map((ds) => (
                <option key={ds.id} value={ds.id}>
                  {ds.name} ({ds.cleanedClaims})
                </option>
              ))}
            </select>

            <select
              aria-label="Filter by region"
              value={filters.region}
              onChange={(e) =>
                setFilters((f) => ({ ...f, region: e.target.value as Region | 'All' }))
              }
              className="px-2.5 py-1.5 text-xs bg-background border border-input rounded-lg text-foreground focus:outline-none focus:border-primary"
            >
              <option value="All">All Regions</option>
              <option value="Northeast">Northeast</option>
              <option value="Midwest">Midwest</option>
              <option value="South">South</option>
              <option value="West">West</option>
            </select>

            <select
              aria-label="Filter by age group"
              value={filters.ageGroup}
              onChange={(e) =>
                setFilters((f) => ({ ...f, ageGroup: e.target.value as AgeGroup | 'All' }))
              }
              className="px-2.5 py-1.5 text-xs bg-background border border-input rounded-lg text-foreground focus:outline-none focus:border-primary"
            >
              <option value="All">All Ages</option>
              <option value="0-17">0–17</option>
              <option value="18-34">18–34</option>
              <option value="35-49">35–49</option>
              <option value="50-64">50–64</option>
              <option value="65+">65+</option>
            </select>

            <select
              aria-label="Filter by policy type"
              value={filters.policyType}
              onChange={(e) =>
                setFilters((f) => ({ ...f, policyType: e.target.value as PolicyType | 'All' }))
              }
              className="px-2.5 py-1.5 text-xs bg-background border border-input rounded-lg text-foreground focus:outline-none focus:border-primary"
            >
              <option value="All">All Policies</option>
              <option value="PPO">PPO</option>
              <option value="HMO">HMO</option>
              <option value="EPO">EPO</option>
              <option value="HDHP">HDHP</option>
              <option value="Medicare Advantage">Medicare Advantage</option>
            </select>

            {hasActiveFilter && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-secondary-foreground hover:text-foreground bg-secondary rounded-lg cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                Reset
              </button>
            )}

            <div className="ml-auto text-xs font-mono tabular-nums text-muted-foreground">
              {filteredClaims.length.toLocaleString()} / {claims.length.toLocaleString()} claims
            </div>
          </div>
        </div>

        {/* Dismissible Feedback Banners */}
        {(statusMessage || errorMessage) && (
          <div className="px-6 pt-4">
            {errorMessage && (
              <div
                role="alert"
                className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-red-900 dark:text-red-200 px-4 py-2.5 rounded-lg text-xs flex items-center justify-between gap-4"
              >
                <span>{errorMessage}</span>
                <button
                  type="button"
                  onClick={clearMessages}
                  className="text-red-700 dark:text-red-300 hover:underline font-medium cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            )}
            {statusMessage && !errorMessage && (
              <div
                role="status"
                className="bg-accent border border-primary/25 text-accent-foreground px-4 py-2.5 rounded-lg text-xs flex items-center justify-between gap-4"
              >
                <span>{statusMessage}</span>
                <button
                  type="button"
                  onClick={clearMessages}
                  className="text-primary hover:underline font-medium cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            )}
          </div>
        )}

        {/* Main Content Viewport */}
        <main className="flex-1 p-6 max-w-[1440px] w-full mx-auto">{children}</main>

        <footer className="border-t border-border bg-card px-6 py-4 text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-4">
          <span>HealthInsight Health Claims & Premium Analytics</span>
          <span>HIPAA Safe Harbor Pseudonymization · AES-256-GCM · Role-Based Access Control</span>
        </footer>
      </div>
    </div>
  );
}

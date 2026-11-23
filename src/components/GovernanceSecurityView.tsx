import React, { useState } from 'react';
import { CheckCircle2, KeyRound, PlayCircle, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useClaimsData } from '../context/ClaimsDataContext';
import { runPlatformValidationSuite, ValidationTestResult } from '../lib/validationTests';
import { UserRole } from '../types/claims';

export function GovernanceSecurityView() {
  const {
    firebaseUser,
    profile,
    effectiveRole,
    teamUsers,
    auditLogs,
    updateUserRole,
    signInWithGoogle,
  } = useAuth();
  const { keyFingerprint, rotateEncryptionKey, setEncryptionPassphrase } = useClaimsData();

  const [passphrase, setPassphrase] = useState('');
  const [testResults, setTestResults] = useState<ValidationTestResult[] | null>(null);
  const [runningTests, setRunningTests] = useState(false);

  const handleRunTests = async () => {
    setRunningTests(true);
    try {
      const res = await runPlatformValidationSuite();
      setTestResults(res);
    } finally {
      setRunningTests(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Privacy & AES-256-GCM Key Management */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold text-foreground">
                HIPAA / GDPR Privacy & AES-256-GCM Encryption
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Patient identifiers are encrypted client-side via Web Crypto AES-256-GCM before any
                Firestore persistence, paired with Safe Harbor masked tokens.
              </p>
            </div>
            <ShieldCheck className="w-5 h-5 text-primary shrink-0" />
          </div>

          <div className="border border-border rounded-lg p-3.5 bg-muted/40 flex items-center justify-between gap-4 text-xs">
            <div>
              <div className="text-muted-foreground">Active AES-256-GCM Key Fingerprint</div>
              <div className="mt-0.5 font-mono font-semibold text-foreground">{keyFingerprint}</div>
            </div>
            <button
              type="button"
              onClick={() => void rotateEncryptionKey()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-foreground bg-card border border-border hover:bg-muted rounded-lg cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Rotate Session Key
            </button>
          </div>

          <div className="space-y-2 text-xs">
            <label htmlFor="pbkdf2-passphrase" className="block font-medium text-foreground">
              Derive Organization Key via PBKDF2-SHA256 (100,000 iterations)
            </label>
            <div className="flex items-center gap-2">
              <input
                id="pbkdf2-passphrase"
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Minimum 8 characters..."
                className="flex-1 px-3 py-2 bg-background border border-input rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={() => {
                  void setEncryptionPassphrase(passphrase);
                  setPassphrase('');
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-primary-foreground bg-primary hover:bg-primary/90 rounded-lg cursor-pointer transition-colors"
              >
                <KeyRound className="w-3.5 h-3.5" />
                Derive Key
              </button>
            </div>
          </div>
        </div>

        {/* RBAC Permissions Matrix */}
        <div className="bg-card border border-border rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Role-Based Access Control (RBAC) Matrix
              </h2>
              <p className="text-xs text-muted-foreground">
                Enforced server-side via hardened Firestore security rules
              </p>
            </div>
            <div className="text-xs font-mono text-muted-foreground">
              Current:{' '}
              <span className="font-semibold capitalize text-primary">
                {firebaseUser ? effectiveRole : 'viewer'}
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-2 pr-3">Capability</th>
                  <th className="py-2 px-3 text-center">Viewer</th>
                  <th className="py-2 px-3 text-center">Analyst</th>
                  <th className="py-2 pl-3 text-center">Admin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-foreground">
                <tr>
                  <td className="py-2 pr-3">View Shared Charts & Run Scenarios</td>
                  <td className="py-2 px-3 text-center font-mono">Allow</td>
                  <td className="py-2 px-3 text-center font-mono">Allow</td>
                  <td className="py-2 pl-3 text-center font-mono">Allow</td>
                </tr>
                <tr>
                  <td className="py-2 pr-3">Upload Claims & Save Datasets to Firestore</td>
                  <td className="py-2 px-3 text-center font-mono text-muted-foreground">Deny</td>
                  <td className="py-2 px-3 text-center font-mono">Allow</td>
                  <td className="py-2 pl-3 text-center font-mono">Allow</td>
                </tr>
                <tr>
                  <td className="py-2 pr-3">Save Risk Rule Presets & Scenarios</td>
                  <td className="py-2 px-3 text-center font-mono text-muted-foreground">Deny</td>
                  <td className="py-2 px-3 text-center font-mono">Allow</td>
                  <td className="py-2 pl-3 text-center font-mono">Allow</td>
                </tr>
                <tr>
                  <td className="py-2 pr-3">Decrypt Patient Tokens & Inspect Audit Logs</td>
                  <td className="py-2 px-3 text-center font-mono text-muted-foreground">Deny</td>
                  <td className="py-2 px-3 text-center font-mono">Own</td>
                  <td className="py-2 pl-3 text-center font-mono">Full</td>
                </tr>
                <tr>
                  <td className="py-2 pr-3">Manage Team Roles (RBAC Promotion)</td>
                  <td className="py-2 px-3 text-center font-mono text-muted-foreground">Deny</td>
                  <td className="py-2 px-3 text-center font-mono text-muted-foreground">Deny</td>
                  <td className="py-2 pl-3 text-center font-mono">Allow</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Team RBAC Directory & Audit Log */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Team Access Directory</h2>
          {!firebaseUser ? (
            <div className="py-6 text-xs text-muted-foreground space-y-3">
              <p>Sign in with Google to verify your identity and view your RBAC profile.</p>
              <button
                type="button"
                onClick={() => void signInWithGoogle()}
                className="px-3.5 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg font-medium cursor-pointer transition-colors"
              >
                Sign In with Google
              </button>
            </div>
          ) : (
            <div className="divide-y divide-border text-xs">
              {(teamUsers.length > 0 ? teamUsers : profile ? [profile] : []).map((u) => (
                <div key={u.uid} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-foreground truncate">{u.displayName}</div>
                    <div className="text-[11px] font-mono text-muted-foreground truncate">
                      {u.uid} · {u.department}
                    </div>
                  </div>
                  {effectiveRole === 'admin' ? (
                    <select
                      aria-label={`Role for ${u.displayName}`}
                      value={u.role}
                      onChange={(e) => void updateUserRole(u.uid, e.target.value as UserRole)}
                      className="px-2.5 py-1 bg-background border border-input rounded-lg text-xs capitalize text-foreground focus:outline-none focus:border-primary"
                    >
                      <option value="viewer">Viewer</option>
                      <option value="analyst">Analyst</option>
                      <option value="admin">Admin</option>
                    </select>
                  ) : (
                    <span className="font-mono capitalize text-foreground">{u.role}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">
            HIPAA / GDPR Compliance Audit Trail
          </h2>
          {auditLogs.length === 0 ? (
            <div className="py-6 text-xs text-muted-foreground">
              {firebaseUser
                ? 'No audit events recorded yet for your account.'
                : 'Sign in to record and inspect persistent Firestore audit events.'}
            </div>
          ) : (
            <div className="divide-y divide-border max-h-64 overflow-y-auto text-xs">
              {auditLogs.map((log) => (
                <div key={log.id} className="py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-foreground">{log.action}</span>
                    <span className="font-mono text-[11px] text-primary capitalize">
                      {log.actorRole}
                    </span>
                  </div>
                  <div className="text-muted-foreground mt-0.5">{log.details}</div>
                  <div className="text-[11px] font-mono text-muted-foreground/80">
                    {log.resourcePath}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Automated Unit & Integration Verification Suite */}
      <section className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Platform Unit, Security & Cross-Module Integration Tests
            </h2>
            <p className="text-xs text-muted-foreground">
              Execute live verification checks against date normalization, ICD-10 formatting,
              AES-256-GCM encryption, and Module 1 → Module 3 data pipelines.
            </p>
          </div>
          <button
            type="button"
            disabled={runningTests}
            onClick={() => void handleRunTests()}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-primary-foreground bg-primary hover:bg-primary/90 disabled:opacity-50 rounded-lg cursor-pointer transition-colors"
          >
            <PlayCircle className="w-4 h-4" />
            {runningTests ? 'Running Suite...' : 'Run Verification Suite'}
          </button>
        </div>

        {testResults && (
          <div className="divide-y divide-border border border-border rounded-lg">
            {testResults.map((t) => (
              <div key={t.id} className="p-3.5 flex items-start justify-between gap-4 text-xs">
                <div className="flex items-start gap-2.5">
                  {t.passed ? (
                    <CheckCircle2 className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <div className="font-medium text-foreground">
                      {t.category} · {t.name}
                    </div>
                    <div className="text-muted-foreground font-mono text-[11px] mt-0.5">
                      {t.details}
                    </div>
                  </div>
                </div>
                <span
                  className={`font-mono font-semibold shrink-0 ${
                    t.passed
                      ? 'text-teal-600 dark:text-teal-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {t.passed ? 'PASS' : 'FAIL'}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

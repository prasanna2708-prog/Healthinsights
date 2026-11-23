import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  auth,
  BOOTSTRAPPED_ADMIN_EMAIL,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
import { AuditLogEntry, UserProfile, UserRole } from '../types/claims';

interface AuthContextValue {
  firebaseUser: User | null;
  profile: UserProfile | null;
  effectiveRole: UserRole;
  authReady: boolean;
  signingIn: boolean;
  authError: string | null;
  teamUsers: UserProfile[];
  auditLogs: AuditLogEntry[];
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  updateUserRole: (targetUid: string, nextRole: UserRole) => Promise<void>;
  recordAuditEvent: (action: string, resourcePath: string, details: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [teamUsers, setTeamUsers] = useState<UserProfile[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);

  const isBootstrappedAdmin = Boolean(
    firebaseUser?.emailVerified && firebaseUser.email === BOOTSTRAPPED_ADMIN_EMAIL,
  );
  const effectiveRole: UserRole = isBootstrappedAdmin
    ? 'admin'
    : (profile?.role ?? 'viewer');

  const recordAuditEvent = useCallback(
    async (action: string, resourcePath: string, details: string) => {
      const current = auth.currentUser;
      if (!current || !current.emailVerified) return;
      const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const path = `auditLogs/${logId}`;
      try {
        await setDoc(doc(db, 'auditLogs', logId), {
          id: logId,
          actorUid: current.uid,
          actorRole:
            current.email === BOOTSTRAPPED_ADMIN_EMAIL && current.emailVerified
              ? 'admin'
              : (profile?.role ?? 'viewer'),
          action: action.slice(0, 64),
          resourcePath: resourcePath.slice(0, 160),
          details: details.slice(0, 240),
          createdAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, path);
      }
    },
    [profile?.role],
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (!user) {
        setProfile(null);
        setTeamUsers([]);
        setAuditLogs([]);
        setAuthReady(true);
        return;
      }

      const userPath = `users/${user.uid}`;
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (!snap.exists()) {
          const initialRole: UserRole =
            user.emailVerified && user.email === BOOTSTRAPPED_ADMIN_EMAIL ? 'admin' : 'viewer';
          const displayName = (
            user.displayName ||
            user.email?.split('@')[0] ||
            'Actuarial User'
          ).slice(0, 80);

          await setDoc(doc(db, 'users', user.uid), {
            uid: user.uid,
            displayName,
            role: initialRole,
            department: initialRole === 'admin' ? 'Actuarial Governance' : 'Risk Analytics',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          await setDoc(doc(db, 'users', user.uid, 'private', 'contact'), {
            uid: user.uid,
            email: (user.email || 'unknown@healthinsight.local').slice(0, 160),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        console.error('Profile initialization error:', err);
      } finally {
        setAuthReady(true);
      }
      void userPath;
    });

    return () => unsub();
  }, []);

  // Listen to signed-in user's profile
  useEffect(() => {
    if (!authReady || !firebaseUser) return;
    const path = `users/${firebaseUser.uid}`;
    const unsub = onSnapshot(
      doc(db, 'users', firebaseUser.uid),
      (snap) => {
        if (snap.exists()) {
          const d = snap.data();
          setProfile({
            uid: String(d.uid),
            displayName: String(d.displayName),
            role: (d.role as UserRole) ?? 'viewer',
            department: String(d.department ?? 'Actuarial Analytics'),
            email: firebaseUser.email ?? undefined,
            createdAt: d.createdAt,
            updatedAt: d.updatedAt,
          });
        }
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, path);
      },
    );
    return () => unsub();
  }, [authReady, firebaseUser]);

  // Listen to team user list (strictly for bootstrapped admin per Firestore list rule)
  useEffect(() => {
    if (!authReady || !firebaseUser || !isBootstrappedAdmin) {
      setTeamUsers(profile ? [profile] : []);
      return;
    }
    const path = 'users';
    const unsub = onSnapshot(
      collection(db, 'users'),
      (snap) => {
        const list: UserProfile[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            uid: String(d.uid),
            displayName: String(d.displayName),
            role: (d.role as UserRole) ?? 'viewer',
            department: String(d.department ?? 'Risk Analytics'),
            createdAt: d.createdAt,
            updatedAt: d.updatedAt,
          };
        });
        setTeamUsers(list);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, path);
      },
    );
    return () => unsub();
  }, [authReady, firebaseUser, isBootstrappedAdmin, profile]);

  // Listen to audit logs (filtered by actorUid unless bootstrapped admin)
  useEffect(() => {
    if (!authReady || !firebaseUser) return;
    const path = 'auditLogs';
    const q = isBootstrappedAdmin
      ? query(collection(db, 'auditLogs'), orderBy('createdAt', 'desc'), limit(40))
      : query(
          collection(db, 'auditLogs'),
          where('actorUid', '==', firebaseUser.uid),
          orderBy('createdAt', 'desc'),
          limit(25),
        );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const logs: AuditLogEntry[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: String(d.id),
            actorUid: String(d.actorUid),
            actorRole: (d.actorRole as UserRole) ?? 'viewer',
            action: String(d.action),
            resourcePath: String(d.resourcePath),
            details: String(d.details),
            createdAt: d.createdAt,
          };
        });
        setAuditLogs(logs);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, path);
      },
    );

    return () => unsub();
  }, [authReady, firebaseUser, isBootstrappedAdmin]);

  const signInWithGoogle = useCallback(async () => {
    setSigningIn(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign-in could not complete.';
      setAuthError(msg);
    } finally {
      setSigningIn(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth);
  }, []);

  const updateUserRole = useCallback(
    async (targetUid: string, nextRole: UserRole) => {
      if (!firebaseUser) return;
      const path = `users/${targetUid}`;
      try {
        await updateDoc(doc(db, 'users', targetUid), {
          role: nextRole,
          updatedAt: serverTimestamp(),
        });
        await recordAuditEvent(
          'RBAC_ROLE_UPDATE',
          path,
          `Updated role for ${targetUid} to ${nextRole}`,
        );
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, path);
      }
    },
    [firebaseUser, recordAuditEvent],
  );

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        profile,
        effectiveRole,
        authReady,
        signingIn,
        authError,
        teamUsers,
        auditLogs,
        signInWithGoogle,
        logout,
        updateUserRole,
        recordAuditEvent,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

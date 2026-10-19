'use client';

import { authClaimsSchema, type AuthClaims } from '@susu/shared';
import { onIdTokenChanged, signOut as firebaseSignOut, type User } from 'firebase/auth';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { firebase } from './firebase';

export type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out' }
  /** Signed in, but no valid role claim yet (API.md §1). */
  | { status: 'no-role'; user: User }
  | { status: 'ready'; user: User; claims: AuthClaims };

interface AuthContextValue {
  state: AuthState;
  /** Force-refresh the ID token so changed claims take effect (API.md §1). */
  refreshClaims: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function resolve(user: User | null, forceRefresh = false): Promise<AuthState> {
  if (!user) return { status: 'signed-out' };
  const token = await user.getIdTokenResult(forceRefresh);
  const claims = authClaimsSchema.safeParse(token.claims);
  return claims.success ? { status: 'ready', user, claims: claims.data } : { status: 'no-role', user };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    const { auth } = firebase();
    return onIdTokenChanged(auth, (user) => {
      resolve(user)
        .then(setState)
        .catch(() => setState({ status: 'signed-out' }));
    });
  }, []);

  const refreshClaims = useCallback(async () => {
    const user = firebase().auth.currentUser;
    setState(await resolve(user, true));
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(firebase().auth);
  }, []);

  const value = useMemo(() => ({ state, refreshClaims, signOut }), [state, refreshClaims, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

/** For screens inside the signed-in shell, where claims are guaranteed. */
export function useSession(): { user: User; claims: AuthClaims } {
  const { state } = useAuth();
  if (state.status !== 'ready') throw new Error('useSession used outside a ready session');
  return { user: state.user, claims: state.claims };
}

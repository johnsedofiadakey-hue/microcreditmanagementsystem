'use client';

import { isHeadOffice } from '@susu/shared';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { listBranches, type BranchSummary } from './api';
import { useSession } from './auth-context';
import { mockStore } from './mock-store';

/** `null` means "All branches" — only offered to head-office roles. */
export type BranchScope = string | null;

interface BranchContextValue {
  /** Branches this person may work in. */
  branches: BranchSummary[];
  scope: BranchScope;
  setScope: (scope: BranchScope) => void;
  /** True when the person has more than one branch to choose from. */
  canSwitch: boolean;
  canSeeAll: boolean;
  branchName: (id: string) => string;
}

const BranchContext = createContext<BranchContextValue | null>(null);
const STORAGE_KEY = 'susu.portal.branchScope';

export function BranchProvider({ children }: { children: ReactNode }) {
  const { claims } = useSession();
  const headOffice = isHeadOffice(claims.role);
  const [all, setAll] = useState<BranchSummary[]>([]);
  const [scope, setScopeState] = useState<BranchScope>(null);

  useEffect(() => {
    const refresh = () => listBranches().then((r) => setAll(r.branches));
    refresh();
    // TODO(api): drop the subscription once listBranches is a real call.
    const unsubscribe = mockStore.subscribe(refresh);
    return () => {
      unsubscribe();
    };
  }, []);

  const branches = useMemo(() => {
    if (headOffice) return all;
    // Scoped roles: exactly the branches in their claims, named from the list where we know them.
    return claims.branchIds.map(
      (id) => all.find((b) => b.id === id) ?? { id, code: id.slice(0, 6).toUpperCase(), name: 'Branch', status: 'ACTIVE' as const },
    );
  }, [all, claims.branchIds, headOffice]);

  // Restore the last choice, but never outside what the claims allow.
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      stored = null;
    }
    const allowed = (id: string | null) => (id === null ? headOffice : branches.some((b) => b.id === id));
    if (stored === 'ALL' && headOffice) setScopeState(null);
    else if (stored && allowed(stored)) setScopeState(stored);
    else setScopeState(headOffice ? null : (branches[0]?.id ?? null));
  }, [branches, headOffice]);

  const value = useMemo<BranchContextValue>(
    () => ({
      branches,
      scope,
      setScope: (next) => {
        setScopeState(next);
        try {
          window.localStorage.setItem(STORAGE_KEY, next ?? 'ALL');
        } catch {
          // Storage unavailable; the choice lasts for this tab only.
        }
      },
      canSwitch: headOffice || branches.length > 1,
      canSeeAll: headOffice,
      branchName: (id) => {
        const b = all.find((x) => x.id === id);
        return b ? `${b.name} (${b.code})` : `Branch ${id.slice(0, 8)}`;
      },
    }),
    [all, branches, headOffice, scope],
  );

  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>;
}

export function useBranch(): BranchContextValue {
  const value = useContext(BranchContext);
  if (!value) throw new Error('useBranch must be used inside <BranchProvider>');
  return value;
}

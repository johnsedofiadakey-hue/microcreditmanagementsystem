'use client';

import type { KycStatus, MemberStatus, SusuFrequency } from '@susu/shared';
import { mockStore, SAMPLE_BRANCH_ID } from './mock-store';

/**
 * TODO(api): delete once searchMembers / getMember / getAccountStatement / listPendingApprovals /
 * listSusuProducts exist. Holds sample members plus anything this browser created through the
 * real callables (registerMember, approveMember, createSusuProduct, openSusuAccount), so the Members
 * screens work before the read endpoints land. Rows with `sample: true` do not exist on the server.
 */

export interface MockMember {
  id: string;
  branchId: string;
  fullName: string;
  /** E.164, e.g. +233241234567. */
  phone: string;
  ghanaCardNumber: string;
  dateOfBirth: string;
  status: MemberStatus;
  kycStatus: KycStatus;
  createdBy: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  photoCount: number;
  sample?: boolean;
}

export interface MockProduct {
  id: string;
  code: string;
  version: number;
  name: string;
  frequency: SusuFrequency;
  status: 'ACTIVE' | 'RETIRED';
  sample?: boolean;
}

export interface MockAccount {
  id: string;
  memberId: string;
  productId: string;
  productName: string;
  balancePesewas: number;
  status: 'ACTIVE' | 'FROZEN' | 'CLOSED';
  openedAt: string;
  sample?: boolean;
}

export interface MockStatementLine {
  postedAt: string;
  kind: string;
  description: string;
  debitPesewas: number;
  creditPesewas: number;
  balanceAfterPesewas: number;
  batchId: string;
}

interface MembersState {
  members: MockMember[];
  products: MockProduct[];
  accounts: MockAccount[];
  statements: Record<string, MockStatementLine[]>;
}

const STORAGE_KEY = 'susu.portal.mock.members.v1';

function seed(): MembersState {
  const now = Date.now();
  const ago = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
  const productId = '5e1f0a2b-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
  const accountId = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
  const collections = [2000, 2000, 5000, 2000, 1250];
  let balance = 0;
  const lines: MockStatementLine[] = collections.map((amount, i) => {
    balance += amount;
    return {
      postedAt: ago(24 * (collections.length - i)),
      kind: 'SUSU_COLLECTION',
      description: 'Susu collection · Adum Market Pair',
      debitPesewas: 0,
      creditPesewas: amount,
      balanceAfterPesewas: balance,
      batchId: `b${i}c4e9a2-1f3d-4b5e-8a7c-${String(i).padStart(12, '0')}`,
    };
  });
  return {
    products: [
      { id: productId, code: 'DAILY', version: 1, name: 'Daily Susu', frequency: 'DAILY', status: 'ACTIVE', sample: true },
      {
        id: '6f2a1b3c-4d5e-4f6a-9b8c-7d6e5f4a3b2c',
        code: 'WEEKLY',
        version: 1,
        name: 'Weekly Susu',
        frequency: 'WEEKLY',
        status: 'ACTIVE',
        sample: true,
      },
    ],
    members: [
      {
        id: '2b7c9a10-1f2e-4d3c-8b4a-5e6f7a8b9c01',
        branchId: SAMPLE_BRANCH_ID,
        fullName: 'Ama Owusu',
        phone: '+233241112201',
        ghanaCardNumber: 'GHA-712345678-3',
        dateOfBirth: '1986-04-12',
        status: 'ACTIVE',
        kycStatus: 'DRAFT',
        createdBy: 'sample-agent-1',
        createdAt: ago(24 * 9),
        approvedBy: 'sample-manager-1',
        approvedAt: ago(24 * 8),
        photoCount: 2,
        sample: true,
      },
      {
        id: '2b7c9a10-1f2e-4d3c-8b4a-5e6f7a8b9c02',
        branchId: SAMPLE_BRANCH_ID,
        fullName: 'Kwabena Mensah',
        phone: '+233552223302',
        ghanaCardNumber: 'GHA-798765432-1',
        dateOfBirth: '1979-11-02',
        status: 'PENDING_APPROVAL',
        kycStatus: 'DRAFT',
        createdBy: 'sample-agent-2',
        createdAt: ago(5),
        approvedBy: null,
        approvedAt: null,
        photoCount: 1,
        sample: true,
      },
    ],
    accounts: [
      {
        id: accountId,
        memberId: '2b7c9a10-1f2e-4d3c-8b4a-5e6f7a8b9c01',
        productId,
        productName: 'Daily Susu',
        balancePesewas: balance,
        status: 'ACTIVE',
        openedAt: ago(24 * 8),
        sample: true,
      },
    ],
    statements: { [accountId]: lines },
  };
}

let state: MembersState | undefined;

function load(): MembersState {
  if (state) return state;
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
    state = raw ? (JSON.parse(raw) as MembersState) : seed();
  } catch {
    state = seed();
  }
  return state;
}

function save(next: MembersState) {
  state = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: keep the in-memory copy only.
  }
  mockStore.notify();
}

export const mockMembers = {
  members: () => [...load().members],
  member: (id: string) => load().members.find((m) => m.id === id) ?? null,
  products: () => [...load().products],
  accountsFor: (memberId: string) => load().accounts.filter((a) => a.memberId === memberId),
  account: (id: string) => load().accounts.find((a) => a.id === id) ?? null,
  statement: (accountId: string) => [...(load().statements[accountId] ?? [])],

  addMember(member: MockMember) {
    const s = load();
    save({ ...s, members: [member, ...s.members] });
  },
  approveMember(id: string, approvedBy: string) {
    const s = load();
    save({
      ...s,
      members: s.members.map((m) =>
        m.id === id ? { ...m, status: 'ACTIVE', approvedBy, approvedAt: new Date().toISOString() } : m,
      ),
    });
  },
  addProduct(product: MockProduct) {
    const s = load();
    // Mirrors the server: a new version of a code retires the previous active one.
    const products = s.products.map((p) =>
      p.code === product.code && p.status === 'ACTIVE' ? { ...p, status: 'RETIRED' as const } : p,
    );
    save({ ...s, products: [...products, product] });
  },
  addAccount(account: MockAccount) {
    const s = load();
    save({ ...s, accounts: [...s.accounts, account], statements: { ...s.statements, [account.id]: [] } });
  },
};

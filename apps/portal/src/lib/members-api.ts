'use client';

import {
  type ApproveMemberRequest,
  type CreateSusuProductRequest,
  type KycStatus,
  type MemberStatus,
  type OpenSusuAccountRequest,
  type RegisterMemberRequest,
  type SusuFrequency,
} from '@susu/shared';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytes } from 'firebase/storage';
import { withoutUndefined } from './api';
import { firebase } from './firebase';
import { mockMembers, type MockStatementLine } from './mock-members';
import { maskGhanaCard } from './utils';

/**
 * Members, products and Susu accounts. Built callables (API.md §2) go to Cloud Functions; the
 * planned read endpoints come from `mockMembers` behind `// TODO(api)` seams with the documented shapes.
 */

async function call<Req, Res>(name: string, data: Req): Promise<Res> {
  const result = await httpsCallable<Req, Res>(firebase().functions, name)(withoutUndefined(data));
  return result.data;
}

/** searchMembers row (API.md §2). Only masked phone and Ghana Card leave the server here. */
export interface MemberRow {
  id: string;
  fullName: string;
  phoneMasked: string;
  ghanaCardMasked: string;
  status: MemberStatus;
  kycStatus: KycStatus;
  branchId: string;
  createdAt: string;
  sample?: boolean;
}

export interface MemberAccount {
  id: string;
  productName: string;
  balancePesewas: number;
  status: 'ACTIVE' | 'FROZEN' | 'CLOSED';
  sample?: boolean;
}

/**
 * getMember (API.md §2: "member profile + accounts"). The profile fields are not pinned down in
 * API.md yet — requested in REQUESTS.md. `ghanaCardNumber` should only be returned in full to
 * roles allowed to see it; the UI masks it for everyone else regardless.
 */
export interface MemberProfile {
  id: string;
  branchId: string;
  fullName: string;
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
  accounts: MemberAccount[];
  sample?: boolean;
}

export type StatementLine = MockStatementLine;

export interface PendingApproval {
  kind: 'MEMBER_REGISTRATION';
  id: string;
  summary: string;
  requestedBy: string;
  requestedAt: string;
  branchId: string;
  sample?: boolean;
}

/** Not in API.md — requested as listSusuProducts in REQUESTS.md. */
export interface ProductRow {
  id: string;
  code: string;
  version: number;
  name: string;
  frequency: SusuFrequency;
  status: 'ACTIVE' | 'RETIRED';
  sample?: boolean;
}

function maskPhone(e164: string): string {
  // +233241234567 -> 024 ••• ••67
  const local = e164.startsWith('+233') ? `0${e164.slice(4)}` : e164;
  return `${local.slice(0, 3)} ••• ••${local.slice(-2)}`;
}

// ── Built callables ───────────────────────────────────────────────────────────

export async function registerMember(input: RegisterMemberRequest, actorUid: string) {
  const result = await call<RegisterMemberRequest, { memberId: string }>('registerMember', input);
  // TODO(api): remove once searchMembers/getMember are built.
  const phone = input.phone.replace(/[\s-]/g, '');
  mockMembers.addMember({
    id: result.memberId,
    branchId: input.branchId,
    fullName: input.fullName.trim(),
    phone: phone.startsWith('0') ? `+233${phone.slice(1)}` : phone,
    ghanaCardNumber: input.ghanaCardNumber.trim().toUpperCase(),
    dateOfBirth: input.dateOfBirth,
    status: 'PENDING_APPROVAL',
    kycStatus: 'DRAFT',
    createdBy: actorUid,
    createdAt: new Date().toISOString(),
    approvedBy: null,
    approvedAt: null,
    photoCount: input.photoPaths?.length ?? 0,
  });
  return result;
}

export async function approveMember(input: ApproveMemberRequest, actorUid: string) {
  await call<ApproveMemberRequest, null>('approveMember', input);
  mockMembers.approveMember(input.memberId, actorUid); // TODO(api)
}

export async function createSusuProduct(input: CreateSusuProductRequest) {
  const result = await call<CreateSusuProductRequest, { productId: string; version: number }>('createSusuProduct', input);
  // TODO(api): remove once listSusuProducts exists.
  mockMembers.addProduct({
    id: result.productId,
    code: input.code.trim().toUpperCase(),
    version: result.version,
    name: input.name.trim(),
    frequency: input.frequency,
    status: 'ACTIVE',
  });
  return result;
}

export async function openSusuAccount(input: OpenSusuAccountRequest) {
  const result = await call<OpenSusuAccountRequest, { susuAccountId: string }>('openSusuAccount', input);
  const product = mockMembers.products().find((p) => p.id === input.productId);
  // TODO(api): remove once getMember returns accounts.
  mockMembers.addAccount({
    id: result.susuAccountId,
    memberId: input.memberId,
    productId: input.productId,
    productName: product?.name ?? 'Susu account',
    balancePesewas: 0,
    status: 'ACTIVE',
    openedAt: new Date().toISOString(),
  });
  return result;
}

/**
 * Upload a KYC photo to the inbox (API.md §5): `kyc-inbox/{uid}/{uuid}.{ext}`, JPEG/PNG/WebP < 8 MB.
 * Returns the storage path to pass in registerMember.photoPaths. Nothing can read it back.
 */
export async function uploadKycPhoto(file: File, uid: string): Promise<string> {
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `kyc-inbox/${uid}/${crypto.randomUUID()}.${ext}`;
  await uploadBytes(ref(firebase().storage, path), file, { contentType: file.type });
  return path;
}

// ── Planned endpoints (mocked) ────────────────────────────────────────────────

export async function searchMembers(input: {
  branchId?: string;
  query: string;
  status?: MemberStatus;
}): Promise<{ members: MemberRow[]; nextCursor: string | null }> {
  // TODO(api): return call('searchMembers', input) — planned, Step 3. API.md requires branchId;
  // head office "All branches" would need it optional (requested in REQUESTS.md).
  const q = input.query.trim().toLowerCase();
  const members = mockMembers
    .members()
    .filter((m) => !input.branchId || m.branchId === input.branchId)
    .filter((m) => !input.status || m.status === input.status)
    .filter((m) => !q || m.fullName.toLowerCase().includes(q) || m.phone.includes(q.replace(/^0/, '')) || m.ghanaCardNumber.toLowerCase() === q)
    .map((m) => ({
      id: m.id,
      fullName: m.fullName,
      phoneMasked: maskPhone(m.phone),
      ghanaCardMasked: maskGhanaCard(m.ghanaCardNumber),
      status: m.status,
      kycStatus: m.kycStatus,
      branchId: m.branchId,
      createdAt: m.createdAt,
      sample: m.sample,
    }));
  return { members, nextCursor: null };
}

export async function getMember(input: { memberId: string }): Promise<MemberProfile | null> {
  // TODO(api): return call('getMember', input) — planned, Step 3.
  const m = mockMembers.member(input.memberId);
  if (!m) return null;
  return {
    ...m,
    accounts: mockMembers.accountsFor(m.id).map((a) => ({
      id: a.id,
      productName: a.productName,
      balancePesewas: a.balancePesewas,
      status: a.status,
      sample: a.sample,
    })),
  };
}

export async function getAccountStatement(input: {
  susuAccountId: string;
}): Promise<{ account: MemberAccount & { memberId: string } | null; lines: StatementLine[]; nextCursor: string | null }> {
  // TODO(api): return call('getAccountStatement', input) — planned, Step 3. The account header
  // (member, product, balance) is not in the documented response; requested in REQUESTS.md.
  const a = mockMembers.account(input.susuAccountId);
  return {
    account: a
      ? { id: a.id, memberId: a.memberId, productName: a.productName, balancePesewas: a.balancePesewas, status: a.status, sample: a.sample }
      : null,
    lines: mockMembers.statement(input.susuAccountId).sort((x, y) => (x.postedAt < y.postedAt ? 1 : -1)),
    nextCursor: null,
  };
}

export async function listPendingApprovals(input: { branchId?: string }): Promise<{ items: PendingApproval[] }> {
  // TODO(api): return call('listPendingApprovals', input) — planned, Step 3.
  const items = mockMembers
    .members()
    .filter((m) => m.status === 'PENDING_APPROVAL' && (!input.branchId || m.branchId === input.branchId))
    .map<PendingApproval>((m) => ({
      kind: 'MEMBER_REGISTRATION',
      id: m.id,
      summary: `New member: ${m.fullName}`,
      requestedBy: m.createdBy,
      requestedAt: m.createdAt,
      branchId: m.branchId,
      sample: m.sample,
    }));
  return { items };
}

export async function listSusuProducts(): Promise<{ products: ProductRow[] }> {
  // TODO(api): not in API.md — requested as listSusuProducts in REQUESTS.md.
  return { products: mockMembers.products() };
}

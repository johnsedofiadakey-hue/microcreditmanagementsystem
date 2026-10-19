'use client';

import type {
  AccountStatement,
  ApproveMemberRequest,
  AssignCollectorRequest,
  CreateSusuProductRequest,
  MemberProfile,
  MemberRow,
  MemberStatus,
  OpenSusuAccountRequest,
  PendingApproval,
  ProductRow,
  RegisterMemberRequest,
  UnassignCollectorRequest,
} from '@susu/shared';
import { FirebaseError } from 'firebase/app';
import { ref, uploadBytes } from 'firebase/storage';
import { call, LIST_LIMIT, write } from './api';
import { firebase } from './firebase';

export type { AccountCollector, MemberAccount, MemberProfile, MemberRow, PendingApproval, ProductRow, StatementLine } from '@susu/shared';

/** Members, products and Susu accounts (API.md §2). Lists are scoped to the caller's branches on the server. */

/** True when the server answered with one of these reason codes (`details.reason`). */
function hasReason(error: unknown, ...reasons: string[]): boolean {
  const reason = (error as FirebaseError & { details?: { reason?: string } })?.details?.reason;
  return error instanceof FirebaseError && !!reason && reasons.includes(reason);
}

// ── Writes ────────────────────────────────────────────────────────────────────

export async function registerMember(input: RegisterMemberRequest) {
  return write<RegisterMemberRequest, { memberId: string }>('registerMember', input);
}

export async function approveMember(input: ApproveMemberRequest) {
  await write<ApproveMemberRequest, null>('approveMember', input);
}

export async function createSusuProduct(input: CreateSusuProductRequest) {
  return write<CreateSusuProductRequest, { productId: string; version: number }>('createSusuProduct', input);
}

export async function openSusuAccount(input: OpenSusuAccountRequest) {
  return write<OpenSusuAccountRequest, { susuAccountId: string }>('openSusuAccount', input);
}

/** Put an account on an agent pair's route; the agents' phones get it straight away (API.md §2). */
export async function assignCollector(input: AssignCollectorRequest) {
  await write<AssignCollectorRequest, null>('assignCollector', input);
}

export async function unassignCollector(input: UnassignCollectorRequest) {
  await write<UnassignCollectorRequest, null>('unassignCollector', input);
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

// ── Reads ─────────────────────────────────────────────────────────────────────

export async function searchMembers(input: {
  branchId?: string;
  query: string;
  status?: MemberStatus;
  cursor?: string | null;
}): Promise<{ members: MemberRow[]; nextCursor: string | null }> {
  return call('searchMembers', { ...input, limit: LIST_LIMIT });
}

/** Null when the member doesn't exist or belongs to a branch the caller can't see. */
export async function getMember(input: { memberId: string }): Promise<MemberProfile | null> {
  try {
    return await call<{ memberId: string }, MemberProfile>('getMember', input);
  } catch (error) {
    if (hasReason(error, 'MEMBER_NOT_FOUND')) return null;
    throw error;
  }
}

/** Null when the account doesn't exist or belongs to a branch the caller can't see. */
export async function getAccountStatement(input: {
  susuAccountId: string;
  cursor?: string | null;
}): Promise<AccountStatement | null> {
  try {
    return await call<typeof input & { limit: number }, AccountStatement>('getAccountStatement', { ...input, limit: LIST_LIMIT });
  } catch (error) {
    if (hasReason(error, 'ACCOUNT_NOT_FOUND')) return null;
    throw error;
  }
}

export async function listPendingApprovals(input: { branchId?: string }): Promise<{ items: PendingApproval[] }> {
  return call('listPendingApprovals', input);
}

export async function listSusuProducts(): Promise<{ products: ProductRow[] }> {
  return call('listSusuProducts', {});
}

'use client';

import type {
  AgentPairSummary,
  AuditEventSummary,
  BindDeviceRequest,
  BranchSummary,
  CreateAgentPairRequest,
  CreateBranchRequest,
  CreateStaffUserRequest,
  DeviceSummary,
  GetDeviceEnrollmentRequest,
  RevokeDeviceRequest,
  StaffSummary,
} from '@susu/shared';
import { httpsCallable } from 'firebase/functions';
import { dataChanged } from './data-events';
import { firebase } from './firebase';

export type { AgentPairSummary, AuditEventSummary, BranchSummary, DeviceSummary, StaffSummary } from '@susu/shared';

/** Every backend call the portal makes for the organisation and audit screens (API.md §2). */

/**
 * The callable SDK sends `undefined` fields as `null`, which optional (non-nullable) Zod fields on
 * the server reject. Drop them so "not provided" stays absent.
 */
export function withoutUndefined<T>(data: T): T {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data;
  return Object.fromEntries(Object.entries(data as Record<string, unknown>).filter(([, v]) => v !== undefined)) as T;
}

export async function call<Req, Res>(name: string, data: Req): Promise<Res> {
  const fn = httpsCallable<Req, Res>(firebase().functions, name);
  const result = await fn(withoutUndefined(data));
  return result.data;
}

/** Run a write, then tell open lists to reload. */
export async function write<Req, Res>(name: string, data: Req): Promise<Res> {
  const result = await call<Req, Res>(name, data);
  dataChanged();
  return result;
}

/** The longest page the server returns (PAGE_SIZE_MAX in @susu/shared). */
export const LIST_LIMIT = 200;

// ── Writes ────────────────────────────────────────────────────────────────────

export async function createBranch(input: CreateBranchRequest) {
  return write<CreateBranchRequest, { branchId: string }>('createBranch', input);
}

export async function createStaffUser(input: CreateStaffUserRequest) {
  return write<CreateStaffUserRequest, { uid: string; passwordSetupLink: string }>('createStaffUser', input);
}

export async function createAgentPair(input: CreateAgentPairRequest) {
  return write<CreateAgentPairRequest, { agentPairId: string }>('createAgentPair', input);
}

/** The phone's enrolled key (API.md §3a). Show it so the supervisor can compare with the phone screen. */
export async function getDeviceEnrollment(input: GetDeviceEnrollmentRequest) {
  return call<GetDeviceEnrollmentRequest, { deviceId: string; agentUid: string; keyFingerprint: string }>(
    'getDeviceEnrollment',
    input,
  );
}

export async function bindDevice(input: BindDeviceRequest) {
  return write<BindDeviceRequest, { keyFingerprint: string }>('bindDevice', input);
}

export async function revokeDevice(input: RevokeDeviceRequest) {
  await write<RevokeDeviceRequest, null>('revokeDevice', input);
}

// ── Reads (scoped to the caller's branches on the server) ─────────────────────

export async function listBranches(): Promise<{ branches: BranchSummary[] }> {
  return call('listBranches', {});
}

export async function listStaff(input: { branchId?: string }): Promise<{ staff: StaffSummary[] }> {
  return call('listStaff', input);
}

export async function listAgentPairs(input: { branchId?: string }): Promise<{ agentPairs: AgentPairSummary[] }> {
  return call('listAgentPairs', input);
}

export async function listDevices(input: { branchId?: string }): Promise<{ devices: DeviceSummary[] }> {
  return call('listDevices', input);
}

export async function listAuditEvents(input: {
  entityKind?: string;
  entityId?: string;
  branchId?: string;
  cursor?: string | null;
}): Promise<{ events: AuditEventSummary[]; nextCursor: string | null }> {
  return call('listAuditEvents', { ...input, limit: LIST_LIMIT });
}

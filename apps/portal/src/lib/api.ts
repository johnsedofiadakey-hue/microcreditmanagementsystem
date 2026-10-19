'use client';

import type {
  BindDeviceRequest,
  CreateAgentPairRequest,
  CreateBranchRequest,
  CreateStaffUserRequest,
  RevokeDeviceRequest,
  Role,
} from '@susu/shared';
import { httpsCallable } from 'firebase/functions';
import { firebase } from './firebase';
import { mockStore } from './mock-store';

/**
 * Every backend call the portal makes. Built callables (API.md §2) go to Cloud Functions.
 * Planned endpoints read from `mockStore` behind `// TODO(api)` seams with the documented shapes,
 * so each one switches over by replacing the function body only.
 */

async function call<Req, Res>(name: string, data: Req): Promise<Res> {
  const fn = httpsCallable<Req, Res>(firebase().functions, name);
  const result = await fn(data);
  return result.data;
}

// ── Shapes for planned list endpoints (API.md §2, "planned — Step 3") ─────────

export type RecordStatus = 'ACTIVE' | 'CLOSED' | 'DISABLED' | 'INACTIVE' | 'REVOKED';

export interface BranchSummary {
  id: string;
  code: string;
  name: string;
  status: 'ACTIVE' | 'CLOSED';
  /** UI-only: true for mocked sample rows that do not exist on the server. */
  sample?: boolean;
}

export interface StaffSummary {
  uid: string;
  email: string;
  displayName: string;
  role: Role;
  branchIds: string[];
  status: 'ACTIVE' | 'DISABLED';
  sample?: boolean;
}

/** Not in API.md yet — requested in docs/handoff/REQUESTS.md (listAgentPairs). */
export interface AgentPairSummary {
  id: string;
  branchId: string;
  name: string;
  agentAUid: string;
  agentBUid: string;
  status: 'ACTIVE' | 'INACTIVE';
  sample?: boolean;
}

/** Not in API.md yet — requested in docs/handoff/REQUESTS.md (listDevices). */
export interface DeviceSummary {
  id: string;
  agentUid: string;
  agentPairId: string;
  branchId: string;
  label: string | null;
  status: 'ACTIVE' | 'REVOKED';
  boundAt: string;
  revokeReason?: string | null;
  sample?: boolean;
}

export interface AuditEventSummary {
  at: string;
  actorUid: string;
  action: string;
  entityKind: string;
  entityId: string;
  channel: string;
  branchId: string | null;
  data: Record<string, unknown>;
  sample?: boolean;
}

// ── Built callables ───────────────────────────────────────────────────────────

export async function createBranch(input: CreateBranchRequest) {
  const result = await call<CreateBranchRequest, { branchId: string }>('createBranch', input);
  // TODO(api): remove once listBranches is built; keeps the mocked list in step with the server.
  mockStore.addBranch({
    id: result.branchId,
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    status: 'ACTIVE',
  });
  return result;
}

export async function createStaffUser(input: CreateStaffUserRequest) {
  const result = await call<CreateStaffUserRequest, { uid: string; passwordSetupLink: string }>(
    'createStaffUser',
    input,
  );
  // TODO(api): remove once listStaff is built.
  mockStore.addStaff({
    uid: result.uid,
    email: input.email.toLowerCase(),
    displayName: input.displayName.trim(),
    role: input.role,
    branchIds: input.branchIds,
    status: 'ACTIVE',
  });
  return result;
}

export async function createAgentPair(input: CreateAgentPairRequest) {
  const result = await call<CreateAgentPairRequest, { agentPairId: string }>('createAgentPair', input);
  // TODO(api): remove once listAgentPairs exists.
  mockStore.addAgentPair({
    id: result.agentPairId,
    branchId: input.branchId,
    name: input.name.trim(),
    agentAUid: input.agentAUid,
    agentBUid: input.agentBUid,
    status: 'ACTIVE',
  });
  return result;
}

export async function bindDevice(input: BindDeviceRequest, branchId: string) {
  await call<BindDeviceRequest, null>('bindDevice', input);
  // TODO(api): remove once listDevices exists. Mirrors the server: one active device per agent.
  mockStore.bindDevice({
    id: input.deviceId,
    agentUid: input.agentUid,
    agentPairId: input.agentPairId,
    branchId,
    label: input.label?.trim() || null,
    status: 'ACTIVE',
    boundAt: new Date().toISOString(),
  });
}

export async function revokeDevice(input: RevokeDeviceRequest) {
  await call<RevokeDeviceRequest, null>('revokeDevice', input);
  // TODO(api): remove once listDevices exists.
  mockStore.revokeDevice(input.deviceId, input.reason.trim());
}

// ── Planned endpoints (mocked) ────────────────────────────────────────────────

export async function listBranches(): Promise<{ branches: BranchSummary[] }> {
  // TODO(api): return call('listBranches', {}) — planned, Step 3.
  return { branches: mockStore.branches() };
}

export async function listStaff(input: { branchId?: string }): Promise<{ staff: StaffSummary[] }> {
  // TODO(api): return call('listStaff', input) — planned, Step 3.
  const staff = mockStore.staff();
  return {
    staff: input.branchId ? staff.filter((s) => s.branchIds.includes(input.branchId!)) : staff,
  };
}

export async function listAgentPairs(input: { branchId?: string }): Promise<{ agentPairs: AgentPairSummary[] }> {
  // TODO(api): not in API.md — requested as listAgentPairs in REQUESTS.md.
  const pairs = mockStore.agentPairs();
  return { agentPairs: input.branchId ? pairs.filter((p) => p.branchId === input.branchId) : pairs };
}

export async function listDevices(input: { branchId?: string }): Promise<{ devices: DeviceSummary[] }> {
  // TODO(api): not in API.md — requested as listDevices in REQUESTS.md.
  const devices = mockStore.devices();
  return { devices: input.branchId ? devices.filter((d) => d.branchId === input.branchId) : devices };
}

export async function listAuditEvents(input: {
  entityKind?: string;
  branchId?: string;
}): Promise<{ events: AuditEventSummary[]; nextCursor: string | null }> {
  // TODO(api): return call('listAuditEvents', input) — planned, Step 3.
  let events = mockStore.auditEvents();
  if (input.branchId) events = events.filter((e) => e.branchId === input.branchId);
  if (input.entityKind) events = events.filter((e) => e.entityKind === input.entityKind);
  return { events, nextCursor: null };
}

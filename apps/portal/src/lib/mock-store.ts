'use client';

import type { AgentPairSummary, AuditEventSummary, BranchSummary, DeviceSummary, StaffSummary } from './api';

/**
 * TODO(api): delete this file once listBranches / listStaff / listAgentPairs / listDevices /
 * listAuditEvents exist. It holds sample rows plus anything this browser created through the real
 * callables, so admin screens are usable before the list endpoints land. Rows with `sample: true`
 * do not exist on the server and the UI labels them "Sample".
 */

const STORAGE_KEY = 'susu.portal.mock.v1';

interface MockState {
  branches: BranchSummary[];
  staff: StaffSummary[];
  agentPairs: AgentPairSummary[];
  devices: DeviceSummary[];
  audit: AuditEventSummary[];
}

const SAMPLE_BRANCH_A = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b';
const SAMPLE_BRANCH_B = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const SAMPLE_PAIR = 'c0ffee00-1234-4abc-8def-0123456789ab';

function seed(): MockState {
  const now = Date.now();
  const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  return {
    branches: [
      { id: SAMPLE_BRANCH_A, code: 'KSI-01', name: 'Kumasi Central', status: 'ACTIVE', sample: true },
      { id: SAMPLE_BRANCH_B, code: 'ACC-02', name: 'Accra Makola', status: 'ACTIVE', sample: true },
    ],
    staff: [
      {
        uid: 'sample-manager-1',
        email: 'akosua.manager@example.com',
        displayName: 'Akosua Mensah',
        role: 'BRANCH_MANAGER',
        branchIds: [SAMPLE_BRANCH_A],
        status: 'ACTIVE',
        sample: true,
      },
      {
        uid: 'sample-agent-1',
        email: 'kwame.agent@example.com',
        displayName: 'Kwame Boateng',
        role: 'AGENT',
        branchIds: [SAMPLE_BRANCH_A],
        status: 'ACTIVE',
        sample: true,
      },
      {
        uid: 'sample-agent-2',
        email: 'ama.agent@example.com',
        displayName: 'Ama Owusu',
        role: 'AGENT',
        branchIds: [SAMPLE_BRANCH_A],
        status: 'ACTIVE',
        sample: true,
      },
    ],
    agentPairs: [
      {
        id: SAMPLE_PAIR,
        branchId: SAMPLE_BRANCH_A,
        name: 'Adum Market Pair',
        agentAUid: 'sample-agent-1',
        agentBUid: 'sample-agent-2',
        status: 'ACTIVE',
        sample: true,
      },
    ],
    devices: [
      {
        id: 'a7f3c2e1-agent-phone-01',
        agentUid: 'sample-agent-1',
        agentPairId: SAMPLE_PAIR,
        branchId: SAMPLE_BRANCH_A,
        label: 'Samsung A15 · tag 0042',
        status: 'ACTIVE',
        boundAt: ago(60 * 26),
        sample: true,
      },
    ],
    audit: [
      {
        at: ago(60 * 26),
        actorUid: 'sample-manager-1',
        action: 'device.bound',
        entityKind: 'device',
        entityId: 'a7f3c2e1-agent-phone-01',
        channel: 'PORTAL',
        branchId: SAMPLE_BRANCH_A,
        data: { agentUid: 'sample-agent-1', agentPairId: SAMPLE_PAIR },
        sample: true,
      },
      {
        at: ago(60 * 27),
        actorUid: 'sample-manager-1',
        action: 'agent_pair.created',
        entityKind: 'agent_pair',
        entityId: SAMPLE_PAIR,
        channel: 'PORTAL',
        branchId: SAMPLE_BRANCH_A,
        data: { agentAUid: 'sample-agent-1', agentBUid: 'sample-agent-2' },
        sample: true,
      },
      {
        at: ago(60 * 48),
        actorUid: 'sample-admin',
        action: 'branch.created',
        entityKind: 'branch',
        entityId: SAMPLE_BRANCH_A,
        channel: 'PORTAL',
        branchId: SAMPLE_BRANCH_A,
        data: { code: 'KSI-01', name: 'Kumasi Central' },
        sample: true,
      },
    ],
  };
}

let state: MockState | undefined;
const listeners = new Set<() => void>();

function load(): MockState {
  if (state) return state;
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
    state = raw ? (JSON.parse(raw) as MockState) : seed();
  } catch {
    state = seed();
  }
  return state;
}

function save(next: MockState) {
  state = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private window or blocked storage: keep the in-memory copy only.
  }
  for (const listener of listeners) listener();
}

function audit(event: Omit<AuditEventSummary, 'at' | 'channel'>): AuditEventSummary {
  return { at: new Date().toISOString(), channel: 'PORTAL', ...event };
}

export const mockStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  branches: () => [...load().branches],
  staff: () => [...load().staff],
  agentPairs: () => [...load().agentPairs],
  devices: () => [...load().devices],
  auditEvents: () => [...load().audit].sort((a, b) => (a.at < b.at ? 1 : -1)),

  addBranch(branch: BranchSummary) {
    const s = load();
    save({
      ...s,
      branches: [...s.branches, branch],
      audit: [
        ...s.audit,
        audit({
          actorUid: 'you',
          action: 'branch.created',
          entityKind: 'branch',
          entityId: branch.id,
          branchId: branch.id,
          data: { code: branch.code, name: branch.name },
        }),
      ],
    });
  },
  addStaff(user: StaffSummary) {
    const s = load();
    save({
      ...s,
      staff: [...s.staff, user],
      audit: [
        ...s.audit,
        audit({
          actorUid: 'you',
          action: 'staff.created',
          entityKind: 'staff_user',
          entityId: user.uid,
          branchId: user.branchIds[0] ?? null,
          data: { role: user.role, branchIds: user.branchIds, email: user.email },
        }),
      ],
    });
  },
  addAgentPair(pair: AgentPairSummary) {
    const s = load();
    save({
      ...s,
      agentPairs: [...s.agentPairs, pair],
      audit: [
        ...s.audit,
        audit({
          actorUid: 'you',
          action: 'agent_pair.created',
          entityKind: 'agent_pair',
          entityId: pair.id,
          branchId: pair.branchId,
          data: { agentAUid: pair.agentAUid, agentBUid: pair.agentBUid },
        }),
      ],
    });
  },
  bindDevice(device: DeviceSummary) {
    const s = load();
    const devices = s.devices.map((d) =>
      d.agentUid === device.agentUid && d.status === 'ACTIVE'
        ? { ...d, status: 'REVOKED' as const, revokeReason: 'Replaced by new device' }
        : d,
    );
    save({
      ...s,
      devices: [...devices, device],
      audit: [
        ...s.audit,
        audit({
          actorUid: 'you',
          action: 'device.bound',
          entityKind: 'device',
          entityId: device.id,
          branchId: device.branchId,
          data: { agentUid: device.agentUid, agentPairId: device.agentPairId },
        }),
      ],
    });
  },
  revokeDevice(deviceId: string, reason: string) {
    const s = load();
    const target = s.devices.find((d) => d.id === deviceId);
    save({
      ...s,
      devices: s.devices.map((d) =>
        d.id === deviceId ? { ...d, status: 'REVOKED' as const, revokeReason: reason } : d,
      ),
      audit: [
        ...s.audit,
        audit({
          actorUid: 'you',
          action: 'device.revoked',
          entityKind: 'device',
          entityId: deviceId,
          branchId: target?.branchId ?? null,
          data: { reason },
        }),
      ],
    });
  },
  /** Let other mock stores (mock-members.ts) wake the same subscribers. */
  notify() {
    for (const listener of listeners) listener();
  },
  reset() {
    save(seed());
  },
};

export const SAMPLE_BRANCH_ID = SAMPLE_BRANCH_A;

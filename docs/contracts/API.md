# Backend Contract — what the UI can call and read

Owner: backend session. UI may rely on anything marked **built**. Items marked **planned** have a
fixed shape you can build screens against with mocked data behind a `// TODO(api)` seam.

Types and validation for everything here live in `packages/shared/src/` (`@susu/shared`).
**All amounts are integer pesewas.** Display with `formatCedis()`; parse user input with `parseCedis()`.

Last updated: 18 October 2026.

---

## 1. Sign-in and claims — **built**

Firebase Auth. After sign-in, read custom claims from `getIdTokenResult()`:

```ts
type AuthClaims = {
  role: 'SUPER_ADMIN' | 'FINANCE' | 'COMPLIANCE' | 'BRANCH_MANAGER' | 'CASHIER' | 'SUPERVISOR' | 'AGENT';
  branchIds: string[];      // UUIDs; head-office roles (SUPER_ADMIN, FINANCE, COMPLIANCE) see every branch
  agentPairId?: string;     // agents only
};
```

- No `role` claim ⇒ show "Your account is not set up yet. Contact your administrator."
- Staff accounts are created by an admin (`createStaffUser`); the person receives a password-setup link. There is no self sign-up.
- Claims change when an admin edits a user; call `getIdToken(true)` after role-changing actions.

## 2. Portal callable functions

Call with `httpsCallable(functions, '<name>')`. App Check is enforced. Errors are `FunctionsError` with:
- `code`: `unauthenticated` · `permission-denied` · `invalid-argument` · `not-found` · `already-exists` · `failed-precondition` · `internal`
- `details.reason`: a stable code from `REJECT_REASONS` (`@susu/shared/errors.ts`) — map these to friendly copy.
- `details.issues` (on `invalid-argument`): `[{ path, message }]` for inline field errors.

| Function | Request schema (`@susu/shared`) | Returns | Who may call | Status |
|---|---|---|---|---|
| `createBranch` | `createBranchRequestSchema` `{ name, code }` | `{ branchId }` | SUPER_ADMIN | **built** |
| `createStaffUser` | `createStaffUserRequestSchema` `{ email, displayName, role, branchIds }` | `{ uid, passwordSetupLink }` | SUPER_ADMIN; BRANCH_MANAGER for CASHIER/SUPERVISOR/AGENT in own branches | **built** |
| `createAgentPair` | `createAgentPairRequestSchema` `{ branchId, name, agentAUid, agentBUid }` | `{ agentPairId }` | SUPER_ADMIN, BRANCH_MANAGER | **built** |
| `bindDevice` | `bindDeviceRequestSchema` `{ deviceId, agentUid, agentPairId, label? }` | `null` | SUPER_ADMIN, BRANCH_MANAGER, SUPERVISOR | **built** |
| `revokeDevice` | `revokeDeviceRequestSchema` `{ deviceId, reason }` | `null` | SUPER_ADMIN, BRANCH_MANAGER, SUPERVISOR | **built** |
| `registerMember` | `registerMemberRequestSchema` `{ branchId, fullName, phone, ghanaCardNumber, dateOfBirth, photoPaths?, consentGiven: true }` | `{ memberId }` | SUPER_ADMIN, BRANCH_MANAGER, CASHIER, SUPERVISOR, AGENT | **built** |
| `approveMember` | `approveMemberRequestSchema` `{ memberId }` | `null` | SUPER_ADMIN, COMPLIANCE, BRANCH_MANAGER — **not** the person who registered them | **built** |
| `createSusuProduct` | `createSusuProductRequestSchema` `{ code, name, frequency }` | `{ productId, version }` | SUPER_ADMIN | **built** |
| `openSusuAccount` | `openSusuAccountRequestSchema` `{ memberId, productId }` | `{ susuAccountId }` | SUPER_ADMIN, BRANCH_MANAGER, CASHIER | **built** |
| `listBranches` | `{}` | `{ branches: [{ id, code, name, status }] }` | any staff (scoped) | planned — Step 3 |
| `listStaff` | `{ branchId? }` | `{ staff: [{ uid, email, displayName, role, branchIds, status }] }` | SUPER_ADMIN, BRANCH_MANAGER | planned — Step 3 |
| `searchMembers` | `{ branchId, query, status?, cursor? }` | `{ members: [{ id, fullName, phoneMasked, ghanaCardMasked, status, kycStatus }], nextCursor }` | staff (scoped) | planned — Step 3 |
| `getMember` | `{ memberId }` | member profile + `accounts: [{ id, productName, balancePesewas, status }]` | staff (scoped) | planned — Step 3 |
| `getAccountStatement` | `{ susuAccountId, from?, to?, cursor? }` | `{ lines: [{ postedAt, kind, description, debitPesewas, creditPesewas, balanceAfterPesewas, batchId }], nextCursor }` | staff (scoped) | planned — Step 3 |
| `listPendingApprovals` | `{ branchId? }` | `{ items: [{ kind, id, summary, requestedBy, requestedAt }] }` | checkers | planned — Step 3 |
| `listAuditEvents` | `{ entityKind?, entityId?, branchId?, cursor? }` | `{ events: [{ at, actorUid, action, entityKind, entityId, channel, data }], nextCursor }` | SUPER_ADMIN, COMPLIANCE, BRANCH_MANAGER (own branch) | planned — Step 3 |
| `confirmHandover` / `closeBranch` / `requestWithdrawal` / `approveRequest` / `payWithdrawal` / `recordBankDeposit` | — | — | — | planned — Steps 6–7 |

## 3. Agent app — offline command queue — **built (COLLECTION)**

The agent app writes one Firestore document per action. Firestore's offline cache holds it until
the phone reconnects; a Cloud Function posts it and writes the result back onto the same document.

**Path:** `commands/{commandId}` — `commandId` is a **UUID v4** generated once per action and reused on retries.

**Client writes exactly these fields, nothing else** (rules reject extra keys):

```json
{
  "type": "COLLECTION",
  "agentUid": "<request.auth.uid>",
  "deviceId": "<stable per-install id, the one bound via bindDevice>",
  "seq": 42,
  "capturedAt": "2026-10-18T09:15:00+00:00",
  "appVersion": "0.1.0",
  "payload": {
    "memberId": "<uuid>",
    "susuAccountId": "<uuid>",
    "amountPesewas": 2000
  }
}
```

- `seq`: per-device counter starting at 1, persisted locally, incremented for every command, never reused.
- `amountPesewas`: integer, 1 … 1,000,000 (GH₵ 10,000 cap until product rules are agreed).
- Agent pair and branch are **not** sent; the server derives them from the device binding.

**Server adds (listen with `onSnapshot`):**

| `status` | Extra fields | Show the agent |
|---|---|---|
| *(absent)* | — | `Pending sync` (also when `snapshot.metadata.hasPendingWrites`) |
| `POSTED` | `postingId`, `serverTime` | `Synced ✓` and receipt reference = first 8 chars of `postingId`, upper-case |
| `REJECTED` | `reason`, `message`, `serverTime` | The `message`, plus guidance by `reason` (below) |
| `FAILED` | `message`, `serverTime` | "Could not be processed. Your supervisor has been notified." |

Rejection reasons the agent app should handle: `DEVICE_NOT_BOUND`, `DEVICE_REVOKED`, `DEVICE_AGENT_MISMATCH`
(sign out and contact supervisor) · `MEMBER_NOT_ACTIVE`, `ACCOUNT_NOT_ACTIVE`, `ACCOUNT_OUTSIDE_BRANCH`, `ACCOUNT_NOT_FOUND`
(member can't be collected from — refer to branch) · `INVALID_COMMAND`, `SEQUENCE_REUSED` (app bug — report).

Planned command types, same envelope: `HANDOVER_START` (Step 6), `WITHDRAWAL_REQUEST` (Step 6), `MEMBER_REGISTRATION` (Step 4).

## 4. Firestore read models

| Path | Who reads | Contents | Status |
|---|---|---|---|
| `commands/{id}` | the agent who wrote it | §3 | **built** |
| `agentPairs/{agentPairId}/routes/{yyyy-mm-dd}` | agents in that pair | `{ members: [{ memberId, susuAccountId, fullName, phoneMasked, expectedPesewas }] }` | planned — Step 4 |
| `agentPairs/{agentPairId}/memberSnapshots/{memberId}` | agents in that pair | `{ fullName, phoneMasked, ghanaCardMasked, photoUrl?, accounts: [{ id, productName, status }] }` | planned — Step 4 |
| `dashboards/branches/{branchId}/days/{yyyy-mm-dd}` | that branch's non-agent staff, head office | `{ collectedPesewas, collectionCount, activePairs, handedOverPesewas, pendingSyncCount, closed }` | planned — Step 7 |
| `dashboards/company/days/{yyyy-mm-dd}` | head office | `{ collectedPesewas, branchesClosed, branchesOpen, exceptions }` | planned — Step 7 |

Security rules already allow these reads, so UI can be built against the emulator with seeded docs.

## 5. Storage — KYC photos — **rules built**

Upload member photos and Ghana Card images to `kyc-inbox/{request.auth.uid}/{uuid}.jpg` (JPEG/PNG/WebP, < 8 MB).
Pass the resulting paths in `registerMember.photoPaths`. Nobody can read them back from the client;
the portal will get short-lived signed URLs from `getMember` (planned).

## 6. Local development

```bash
corepack pnpm install
firebase emulators:start          # Auth 9099, Firestore 8080, Functions 5001, Storage 9199, UI 4000
```
Functions need `DATABASE_URL` for a local Postgres (e.g. `postgresql:///susu_dev`); set it in
`functions/.secret.local` for the emulator. A seed script for demo data is planned (Step 3).

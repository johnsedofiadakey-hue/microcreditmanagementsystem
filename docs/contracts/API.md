# Backend Contract — what the UI can call and read

Owner: backend session. UI may rely on anything marked **built**. Items marked **planned** have a
fixed shape you can build screens against with mocked data behind a `// TODO(api)` seam.

Types and validation for everything here live in `packages/shared/src/` (`@susu/shared`).
**All amounts are integer pesewas.** Display with `formatCedis()`; parse user input with `parseCedis()`.

Last updated: 19 October 2026 — audit hardening (signed commands, device enrolment, live staff checks). Changes are marked **changed 19 Oct**.

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
- **changed 19 Oct:** every callable also checks the live staff record. A disabled user, or one whose role or branches no longer match their token, gets `permission-denied` with `reason: STAFF_NOT_ACTIVE` — show "Your access has changed. Sign out and sign in again." A first admin must exist in both Auth and `staff_users`; locally, `seed:local` does that (§6).

## 2. Portal callable functions

Call with `httpsCallable(functions, '<name>')`. App Check is enforced. Paged lists take `limit` (default 50, max 200) and return `nextCursor` (`null` on the last page) — pass it back unchanged as `cursor`. Types for every response are exported from `@susu/shared` (`reads.ts`), as are `maskPhone()` and `maskGhanaCard()`. Errors are `FunctionsError` with:
- `code`: `unauthenticated` · `permission-denied` · `invalid-argument` · `not-found` · `already-exists` · `failed-precondition` · `internal`
- `details.reason`: a stable code from `REJECT_REASONS` (`@susu/shared/errors.ts`) — map these to friendly copy.
- `details.issues` (on `invalid-argument`): `[{ path, message }]` for inline field errors.

| Function | Request schema (`@susu/shared`) | Returns | Who may call | Status |
|---|---|---|---|---|
| `createBranch` | `createBranchRequestSchema` `{ name, code }` | `{ branchId }` | SUPER_ADMIN | **built** |
| `createStaffUser` | `createStaffUserRequestSchema` `{ email, displayName, role, branchIds }` | `{ uid, passwordSetupLink }` | SUPER_ADMIN; BRANCH_MANAGER for CASHIER/SUPERVISOR/AGENT in own branches | **built** |
| `createAgentPair` | `createAgentPairRequestSchema` `{ branchId, name, agentAUid, agentBUid }` | `{ agentPairId }` | SUPER_ADMIN, BRANCH_MANAGER | **built** |
| `getDeviceEnrollment` | `getDeviceEnrollmentRequestSchema` `{ deviceId }` | `{ deviceId, agentUid, keyFingerprint }` — show the fingerprint and ask the supervisor to confirm it matches the phone screen before binding | SUPER_ADMIN, BRANCH_MANAGER, SUPERVISOR (agent's branch) | **built — new 19 Oct** |
| `bindDevice` | `bindDeviceRequestSchema` `{ deviceId, agentUid, agentPairId, label? }` | `{ keyFingerprint }` — **changed 19 Oct**: the phone must have enrolled first (§3a), else `DEVICE_NOT_ENROLLED`; enrolled by another agent ⇒ `DEVICE_AGENT_MISMATCH`; agent not in that pair ⇒ `AGENT_NOT_IN_PAIR` | SUPER_ADMIN, BRANCH_MANAGER, SUPERVISOR | **built** |
| `revokeDevice` | `revokeDeviceRequestSchema` `{ deviceId, reason }` | `null` | SUPER_ADMIN, BRANCH_MANAGER, SUPERVISOR | **built** |
| `registerMember` | `registerMemberRequestSchema` `{ branchId, fullName, phone, ghanaCardNumber, dateOfBirth, photoPaths?, consentGiven: true }` | `{ memberId }` — **changed 19 Oct**: each `photoPaths` entry must be `kyc-inbox/{your uid}/{uuid}.{jpg,jpeg,png,webp}` and already uploaded (§5); a duplicate Ghana Card at another branch returns `CONFLICT` without that member's ID | SUPER_ADMIN, BRANCH_MANAGER, CASHIER, SUPERVISOR, AGENT | **built** |
| `approveMember` | `approveMemberRequestSchema` `{ memberId }` | `null` | SUPER_ADMIN, COMPLIANCE, BRANCH_MANAGER — **not** the person who registered them | **built** |
| `createSusuProduct` | `createSusuProductRequestSchema` `{ code, name, frequency }` | `{ productId, version }` | SUPER_ADMIN | **built** |
| `openSusuAccount` | `openSusuAccountRequestSchema` `{ memberId, productId, collector? }` — optional `collector: { agentPairId, expectedPesewas }` puts the new account straight onto a route (needs an assigning role; a CASHIER sending it is refused and nothing is opened) | `{ susuAccountId }` | SUPER_ADMIN, BRANCH_MANAGER, CASHIER | **built** (`collector` 19 Oct) |
| `assignCollector` | `assignCollectorRequestSchema` `{ susuAccountId, agentPairId, expectedPesewas }` — 1 to 1,000,000 pesewas. Also moves an account to another pair or changes the amount. Pair and account must be ACTIVE and in the same branch (reasons `ACCOUNT_NOT_ACTIVE`, `MEMBER_NOT_ACTIVE`, `AGENT_PAIR_NOT_ACTIVE`, `ACCOUNT_OUTSIDE_BRANCH`). Republishes the affected pairs' routes (§4) | `null` | SUPER_ADMIN, BRANCH_MANAGER, SUPERVISOR (scoped) | **built 19 Oct** |
| `unassignCollector` | `unassignCollectorRequestSchema` `{ susuAccountId }` — `NOT_FOUND` if it is on no route | `null` | SUPER_ADMIN, BRANCH_MANAGER, SUPERVISOR (scoped) | **built 19 Oct** |
| `listBranches` | `listBranchesRequestSchema` `{}` | `{ branches: BranchSummary[] }` — `{ id, code, name, status }`, sorted by name | any staff except AGENT (head office: all; others: own branches) | **built 19 Oct** |
| `listStaff` | `listStaffRequestSchema` `{ branchId? }` | `{ staff: StaffSummary[] }` — `{ uid, email, displayName, role, branchIds, status }` | SUPER_ADMIN, COMPLIANCE, BRANCH_MANAGER, SUPERVISOR (scoped) | **built 19 Oct** |
| `listAgentPairs` | `listAgentPairsRequestSchema` `{ branchId? }` | `{ agentPairs: AgentPairSummary[] }` — `{ id, branchId, name, agentAUid, agentBUid, status }` | any staff except AGENT (scoped) | **built 19 Oct** |
| `listDevices` | `listDevicesRequestSchema` `{ branchId? }` | `{ devices: DeviceSummary[] }` — `{ id, agentUid, agentPairId, branchId, label, status, boundAt, keyFingerprint, revokeReason }` | SUPER_ADMIN, COMPLIANCE, BRANCH_MANAGER, SUPERVISOR (scoped) | **built 19 Oct** |
| `listSusuProducts` | `listSusuProductsRequestSchema` `{}` | `{ products: ProductRow[] }` — `{ id, code, version, name, frequency, status }` | any staff except AGENT | **built 19 Oct** |
| `searchMembers` | `searchMembersRequestSchema` `{ branchId?, query, status?, cursor?, limit? }` | `{ members: MemberRow[], nextCursor }` — `{ id, fullName, phoneMasked, ghanaCardMasked, status, kycStatus, branchId, createdAt }`, newest first. `query` matches a name fragment, a phone (`024…` or `+233…`) or a full Ghana Card number; empty lists everyone. `branchId` optional: head office ⇒ all branches, others ⇒ their own | any staff except AGENT (scoped) | **built 19 Oct** |
| `getMember` | `getMemberRequestSchema` `{ memberId }` | `MemberProfile` — `{ id, branchId, fullName, phone, ghanaCardNumber \| null, ghanaCardMasked, dateOfBirth, status, kycStatus, createdBy, createdAt, approvedBy, approvedAt, photoCount, photoUrls[], accounts: [{ id, productName, balancePesewas, status, collector: { agentPairId, agentPairName, expectedPesewas } \| null }] }`. `ghanaCardNumber` and `photoUrls` (signed, 5 min) only for SUPER_ADMIN, COMPLIANCE, or a BRANCH_MANAGER of that branch; others get `null` / `[]` | any staff except AGENT (scoped) | **built 19 Oct** |
| `getAccountStatement` | `getAccountStatementRequestSchema` `{ susuAccountId, from?, to?, cursor?, limit? }` | `{ account: { id, memberId, productName, balancePesewas, status }, lines: [{ postedAt, kind, description, debitPesewas, creditPesewas, balanceAfterPesewas, batchId }], nextCursor }` — newest first; `balanceAfterPesewas` is the member's balance right after that line | any staff except AGENT (scoped) | **built 19 Oct** |
| `listPendingApprovals` | `listPendingApprovalsRequestSchema` `{ branchId? }` | `{ items: [{ kind: 'MEMBER_REGISTRATION', id, summary, requestedBy, requestedAt, branchId }] }` — oldest first; `requestedBy` is the maker (hide "Review" when it's the signed-in user — the server refuses it anyway) | SUPER_ADMIN, COMPLIANCE, BRANCH_MANAGER (scoped) | **built 19 Oct** |
| `listAuditEvents` | `listAuditEventsRequestSchema` `{ entityKind?, entityId?, branchId?, cursor?, limit? }` | `{ events: [{ at, actorUid, action, entityKind, entityId, channel, branchId, data }], nextCursor }` — newest first. Company-level events (`branchId: null`, e.g. staff creation) are visible to head office only | SUPER_ADMIN, COMPLIANCE, BRANCH_MANAGER (own branches) | **built 19 Oct** |
| `confirmHandover` / `closeBranch` / `requestWithdrawal` / `approveRequest` / `payWithdrawal` / `recordBankDeposit` | — | — | — | planned — Steps 6–7 |

## 3. Agent app — offline command queue — **built (COLLECTION)**

The agent app writes one Firestore document per action. Firestore's offline cache holds it until
the phone reconnects; a Cloud Function posts it and writes the result back onto the same document.

**Path:** `commands/{commandId}` — `commandId` is a **UUID v4** generated once per action and reused on retries.

**Client writes exactly these fields, nothing else** (rules reject extra or missing keys):

```json
{
  "type": "COLLECTION",
  "agentUid": "<request.auth.uid>",
  "deviceId": "<stable per-install id, the one enrolled in §3a and bound via bindDevice>",
  "seq": 42,
  "capturedAt": "2026-10-18T09:15:00+00:00",
  "appVersion": "0.1.0",
  "payload": {
    "memberId": "<uuid>",
    "susuAccountId": "<uuid>",
    "amountPesewas": 2000
  },
  "sig": "<base64 DER ECDSA signature — changed 19 Oct, required>"
}
```

- `seq`: per-device counter starting at 1, persisted locally, incremented for every command, never reused.
- `amountPesewas`: integer, 1 … 1,000,000 (GH₵ 10,000 cap until product rules are agreed).
- Agent pair and branch are **not** sent; the server derives them from the device binding.

### Signing every command — **changed 19 Oct (audit H2)**

The phone signs each command with its Keystore key (§3a). Build this exact UTF-8 string, sign it with
`Signature.getInstance("SHA256withECDSA")`, and send the DER signature base64-encoded (no line breaks) as `sig`:

```
susu-cmd-v1|{commandId}|{type}|{agentUid}|{deviceId}|{seq}|{capturedAt}|{canonicalJson(payload)}
```

- `commandId`: the Firestore document ID, lower-case UUID. `seq` in decimal. `capturedAt`: the exact string you send.
- `canonicalJson(payload)`: keys sorted alphabetically, no whitespace, integers as plain digits, strings JSON-escaped. For a collection it is always
  `{"amountPesewas":2000,"memberId":"…","susuAccountId":"…"}`.
- Reference implementation: `commandSigningString()` and `canonicalJson()` in `@susu/shared`; the server verifies in `functions/src/lib/deviceKeys.ts`.
- A wrong or missing signature ⇒ `REJECTED` with `INVALID_SIGNATURE` (or `INVALID_COMMAND` if `sig` is absent).

### 3a. Device enrolment — `deviceEnrollments/{deviceId}` — **new 19 Oct**

At first launch, before a supervisor binds the phone:
1. Generate a **non-exportable EC P-256 key** in the Android Keystore (`KeyGenParameterSpec`, `PURPOSE_SIGN`, `DIGEST_SHA256`, `setAttestationChallenge(deviceId bytes)` so a certificate chain is produced; StrongBox when available).
2. Write once (the rules allow create only, never update):
   ```json
   { "agentUid": "<auth uid>", "publicKey": "<base64 of publicKey.encoded (X.509 SPKI DER)>",
     "attestationChain": ["<base64 DER cert>", "…"], "enrolledAt": <serverTimestamp()> }
   ```
3. Show the **key fingerprint** on screen for the supervisor: SHA-256 of the SPKI DER bytes, first 16 hex characters, upper-case, grouped `ABCD-EF01-2345-6789`. The portal shows the same value from `getDeviceEnrollment` / `bindDevice`.

A reinstall means a new key: give it a **new `deviceId`**, enrol again, and have the supervisor bind it (the old binding is revoked automatically).
Attestation chains are stored for verification in a later step; Play Integrity App Check enforcement is on the deploy checklist (`docs/ops/ENVIRONMENT_CHECKLIST.md`).

**Server adds (listen with `onSnapshot`):**

| `status` | Extra fields | Show the agent |
|---|---|---|
| *(absent)* | — | `Pending sync` (also when `snapshot.metadata.hasPendingWrites`). If the server never processes it (a lost trigger), the 15-minute sweeper picks it up after 10 minutes (**19 Oct**) |
| `POSTED` | `postingId`, `serverTime`, `processedAt` | `Synced ✓` and receipt reference = first 8 chars of `postingId`, upper-case |
| `REJECTED` | `reason`, `message`, `serverTime`, `processedAt` | The `message`, plus guidance by `reason` (below) |
| `FAILED` | `message`, `serverTime`, `processedAt` | **changed 19 Oct:** "Not processed yet. It will be retried automatically — do not enter it again." A sweeper retries every 15 minutes and later sets `POSTED` or `REJECTED` on the same document |

`processedAt` is a Firestore server `Timestamp`; `serverTime` is the ISO string from the ledger.

Rejection reasons the agent app should handle:
- `DEVICE_NOT_BOUND`, `DEVICE_NOT_ENROLLED`, `DEVICE_REVOKED`, `DEVICE_AGENT_MISMATCH`, `AGENT_NOT_IN_PAIR` — this phone can't post: stop new collections, ask the supervisor to (re)bind it.
- `AGENT_NOT_ACTIVE`, `AGENT_PAIR_NOT_ACTIVE` — account or pair switched off: sign out and contact the supervisor.
- `MEMBER_NOT_ACTIVE`, `ACCOUNT_NOT_ACTIVE`, `ACCOUNT_OUTSIDE_BRANCH`, `ACCOUNT_NOT_FOUND` — the member can't be collected from; refer them to the branch.
- `INVALID_SIGNATURE`, `INVALID_COMMAND`, `SEQUENCE_REUSED` — an app bug or tampering: report it.

Planned command types, same envelope: `HANDOVER_START` (Step 6), `WITHDRAWAL_REQUEST` (Step 6), `MEMBER_REGISTRATION` (Step 4).

## 4. Firestore read models

| Path | Who reads | Contents | Status |
|---|---|---|---|
| `commands/{id}` | the agent who wrote it | §3 | **built** |
| `deviceEnrollments/{deviceId}` | the agent who wrote it (create once) | §3a | **built — 19 Oct** |
| `devices/{deviceId}` | that phone's agent (a missing document means "not bound yet"); branch staff; head office | `{ status: 'ACTIVE' \| 'REVOKED', agentUid, agentPairId, branchId, keyFingerprint, revokeReason, updatedAt }` — updated on every bind and revoke. The agent app should stop collecting when it's missing, `REVOKED`, or `agentUid` isn't the signed-in user | **built — 19 Oct** |
| `branchDashboards/{branchId}/syncHealth/{agentPairId}` | that branch's non-agent staff, head office | `{ branchId, agentPairId, devices: [{ deviceId, agentUid, status, lastSeq, received, posted, rejected, missingSeqCount, lastReceivedAt }], updatedAt }` — updated after every command. `missingSeqCount` > 0 means records the phone numbered never arrived (a crash can leave one; a growing count needs a supervisor) | **built — 19 Oct** |
| `branchDashboards/{branchId}/days/{yyyy-mm-dd}` | that branch's non-agent staff, head office | `{ collectedPesewas, collectionCount, activePairs, handedOverPesewas, pendingSyncCount, closed }` | planned — Step 7. **Path changed 19 Oct**: it was documented as `dashboards/branches/{branchId}/days/{date}`, which has an odd number of segments and isn't a valid document path |
| `dashboards/company/days/{yyyy-mm-dd}` | head office | `{ collectedPesewas, branchesClosed, branchesOpen, exceptions }` | planned — Step 7 |
| `dashboards/company/live/exceptions` | head office | `{ openCommandFailures, openSmsFailures }` | **built — 19 Oct** (`openSmsFailures` with Step 5) |
| `dashboards/company/live/sms` | head office | `{ pending, failed, oldestPendingAt, updatedAt }` — SMS receipts still owed and given up; refreshed every minute by `dispatchSmsOutbox` | **built 19 Oct** |
| `exceptions/{id}` | head office | `{ kind: 'COMMAND_FAILED' \| 'BALANCE_MISMATCH' \| 'SMS_FAILED', status: 'OPEN' \| 'RESOLVED', openedAt, … }` — failed commands (`commandId`, `agentUid`, `deviceId`, `error`), nightly reconciliation alerts (`count`, `sample`), and SMS receipts given up after 10 attempts or refused by the provider (`outboxId`, `dedupeKey`, `error`) | **built — 19 Oct** |
| `agentPairs/{agentPairId}/routes/{yyyy-mm-dd}` | agents in that pair | `{ day, agentPairId, branchId, members: [{ memberId, susuAccountId, fullName, phoneMasked, expectedPesewas, productName, frequency }], updatedAt }` — every ACTIVE account of an ACTIVE member assigned to the pair (`assignCollector`), sorted by name; empty for an inactive pair. Rewritten on every assignment change and for every active pair at 00:05 Accra time (`publishDailyRoutes`). Every frequency is listed every day for now. Type: `RouteDoc` | **built 19 Oct** |
| `agentPairs/{agentPairId}/memberSnapshots/{memberId}` | agents in that pair | `{ fullName, phoneMasked, ghanaCardMasked, accounts: [{ id, productName, status }], updatedAt }` — only members on the pair's route, only their accounts on that route; deleted when the member leaves the route. No photo (signed URLs expire; agents don't need KYC images). Type: `MemberSnapshotDoc` | **built 19 Oct** |

Security rules already allow these reads, so UI can be built against the emulator with seeded docs.

## 4a. SMS receipts — **built 19 Oct (Step 5)**

Not a UI call — documented so the UI copy is right. Each POSTED collection writes one outbox row in the
same transaction as the ledger posting. The receipt is sent right after posting and, if that fails, by
`dispatchSmsOutbox` every minute with backoff (1, 2, 4 … minutes, max 6 h; 10 attempts), then an
`SMS_FAILED` exception. A redelivered command never sends a second receipt; a crash mid-send can (rarely)
send one twice. Text, one GSM-7 segment: `Susu: GHS 20.00 received 19 Oct 10:24. Balance GHS 120.00.
Ref 357D5757. Keep this SMS as your receipt.` (`Ref` = the first 8 characters of the posting, the same
reference the agent app and statement show.) Provider: `SMS_PROVIDER` = `log` (default, sends nothing) or
`arkesel`; see `docs/ops/ENVIRONMENT_CHECKLIST.md`.

## 5. Storage — KYC photos — **rules built, changed 19 Oct**

Upload member photos and Ghana Card images to `kyc-inbox/{request.auth.uid}/{uuid}.{jpg|jpeg|png|webp}`, under 8 MB
(SUPER_ADMIN may upload too). Pass the resulting paths in `registerMember.photoPaths`. The server checks they exist and are yours,
then moves them to `kyc/{memberId}/`. Nobody can read them back from the client; the portal will get short-lived
signed URLs, only ever for `kyc/{memberId}/` paths, from `getMember` (built 19 Oct).

## 6. Local development — **changed 19 Oct**

```bash
corepack pnpm install
createdb susu_dev
cp functions/.secret.local.example functions/.secret.local   # DATABASE_URL for the Functions emulator
cp functions/.env.example functions/.env.local               # FUNCTIONS_REGION
firebase emulators:start --project demo-susu                 # always a demo- project locally: never touches production
corepack pnpm --filter @susu/functions seed:local            # migrates susu_dev, creates admin@susu.test in Auth + staff_users, demo branch + product
```
`seed:local` replaces `apps/portal/scripts/seed-emulator.mjs`; that script only creates the Auth half, which callables now refuse (`STAFF_NOT_ACTIVE`).
To apply new migrations to an existing database: `DATABASE_URL=postgresql:///susu_dev corepack pnpm --filter @susu/functions migrate`.

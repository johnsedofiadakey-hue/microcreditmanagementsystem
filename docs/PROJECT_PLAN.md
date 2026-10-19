# Project Plan — live status

**Read this first.** It is the single place that says what is done, what is in progress, who is
doing it and what comes next, so any session (or person) can pick the work up.

**Rule for every owner:** whenever you finish a task, reach a milestone, change direction or hand
over, update this file in the same change: tick what's done, move "in progress" items, and add the
next step. Keep entries short and link to the detailed doc. Add a dated line to the change log at
the bottom.

- Architecture and build order: `BUILD_PLAN.md` (backend-owned). This plan tracks progress against it.
- Contract between UI and backend: `docs/contracts/API.md` + `packages/shared/src/`.
- Cross-owner requests: `docs/handoff/REQUESTS.md`. Audit findings: `docs/audit/`.
- Repository: https://github.com/johnsedofiadakey-hue/microcreditmanagementsystem (`main`).

## Owners

| Owner | Paths | Brief |
|---|---|---|
| Backend session | `functions/`, `dataconnect/`, `packages/shared/`, `firestore.rules`, `storage.rules`, `firebase.json`, `.github/` | `BUILD_PLAN.md` |
| UI & Audit session | `apps/portal/`, `apps/site/`, `apps/agent-android/`, `docs/audit/` | `docs/handoff/UI_AND_AUDIT_BRIEF.md` |

## Status at a glance

Legend: ✅ done · 🟡 in progress · ⏳ not started · ⛔ blocked

### Backend (BUILD_PLAN §8)

| Step | Status | Notes |
|---|---|---|
| 1 Foundation | ✅ local | Monorepo, Firebase config, claims, org model, audit log, rules tests. Firebase projects and CI not created yet |
| 2 Ledger core | ✅ | Posting, idempotency, reversals, append-only. Hardened 19 Oct (migration 002): balances move only via journal triggers, committed batches frozen, reversals must mirror, nightly reconciliation |
| 3 Members & Susu accounts | ✅ | Writes and all read endpoints built (`listBranches`, `listStaff`, `listAgentPairs`, `listDevices`, `listSusuProducts`, `searchMembers`, `getMember`, `getAccountStatement`, `listPendingApprovals`, `listAuditEvents`); portal uses them since 19 Oct |
| 4 Offline collections | ✅ | Command queue → trigger → ledger → SMS outbox. Commands signed by the phone's Keystore key. FAILED commands retried every 15 min. **Routes built 19 Oct**: `route_assignments` (migration 003), `assignCollector` / `unassignCollector`, optional `collector` on `openSusuAccount`, `routes/{day}` + `memberSnapshots` projections republished on change and daily at 00:05 (`publishDailyRoutes`) |
| 5 SMS receipts | ✅ | Built 19 Oct: outbox dispatcher (claim with SKIP LOCKED + lease, backoff, 10 attempts, `SMS_FAILED` exception), immediate send after posting + `dispatchSmsOutbox` every minute, provider adapter (`log`, `arkesel`), GSM-7 one-segment receipt text. Migration 004. Provider not chosen yet; Arkesel adapter not tried against the live API. Delivery reports (provider webhooks) not built |
| 6 Handover, branch close, withdrawals | ⏳ | |
| 7 Bank match, dashboards | ⏳ | |
| 8 Ghana Card verification | ⏳ | Waiting on the NIA provider |
| 9 Migration, UAT, pilot | ⏳ | |
| Audit fixes (REQUESTS #3–#19) | ✅ mostly | Done 19 Oct: H1, H2 (server side), M1–M8, L2–L5, #17–#19. Open: L1 seq-gap reporting, attestation-chain verification, approvals table (Step 6). Contract changes for UI: REQUESTS #25 |

### UI (brief build order)

| # | Area | Status | Notes |
|---|---|---|---|
| 1 | Portal shell: sign-in (+MFA challenge), role-aware nav, branch switcher, audit log viewer | ✅ | Verified against the emulators. MFA enrolment screen not built (audit U5). Audit log uses mocked data |
| 2 | Admin: branches, staff, agent pairs, devices | ✅ | Real callables and real lists (mocks removed 19 Oct). 19 Oct: Bind phone now looks up `getDeviceEnrollment`, shows the key fingerprint and requires the supervisor to confirm it matches the phone; verified with a scripted P-256 key, and a command signed with it was POSTED |
| 3 | Members: register, approve (maker-checker), profile, Susu account + statement, products, approvals queue, **assign collector** | ✅ | Verified 19 Oct: admin registers → admin is blocked from approving → branch manager approves → opens account (all real callables, rows in Postgres). Reads now real (mocks removed 19 Oct); profile shows KYC photos via 5-minute signed URLs to allowed roles. KYC photo upload is wired but untested. Lists load the first 200 rows; paging (`nextCursor`) not yet in the UI |
| 4 | Agent app: sign-in, route, collection + offline queue, records, phone/device ID, sign-out block | ✅ | Builds (AGP 9.4.1, compileSdk 37); offline → sync verified on an emulator 19 Oct (audit U1) |
| 4b | Agent app hardening: biometric unlock, cache wipe on sign-out, persisted refused writes, fonts, **Keystore enrolment + command signing (REQUESTS #25)** | ✅ | Verified end to end 19 Oct on an API 37 emulator: real Keystore key enrolled → portal showed the same fingerprint → bound → signed GH₵ 20.00 collection POSTED → visible on the portal statement. Fonts: run `apps/agent-android/scripts/fetch-satoshi.sh` once per checkout |
| 5 | Cashier: expected vs received cash, handover, payout queue | ⏳ | Waits on backend Step 6 (can be mocked) |
| 6 | Branch manager: activity board, work queue, close checklist | ⏳ | Waits on backend Steps 6–7 |
| 7 | Head office: today at a glance, branch comparison, approvals and exceptions | ⏳ | Overview tiles read the planned dashboard docs already |
| — | Public site (`apps/site`) | ⏳ | |

## Next up

1. **Backend:** **gap found 19 Oct** — a command whose trigger never ran (emulator stuck, or a lost event) has no `status`, and `retryFailedCommands` only sweeps `FAILED`, so it would never post. Sweep commands with no status older than ~10 min too. Then Step 6 (handover, branch close, withdrawals). SMS: choose the provider and add its delivery-report webhook. Route follow-ups: collection days for WEEKLY/MONTHLY products (all frequencies show every day now); the agent app keeps listening to the day it opened on, so an app left open past midnight shows yesterday's route until reopened.
2. **UI:** re-audit commit `939103c`; list paging in the portal; then cashier screens (item 5) against mocked Step 6 shapes.
3. **Both:** commit and push your own work to `origin/main` at each milestone. Next: GitHub CI. Note that the repo is public by the user's choice (it includes `outputs/` and the bundled Satoshi fonts, whose licence forbids public redistribution).
4. **UI:** portal MFA enrolment (audit U5) and self-hosted Satoshi (U6).
5. **UI:** cashier screens (item 5) against mocked Step 6 shapes.

## How to run locally

```bash
corepack pnpm install
createdb susu_dev
cp functions/.secret.local.example functions/.secret.local && cp functions/.env.example functions/.env.local
firebase emulators:start --project demo-susu
corepack pnpm --filter @susu/functions seed:local    # migrates, creates admin@susu.test in Auth + staff_users (password in functions/scripts/seed-local.ts)
corepack pnpm --filter portal dev                     # http://localhost:3000
cd apps/agent-android && ./gradlew :app:assembleDebug # JDK 17+, Android SDK with platform 37
```

## Change log

- **2026-10-18** Backend: Steps 1–2 done, Step 3 writes, Step 4 backend (commit `e067c56`).
- **2026-10-18** UI & Audit: portal shell and admin screens built and verified against the emulators; agent app written; first audit pass (`docs/audit/AUDIT-2026-10-18.md`, REQUESTS #3–#19).
- **2026-10-19** UI & Audit: Android SDK installed; agent app builds and passed the offline → sync test on an emulator. Agent-app hardening split into its own session. This plan created.
- **2026-10-19** UI & Audit: portal Members module done (list/search, register with KYC photo upload, maker-checker approval, profile with masked Ghana Card, open Susu account, statement, approvals queue, Susu products) and verified against the emulators. REQUESTS #21–#24 added.
- **2026-10-19** UI & Audit: first UI commit on `main` (portal, agent app as of the hardening session's in-progress state, audit, plan). Pushed to `origin/main` (public repo, by the user's choice).
- **2026-10-19** Backend: audit fixes — migration `002_hardening` (H1, L3, M3, M4, M5), signed agent commands + device enrolment (H2), live staff checks (M1), createStaffUser order (M2), KYC path checks (M6), agent/pair checks (M7), failed-command exceptions + sweeper (M8), per-device lock (L2), local `migrate`/`seed:local` (L5, #19), `docs/ops/ENVIRONMENT_CHECKLIST.md` (L6). 65 unit + 2 Postgres + 18 rules tests green. Contract changes listed in REQUESTS #25.
- **2026-10-19** UI & Audit: pushed the missing `apps/portal/src/lib` (`877ae85`). REQUESTS #25 portal part: new reason copy, fingerprint check before `bindDevice`, Turbopack again (shared is extensionless), callables no longer send `undefined` as `null` (optional `label` was rejected), SUPER_ADMIN may upload KYC photos, old seed script retired in favour of `seed:local`. Agent-app signing handed to 4b with a verified signing reference.
- **2026-10-19** Committed and pushed all in-progress work (`a1f1578`): backend Step 3 read callables (`listBranches`, `listStaff`, `listAgentPairs`, `listDevices`, `listSusuProducts`, `searchMembers`, `getMember`, `getAccountStatement`, `listPendingApprovals`, `listAuditEvents`) + projections and sync-health reads; agent-app Keystore enrolment and signing (4b) as of that moment. Satoshi `.ttf` files removed from the repo and ignored. Typecheck, 89 unit tests and Android unit tests green. Portal still needs to swap its `// TODO(api)` mocks for these reads.
- **2026-10-19** Steps 1–2 of the remaining work: portal switched from mocks to the real read endpoints (mock stores deleted; lists reload after any write; load errors shown; KYC photos on the profile). Agent-app signing verified end to end on the emulator (enrol → fingerprint match in portal → bind → signed collection POSTED → on statement). REQUESTS #25 closed.
- **2026-10-19** Step 4 routes: members are put on an agent pair's route from the member profile (Assign collector: pair + expected GH₵ per visit). Functions write `agentPairs/{id}/routes/{today}` and `memberSnapshots` on every change and nightly at 00:05; the agent app's debug sample route is removed. 12 new unit tests + 1 rules test; verified on the emulators (assign in portal → phone route updated live; unassign empties route and deletes the snapshot; agents refused). The daily schedule itself was not triggered in the emulator.
- **2026-10-19** Step 5 SMS receipts: outbox dispatcher, immediate send after posting, minute sweep, Arkesel + log providers, `dashboards/company/live/sms`, `SMS_FAILED` exceptions. 17 unit tests + a 5-way race test on real Postgres. Verified on the emulators: a scripted phone's signed collection POSTED and its receipt was sent within a second; the six older queued receipts drained via the dispatch code. Found the unprocessed-command gap above (not fixed).

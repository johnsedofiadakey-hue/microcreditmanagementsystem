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
| 2 Ledger core | ✅ | Posting, idempotency, reversals, append-only. Audit H1 and M4 still open |
| 3 Members & Susu accounts | 🟡 | Writes built. Read endpoints planned: `searchMembers`, `getMember`, `getAccountStatement`, `listPendingApprovals`, `listAuditEvents`, `listBranches`, `listStaff` |
| 4 Offline collections | ✅ backend | Command queue → trigger → ledger → SMS outbox. Route/member-snapshot read models still planned |
| 5 SMS receipts | ⏳ | |
| 6 Handover, branch close, withdrawals | ⏳ | |
| 7 Bank match, dashboards | ⏳ | |
| 8 Ghana Card verification | ⏳ | Waiting on the NIA provider |
| 9 Migration, UAT, pilot | ⏳ | |
| Audit fixes (REQUESTS #3–#19) | ⏳ | 2 high, 8 medium, 7 low — `docs/audit/AUDIT-2026-10-18.md` |

### UI (brief build order)

| # | Area | Status | Notes |
|---|---|---|---|
| 1 | Portal shell: sign-in (+MFA challenge), role-aware nav, branch switcher, audit log viewer | ✅ | Verified against the emulators. MFA enrolment screen not built (audit U5). Audit log uses mocked data |
| 2 | Admin: branches, staff, agent pairs, devices | ✅ | Real callables, verified in Postgres. Lists mocked until the list endpoints exist |
| 3 | Members: register, approve (maker-checker), profile, Susu account + statement, products, approvals queue | ✅ | Verified 19 Oct: admin registers → admin is blocked from approving → branch manager approves → opens account (all real callables, rows in Postgres). Reads (`searchMembers`, `getMember`, `getAccountStatement`, `listPendingApprovals`, `listSusuProducts`) are mocked behind `// TODO(api)` in `apps/portal/src/lib/members-api.ts`. KYC photo upload is wired but untested (the admin role can't upload, per storage.rules) |
| 4 | Agent app: sign-in, route, collection + offline queue, records, phone/device ID, sign-out block | ✅ | Builds (AGP 9.4.1, compileSdk 37); offline → sync verified on an emulator 19 Oct (audit U1) |
| 4b | Agent app hardening: biometric unlock, cache wipe on sign-out, persisted refused writes, fonts | 🟡 | Session `harden-the-susu-agent-an` (local_78383c71) |
| 5 | Cashier: expected vs received cash, handover, payout queue | ⏳ | Waits on backend Step 6 (can be mocked) |
| 6 | Branch manager: activity board, work queue, close checklist | ⏳ | Waits on backend Steps 6–7 |
| 7 | Head office: today at a glance, branch comparison, approvals and exceptions | ⏳ | Overview tiles read the planned dashboard docs already |
| — | Public site (`apps/site`) | ⏳ | |

## Next up

1. **UI:** agent app hardening (4b), running in its own session.
2. **Backend:** audit fixes H1, H2, M1–M8 (REQUESTS #3–#12), then the Step 3 read endpoints (REQUESTS #21–#24 pin down their shapes).
3. **Both:** commit and push your own work to `origin/main` at each milestone. Next: GitHub CI. Note that the repo is public by the user's choice (it includes `outputs/` and the bundled Satoshi fonts, whose licence forbids public redistribution).
4. **UI:** portal MFA enrolment (audit U5) and self-hosted Satoshi (U6).
5. **UI:** cashier screens (item 5) against mocked Step 6 shapes.

## How to run locally

```bash
corepack pnpm install
createdb susu_dev        # then apply functions/src/db/migrations/001_core.ts (no migrate script yet, REQUESTS #14)
DATABASE_URL=postgresql:///susu_dev firebase emulators:start --project demo-susu
node apps/portal/scripts/seed-emulator.mjs            # admin@susu.test (password in that file)
corepack pnpm --filter portal dev                     # http://localhost:3000
cd apps/agent-android && ./gradlew :app:assembleDebug # JDK 17+, Android SDK with platform 37
```

## Change log

- **2026-10-18** Backend: Steps 1–2 done, Step 3 writes, Step 4 backend (commit `e067c56`).
- **2026-10-18** UI & Audit: portal shell and admin screens built and verified against the emulators; agent app written; first audit pass (`docs/audit/AUDIT-2026-10-18.md`, REQUESTS #3–#19).
- **2026-10-19** UI & Audit: Android SDK installed; agent app builds and passed the offline → sync test on an emulator. Agent-app hardening split into its own session. This plan created.
- **2026-10-19** UI & Audit: portal Members module done (list/search, register with KYC photo upload, maker-checker approval, profile with masked Ghana Card, open Susu account, statement, approvals queue, Susu products) and verified against the emulators. REQUESTS #21–#24 added.
- **2026-10-19** UI & Audit: first UI commit on `main` (portal, agent app as of the hardening session's in-progress state, audit, plan). Pushed to `origin/main` (public repo, by the user's choice).

# Susu Platform — Build Plan (Firebase-first)

Status: draft for review · 18 October 2026
Source: `outputs/` client guide, internal technical blueprint and commercial proposal.

The goal of this plan: one home for everything (Firebase), built in an order where every step
stands on something already tested, with the money-handling core built first and hardest.

---

## 0. Who builds what

| Owner | Scope | Brief |
|---|---|---|
| **Backend Claude session** | Ledger, Cloud Functions, SQL / Data Connect, Firestore & Storage rules, `packages/shared` contracts, CI and deploys | This plan + `docs/contracts/API.md` |
| **UI & Audit Claude session** | Portal, public site, member PWA, agent Android app screens; independent audit of the whole project | `docs/handoff/UI_AND_AUDIT_BRIEF.md` |

Ownership rules are in `CLAUDE.md`. Cross-owner requests go in `docs/handoff/REQUESTS.md`.

### Progress

| Step | Backend | Notes |
|---|---|---|
| 1 — Foundation | **Done** (local) | Monorepo, Firebase config, Auth claims, org model, audit log, emulator rules tests. Firebase projects and CI not created yet. |
| 2 — Ledger core | **Done** | Double-entry posting, idempotency, reversals, append-only + balanced-batch enforced in the database. |
| 3 — Members & Susu accounts | **Partly done** | Register, approve (maker-checker), products, open account. Read/list endpoints next. |
| 4 — Offline collections | **Backend done** | Firestore command queue → trigger → ledger, with SMS receipt queued in the outbox. Agent app is UI-owned. |
| 5–9 | Not started | |

---

## 1. The one principle that shapes everything

> **No phone, browser, USSD session or SMS callback ever changes money directly.**
> They submit *requests* (commands). Only our server code turns a command into ledger entries.

Everything below is how we honour that while keeping the whole system inside Firebase.

---

## 2. Firebase does all of this

All of it lives in one Firebase project per environment and shows up in one Firebase console.

| Need | Firebase product | Notes |
|---|---|---|
| Sign-in for staff, agents, members | **Firebase Authentication** (with Identity Platform upgrade) | Upgrade enables MFA for staff, blocking functions, audit logs. Roles and branch scope live in **custom claims**. |
| Prove requests come from *our* app | **App Check** (Play Integrity on Android, reCAPTCHA Enterprise on web) | An extra signal on top of device binding, not a replacement for it. |
| **The ledger and all financial records** | **Firebase Data Connect** (managed **Cloud SQL for PostgreSQL**) | Postgres inside Firebase. Gives real transactions, constraints and SQL reporting, which Firestore cannot do safely for double-entry money. See §3. |
| Agent offline queue, live dashboards, notifications | **Cloud Firestore** | Firestore's built-in offline cache *is* the agent's sync queue (see §5). Also holds read models for fast live screens. |
| All server logic | **Cloud Functions for Firebase (2nd gen)** in TypeScript | Firestore triggers, HTTPS endpoints (USSD/SMS webhooks), callable functions (portal actions), scheduled jobs, task queues. |
| Background jobs and retries | Functions **task queues** + **scheduled functions** | SMS sending, KYC calls, nightly reconciliation, report builds. |
| Branch portal, public website, member PWA | **Firebase App Hosting** (Next.js) | Git-connected deploys, server-side rendering, same project. |
| Ghana Card photos, member photos, agreements | **Cloud Storage for Firebase** | Locked by Storage rules; only server-signed access to KYC files. |
| Push to agent phones | **Firebase Cloud Messaging** | Route changes, "handover confirmed", forced app update. |
| Feature switches and stage rollout | **Remote Config** | Turn loans / hire purchase / welfare on per branch as stages go live. |
| Crashes and app health | **Crashlytics** + **Performance Monitoring** | |
| Ship agent app builds to testers | **App Distribution** | Pilot builds before managed Play release. |
| Local development | **Emulator Suite** | Auth, Firestore, Functions, Storage and Data Connect all run locally. |
| Reports and analytics (Stage 2+) | **BigQuery** (Firestore export extension / Cloud SQL federation) + Looker Studio | Same Google project, management reporting without touching the live ledger. |

**What Firebase does not provide (we connect to it from Cloud Functions):**
Ghana Card verification (NIA-approved verification provider), SMS and USSD (Arkesel, mNotify,
NALO or Africa's Talking), bank statement files, and device management (Android Enterprise / MDM).

---

## 3. Why the ledger sits in Data Connect (Postgres) and not Firestore

This is the only place where "just use Firestore" would hurt us, so it's worth being explicit.

| Requirement | Firestore | Data Connect (Postgres) |
|---|---|---|
| Debits always equal credits in one atomic step | Possible but hand-built and fragile | Database transaction + constraint |
| Branch cash account updated by many agents at once | Single hot document, contention and retries | Row locks, built for it |
| "Show every collection not yet handed over, grouped by agent pair" | Needs pre-built copies of the data | One SQL query |
| Reconciliation, month-end, arrears (PAR 30/60/90) | Painful | Plain SQL |
| Auditor-friendly history | Custom | Append-only tables + database audit |

It is still Firebase: Data Connect is created, deployed and viewed from the Firebase console and
CLI, runs in the emulator, and its schema lives in our repo next to everything else.

**How we use it:**
- Data Connect owns the schema (`dataconnect/schema/*.gql`) and generates typed SDKs for the portal's **read** screens, protected by `@auth` rules.
- **All financial writes** happen only inside Cloud Functions, in one database transaction (Data Connect mutations marked `@transaction`, or a direct Postgres connection from Functions to the same Cloud SQL instance for the posting procedure).
- No client SDK is ever given a mutation that touches money.
- **Decided (18 Oct 2026):** the posting path is plain SQL in Cloud Functions (`functions/src/ledger/post.ts`) over a `pg` connection to the Data Connect Cloud SQL instance. The financial schema is owned by versioned SQL migrations (`functions/src/db/migrations/`), because it relies on triggers and constraints (append-only journal, balanced-batch check at commit) that a GraphQL schema can't express. Data Connect is added for portal **read** queries with its schema validation in `COMPATIBLE` mode, mapped onto these tables. Proven: 100 simultaneous deliveries of 50 commands on real Postgres produce exactly 50 postings with correct balances.

---

## 4. Full stack, one line each

| Layer | Choice |
|---|---|
| Repo | One monorepo: **pnpm workspaces** (Turborepo dropped — not needed at this size) |
| Shared code | `packages/shared`: TypeScript types + **Zod** schemas for every command (used by Functions, portal and tests) |
| Server | **Cloud Functions for Firebase 2nd gen**, Node 22, TypeScript |
| Ledger database | **Firebase Data Connect → Cloud SQL PostgreSQL** |
| Live/offline data | **Cloud Firestore** |
| Branch & head-office portal | **Next.js (App Router) + TypeScript + Tailwind + shadcn/ui**, TanStack Table, Recharts; **Inter** for UI text, **Satoshi** for headings; on **App Hosting** |
| Public site + member PWA | **Next.js** on **App Hosting** (separate app; member PWA added in Stage 4) |
| Agent app | **Native Android: Kotlin + Jetpack Compose**, Firebase Android SDKs, WorkManager for photo uploads, Android Keystore, BiometricPrompt to unlock the app |
| Agent devices | Company-owned Android phones, **Android Enterprise** managed by an MDM |
| SMS / USSD | Provider-neutral adapter in Functions; first provider chosen in Stage 0 |
| Testing | **Vitest** + Firebase Emulator Suite (rules, functions, ledger), **Playwright** (portal), Android instrumented tests |
| CI/CD | **GitHub Actions** → `firebase deploy` per environment; App Hosting deploys on merge |
| Environments | Three Firebase projects: `susu-dev`, `susu-staging`, `susu-prod` (Blaze plan, budget alerts on each) |

**Why native Kotlin for the agent app:** it's the app that handles cash in poor network areas on
managed phones. Native gives the most reliable offline storage, background work, hardware-backed
keys and MDM integration. The portal and member side stay in TypeScript.

**Region:** decide in Stage 0 with the client's compliance lead. `africa-south1` (Johannesburg)
if data must stay on the continent; `europe-west1` (Belgium) often has lower latency from Accra.
All products must sit in the same region.

---

## 5. How an agent collection works offline (the key mechanism)

```
Agent phone (offline OK)                 Firebase (server)
─────────────────────────                ─────────────────────────────────────────
1. Agent saves collection
   → Firestore doc
     commands/{clientUuid}
     { type: COLLECTION, memberId,
       amount, deviceId, seq,
       agentPairId, capturedAt }
   Firestore SDK keeps it on the
   phone until network returns.
   Screen shows "Pending sync".
                         ── sync ──►     2. Security rules allow create only:
                                            own uid, bound device, no updates/deletes.
                                         3. Function trigger onCommandCreated:
                                            - validate with Zod + policy
                                            - check device is bound and not revoked
                                            - ONE Postgres transaction:
                                              idempotency key = clientUuid
                                              journal batch (debit agent cash custody,
                                              credit member Susu liability)
                                              update balance projection
                                            - write outbox row "send SMS receipt"
                                         4. Write result back to commands/{clientUuid}
                                            { status: POSTED, postingId, serverTime }
5. App sees status change   ◄── sync ──
   → "Synced ✓"                          6. Task queue sends SMS receipt to member.
```

Why this is safe:
- **Duplicates:** the Firestore document ID is the client UUID, and the ledger rejects a second posting with the same key. Triggers can run more than once; the money only moves once. Commands from one phone are processed one at a time (advisory lock per device).
- **Proof of origin (since 19 Oct):** each phone holds a non-exportable Android Keystore key, enrolled at first launch and captured when a supervisor binds the phone (after comparing a fingerprint). Every command is signed; stolen credentials alone can't post collections.
- **Ordering:** each device numbers its commands (`seq`). Collections are independent, so they post in any order; a reused `seq` is refused. Gaps are reported on the supervisor's sync-health view (planned) rather than blocking, because a crash can legitimately leave one.
- **Server time is official time.** The phone's clock is recorded but never trusted.
- **Agents can't edit or delete** a saved collection; rules forbid it. Corrections are reversals done in the portal with approval.
- **Known limits:** Firestore's offline cache is not encrypted by itself, so phones must be managed devices with device encryption and a screen lock; pending items are lost if the app's data is wiped, so the app shows a count of unsynced items and blocks logout until it's zero. Photos don't queue in Firestore, so WorkManager uploads them to Storage when online.

The same pattern carries every agent action: handovers, registrations, withdrawal requests.

---

## 6. Where each kind of data lives

| Data | Home | Who writes it |
|---|---|---|
| Members, accounts, products, contracts | Postgres | Functions only |
| Journal batches and lines, balances | Postgres | Functions only, append-only |
| Handovers, branch closes, bank deposits, matches | Postgres | Functions only |
| Approvals, cases, audit events | Postgres | Functions only |
| Agent command queue | Firestore `commands/` | Agent app (create only) → Functions update status |
| Agent's route and member list for offline use | Firestore `routes/`, `memberSnapshots/` | Functions (read-only copy for the phone) |
| Live dashboard counters | Firestore `dashboards/` | Functions after each posting |
| Notifications, in-app announcements | Firestore | Functions |
| Feature switches per branch | Remote Config | Admin |
| KYC images, documents | Cloud Storage | Agent app (upload only) → Functions move to locked folder |

Rule of thumb: **Postgres is the truth; Firestore is the fast, offline-friendly window onto it.**

---

## 7. Repository layout

```
susu-platform/
├── apps/
│   ├── portal/              # Next.js — head office, branch, cashier, supervisor
│   ├── site/                # Next.js — public website (+ member PWA in Stage 4)
│   └── agent-android/       # Kotlin + Compose (own Gradle build)
├── functions/               # Cloud Functions (TypeScript)
│   └── src/
│       ├── ledger/          # posting engine, chart of accounts, reversals
│       ├── commands/        # Firestore command processors (collection, handover…)
│       ├── members/         # registration, KYC states
│       ├── cash/            # handover, branch close, bank match
│       ├── approvals/       # maker-checker engine
│       ├── messaging/       # SMS/USSD adapters + outbox
│       ├── kyc/             # NIA verification provider adapter
│       └── projections/     # Firestore read models + dashboards
├── dataconnect/             # schema/*.gql, connectors, generated SDK config
├── packages/shared/         # Zod command schemas, enums, money helpers
├── firestore.rules
├── storage.rules
├── firebase.json / .firebaserc
└── .github/workflows/
```

---

## 8. Build order — step by step

Each step ends with something demoable and tested. Steps in **Stage 1** are 2-week sprints.

### Before code: Stage 0 — rules and long-lead items (weeks 1–3, no production code)

Signed off with the client:
1. Susu product rules: cycles, fees, commission, withdrawal and catch-up rules.
2. Approval matrix: who approves what, up to which amount, in which branch.
3. Cash process: collection → handover → branch close → bank deposit, as they really do it.
4. Chart of accounts and posting rules, agreed with the client's accountant.
5. Pilot branch, agent pairs, named owners, pilot acceptance checklist.
6. **Data migration plan** for existing members and balances (not covered in the current documents).
7. Hosting region decision.

Started on day 1 because they take weeks: NIA verification provider contract, SMS sender ID,
USSD short code (not needed for the pilot), agent phones + MDM, Firebase projects on Blaze.

### Step 1 — Foundation (Sprint 1)
- Three Firebase projects, monorepo, CI deploying to dev, Emulator Suite running locally.
- Auth with Identity Platform: staff email + MFA; custom claims `{ role, branchIds }`.
- Organisation model: company → branches/towns → users → agent pairs → devices.
- Audit event writer used by every later function.
- **Spike:** Data Connect posting transaction under concurrency (§3).
- **Done when:** an admin signs in to an empty portal shell, creates a branch and a user, and the audit trail shows it.

### Step 2 — The ledger core (Sprint 2) — the heart, built first
- Chart of accounts, journal batches/lines, balance projections.
- One `postJournal()` entry point: idempotency key, balance check, atomic write, reversal support.
- Period locks; amounts stored as integer pesewas.
- Tests: every batch balances; same command twice posts once; 50 concurrent postings to one branch account stay correct; reversals leave the original untouched.
- **Done when:** the test suite proves those properties. No screens needed yet.

### Step 3 — Members and Susu accounts in the portal (Sprint 3)
- Member registration in the portal (Ghana Card fields, photo upload, consent), KYC state `DRAFT`.
- Susu products (versioned) and opening a Susu account.
- Maker-checker engine (request → different-person approval), used first for member approval.
- **Done when:** branch staff register a member, a second person approves them, and their Susu account exists with zero balance.

*Why portal before the app:* branches need it anyway, and it lets us exercise the ledger and
approvals through a simple screen before adding offline complexity.

### Step 4 — Agent app and offline collections (Sprint 4)
- Kotlin app: sign-in, device binding, biometric unlock, today's route, member search (from Firestore snapshot).
- Collection screen → `commands/` → trigger → ledger (§5). Pending/synced states.
- Firestore rules for the command queue, tested in the emulator.
- **Done when:** phone in airplane mode records 10 collections, reconnects, all 10 post exactly once, and the portal shows them.

### Step 5 — SMS receipts and messaging outbox (Sprint 4–5)
- Outbox table → task queue → SMS provider adapter, with retries and delivery status.
- **Done when:** each posted collection produces one SMS receipt, even if the provider fails once.

### Step 6 — Cash handover and branch close (Sprint 5)
- Agent starts handover; cashier counts and confirms; differences open a case.
- Branch close checklist: counted cash vs expected, pending payouts, open differences, manager sign-off.
- Withdrawal request → approval → cashier payout (maker-checker).
- **Done when:** a full day runs: collections → handover → payout → branch closed, with any difference visible.

### Step 7 — Bank match and dashboards (Sprint 6, first half)
- Record bank deposits; match against branch closes; unmatched stays visible.
- Dashboards for admin, branch manager, cashier and supervisor (Firestore read models for live counters, SQL for tables).
- **Done when:** head office sees today's collections, handovers and unclosed branches live.

### Step 8 — Ghana Card verification (in parallel, whenever the provider is ready)
- KYC adapter in Functions; states `DRAFT → VERIFIED / RETRY_REQUIRED → EXCEPTION → RESTRICTED`.
- Restricted members can't make withdrawals until compliance resolves the case.
- Until the provider is live, pilot members stay `DRAFT` under a client-approved interim rule.

### Step 9 — Migration, testing, pilot go-live (Sprint 6, second half)
- Import existing members and opening balances; reconcile totals with the client's records.
- UAT with real branch staff in staging; training; agent phones enrolled in MDM.
- **Pilot go-live at one branch**, then 4–6 weeks of supervised running against the acceptance checklist.

---

## 9. After the pilot

| Stage | Length (est.) | What gets built | Firebase pieces added |
|---|---|---|---|
| **2 — Expansion** | 6–8 weeks | More branches and pairs, member USSD (balance, recent activity, requests), exception queues, commission, reporting | Functions HTTPS endpoint for USSD, BigQuery + Looker Studio |
| **3 — Loans & hire purchase** | 8–10 weeks | Loan applications, assessment, approvals, schedules, repayments, arrears (PAR 30/60/90); hire-purchase catalogue, supplier and delivery flow | Remote Config switches per branch, scheduled functions for daily arrears |
| **4 — Welfare & hardening** | 6–8 weeks | Welfare membership and claims, member PWA, load and recovery tests, full rollout | App Hosting for PWA, Auth phone sign-in for members |

Rough total: **pilot live around month 4, full platform around months 9–12.**

---

## 10. Non-negotiables to check at every step

- Clients never write financial data; rules and tests prove it.
- Every money change is a balanced journal batch; nothing is updated or deleted, only reversed.
- Every money-out action needs two different people.
- Every action records who, which device, which channel, and server time.
- Every new feature has emulator tests before it reaches staging.
- Budget alerts on every Firebase project; Cloud SQL backups and point-in-time recovery switched on from day one.

---

## 11. Open decisions

| Decision | Owner | Needed by |
|---|---|---|
| Hosting region | Client compliance + Stormglide | End of Stage 0 |
| NIA verification provider | Client | Start Stage 0 (long lead) |
| SMS / USSD provider | Stormglide + client | Stage 0 |
| MDM product for agent phones | Client IT + Stormglide | Before Step 4 |
| Interim rule for members whose Ghana Card check isn't live yet | Client compliance | Before pilot |
| ~~Data Connect mutations vs direct SQL for posting~~ | Stormglide | **Decided:** direct SQL in Functions (§3) |

# Blueprint gap analysis — 21 October 2026

**Compared:** *Microfinance and Susu Internal Technical Blueprint* v1.0 (27 Sep 2026, `outputs/…Technical_Blueprint.pdf`)
against the repository at `main` (`8885ef4`), `BUILD_PLAN.md`, `docs/PROJECT_PLAN.md` and `docs/ops/`.
**Owner:** backend. Evidence is the code and tests in this repository; nothing here was verified on real devices,
with real providers or with client staff.

## 1. Where we stand by blueprint phase

| Blueprint phase (months) | Built | Estimate | What is missing |
|---|---|---|---|
| **Phase 0 — Discovery and controls** (1) | Decisions recorded as ADRs (three businesses, cash controls); open decisions listed | ~15% | Signed business-rules specification, approval matrix, licence category, NIA/IVSP and SMS/USSD/MDM provider due diligence, threat model, accountant chart-of-accounts mapping, data inventory, pilot acceptance criteria. **No client sign-off recorded for anything.** |
| **Phase 1 — Core Susu pilot** (2) | Member intake + maker-checker approval, signed offline collections, ledger, routes, handover / close, withdrawals, corrections, bank match, dashboards, SMS outbox (log provider), portal and agent app | ~60% (code ~80%) | Ghana Card / IVSP verification, real SMS provider, public site v1, MFA enrolment, encrypted local store, MDM, UAT environment, data migration tooling, the 10-pair one-branch pilot itself |
| **Phase 2 — Member access and scale-out** (2) | Withdrawal request → approve → pay | ~15% | USSD gateway, member PWA, fraud alerts, commissions, branch-wave tooling, support operations, 200-agent load readiness |
| **Phase 3 — Credit and hire purchase** (2) | Module switch (`business_modules`), reusable ledger and maker-checker | ~5% | Loans, schedules, PAR, bureau export, hire-purchase catalogue / suppliers / delivery proof, Member Value Score |
| **Phase 4 — Welfare, reporting, hardening** (2) | Live day dashboards | ~10% | Welfare membership and claims, regulatory reporting pack, resilience / security review, pen test |

Weighted by the blueprint's timing (9 months to support), **about 20–25 % of the whole programme is built**,
concentrated in Phase 1. The financial core that every later phase depends on is the most complete part.

## 2. Architecture: where the build differs from the blueprint

These are deliberate changes made in `BUILD_PLAN.md` ("everything in Firebase"). The blueprint marks its own
stack choices as *[Technical recommendation] — requires Phase 0 acceptance*; **none of these changes has a
recorded client or Phase 0 acceptance.** They need one before production.

| Blueprint | Built | Risk if accepted as-is | What would close it |
|---|---|---|---|
| Financial Core as TypeScript services on **Cloud Run**; Cloud Functions only for non-financial triggers (§3, §3.1) | **Cloud Functions (2nd gen) with direct SQL** to Cloud SQL Postgres; no Data Connect in use despite the plan's wording | Low for correctness — the controls live in Postgres (balanced batches, append-only, two-person checks in triggers). Operational: cold starts, per-function connection pools (`max_connections`), harder private networking | Record acceptance, or move the callables behind one Cloud Run service later (the domain code is plain TypeScript and portable) |
| Agent app local store **Room + SQLCipher**, WorkManager sync, Sync API (§3, §7.1) | Firestore's persistent offline cache **is** the queue; commands are Keystore-signed | **Medium:** the cache is protected by Android device encryption only, not an app-level encrypted database; a device-loss policy and MDM become essential | SQLCipher-backed queue in the app, or document device-encryption + MDM as the accepted control |
| **OpenAPI 3.1** contracts per channel (§9) | Zod schemas in `packages/shared` + `docs/contracts/API.md` | Low | Generate OpenAPI from the Zod schemas if an external party needs it |
| **Pub/Sub, Cloud Tasks**, dead-letter queues (§2, §9.1) | Transactional outbox table + scheduled sweeps + Firestore triggers | Low at pilot scale; no dead-letter queue with a named owner yet | Alerting on outbox / sweeper backlogs (partly done: `dashboards/company/live/*`) |
| **Terraform** for infrastructure (§3, §13.2) | Firebase CLI + console; settings recorded in `docs/ops/ENVIRONMENT_CHECKLIST.md` | Medium: environments are not reproducible from code | Terraform (or scripted setup) before creating production |
| **Separate dev / UAT / production projects** (§2, §13.1) | Local emulators + one trial project (`microcreditplatform`) | High for go-live, none for demos | Create UAT and production projects; work the environment checklist (0 of 16 items ticked) |
| Production region co-located | Trial: functions europe-west1, **database us-west1**, App Check off, SMS logged | Acceptable only for synthetic demo data (`docs/ops/TRIAL_DEPLOYMENT.md`) | Production in one region with App Check enforced |
| Device binding via **Android Enterprise / MDM** with attestation (§5.3) | Keystore key per phone, fingerprint check at binding, signed commands, remote revoke; attestation chains stored but **not verified**; no MDM | Medium | MDM enrolment, attestation verification, App Check Play Integrity |
| Redis for rate limits / locks | Postgres locks; no Redis | None at pilot scale | — |

Agreed with the blueprint: PostgreSQL is the authoritative ledger; Firestore holds only commands, enrolments and
read models; no client writes money; integer minor units; append-only journal with reversals; server time is official.

## 3. Blueprint controls — status

| Blueprint control | Status |
|---|---|
| Double-entry, append-only, balanced batches, reversal not deletion (§6) | ✅ enforced in the database, property and race tests |
| Idempotency per device command; server assigns posting ID and time (§6.2) | ✅ |
| Per-device monotonic sequence, no trust in client clock (§7.1) | ✅ seq per device; lost-trigger recovery driven by seq, not phone time |
| Receipt only after commit; SMS through outbox with retry (§7.1, §9) | ✅ backend; ⚠ no real provider, no delivery-report webhook |
| Handover: both sides confirm, variance opens a case (§6.2, §7.2) | ✅ agent declaration + independent cashier confirmation |
| Branch close: count, pending payouts, open variances, signed close (§7.2) | ✅ backend; portal close screen in progress |
| Bank deposit and statement match, mismatch stays visible (§7.2) | ✅ backend |
| Withdrawal maker-checker, payer ≠ approver (§8.1) | ✅ three people, database-enforced; ⚠ amount limits are placeholders |
| Reversal / correction with independent checker, linked to original (§8.1) | ✅ (corrections); ⚠ GH₵ 1,000 head-office threshold is a placeholder |
| Role / limit change needs a separate approver (§8.1) | ❌ SUPER_ADMIN acts alone (staff, modules) |
| Cases as first-class records with severity, owner, SLA, outcome code (§12) | 🟡 cases exist (variance, dispute, off-route, close) with resolution text; no severity, owner, SLA or outcome codes |
| Fraud / anomaly signals (§12) | 🟡 off-route collections, self-approval refused; no collection-anomaly, account-takeover or staff-misuse detection |
| KYC states and restricted account (§5.1) | 🟡 statuses exist and non-ACTIVE members cannot withdraw; no IVSP gateway, no exception ladder, no 90-day rule |
| Account recovery (member / agent / staff) (§5.2) | 🟡 agent device re-binding only |
| Staff MFA (§10.1) | 🟡 challenge supported; enrolment screen and console enforcement missing |
| Secrets in Secret Manager (§10.1) | ✅ trial uses Secret Manager |
| Backups, PITR, restore rehearsal, RPO 15 min / RTO 4 h (§11) | ❌ not configured or rehearsed |
| SLO monitoring (§11.1) | 🟡 backlog dashboards for commands and SMS; no SLO alerting |
| CI: lint, typecheck, tests, security scan, migration review (§13.2) | 🟡 typecheck, unit, Postgres race and emulator tests run in CI; no dependency / security scan or Android instrumentation |
| Migration protocol with signed opening balances (§14.1) | ❌ not started |
| Pilot entry / exit gates (§14.3) | ❌ not started |

## 4. Before calling the pilot ready

1. **Phase 0 sign-off**: business rules, approval limits (withdrawal GH₵ 5,000; correction GH₵ 1,000), the ADR-002
   cash policies, and acceptance of the architecture changes in section 2.
2. **Providers**: NIA / IVSP (Step 8), SMS sender IDs and delivery reports, MDM.
3. **Environments**: UAT and production projects in one region, App Check enforced, backups + PITR + a restore test.
4. **Agent app**: encrypted local queue or an accepted device-encryption + MDM control; physical-device offline test.
5. **Portal**: close, payout and correction screens; MFA enrolment.
6. **Migration and UAT**: tooling for signed opening balances, a rehearsal, then the one-branch pilot with about 10 pairs.

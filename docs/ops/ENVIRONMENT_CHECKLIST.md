# Environment checklist

Tick each item per Firebase project before it takes real traffic. Settings that live in a console are
not visible in the code, so this file is their record (audit L6). Owner: backend.

| # | Item | Dev (`susu-dev`) | Staging (`susu-staging`) | Prod (`susu-prod`) |
|---|---|---|---|---|
| 1 | Project created on the Blaze plan, region chosen (BUILD_PLAN §4) and the same for Firestore, Functions, Storage and Cloud SQL | ☐ | ☐ | ☐ |
| 2 | Budget alerts at 50 / 90 / 100 % of the monthly budget, sent to the owner and Stormglide | ☐ | ☐ | ☐ |
| 3 | **App Check enforced** for Cloud Firestore, Cloud Storage and callable functions. Android: Play Integrity provider requiring `MEETS_DEVICE_INTEGRITY` and a recognised app. Web: reCAPTCHA Enterprise | ☐ | ☐ | ☐ |
| 4 | Identity Platform upgrade on; staff MFA required; email-enumeration protection on; self sign-up off | ☐ | ☐ | ☐ |
| 5 | Cloud SQL (Postgres 16+): automated backups, **point-in-time recovery on**, deletion protection on, private IP / Cloud SQL connector only | ☐ | ☐ | ☐ |
| 6 | `max_connections` sized for the functions: each function runs ≤ 10 instances × pool 5 = 50 connections; with N Postgres-using functions, need ≥ 50 × N + 20 headroom (today N = 13 exports, but only the active ones hold connections) | ☐ | ☐ | ☐ |
| 7 | Database user for the functions is **not** a superuser and cannot `ALTER TABLE … DISABLE TRIGGER` (owner role runs migrations; app role has DML only) | ☐ | ☐ | ☐ |
| 8 | `DATABASE_URL` secret set in Secret Manager for the app role; no secrets in `.env` files | ☐ | ☐ | ☐ |
| 9 | Migrations applied with the owner role: `corepack pnpm --filter @susu/functions migrate` | ☐ | ☐ | ☐ |
| 10 | First SUPER_ADMIN created in both Auth and `staff_users` (production equivalent of `seed:local`, run by Stormglide with two people present) | ☐ | ☐ | ☐ |
| 11 | Firestore and Storage rules deployed from `main` and rules tests green (`corepack pnpm test:rules`) | ☐ | ☐ | ☐ |
| 12 | Scheduled functions running: `retryFailedCommands` (every 15 min), `reconcileBalances` (02:00 Africa/Accra), `publishDailyRoutes` (00:05 Africa/Accra), `dispatchSmsOutbox` (every minute), `publishDayDashboards` (every 5 min) | ☐ | ☐ | ☐ |
| 13 | Log-based alerts: `Balance reconciliation found mismatches`, `Agent command failed; handing over to the sweeper`, `KYC photo move failed`, `SMS given up after retries`, `Commands found unprocessed; their trigger never ran` (should never fire — investigate lost trigger events), `Routes for … pairs could not be published` | ☐ | ☐ | ☐ |
| 15 | SMS: sender ID registered with the provider and with NCA approval; params `SMS_PROVIDER=arkesel`, `SMS_SENDER_ID` (≤ 11 chars), `SMS_BRAND`; secret `SMS_API_KEY`. **Before go-live send one real receipt to a staff phone** — the Arkesel adapter is unit-tested against its documented v2 API but not yet against the live service. Dev may stay on `log` | ☐ | ☐ | ☐ |
| 15 | Bank accounts registered per business (`createBankAccount`, last 4 digits only) and the bank's statement export format agreed with finance | ☐ | ☐ | ☐ |
| 14 | Agent phones enrolled in the MDM, Play Store managed distribution, screen lock and device encryption enforced | — | ☐ | ☐ |

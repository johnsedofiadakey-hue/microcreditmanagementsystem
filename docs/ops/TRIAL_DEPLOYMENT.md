# Trial deployment — `microcreditplatform`

A **test** deployment for demos while the client is not yet paying. No real member data.
Owner: backend. Set up 21 Oct 2026.

| Item | Value |
|---|---|
| Firebase project | `microcreditplatform` (alias `trial` in `.firebaserc`), Blaze plan |
| Firestore, Storage, Functions | `europe-west1` |
| Ledger database | Cloud SQL `microcreditplatform-instance`, **us-west1** (Data Connect console default), Postgres 18, `db-f1-micro`, label `firebase-data-connect: ft` |
| Free trial | Data Connect no-cost Cloud SQL trial, 3 months from 21 Oct 2026 → **ends about 21 Jan 2027**, then ≈ US$9.37/month. Keep the default configuration (no resize, private IP, replicas, extra compute) or billing starts. **Deleting the instance ends the trial for this project for good.** |
| Database | `susu`. Owner `susu_owner` (migrations; secret `DATABASE_OWNER_URL`, a localhost:6543 URL for the proxy). App role `susu_app` (row access only, cannot alter tables or triggers; secret `DATABASE_URL`) |
| Function parameters | `functions/.env.microcreditplatform` (git-ignored): `CLOUD_SQL_INSTANCE`, `FUNCTIONS_REGION=europe-west1`, **`ENFORCE_APP_CHECK=false`** (test project only), `SMS_PROVIDER=log` (receipts logged, not sent) |
| Secrets | `DATABASE_URL`, `DATABASE_OWNER_URL`, `SMS_API_KEY` (placeholder) |
| Functions service account | `791592522752-compute@…` granted: cloudsql.client, datastore.user, storage.objectAdmin, firebaseauth.admin, eventarc.eventReceiver, logging.logWriter, cloudbuild.builds.builder, artifactregistry.writer, and tokenCreator on itself (signed KYC URLs) |
| First super admin | created with `bootstrap:admin` |

## Public website preview (21 Oct 2026)
- Hosting site **`gadufia-fiase`** → https://gadufia-fiase.web.app (target `site` in `.firebaserc`; static export of `apps/site`).
- Build settings: `apps/site/.env.production.local` (git-ignored; copy `apps/site/.env.example`, set the trial's web config and `NEXT_PUBLIC_USE_EMULATORS=false`).
- Search engines are told not to index it until the client approves the copy (`NEXT_PUBLIC_SITE_INDEXABLE`).
- Functions `submitEnquiry`, `listEnquiries`, `updateEnquiry` deployed; Firestore indexes for `enquiries` deployed.
- Deploy the site only: `firebase deploy --only hosting:site --project microcreditplatform`.
- Other functions on the trial are still at the earlier deploy (the dashboard fix `8885ef4` is not deployed).

## Demo data (21 Oct 2026)
Seeded with `seed:demo` (functions/scripts/seed-demo.ts): branch **DEMO-AFL** "DEMO Aflao Main", product **DEMO-DAILY**, staff "DEMO …" whose emails are `johnsedofiadakey+demo-<role>@gmail.com` (sign in as one with **Forgot password**), 5 members "… (Demo)" with 020 000 00xx phones and GHA-0000000xx cards, a scripted phone, 6 signed collections (GH₵ 140) posted by the deployed trigger, a GH₵ 115 two-party handover, one paid and one pending withdrawal. No close or bank deposit. The scripted phone's private key existed only during the run, so it cannot post again; bind a real phone for more collections.

## Known trade-offs
- **Cross-region latency:** functions and Firestore are in europe-west1, the database in us-west1, so every query crosses the Atlantic. Postings and portal actions take a few seconds. Acceptable for demos; the paid production database goes in europe-west1.
- **No App Check yet:** register the web app (reCAPTCHA Enterprise) and Android app (Play Integrity), then set `ENFORCE_APP_CHECK=true` and redeploy.
- **No SMS:** choose a provider (Step 5) before members expect receipts.

## Everyday commands
```bash
# Reach the database from this Mac (uses your gcloud login)
cloud-sql-proxy microcreditplatform:us-west1:microcreditplatform-instance --port 6543
# New migrations
DATABASE_URL="$(gcloud secrets versions access latest --secret DATABASE_OWNER_URL --project microcreditplatform)" corepack pnpm --filter @susu/functions migrate
# Deploy
firebase deploy --only functions,firestore,storage --project microcreditplatform
```
New tables made by later migrations are readable by `susu_app` automatically (default privileges for `susu_owner`).

## Before the trial ends (by ~21 Jan 2027)
Either the client pays (then create the production project and database in europe-west1 and copy data), or stop the instance (storage only, ~US$2/month), or move to a free external Postgres.

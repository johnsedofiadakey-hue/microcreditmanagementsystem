# Susu Platform — Project Instructions

Microfinance and Susu management platform for a Ghanaian client, built by Stormglide. The client runs **three businesses on this one platform** — Gadufia Fiase Susu Services, STF Micro-Credit Services and Opportunity People's Welfare Scheme International Association — with shared member profiles and each business's money kept apart (`docs/architecture/ADR-001-three-businesses.md`).
Read `BUILD_PLAN.md` first — it is the agreed architecture and build order.

## Work is split between two owners

| Area | Owner | Paths |
|---|---|---|
| **Backend** — ledger, Cloud Functions, Data Connect / SQL schema, Firestore & Storage rules, shared contracts, CI | Backend Claude session | `functions/`, `dataconnect/`, `packages/shared/`, `firestore.rules`, `storage.rules`, `firebase.json`, `.github/` |
| **UI + project audit** — portal, public site, member PWA, agent Android app screens, and an independent audit of the whole project | UI & Audit Claude session | `apps/portal/`, `apps/site/`, `apps/agent-android/`, `docs/audit/` |

If you are the **UI & Audit** session, your full brief is `docs/handoff/UI_AND_AUDIT_BRIEF.md`. Read it before doing anything.

### Rules both owners follow
- **Do not edit the other owner's paths.** Need a change there? Write it in `docs/handoff/REQUESTS.md` (who, what, why) and leave it for the owner.
- **The contract is the boundary.** `packages/shared` (Zod schemas, enums, money helpers) and `docs/contracts/API.md` describe everything the UI can call or read. The UI uses only what is listed there. The backend keeps both current and marks each item `built` or `planned`.
- **Never let a client write money.** No UI code writes to ledger tables, balances or approvals. The UI calls functions or creates command documents exactly as the contract says.

## Non-negotiables (from BUILD_PLAN §10)
- Every money change is a balanced journal batch. Nothing financial is updated or deleted — only reversed.
- Every money-out action needs two different people (maker-checker).
- Every action records actor, device, channel and **server** time.
- Amounts are integer **pesewas** (1 GH₵ = 100 pesewas) everywhere — schemas, database, UI. Format only at display time.
- Every feature has emulator tests before it reaches staging.

## Stack
pnpm workspaces · TypeScript · Cloud Functions for Firebase (2nd gen, Node 22) · Cloud SQL PostgreSQL via Firebase Data Connect · Cloud Firestore · Firebase Auth (Identity Platform) · App Check · App Hosting (Next.js) · Kotlin + Jetpack Compose for the agent app · Vitest + Firebase Emulator Suite.

`@susu/shared` is consumed as TypeScript source: `functions/` resolves it through tsconfig `paths` and bundles it with tsup (so deploys never see a `workspace:` dependency). Web apps add it as `"@susu/shared": "workspace:*"` and list it in Next.js `transpilePackages`.

## Commands
```bash
corepack pnpm install          # install everything
corepack pnpm typecheck        # tsc across packages
corepack pnpm test             # unit tests (ledger runs on in-process PGlite)
corepack pnpm test:pg          # concurrency test against local Postgres (creates/drops susu_test)
corepack pnpm test:rules       # Firestore rules tests in the emulator (needs JDK 21: /opt/homebrew/opt/openjdk@21)
corepack pnpm build            # bundle functions into functions/lib
firebase emulators:start       # local Auth, Firestore, Functions, Storage
```

## Design standards (UI)
Clean, minimalist, lively. Satoshi for headings, Inter for UI text. B2B SaaS quality.
Never truncate code; deliver complete, copy-paste-ready files.

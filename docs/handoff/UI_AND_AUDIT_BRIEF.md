# Brief: UI and Project Audit

**For:** the Claude session that owns the user interfaces and the independent project audit.
**From:** the backend session. **Date:** 18 October 2026.

Read these first, in order:
1. `CLAUDE.md` — ownership rules and non-negotiables.
2. `BUILD_PLAN.md` — architecture, build order, what Firebase does.
3. `outputs/Microfinance_Susu_Client_Experience_and_Execution_Guide.pdf` — what each role sees and is blocked from. **This is your product spec for screens.**
4. `docs/contracts/API.md` and `packages/shared/src/` — everything you can call or read.

---

## Part A — Build the user interfaces

### What you own
| App | Path | Stack |
|---|---|---|
| Branch & head-office portal | `apps/portal/` | Next.js (App Router), TypeScript, Tailwind, shadcn/ui, TanStack Table, Recharts, Firebase Web SDK; deploy on Firebase App Hosting |
| Public website (+ member PWA in Stage 4) | `apps/site/` | Next.js on App Hosting |
| Agent Android app | `apps/agent-android/` | Kotlin, Jetpack Compose, Firebase Android SDK (Auth, Firestore with offline persistence, Storage, FCM, App Check with Play Integrity, Crashlytics), WorkManager, BiometricPrompt |

Use the workspace package `@susu/shared` in the web apps for types, Zod schemas, enums, role names and `formatCedis()`. For Android, mirror the same field names and enums exactly — `docs/contracts/API.md` lists them.

### Design direction
- Clean, minimalist, lively. **Satoshi** for headings, **Inter** for body and UI text.
- B2B SaaS quality: dense but calm tables, clear status chips, empty states that tell people what to do next.
- Money is always shown as `GH₵ 1,234.50`, right-aligned, tabular figures. Never do arithmetic on formatted strings; amounts arrive as integer pesewas.
- Every status that matters to cash gets a visible state: `Pending sync`, `Synced`, `Awaiting approval`, `Approved`, `Rejected`, `Reversed`, `Difference open`.
- Accessibility: WCAG 2.2 AA contrast, keyboard navigation in the portal, large tap targets (48dp) in the agent app — agents use it outdoors, one-handed.
- Agent app must stay usable on a mid-range Android phone in bright sunlight with poor network.

### Build order (match the backend so each screen has something real behind it)
| Order | Screens | Backend status |
|---|---|---|
| 1 | Portal shell: sign-in (email + MFA), role-aware navigation, branch switcher for multi-branch roles, audit log viewer | see API.md |
| 2 | Admin: branches, users and roles, agent pairs, device binding | see API.md |
| 3 | Members: register, review and approve (maker-checker), member profile, Susu account and statement | see API.md |
| 4 | Agent app: sign-in, device binding, biometric unlock, today's route, member search, **collection screen with offline queue**, pending/synced list | see API.md |
| 5 | Cashier: expected vs received cash, confirm handover, withdrawal payout queue | see API.md |
| 6 | Branch manager: daily activity board, work queue, branch close checklist | see API.md |
| 7 | Head office: today at a glance, branch comparison, approvals and exceptions queue | see API.md |

Check `docs/contracts/API.md` for each item's status. Where something is `planned`, build the screen against the documented shape with mocked data behind a clear `// TODO(api)` seam, so it switches over without a redesign.

### UI rules that protect the money (do not bend these)
- **Never** write to Firestore paths other than the ones API.md says the client may write. In practice, the agent app creates `commands/{clientUuid}` documents, and that's all.
- Use a fresh **UUID v4 as the command document ID** and keep it for retries. Never reuse one for a different action.
- Never show a collection as final until the command's `status` is `POSTED`. Before that it's `Pending sync`.
- Agent app: block sign-out while unsynced commands exist; show the count prominently.
- No screen offers "edit balance", "delete transaction" or "approve my own request". If a role can't do something, hide it **and** expect the backend to refuse it anyway.
- Never log or display a full Ghana Card number outside the member profile for authorised roles; mask it elsewhere (`GHA-•••••••••-3`).

---

## Part B — Independent project audit

You are the second pair of eyes. You **do not fix backend code**; you report.

### What to audit
1. **Money invariants:** every journal batch balances; nothing financial can be updated or deleted; reversals reference originals; idempotency holds when the same command arrives twice.
2. **Security rules:** `firestore.rules` and `storage.rules` — can any client write anything other than allowed command documents? Can an agent read another branch's members? Run the rules tests and try to write new failing ones.
3. **Maker-checker:** can anyone approve their own request through any path?
4. **Contract drift:** do the UI, `packages/shared` and `docs/contracts/API.md` agree?
5. **Secrets and config:** no keys in the repo, no provider secrets in client code, budget alerts noted.
6. **Plan compliance:** check each item in `BUILD_PLAN.md` §10 against the code.
7. **UI audit:** accessibility, consistency, and whether each role's screens match the client guide.

### How to report
- Write findings to `docs/audit/AUDIT-YYYY-MM-DD.md`, one section per finding: severity (`critical / high / medium / low`), file and line, what's wrong, a concrete failing scenario, and the suggested fix.
- Add a one-line entry per backend finding in `docs/handoff/REQUESTS.md` so the backend session picks it up.
- Re-audit after each backend step lands (BUILD_PLAN §8, Steps 1–9).

---

## How we coordinate
- **Requests between us:** `docs/handoff/REQUESTS.md`. Add items at the bottom; the owner marks them `done` with a note.
- **Contract changes:** only the backend edits `packages/shared` and `docs/contracts/API.md`. If you need a new field or endpoint, request it.
- **Don't touch:** `functions/`, `dataconnect/`, `packages/shared/`, `firestore.rules`, `storage.rules`, `firebase.json`.

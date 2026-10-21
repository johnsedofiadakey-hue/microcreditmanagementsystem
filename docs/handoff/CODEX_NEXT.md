# Next work for Codex (UI & Audit session) — 21 Oct 2026

Read first: root `CLAUDE.md`, `docs/handoff/UI_AND_AUDIT_BRIEF.md`, `docs/contracts/API.md`, `docs/handoff/REQUESTS.md`
(#33, #35, #36 are open for you), `docs/architecture/ADR-002-cash-controls.md`, `docs/architecture/BLUEPRINT_GAP_ANALYSIS.md`.

## Ground rules (unchanged, plus one change)

- **You own** `apps/portal/`, `apps/agent-android/`, `docs/audit/`. **Ownership change 21 Oct:** `apps/site/` (public
  website) now belongs to the backend session. You still audit it; don't edit it.
- Never edit `functions/`, `packages/shared/`, `firestore.rules`, `storage.rules`, `firebase.json`, `.github/`, `apps/site/`.
  Need something there? Add a row to `docs/handoff/REQUESTS.md` (who, what, why).
- Use only what `docs/contracts/API.md` lists as built. Never write money from the UI.
- Amounts are integer pesewas; format only for display (`formatCedis`).
- Stage and commit **only your own files**. Don't deploy, and don't touch the trial project's data.
- Every journey you call "done" must be verified on the emulators (`docs/contracts/API.md` §6: `firebase emulators:start --project demo-susu`,
  then `seed:local`), with what you verified written in `docs/PROJECT_PLAN.md`.
- Update your rows in `docs/PROJECT_PLAN.md` at each milestone.

## Work in this order

### 1. Finish and commit what is in progress (REQUESTS #35 — corrections)
Your uncommitted files: `approvals/corrections.tsx`, `request-correction-dialog.tsx`, `corrections-api.ts`, edits to
`approvals/page.tsx`, the account page, `access.ts`, `docs/PROJECT_PLAN.md`. Complete #35 (a)–(d), verify a request →
approve by a different user → statement shows the correction, then commit.

### 2. Cashier: two-party handover (REQUESTS #33 portal part)
Handover queue from `listHandoverDeclarations` → count each business line → `confirmHandover` (pass the line's
`currentCustodyPesewas` as `expectedPesewas`; `EXPECTED_CASH_CHANGED` = reload). Hide the action for agents of that pair.
Show difference and dispute results, and any opened case.

### 3. Withdrawals: verify the three-person payout
Request (cashier) → approve (manager; head office above `WITHDRAWAL_HEAD_OFFICE_THRESHOLD_PESEWAS`) → pay (a third person).
Make sure each blocked step shows a clear message (`SELF_APPROVAL_FORBIDDEN`, `APPROVAL_LIMIT_EXCEEDED`).

### 4. Branch manager: close screen
From `getBranchCashDay`: one section per business with the checklist (expected cash, count, collected, handed over, paid
out, pending declarations, approved-unpaid, open cases, route exceptions, carried-in, posted-after-close, warnings).
`submitBranchCount` (cashier) then `closeBranchDay` (manager, not the person who counted). After close the checklist is
frozen; show `postedAfterClose` live.

### 5. Website enquiries screen (REQUESTS #36)
Full spec in REQUESTS #36 and API.md §2. Nav badge with the NEW count.

### 6. Full cash journey, verified end to end on the emulators
Collection (agent app or scripted signed command) → agent declares handover → cashier confirms → withdrawal requested,
approved, paid → count → close → bank deposit recorded → statement imported → matched. Record each step and its result
in `docs/PROJECT_PLAN.md`. **This is the gate for calling Step 6 and the pilot journey complete.**

### 7. Android agent app (REQUESTS #33 Android part)
- Handover screen: per-business amounts → signed `HANDOVER_DECLARATION` command; result `RECORDED` counts as synced.
- Read `agentPairs/{pairId}/handovers/{declarationId}` to show DECLARED → CONFIRMED with the cashier's count.
- OFF_ROUTE collections are posted, not errors.
- Test on a **real Android phone**: offline collections in airplane mode → reconnect → SMS logged; route change at
  midnight; sign-out wipes the cache; a revoked phone can't post.

### 8. Security items
- Portal MFA **enrolment** screen (audit U5); MFA required for SUPER_ADMIN, FINANCE, BRANCH_MANAGER.
- Self-host Satoshi in the portal (audit U6) instead of the Fontshare stylesheet.

### 9. Audit the public site (read-only)
Review https://gadufia-fiase.web.app and `apps/site/` for accessibility (WCAG 2.2 AA), phone-width layout, copy that
promises something the platform or client rules don't support, and form security. Write findings to
`docs/audit/` and any change requests to REQUESTS.md for the backend session.

## Done means

Each item: built against the contract, typecheck clean (`corepack pnpm typecheck`), verified on the emulators or a device,
`PROJECT_PLAN.md` updated, only your files committed with a clear message.

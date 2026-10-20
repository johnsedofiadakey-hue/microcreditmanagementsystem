# ADR-002 — Cash controls after the 19 Oct audit

**Status:** implemented 19 Oct 2026 as interim defaults · **Owner:** backend · **Client sign-off needed:** yes (marked ⚠ below)
**Resolves:** `docs/audit/AUDIT-2026-10-19.md` H1, H2, H3, M3, M4, M5, M7 (REQUESTS #26–#32) · **Migration:** `007_cash_controls`

The rule throughout: **a valid signed collection is never refused or left unposted.** The member handed over real
cash and receives an SMS receipt, so the company's obligation to the member is recorded at once. Controls decide
how the collection is labelled, which day it counts towards, and who must review it.

## H1 — Route assignment at posting

Every assignment change is kept as a period (`route_assignment_periods`, server times, append-only apart from
ending a period). When a collection posts it is labelled:

| Label | When | What happens |
|---|---|---|
| `ON_ROUTE` | the account is assigned to the device's pair now | normal |
| `PREVIOUS_ROUTE` | the pair held the account until a reassignment **≤ 72 h ago** (server time) and the phone captured the collection before that change | posts into the collecting pair's custody (that is where the cash is); counted on the close checklist; no case |
| `OFF_ROUTE` | anything else (never assigned, another pair's account, grace expired, capture time after the change) | posts into the collecting pair's custody **and opens an `OFF_ROUTE_COLLECTION` case** for the branch; shown on the close checklist |

Custody is never moved to another pair automatically. Collections posted before this change are labelled `BEFORE_ROUTE_CHECKS`.

⚠ **Client decisions:** (a) the 72-hour grace (`PREVIOUS_ROUTE_GRACE_HOURS`); (b) whether off-route collections should
instead be *held unposted until a supervisor approves*. We did not choose (b) because the member would hold a receipt-less
payment and the cash in the agent's bag would have no ledger record while it waits.

## H2 — Collections that arrive after a business's branch day has closed

A close is final and frozen. A collection that reaches the server after its business's close for today **posts normally
(true server and capture times in the ledger) and counts towards the next cash day** (`collections.cash_day`,
`posted_after_close = true`). The cash is still in the pair's custody, so the next day's handover and close pick it up.

- The closed day's checklist shows a live `postedAfterClose { count, amountPesewas, countedOnDay }`, outside the frozen copy.
- The next day's checklist shows `carriedIn` and a warning.
- Collections and branch closes serialise on the branch row, so a collection lands clearly before or after a close (Postgres race test).

⚠ **Client decision:** that late offline collections are *reported* on the next open day. This is a reporting convention,
not a change to the ledger; the accountant may prefer a different presentation. Nothing about the closed day is edited either way.

## H3 — Two-party handover

1. **Agents declare** from a bound phone: a signed `HANDOVER_DECLARATION` command (API.md §3) with one line per business
   and the amount they counted. Stored immutably with the device, agent, capture time, server receipt time and each
   business's custody at that moment. No money moves. A newer declaration supersedes the pair's unconfirmed lines.
2. **A cashier confirms** each business line (`confirmHandover`): counts, and the journal batch records the cashier as
   actor and the declaring agent as second party. Cashier ≠ either agent of the pair (code and database). Each line
   confirms once (replay → `CONFLICT`).
3. **Differences:** counted ≠ custody → variance + `HANDOVER_DIFFERENCE` case; counted = custody but ≠ declared →
   `HANDOVER_DISPUTE` case. The agents see the cashier's count on their phone (`agentPairs/{id}/handovers/{declarationId}`).
4. The cashier-only `recordHandover` is **removed**; the database refuses any new handover without a declaration line.

⚠ **Client decisions:** (a) what happens when both agents' phones are unavailable (lost, broken). Today there is no
handover without a declaration from a bound phone of the pair; a supervisor-witnessed fallback would need its own
two-person design. (b) Whether partial handovers (keeping some cash overnight) are allowed; today a handover covers the
pair's whole custody for that business and anything short is a shortage.

## M3 — Business modules

`business_modules` records which module each business offers. Stage 1: **Gadufia SUSU on; STF LOANS and OPWS WELFARE off.**
`createSusuProduct` and `openSusuAccount` need the business's `SUSU` module (`NOT_PERMITTED` with `details.module`).
Switching a module off never strands money: existing accounts keep collecting and paying out. `setBusinessModule` is
SUPER_ADMIN only, with a written reason, audited.

⚠ **Client decision:** whether STF or OPWS run any Susu-style contribution product in the pilot (today: no).

## M4 — Recovering commands whose trigger never ran

Recovery no longer uses the phone's clock. For every bound device Postgres knows the highest processed `seq` and the
gaps; the sweep reads exactly those Firestore commands (`deviceId` + `seq`, composite index in `firestore.indexes.json`)
plus all commands of enrolled-but-unbound phones, and processes any without a result after 10 minutes. It publishes
`dashboards/company/live/commands { unprocessedFound, stillUnprocessed, oldestUnprocessedCreatedAt }` and logs an error
when one has waited over an hour.

## M5 / M7

Cash lists (`listHandovers`, `listWithdrawals`, `listCases`, `listHandoverDeclarations`) take `cursor` and `limit`
(default 50, max 200) and return `nextCursor`. Storage rules now have emulator tests; they found that an uploader could
**overwrite** an inbox image (a photo swap before the server moves it). Fixed: create only when no file exists.

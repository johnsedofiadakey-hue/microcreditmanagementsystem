# ADR-001 — Three businesses on one platform

**Status:** accepted 19 Oct 2026 (decisions by the project owner) · **Owner:** backend

## Context

The client runs three businesses from Aflao (P.O. Box FL 21, Volta Region):

| Code | Business | First module |
|---|---|---|
| `GADUFIA` | Gadufia Fiase Susu Services | Susu (built) |
| `STF` | STF Micro-Credit Services | Loans (Stage 3) |
| `OPWS` | Opportunity People's Welfare Scheme International Association | Welfare (later) |

Until now the platform assumed one company.

## Decisions

1. **One platform, three businesses.** One portal, one agent app and one login. Head office sees all three; every report can be filtered by business.
2. **One shared member profile.** A person registers and passes KYC once, and can hold accounts with any business. Members keep a home branch.
3. **Separate cash per business.** Each business is its own legal entity, so its money is never mixed:
   - every ledger account belongs to exactly one business;
   - **the database refuses a journal batch whose lines touch two businesses**;
   - agent custody, branch cash and branch variance are per (owner, business): a pair holding GH₵ 50 of Susu and GH₵ 20 of welfare cash has two custody balances;
   - handovers, cashier counts and branch closes are per (branch, business), and cases carry their business. The cashier works from one screen with a section per business.
4. **Staff serve all three businesses at their branch.** Roles and branch scoping are unchanged; no per-business claims.
5. **Products belong to a business.** An account inherits its business from its product. Collections post to the custody of the account's business.
6. **SMS per business.** Each business has its own sender ID (≤ 11 characters, registered with the provider and NCA) and the brand name that starts its receipts.

## Consequences

- Migration `006_businesses` adds `businesses`, puts `business_id` on products, ledger accounts, handovers, withdrawals, counts, closes and cases, and assigns everything that exists to `GADUFIA` (all existing data is Susu).
- `createSusuProduct` needs a `businessId`; `bindDevice`, routes and collections are unchanged on the phone.
- A route can mix members of different businesses; the agents' cash for each business is still tracked separately.
- Loans (STF) and welfare (OPWS) reuse this: their products and accounts simply belong to those businesses.

## Not decided yet

- The registered SMS sender IDs (placeholders: `GadufiaSusu`, `STFCredit`, `OPWelfare`).
- Whether each business needs its own bank accounts for Step 7 deposits (assumed yes).

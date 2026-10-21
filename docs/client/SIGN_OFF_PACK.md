# Decisions we need from you — sign-off pack

**For:** Gadufia Fiase Susu Services · STF Micro-Credit Services · Opportunity People's Welfare Scheme International Association
**From:** Stormglide · **Date:** 21 October 2026 · **Version:** 1 (draft for discussion)

The platform's core is working in a test environment: registering members, daily collections on the agent phone, SMS
receipts, cash handover, withdrawals, branch close and bank matching. Before real members and real money go on it,
a few rules must come from you rather than from us. Where we have had to assume something to keep building, the
assumption is shown below. **Nothing here is final until you tick it.**

How to reply: for each item, tick **Agree** or write your answer. One person per business should sign at the end.

Preview of the public website (not yet visible to search engines): **https://gadufia-fiase.web.app**

---

## A. Website content

The website is built. It shows no rates, fees, loan terms or welfare benefits until you approve them.

| # | We need | Your answer |
|---|---|---|
| A1 | Logos for each business (PNG or SVG, the best quality you have) | |
| A2 | Main phone number, and WhatsApp number if different | |
| A3 | Email address for enquiries | |
| A4 | Opening hours | |
| A5 | Directions to the head office (landmark, street) | |
| A6 | List of branches: name, town, directions | |
| A7 | Is there one group name for the three businesses? (The site currently leads with "Gadufia Fiase") | |
| A8 | Approve the wording of every page, or send changes | ☐ Agree ☐ Changes attached |
| A9 | Approve the privacy notice (ideally checked by your data protection adviser) | ☐ Agree ☐ Changes attached |
| A10 | Who calls back website enquiries? (They appear in the portal) | |

## B. Susu product rules (Gadufia Fiase)

| # | Question | What the system assumes today | Your answer |
|---|---|---|---|
| B1 | How long is a Susu cycle (e.g. 31 days)? | No cycle; the balance simply grows | |
| B2 | What is your fee or commission (e.g. one day's contribution per cycle)? How and when is it taken? | No fee is taken | |
| B3 | When may a member withdraw? Any notice or minimum? | Any time, up to the balance, after approval | |
| B4 | Largest single collection an agent may record | GH₵ 10,000 | |
| B5 | Which collection days per product (daily, 6 days a week, weekly, monthly)? | Every product shows on every day's route | |
| B6 | What happens if a member misses days — any catch-up rule? | Nothing; balance is what was paid | |

## C. Approval limits — who may approve what

Every payout and correction already needs two different people (one requests, another approves, a third pays out).
These are the amounts at which head office must approve instead of the branch.

| # | Action | What the system assumes today | Your answer |
|---|---|---|---|
| C1 | Withdrawal: branch manager may approve up to… | GH₵ 5,000; above that SUPER_ADMIN or Finance | |
| C2 | Largest withdrawal accepted at all | GH₵ 100,000 | |
| C3 | Correcting a wrong collection: branch may approve up to… | GH₵ 1,000; above that head office | |
| C4 | Who may change staff roles and these limits? Should a second person approve such changes? | The overall administrator alone | |

## D. Cash rules

| # | Question | What the system assumes today | Your answer |
|---|---|---|---|
| D1 | A member is moved to another agent pair. For how long may the old pair still record that member's payments without it being flagged? | 72 hours | |
| D2 | A pair collects from a member who is not on their route. Record it and flag it for review — or hold it until a supervisor approves? | Record it (the member gets a receipt), open a case for review | |
| D3 | A payment recorded offline arrives after the branch has closed for the day. Count it towards the next day? | Yes — next day; the closed day is never changed | |
| D4 | Both phones of a pair are lost or broken. How should their cash be handed over? | Not possible until a phone is replaced | |
| D5 | May agents keep some cash overnight (partial handover)? | No — the whole amount is handed over; any shortfall is a shortage | |
| D6 | Does each business have its own bank account for deposits? Which bank(s)? | Yes, one per business | |

## E. Running STF and Opportunity Welfare

| # | Question | Your answer |
|---|---|---|
| E1 | Should STF or Opportunity Welfare collect Susu-style contributions during the pilot? (Today: no) | |
| E2 | STF: loan products, interest method, fees, repayment frequency, how decisions are made — please share your current rules or forms | |
| E3 | Opportunity Welfare: contribution amounts, what the scheme pays for, claim process and approvals — please share the association's rules | |
| E4 | Which licences does each business hold (e.g. Bank of Ghana category, association registration)? | |

## F. Providers you will need to contract

We will connect to whichever you choose; we recommend comparing two of each.

| # | Service | Why | Your choice |
|---|---|---|---|
| F1 | SMS provider (e.g. Arkesel, Hubtel, mNotify) | Receipts to members. Each business needs its own registered sender name (max 11 letters) | |
| F2 | Ghana Card verification (NIA-approved verification service) | Confirm each member's identity | |
| F3 | Phone management (MDM) for agent phones | Lock, locate and wipe a lost phone | |
| F4 | Agent phones: model and number of devices | Must run Android 10 or newer | |

## G. Technology choices to accept

Our original blueprint (27 Sep 2026) proposed some technologies. To deliver faster on Google Firebase we changed a
few. None changes how money is protected — the rules are enforced inside the database — but you should know and agree.

| # | Blueprint said | We built | What it means for you | |
|---|---|---|---|---|
| G1 | Separate servers (Cloud Run) for the money system | Firebase Cloud Functions | Same security; simpler to run; can move later | ☐ Accept |
| G2 | Encrypted database inside the agent app | Phone's own encryption plus company phone management (F3) | Relies on managed phones with a screen lock | ☐ Accept |
| G3 | Separate test, trial and live systems from day one | One test system now; live system created before the pilot | Live system will be in one region, with backups and a tested restore | ☐ Accept |

## H. Pilot

| # | Question | Your answer |
|---|---|---|
| H1 | Which branch pilots first? | |
| H2 | Which agent pairs (about 10) and which supervisor, cashier and manager? | |
| H3 | How are member records and balances kept today (books, Excel, another system)? | |
| H4 | Who will sign the opening balances we load for each member? | |
| H5 | Who from each business will test the system before the pilot (2–3 people)? | |

---

## Sign-off

| Business | Name | Role | Signature | Date |
|---|---|---|---|---|
| Gadufia Fiase Susu Services | | | | |
| STF Micro-Credit Services | | | | |
| Opportunity People's Welfare Scheme International Association | | | | |

# Public website (`apps/site`)

Marketing site for Gadufia Fiase Susu Services, STF Micro-Credit Services and Opportunity People's Welfare
Scheme International Association. Owned by the backend session since 21 Oct 2026 (see root `CLAUDE.md`).

```bash
cp apps/site/.env.example apps/site/.env.local
corepack pnpm --filter site dev        # http://localhost:3001
```

- **All business facts** (names, contact details, branches) are in `src/content/site.ts`. A `null` value is
  "not confirmed by the client" and is simply not shown.
- **No rates, fees, loan terms or welfare benefits** appear anywhere until the client signs the business rules.
  STF and OPWS pages invite people to talk to us; they do not offer online applications.
- The only backend call is the enquiry form → `submitEnquiry` (`docs/contracts/API.md` §2). Against the
  emulators it needs the Functions and Firestore emulators running.
- Every page is static; the site can go on App Hosting or Firebase Hosting. Not deployed yet.

# Requests between owners

Add new items at the bottom. The owner of the target path marks them `done` with a short note.

| # | From | To | Request | Why | Status |
|---|---|---|---|---|---|
| 1 | Backend | UI & Audit | Start with the portal shell (sign-in, role-aware navigation) and the agent collection screen, against `docs/contracts/API.md` §1–3 | Auth claims, admin/member callables and the collection command queue are built and tested | open |
| 2 | Backend | UI & Audit | First audit pass on `functions/src/ledger/`, `functions/src/commands/`, `firestore.rules`, `storage.rules` | Steps 1–2 are done; money invariants should get a second pair of eyes before more is built on them | open |

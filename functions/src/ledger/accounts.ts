import type { Queryable } from '../db/types.js';

export type LedgerAccountKind =
  | 'MEMBER_SUSU'
  | 'AGENT_CASH_CUSTODY'
  | 'BRANCH_CASH'
  | 'BRANCH_CASH_VARIANCE'
  | 'OPENING_BALANCE_EQUITY'
  | 'CASH_IN_TRANSIT'
  | 'BANK';

type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
type Side = 'DEBIT' | 'CREDIT';

interface AccountKindDefinition {
  accountType: AccountType;
  normalSide: Side;
  allowNegative: boolean;
}

/**
 * Application chart of accounts. The client's accountant owns the mapping to their general ledger;
 * these kinds are the operational accounts the platform needs to trace cash and member liability.
 */
export const ACCOUNT_KINDS: Record<LedgerAccountKind, AccountKindDefinition> = {
  // What we owe a member. Credit increases it. Can never go below zero.
  MEMBER_SUSU: { accountType: 'LIABILITY', normalSide: 'CREDIT', allowNegative: false },
  // Cash physically held by an agent pair between collection and handover.
  AGENT_CASH_CUSTODY: { accountType: 'ASSET', normalSide: 'DEBIT', allowNegative: false },
  // Cash physically held by the branch cashier.
  BRANCH_CASH: { accountType: 'ASSET', normalSide: 'DEBIT', allowNegative: false },
  // Unexplained shortages (debit) or overages (credit) found at handover or close.
  BRANCH_CASH_VARIANCE: { accountType: 'EXPENSE', normalSide: 'DEBIT', allowNegative: true },
  // Counterpart for balances migrated from the client's previous records.
  OPENING_BALANCE_EQUITY: { accountType: 'EQUITY', normalSide: 'CREDIT', allowNegative: true },
  // Cash taken from a branch vault to the bank, until the bank statement shows it arrived (Step 7).
  CASH_IN_TRANSIT: { accountType: 'ASSET', normalSide: 'DEBIT', allowNegative: false },
  // A business's bank account, moved only by matched statement lines (Step 7).
  BANK: { accountType: 'ASSET', normalSide: 'DEBIT', allowNegative: false },
};

export interface EnsureAccountInput {
  kind: LedgerAccountKind;
  ownerId: string | null;
  branchId: string | null;
  /** Every account belongs to one business (ADR-001); a batch never mixes two. */
  businessId: string;
  name: string;
}

/** Create the ledger account for an owner and business (with a zero balance row) or return the existing one. */
export async function ensureLedgerAccount(tx: Queryable, input: EnsureAccountInput): Promise<string> {
  const definition = ACCOUNT_KINDS[input.kind];
  const existing = await findLedgerAccountId(tx, input.kind, input.ownerId, input.businessId);
  if (existing) return existing;

  const created = await tx.query<{ id: string }>(
    `insert into ledger_accounts (kind, owner_id, branch_id, business_id, name, account_type, normal_side, allow_negative)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict do nothing
     returning id`,
    [
      input.kind,
      input.ownerId,
      input.branchId,
      input.businessId,
      input.name,
      definition.accountType,
      definition.normalSide,
      definition.allowNegative,
    ],
  );
  const id = created.rows[0]?.id;
  // Another transaction created it a moment ago: use theirs.
  if (!id) return (await findLedgerAccountId(tx, input.kind, input.ownerId, input.businessId))!;
  await tx.query('insert into account_balances (account_id) values ($1)', [id]);
  return id;
}

export async function findLedgerAccountId(
  tx: Queryable,
  kind: LedgerAccountKind,
  ownerId: string | null,
  businessId: string,
): Promise<string | null> {
  const result = await tx.query<{ id: string }>(
    `select id from ledger_accounts
      where kind = $1 and coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid)
                        = coalesce($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
        and business_id = $3`,
    [kind, ownerId, businessId],
  );
  return result.rows[0]?.id ?? null;
}

export async function getBalance(tx: Queryable, accountId: string): Promise<number> {
  const result = await tx.query<{ balance_pesewas: number }>(
    'select balance_pesewas from account_balances where account_id = $1',
    [accountId],
  );
  if (!result.rows[0]) throw new Error(`No balance row for ledger account ${accountId}`);
  return result.rows[0].balance_pesewas;
}

type CashKind = 'AGENT_CASH_CUSTODY' | 'BRANCH_CASH' | 'BRANCH_CASH_VARIANCE' | 'CASH_IN_TRANSIT';

/**
 * The cash account of a pair (custody) or branch (vault, variance) for one business, created on first
 * use. Branches and pairs get these for every business when created; this covers businesses added later.
 */
export async function ensureCashAccount(tx: Queryable, kind: CashKind, ownerId: string, businessId: string): Promise<string> {
  const existing = await findLedgerAccountId(tx, kind, ownerId, businessId);
  if (existing) return existing;
  const owner =
    kind === 'AGENT_CASH_CUSTODY'
      ? (await tx.query<{ name: string; branch_id: string }>('select name, branch_id from agent_pairs where id = $1', [ownerId])).rows[0]
      : (await tx.query<{ name: string; branch_id: string }>('select name, id as branch_id from branches where id = $1', [ownerId])).rows[0];
  if (!owner) throw new Error(`No owner ${ownerId} for a ${kind} account`);
  const business = (await tx.query<{ code: string }>('select code from businesses where id = $1', [businessId])).rows[0];
  if (!business) throw new Error(`Unknown business ${businessId}`);
  const label =
    kind === 'AGENT_CASH_CUSTODY' ? 'cash custody' : kind === 'BRANCH_CASH' ? 'cash' : kind === 'CASH_IN_TRANSIT' ? 'cash in transit to bank' : 'cash variance';
  return ensureLedgerAccount(tx, { kind, ownerId, branchId: owner.branch_id, businessId, name: `${owner.name} ${label} · ${business.code}` });
}

/** Active businesses, for creating every business's cash accounts up front. */
export async function activeBusinessIds(tx: Queryable): Promise<string[]> {
  return (await tx.query<{ id: string }>(`select id from businesses where status = 'ACTIVE' order by code`)).rows.map((r) => r.id);
}

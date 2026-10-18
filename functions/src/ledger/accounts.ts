import type { Queryable } from '../db/types.js';

export type LedgerAccountKind =
  | 'MEMBER_SUSU'
  | 'AGENT_CASH_CUSTODY'
  | 'BRANCH_CASH'
  | 'BRANCH_CASH_VARIANCE'
  | 'OPENING_BALANCE_EQUITY';

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
};

export interface EnsureAccountInput {
  kind: LedgerAccountKind;
  ownerId: string | null;
  branchId: string | null;
  name: string;
}

/** Create the ledger account for an owner (with a zero balance row) or return the existing one. */
export async function ensureLedgerAccount(tx: Queryable, input: EnsureAccountInput): Promise<string> {
  const definition = ACCOUNT_KINDS[input.kind];
  const existing = await tx.query<{ id: string }>(
    `select id from ledger_accounts
      where kind = $1 and coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid)
                        = coalesce($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)`,
    [input.kind, input.ownerId],
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const created = await tx.query<{ id: string }>(
    `insert into ledger_accounts (kind, owner_id, branch_id, name, account_type, normal_side, allow_negative)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id`,
    [
      input.kind,
      input.ownerId,
      input.branchId,
      input.name,
      definition.accountType,
      definition.normalSide,
      definition.allowNegative,
    ],
  );
  const id = created.rows[0]!.id;
  await tx.query('insert into account_balances (account_id) values ($1)', [id]);
  return id;
}

export async function findLedgerAccountId(
  tx: Queryable,
  kind: LedgerAccountKind,
  ownerId: string | null,
): Promise<string | null> {
  const result = await tx.query<{ id: string }>(
    `select id from ledger_accounts
      where kind = $1 and coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid)
                        = coalesce($2::uuid, '00000000-0000-0000-0000-000000000000'::uuid)`,
    [kind, ownerId],
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

import type { BankAccountSummary, CreateBankAccountRequest, Role } from '@susu/shared';
import type { Queryable } from '../db/types.js';
import { ensureLedgerAccount } from '../ledger/accounts.js';
import type { Actor } from '../lib/actor.js';
import { writeAudit } from '../lib/audit.js';
import { DomainError } from '../lib/errors.js';
import { requireRole } from '../lib/permissions.js';
import { requireBusiness } from '../cash/common.js';

export const BANK_ADMINS: readonly Role[] = ['SUPER_ADMIN', 'FINANCE'];
/** Branch staff need the list to choose where they deposited. */
export const BANK_ACCOUNT_READERS: readonly Role[] = ['SUPER_ADMIN', 'FINANCE', 'COMPLIANCE', 'BRANCH_MANAGER', 'CASHIER'];

export async function createBankAccount(tx: Queryable, actor: Actor, input: CreateBankAccountRequest): Promise<{ bankAccountId: string }> {
  requireRole(actor, BANK_ADMINS);
  const business = await requireBusiness(tx, input.businessId);
  const clash = await tx.query('select 1 from bank_accounts where business_id = $1 and bank_name = $2 and account_number_last4 = $3', [
    business.id,
    input.bankName,
    input.accountNumberLast4,
  ]);
  if (clash.rowCount > 0) throw new DomainError('CONFLICT', 'This bank account is already registered for the business');

  const id = (await tx.query<{ id: string }>('select gen_random_uuid() as id')).rows[0]!.id;
  const ledgerAccountId = await ensureLedgerAccount(tx, {
    kind: 'BANK',
    ownerId: id,
    branchId: null,
    businessId: business.id,
    name: `${input.bankName} ••${input.accountNumberLast4} · ${business.code}`,
  });
  await tx.query(
    `insert into bank_accounts (id, business_id, bank_name, account_name, account_number_last4, ledger_account_id, created_by)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [id, business.id, input.bankName, input.accountName, input.accountNumberLast4, ledgerAccountId, actor.uid],
  );
  await writeAudit(tx, {
    actorUid: actor.uid,
    action: 'bank_account.created',
    entityKind: 'bank_account',
    entityId: id,
    channel: actor.channel,
    data: { businessId: business.id, bankName: input.bankName, accountNumberLast4: input.accountNumberLast4 },
  });
  return { bankAccountId: id };
}

export async function listBankAccounts(q: Queryable, actor: Actor, input: { businessId?: string }): Promise<{ bankAccounts: BankAccountSummary[] }> {
  requireRole(actor, BANK_ACCOUNT_READERS);
  const rows = await q.query<{
    id: string;
    business_id: string;
    bank_name: string;
    account_name: string;
    account_number_last4: string;
    status: 'ACTIVE' | 'CLOSED';
    balance_pesewas: number;
  }>(
    `select a.id, a.business_id, a.bank_name, a.account_name, a.account_number_last4, a.status, b.balance_pesewas
       from bank_accounts a join account_balances b on b.account_id = a.ledger_account_id
      where $1::uuid is null or a.business_id = $1
      order by a.status, a.bank_name, a.account_number_last4`,
    [input.businessId ?? null],
  );
  return {
    bankAccounts: rows.rows.map((r) => ({
      id: r.id,
      businessId: r.business_id,
      bankName: r.bank_name,
      accountName: r.account_name,
      accountNumberLast4: r.account_number_last4,
      status: r.status,
      balancePesewas: r.balance_pesewas,
    })),
  };
}

export interface BankAccountRow {
  id: string;
  businessId: string;
  status: string;
  ledgerAccountId: string;
  label: string;
}

export async function getBankAccount(q: Queryable, bankAccountId: string, lock = false): Promise<BankAccountRow> {
  const row = (
    await q.query<{ id: string; business_id: string; status: string; ledger_account_id: string; bank_name: string; account_number_last4: string }>(
      `select id, business_id, status, ledger_account_id, bank_name, account_number_last4 from bank_accounts where id = $1${lock ? ' for update' : ''}`,
      [bankAccountId],
    )
  ).rows[0];
  if (!row) throw new DomainError('NOT_FOUND', 'Bank account not found');
  return {
    id: row.id,
    businessId: row.business_id,
    status: row.status,
    ledgerAccountId: row.ledger_account_id,
    label: `${row.bank_name} ••${row.account_number_last4}`,
  };
}

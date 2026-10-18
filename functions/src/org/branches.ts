import type { CreateBranchRequest } from '@susu/shared';
import type { Queryable } from '../db/types.js';
import { ensureLedgerAccount } from '../ledger/accounts.js';
import type { Actor } from '../lib/actor.js';
import { writeAudit } from '../lib/audit.js';
import { DomainError } from '../lib/errors.js';
import { requireRole } from '../lib/permissions.js';

export async function createBranch(tx: Queryable, actor: Actor, input: CreateBranchRequest): Promise<{ branchId: string }> {
  requireRole(actor, ['SUPER_ADMIN']);

  const clash = await tx.query('select 1 from branches where code = $1', [input.code]);
  if (clash.rowCount > 0) throw new DomainError('CONFLICT', `Branch code ${input.code} is already used`);

  const created = await tx.query<{ id: string }>(
    'insert into branches (code, name, created_by) values ($1, $2, $3) returning id',
    [input.code, input.name, actor.uid],
  );
  const branchId = created.rows[0]!.id;

  await ensureLedgerAccount(tx, { kind: 'BRANCH_CASH', ownerId: branchId, branchId, name: `${input.name} cash` });
  await ensureLedgerAccount(tx, {
    kind: 'BRANCH_CASH_VARIANCE',
    ownerId: branchId,
    branchId,
    name: `${input.name} cash variance`,
  });

  await writeAudit(tx, {
    actorUid: actor.uid,
    action: 'branch.created',
    entityKind: 'branch',
    entityId: branchId,
    branchId,
    channel: actor.channel,
    data: { code: input.code, name: input.name },
  });
  return { branchId };
}

import { formatCedis, type CollectionCommand } from '@susu/shared';
import type { Queryable } from '../db/types.js';
import { openCase, today } from '../cash/common.js';
import { ensureCashAccount } from '../ledger/accounts.js';
import { routeStatusFor, type RouteStatus } from '../routes/routes.js';
import { postJournal } from '../ledger/post.js';
import { writeAudit } from '../lib/audit.js';
import { DomainError } from '../lib/errors.js';
import type { BoundDevice } from '../org/devices.js';

export interface CollectionPosted {
  batchId: string;
  postedAt: string;
  routeStatus: RouteStatus;
  /** The cash day it counts towards: today, or the next day when today's close already happened (H2). */
  cashDay: string;
  postedAfterClose: boolean;
}

/** The day after an ISO yyyy-mm-dd date. */
function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * A member paid cash to an agent pair. The member gave real cash and gets a receipt, so a valid signed
 * collection always posts; the controls decide how it is labelled and who must look at it:
 *   - route (audit H1): ON_ROUTE, PREVIOUS_ROUTE (captured before a recent reassignment) or OFF_ROUTE,
 *     which opens an OFF_ROUTE_COLLECTION case for the branch;
 *   - cash day (audit H2): if this business's branch day already closed, the collection counts towards
 *     the next day; the closed day stays as it was frozen.

 *   Debit  AGENT_CASH_CUSTODY (the pair now holds the cash — its custody for the account's business)
 *   Credit MEMBER_SUSU        (the company now owes the member)
 * Runs inside the caller's transaction together with the command record, audit and SMS outbox.
 */
export async function postCollection(
  tx: Queryable,
  commandId: string,
  command: CollectionCommand,
  device: BoundDevice,
): Promise<CollectionPosted> {
  const { memberId, susuAccountId, amountPesewas } = command.payload;

  const accountResult = await tx.query<{
    member_id: string;
    branch_id: string;
    status: string;
    ledger_account_id: string;
    member_status: string;
    phone: string;
    full_name: string;
    business_id: string;
    sms_brand: string;
    sms_sender_id: string;
  }>(
    `select s.member_id, s.branch_id, s.status, s.ledger_account_id, m.status as member_status, m.phone, m.full_name,
            p.business_id, b.sms_brand, b.sms_sender_id
       from susu_accounts s
       join members m on m.id = s.member_id
       join susu_products p on p.id = s.product_id
       join businesses b on b.id = p.business_id
      where s.id = $1`,
    [susuAccountId],
  );
  const account = accountResult.rows[0];
  if (!account) throw new DomainError('ACCOUNT_NOT_FOUND', 'Susu account not found');
  if (account.member_id !== memberId) {
    throw new DomainError('INVALID_COMMAND', 'This Susu account does not belong to the selected member');
  }
  if (account.branch_id !== device.branchId) {
    throw new DomainError('ACCOUNT_OUTSIDE_BRANCH', 'This member belongs to a different branch');
  }
  if (account.member_status !== 'ACTIVE') {
    throw new DomainError('MEMBER_NOT_ACTIVE', `Member is ${account.member_status}`);
  }
  if (account.status !== 'ACTIVE') throw new DomainError('ACCOUNT_NOT_ACTIVE', `Susu account is ${account.status}`);

  // Serialise with a branch close (which locks the branch row for update) so a collection lands either
  // before the close is frozen or clearly after it.
  await tx.query('select 1 from branches where id = $1 for share', [device.branchId]);
  const day = today();
  const closedToday = await tx.query('select 1 from branch_closes where branch_id = $1 and business_id = $2 and day = $3', [
    device.branchId,
    account.business_id,
    day,
  ]);
  const postedAfterClose = closedToday.rowCount > 0;
  const cashDay = postedAfterClose ? nextDay(day) : day;
  const routeStatus = await routeStatusFor(tx, { susuAccountId, agentPairId: device.agentPairId, capturedAt: command.capturedAt });

  // The pair's custody for this account's business: each business's cash is tracked apart (ADR-001).
  const custodyAccountId = await ensureCashAccount(tx, 'AGENT_CASH_CUSTODY', device.agentPairId, account.business_id);

  const posting = await postJournal(tx, {
    idempotencyKey: `cmd:${commandId}`,
    kind: 'SUSU_COLLECTION',
    description: `Susu collection from ${account.full_name}`,
    branchId: device.branchId,
    actorUid: device.agentUid,
    deviceId: device.id,
    channel: 'AGENT_APP',
    lines: [
      { accountId: custodyAccountId, side: 'DEBIT', amountPesewas },
      { accountId: account.ledger_account_id, side: 'CREDIT', amountPesewas },
    ],
  });

  const caseId =
    routeStatus === 'OFF_ROUTE'
      ? await openCase(tx, {
          branchId: device.branchId,
          businessId: account.business_id,
          kind: 'OFF_ROUTE_COLLECTION',
          amountPesewas,
          summary: `${formatCedis(amountPesewas)} collected from ${account.full_name} by a pair this account is not assigned to`,
          entityKind: 'collection',
          entityId: commandId,
          openedBy: 'SYSTEM',
        })
      : null;

  await tx.query(
    `insert into collections
       (id, member_id, susu_account_id, agent_pair_id, branch_id, agent_uid, device_id, amount_pesewas, captured_at, batch_id,
        business_id, cash_day, route_status, posted_after_close, case_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      commandId,
      memberId,
      susuAccountId,
      device.agentPairId,
      device.branchId,
      device.agentUid,
      device.id,
      amountPesewas,
      command.capturedAt,
      posting.batchId,
      account.business_id,
      cashDay,
      routeStatus,
      postedAfterClose,
      caseId,
    ],
  );

  const balance = await tx.query<{ balance_pesewas: number }>(
    'select balance_pesewas from account_balances where account_id = $1',
    [account.ledger_account_id],
  );

  await tx.query(
    `insert into outbox (kind, dedupe_key, payload) values ('SMS', $1, $2)`,
    [
      `sms:collection:${commandId}`,
      JSON.stringify({
        to: account.phone,
        template: 'COLLECTION_RECEIPT',
        brand: account.sms_brand,
        senderId: account.sms_sender_id,
        values: {
          amount: formatCedis(amountPesewas),
          balance: formatCedis(balance.rows[0]!.balance_pesewas),
          reference: posting.batchId.slice(0, 8).toUpperCase(),
          postedAt: posting.postedAt,
        },
      }),
    ],
  );

  await writeAudit(tx, {
    actorUid: device.agentUid,
    action: 'collection.posted',
    entityKind: 'collection',
    entityId: commandId,
    branchId: device.branchId,
    deviceId: device.id,
    channel: 'AGENT_APP',
    data: { memberId, susuAccountId, amountPesewas, batchId: posting.batchId, routeStatus, cashDay, postedAfterClose, caseId },
  });

  return { batchId: posting.batchId, postedAt: posting.postedAt, routeStatus, cashDay, postedAfterClose };
}

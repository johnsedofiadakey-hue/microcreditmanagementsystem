import type { BusinessModule, SetBusinessModuleRequest } from '@susu/shared';
import type { Queryable } from '../db/types.js';
import type { Actor } from '../lib/actor.js';
import { writeAudit } from '../lib/audit.js';
import { DomainError } from '../lib/errors.js';
import { requireRole } from '../lib/permissions.js';

/**
 * Which business offers which module (audit M3, REQUESTS #29). Stage 1 switches on only Gadufia's Susu;
 * STF loans and OPWS welfare stay off until their stages and policies are approved by the client.
 * Existing accounts keep collecting and paying out when a module is switched off — only new products and
 * new accounts are refused — so no member's money is stranded.
 */
export async function requireModule(tx: Queryable, businessId: string, module: BusinessModule): Promise<void> {
  const row = (
    await tx.query<{ enabled: boolean }>('select enabled from business_modules where business_id = $1 and module = $2', [businessId, module])
  ).rows[0];
  if (!row?.enabled) {
    throw new DomainError('NOT_PERMITTED', `The ${module.toLowerCase()} module is not switched on for this business`, {
      module,
      businessId,
    });
  }
}

/** Switch a module on or off for a business. SUPER_ADMIN only, with a written reason; audited. */
export async function setBusinessModule(tx: Queryable, actor: Actor, input: SetBusinessModuleRequest): Promise<void> {
  requireRole(actor, ['SUPER_ADMIN']);
  const business = await tx.query('select 1 from businesses where id = $1', [input.businessId]);
  if (business.rowCount === 0) throw new DomainError('NOT_FOUND', 'Business not found');
  const previous = (
    await tx.query<{ enabled: boolean }>('select enabled from business_modules where business_id = $1 and module = $2 for update', [
      input.businessId,
      input.module,
    ])
  ).rows[0];
  await tx.query(
    `insert into business_modules (business_id, module, enabled, changed_by, reason) values ($1, $2, $3, $4, $5)
     on conflict (business_id, module) do update
        set enabled = excluded.enabled, changed_by = excluded.changed_by, changed_at = now(), reason = excluded.reason`,
    [input.businessId, input.module, input.enabled, actor.uid, input.reason],
  );
  await writeAudit(tx, {
    actorUid: actor.uid,
    action: input.enabled ? 'business_module.enabled' : 'business_module.disabled',
    entityKind: 'business',
    entityId: input.businessId,
    channel: actor.channel,
    data: { module: input.module, previouslyEnabled: previous?.enabled ?? null, reason: input.reason },
  });
}

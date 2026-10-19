import { authClaimsSchema } from '@susu/shared';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import type { SecretParam } from 'firebase-functions/params';
import type { z } from 'zod';
import type { Database } from '../db/types.js';
import type { Actor } from '../lib/actor.js';
import { isDomainError } from '../lib/errors.js';
import { assertStaffActive } from '../org/staff.js';
import { DATABASE_URL, REGION, getDatabase } from '../runtime.js';

const STATUS_BY_REASON: Record<string, ConstructorParameters<typeof HttpsError>[0]> = {
  NOT_PERMITTED: 'permission-denied',
  STAFF_NOT_ACTIVE: 'permission-denied',
  AGENT_NOT_IN_PAIR: 'failed-precondition',
  AGENT_NOT_ACTIVE: 'failed-precondition',
  DEVICE_NOT_ENROLLED: 'failed-precondition',
  DEVICE_AGENT_MISMATCH: 'failed-precondition',
  SELF_APPROVAL_FORBIDDEN: 'permission-denied',
  NOT_FOUND: 'not-found',
  MEMBER_NOT_FOUND: 'not-found',
  ACCOUNT_NOT_FOUND: 'not-found',
  CONFLICT: 'already-exists',
  INSUFFICIENT_BALANCE: 'failed-precondition',
  MEMBER_NOT_ACTIVE: 'failed-precondition',
  ACCOUNT_NOT_ACTIVE: 'failed-precondition',
  ALREADY_REVERSED: 'failed-precondition',
  BRANCH_DAY_CLOSED: 'failed-precondition',
  APPROVAL_LIMIT_EXCEEDED: 'permission-denied',
  EXPECTED_CASH_CHANGED: 'aborted',
};

/**
 * Wraps a portal action: verifies App Check and auth, parses claims and input with Zod, checks the
 * live staff record (active, same role and branches as the token), runs the handler, and turns DomainErrors into typed HttpsErrors (`details.reason` carries the reason code).
 */
export function staffCallable<S extends z.ZodType, R>(
  schema: S,
  handler: (ctx: { db: Database; actor: Actor; input: z.output<S>; request: CallableRequest }) => Promise<R>,
  options: { secrets?: SecretParam[] } = {},
) {
  return onCall({ region: REGION, enforceAppCheck: true, secrets: [DATABASE_URL, ...(options.secrets ?? [])] }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first');
    const claims = authClaimsSchema.safeParse(request.auth.token);
    if (!claims.success) throw new HttpsError('permission-denied', 'Your account has no role assigned');

    const input = schema.safeParse(request.data);
    if (!input.success) {
      throw new HttpsError('invalid-argument', 'Some fields are invalid', {
        reason: 'INVALID_COMMAND',
        issues: input.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    const actor: Actor = { uid: request.auth.uid, claims: claims.data, channel: 'PORTAL' };
    try {
      const db = getDatabase();
      await assertStaffActive(db, actor);
      return await handler({ db, actor, input: input.data, request });
    } catch (error) {
      if (isDomainError(error)) {
        throw new HttpsError(STATUS_BY_REASON[error.reason] ?? 'failed-precondition', error.message, {
          reason: error.reason,
          ...error.details,
        });
      }
      logger.error('Callable failed', { uid: request.auth.uid, error });
      throw new HttpsError('internal', 'Something went wrong. Please try again.');
    }
  });
}

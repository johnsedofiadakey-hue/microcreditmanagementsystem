import { isHeadOffice, type Role } from '@susu/shared';
import type { Actor } from '../lib/actor.js';
import { DomainError } from '../lib/errors.js';
import { requireBranch, requireRole } from '../lib/permissions.js';

/** Every staff role except agents, who read only their own Firestore projections. */
export const STAFF_READERS: readonly Role[] = ['SUPER_ADMIN', 'FINANCE', 'COMPLIANCE', 'BRANCH_MANAGER', 'CASHIER', 'SUPERVISOR'];

/**
 * Which branches a list may include: `null` = every branch (head office, no filter), otherwise the
 * explicit branch (checked) or the caller's own branches.
 */
export function branchScope(actor: Actor, branchId: string | undefined, allowed: readonly Role[] = STAFF_READERS): string[] | null {
  requireRole(actor, allowed);
  if (branchId) {
    requireBranch(actor, branchId);
    return [branchId];
  }
  if (isHeadOffice(actor.claims.role)) return null;
  if (actor.claims.branchIds.length === 0) throw new DomainError('NOT_PERMITTED', 'Your account has no branch');
  return actor.claims.branchIds;
}

/** Keyset pagination: an opaque cursor carrying the last row's sort key and id. */
export interface Cursor {
  k: string;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCursor(value: string | null | undefined): Cursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<Cursor>;
    if (typeof parsed.k === 'string' && typeof parsed.id === 'string') return { k: parsed.k, id: parsed.id };
  } catch {
    // fall through
  }
  throw new DomainError('INVALID_COMMAND', 'Invalid page cursor');
}

/** Fetch `limit + 1` rows; if the extra row exists there is a next page. */
export function pageOf<T>(rows: T[], limit: number, cursorOf: (row: T) => Cursor): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(cursorOf(last)) : null };
}

export const iso = (value: Date | string | null): string | null => (value === null ? null : new Date(value).toISOString());

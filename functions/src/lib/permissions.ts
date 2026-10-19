import { canAccessBranch, type Role } from '@susu/shared';
import type { Actor } from './actor.js';
import { DomainError } from './errors.js';

export function requireRole(actor: Actor, allowed: readonly Role[]): void {
  if (!allowed.includes(actor.claims.role)) {
    throw new DomainError('NOT_PERMITTED', `Role ${actor.claims.role} cannot perform this action`);
  }
}

export function requireBranch(actor: Actor, branchId: string): void {
  if (!canAccessBranch(actor.claims, branchId)) {
    throw new DomainError('NOT_PERMITTED', 'You do not have access to this branch');
  }
}

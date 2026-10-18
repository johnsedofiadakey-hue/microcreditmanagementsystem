import { z } from 'zod';

export const ROLES = [
  'SUPER_ADMIN', // "Overall administrator" in the client guide
  'FINANCE',
  'COMPLIANCE',
  'BRANCH_MANAGER',
  'CASHIER',
  'SUPERVISOR',
  'AGENT',
] as const;

export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

/** Roles that see every branch. */
export const HEAD_OFFICE_ROLES: readonly Role[] = ['SUPER_ADMIN', 'FINANCE', 'COMPLIANCE'];

/** Shape of Firebase Auth custom claims set by the backend. */
export const authClaimsSchema = z.object({
  role: roleSchema,
  branchIds: z.array(z.uuid()),
  agentPairId: z.uuid().optional(),
});
export type AuthClaims = z.infer<typeof authClaimsSchema>;

export function isHeadOffice(role: Role): boolean {
  return HEAD_OFFICE_ROLES.includes(role);
}

export function canAccessBranch(claims: AuthClaims, branchId: string): boolean {
  return isHeadOffice(claims.role) || claims.branchIds.includes(branchId);
}

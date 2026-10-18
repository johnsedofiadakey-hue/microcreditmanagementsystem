import { z } from 'zod';
import { roleSchema } from './roles.js';
import { susuFrequencySchema } from './enums.js';

/** Request bodies for portal callable functions. Names match `docs/contracts/API.md`. */

export const createBranchRequestSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,12}$/, 'Use 2–12 letters, digits or hyphens'),
});
export type CreateBranchRequest = z.infer<typeof createBranchRequestSchema>;

export const createStaffUserRequestSchema = z.object({
  email: z.email(),
  displayName: z.string().trim().min(2).max(120),
  role: roleSchema,
  branchIds: z.array(z.uuid()).max(50),
});
export type CreateStaffUserRequest = z.infer<typeof createStaffUserRequestSchema>;

export const createAgentPairRequestSchema = z.object({
  branchId: z.uuid(),
  name: z.string().trim().min(2).max(120),
  agentAUid: z.string().min(1).max(128),
  agentBUid: z.string().min(1).max(128),
});
export type CreateAgentPairRequest = z.infer<typeof createAgentPairRequestSchema>;

export const bindDeviceRequestSchema = z.object({
  deviceId: z.string().min(1).max(128),
  agentUid: z.string().min(1).max(128),
  agentPairId: z.uuid(),
  label: z.string().trim().max(120).optional(),
});
export type BindDeviceRequest = z.infer<typeof bindDeviceRequestSchema>;

export const revokeDeviceRequestSchema = z.object({
  deviceId: z.string().min(1).max(128),
  reason: z.string().trim().min(3).max(500),
});
export type RevokeDeviceRequest = z.infer<typeof revokeDeviceRequestSchema>;

/** Ghana Card PIN format: GHA-123456789-0 */
export const ghanaCardNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^GHA-\d{9}-\d$/, 'Ghana Card number must look like GHA-123456789-0');

/** Ghana mobile numbers stored in E.164: +233 followed by 9 digits. */
export const ghanaPhoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .transform((v) => (v.startsWith('0') ? `+233${v.slice(1)}` : v))
  .pipe(z.string().regex(/^\+233\d{9}$/, 'Phone must be a Ghana number like 024 123 4567'));

export const registerMemberRequestSchema = z.object({
  branchId: z.uuid(),
  fullName: z.string().trim().min(2).max(160),
  phone: ghanaPhoneSchema,
  ghanaCardNumber: ghanaCardNumberSchema,
  dateOfBirth: z.iso.date(),
  /** Storage paths under kyc-inbox/ for photos captured at registration. */
  photoPaths: z.array(z.string().max(512)).max(6).default([]),
  consentGiven: z.literal(true),
});
export type RegisterMemberRequest = z.input<typeof registerMemberRequestSchema>;

export const approveMemberRequestSchema = z.object({
  memberId: z.uuid(),
});
export type ApproveMemberRequest = z.infer<typeof approveMemberRequestSchema>;

export const createSusuProductRequestSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,24}$/),
  name: z.string().trim().min(2).max(120),
  frequency: susuFrequencySchema,
});
export type CreateSusuProductRequest = z.infer<typeof createSusuProductRequestSchema>;

export const openSusuAccountRequestSchema = z.object({
  memberId: z.uuid(),
  productId: z.uuid(),
});
export type OpenSusuAccountRequest = z.infer<typeof openSusuAccountRequestSchema>;

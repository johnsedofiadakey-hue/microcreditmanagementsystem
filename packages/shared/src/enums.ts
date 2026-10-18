import { z } from 'zod';

export const channelSchema = z.enum(['PORTAL', 'AGENT_APP', 'USSD', 'SMS', 'SYSTEM']);
export type Channel = z.infer<typeof channelSchema>;

export const memberStatusSchema = z.enum(['PENDING_APPROVAL', 'ACTIVE', 'RESTRICTED', 'REJECTED', 'CLOSED']);
export type MemberStatus = z.infer<typeof memberStatusSchema>;

export const kycStatusSchema = z.enum([
  'DRAFT',
  'VERIFIED',
  'RETRY_REQUIRED',
  'EXCEPTION',
  'RESTRICTED',
  'REJECTED',
  'EXPIRED',
]);
export type KycStatus = z.infer<typeof kycStatusSchema>;

export const susuFrequencySchema = z.enum(['DAILY', 'WEEKLY', 'MONTHLY']);
export type SusuFrequency = z.infer<typeof susuFrequencySchema>;

export const commandStatusSchema = z.enum(['POSTED', 'REJECTED', 'FAILED']);
export type CommandStatus = z.infer<typeof commandStatusSchema>;

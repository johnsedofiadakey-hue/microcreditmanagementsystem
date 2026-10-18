import { z } from 'zod';
import { positivePesewasSchema } from './money.js';

/**
 * Agent app commands. The agent app writes these to Firestore `commands/{clientUuid}`; the document
 * ID is a UUID v4 generated once per action and reused on every retry. Firestore's offline cache
 * holds them until the phone reconnects. The server derives agent pair and branch from the device
 * binding and never trusts them from the client.
 */
export const COLLECTION_MAX_PESEWAS = 1_000_000; // GH₵ 10,000.00 per collection until product rules say otherwise

const envelope = {
  agentUid: z.string().min(1).max(128),
  deviceId: z.string().min(1).max(128),
  /** Per-device counter starting at 1, incremented for every command. */
  seq: z.int().min(1),
  /** Phone clock at capture, ISO 8601. Recorded as evidence only; server time is official. */
  capturedAt: z.iso.datetime({ offset: true }),
  appVersion: z.string().min(1).max(32),
};

export const collectionCommandSchema = z.object({
  type: z.literal('COLLECTION'),
  ...envelope,
  payload: z.object({
    memberId: z.uuid(),
    susuAccountId: z.uuid(),
    amountPesewas: positivePesewasSchema.max(COLLECTION_MAX_PESEWAS),
  }),
});
export type CollectionCommand = z.infer<typeof collectionCommandSchema>;

export const agentCommandSchema = z.discriminatedUnion('type', [collectionCommandSchema]);
export type AgentCommand = z.infer<typeof agentCommandSchema>;
export type AgentCommandType = AgentCommand['type'];

/** Fields the server adds to `commands/{id}` after processing. Clients must never write these. */
export const commandResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('POSTED'),
    postingId: z.uuid(),
    serverTime: z.iso.datetime({ offset: true }),
  }),
  z.object({
    status: z.literal('REJECTED'),
    reason: z.string(),
    message: z.string(),
    serverTime: z.iso.datetime({ offset: true }),
  }),
  z.object({
    status: z.literal('FAILED'),
    message: z.string(),
    serverTime: z.iso.datetime({ offset: true }),
  }),
]);
export type CommandResult = z.infer<typeof commandResultSchema>;

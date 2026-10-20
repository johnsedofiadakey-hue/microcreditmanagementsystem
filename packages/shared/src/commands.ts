import { z } from 'zod';
import { canonicalJson } from './canonical';
import { pesewasSchema, positivePesewasSchema } from './money';

/**
 * Agent app commands. The agent app writes these to Firestore `commands/{clientUuid}`; the document
 * ID is a UUID v4 generated once per action and reused on every retry. Firestore's offline cache
 * holds them until the phone reconnects. The server derives agent pair and branch from the device
 * binding and never trusts them from the client.
 *
 * Every command is signed by a non-exportable Android Keystore key created when the app is installed
 * (see `commandSigningString`). The public key is enrolled in `deviceEnrollments/{deviceId}` and
 * captured by `bindDevice`; a command whose signature does not verify is rejected.
 */
export const COLLECTION_MAX_PESEWAS = 1_000_000; // GH₵ 10,000.00 per collection until product rules say otherwise
/** Largest single business line on a handover declaration: GH₵ 1,000,000.00. */
export const HANDOVER_DECLARATION_MAX_PESEWAS = 100_000_000;

const envelope = {
  agentUid: z.string().min(1).max(128),
  deviceId: z.string().min(1).max(128),
  /** Per-device counter starting at 1, incremented for every command. */
  seq: z.int().min(1),
  /** Phone clock at capture, ISO 8601. Recorded as evidence only; server time is official. */
  capturedAt: z.iso.datetime({ offset: true }),
  appVersion: z.string().min(1).max(32),
  /** Base64 DER-encoded ECDSA P-256 / SHA-256 signature over `commandSigningString`. */
  sig: z.base64().min(16).max(200),
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

/**
 * The agent pair declares the cash it is handing to the branch cashier (audit H3). One line per
 * business with cash; amounts are what the agents counted. Moves no money: the cashier then confirms
 * each line independently with `confirmHandover`. The command ID is the declaration ID.
 */
export const handoverDeclarationCommandSchema = z.object({
  type: z.literal('HANDOVER_DECLARATION'),
  ...envelope,
  payload: z.object({
    lines: z
      .array(
        z.object({
          businessId: z.uuid(),
          declaredPesewas: pesewasSchema.max(HANDOVER_DECLARATION_MAX_PESEWAS),
        }),
      )
      .min(1)
      .max(10)
      .refine((lines) => new Set(lines.map((l) => l.businessId)).size === lines.length, 'One line per business')
      .refine((lines) => lines.some((l) => l.declaredPesewas > 0), 'Declare at least one amount'),
  }),
});
export type HandoverDeclarationCommand = z.infer<typeof handoverDeclarationCommandSchema>;

export const agentCommandSchema = z.discriminatedUnion('type', [collectionCommandSchema, handoverDeclarationCommandSchema]);
export type AgentCommand = z.infer<typeof agentCommandSchema>;
export type AgentCommandType = AgentCommand['type'];

export const COMMAND_SIGNATURE_VERSION = 'susu-cmd-v1';

/**
 * The exact UTF-8 string the agent app signs and the server verifies:
 *   susu-cmd-v1|{commandId}|{type}|{agentUid}|{deviceId}|{seq}|{capturedAt}|{canonicalJson(payload)}
 * `commandId` is the Firestore document ID (lower-case UUID). `capturedAt` is the exact string sent.
 */
export function commandSigningString(
  commandId: string,
  command: Pick<AgentCommand, 'type' | 'agentUid' | 'deviceId' | 'seq' | 'capturedAt' | 'payload'>,
): string {
  return [
    COMMAND_SIGNATURE_VERSION,
    commandId,
    command.type,
    command.agentUid,
    command.deviceId,
    String(command.seq),
    command.capturedAt,
    canonicalJson(command.payload),
  ].join('|');
}

/**
 * Written once by the agent app at first launch to `deviceEnrollments/{deviceId}`, before a
 * supervisor binds the phone. The supervisor compares the key fingerprint shown on the phone with
 * the one shown in the portal.
 */
export const deviceEnrollmentSchema = z.object({
  agentUid: z.string().min(1).max(128),
  /** Base64 X.509 SubjectPublicKeyInfo (DER) of an EC P-256 key; Android `PublicKey.getEncoded()`. */
  publicKey: z.base64().min(80).max(400),
  /** Base64 DER certificates from `KeyStore.getCertificateChain(alias)`, leaf first. Verified in a later step. */
  attestationChain: z.array(z.base64().max(8000)).max(10),
});
export type DeviceEnrollment = z.infer<typeof deviceEnrollmentSchema>;

/** Fields the server adds to `commands/{id}` after processing. Clients must never write these. */
export const commandResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('POSTED'),
    postingId: z.uuid(),
    serverTime: z.iso.datetime({ offset: true }),
  }),
  /** Accepted evidence that moves no money (a handover declaration). `recordId` is the declaration ID. */
  z.object({
    status: z.literal('RECORDED'),
    recordId: z.uuid(),
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

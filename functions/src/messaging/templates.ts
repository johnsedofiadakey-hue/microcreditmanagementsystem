import { z } from 'zod';

/**
 * SMS texts. Kept to the GSM-7 alphabet so a receipt is one 160-character segment: "₵" is not in
 * GSM-7 and would switch the whole message to UCS-2 (70 characters a segment, at least 2 segments).
 * So receipts say "GHS", not "GH₵".
 */

export const SMS_SEGMENT_GSM7 = 160;

const receiptValues = z.object({
  /** formatCedis output, e.g. "GH₵ 1,234.50". */
  amount: z.string(),
  balance: z.string(),
  reference: z.string(),
  /** ISO server time of the posting. */
  postedAt: z.string(),
});

/** The outbox payloads written by posting transactions (collection.ts, cash/withdrawals.ts). */
export const smsOutboxPayloadSchema = z.object({
  to: z.string().regex(/^\+233\d{9}$/),
  template: z.enum(['COLLECTION_RECEIPT', 'WITHDRAWAL_RECEIPT']),
  /** The business's name on the receipt and its registered sender ID (ADR-001). Older rows have neither. */
  brand: z.string().max(40).optional(),
  senderId: z.string().regex(/^[A-Za-z0-9 ]{1,11}$/).optional(),
  values: receiptValues,
});
export type SmsOutboxPayload = z.infer<typeof smsOutboxPayloadSchema>;

const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXTENDED = '^{}\\[~]|€';

export function isGsm7(text: string): boolean {
  return [...text].every((c) => GSM7_BASIC.includes(c) || GSM7_EXTENDED.includes(c));
}

/** GSM-7 length, counting extended characters as two. */
export function gsm7Length(text: string): number {
  return [...text].reduce((n, c) => n + (GSM7_EXTENDED.includes(c) ? 2 : 1), 0);
}

/** "GH₵ 1,234.50" → "GHS 1,234.50"; "-GH₵ 5.00" → "-GHS 5.00". */
function asciiCedis(formatted: string): string {
  return formatted.replace('GH₵', 'GHS');
}

const accraTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Accra',
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** "19 Oct 10:24" in Accra time. */
function shortTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return accraTime.format(date).replace(',', '');
}

/** Strip anything outside GSM-7 (e.g. a brand name typed with a curly apostrophe). */
function gsm7Only(text: string): string {
  return [...text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"')].filter((c) => isGsm7(c)).join('');
}

/**
 * The text a member receives. `brand` is the sender's trading name (SMS_BRAND), e.g. "Susu".
 * Collection: "Susu: GHS 20.00 received 19 Oct 10:24. Balance GHS 120.00. Ref 357D5757. Keep this SMS as your receipt."
 * Withdrawal: "Susu: GHS 50.00 paid to you 19 Oct 14:02. Balance GHS 70.00. Ref 9A0B1C2D. Keep this SMS as your receipt."
 */
export function renderSms(payload: SmsOutboxPayload, brand: string): string {
  const v = payload.values;
  const name = gsm7Only(brand).trim() || 'Susu';
  const what = payload.template === 'WITHDRAWAL_RECEIPT' ? 'paid to you' : 'received';
  const text =
    `${name}: ${asciiCedis(v.amount)} ${what} ${shortTime(v.postedAt)}. ` +
    `Balance ${asciiCedis(v.balance)}. Ref ${v.reference}. Keep this SMS as your receipt.`;
  return gsm7Only(text).replace(/\s+/g, ' ').replace(' .', '.');
}

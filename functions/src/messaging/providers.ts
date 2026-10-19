import { logger } from 'firebase-functions';

/** What a provider tells us about one send. */
export type SendResult =
  | { ok: true; providerMessageId: string | null }
  /** `permanent`: retrying won't help (bad number, rejected content, account suspended). */
  | { ok: false; permanent: boolean; error: string };

export interface SmsMessage {
  /** E.164, e.g. +233241234567. */
  to: string;
  text: string;
  /** Our outbox dedupe key, passed to providers that accept a client reference. */
  reference: string;
  /** The business's registered sender ID; the provider's default (SMS_SENDER_ID) when absent. */
  senderId?: string;
}

/** Provider-neutral adapter (BUILD_PLAN §4). One implementation per SMS/USSD aggregator. */
export interface SmsProvider {
  readonly name: string;
  send(message: SmsMessage): Promise<SendResult>;
}

/** +233241234567 → "024 ••• ••67", for logs. */
export function maskNumber(e164: string): string {
  const local = e164.startsWith('+233') ? `0${e164.slice(4)}` : e164;
  return `${local.slice(0, 3)} ••• ••${local.slice(-2)}`;
}

/**
 * Development and emulator provider: sends nothing, logs the text with a masked number, and accepts.
 * Also the safe default in any project where SMS_PROVIDER is not set.
 */
export class LogSmsProvider implements SmsProvider {
  readonly name = 'log';
  readonly sent: SmsMessage[] = [];

  async send(message: SmsMessage): Promise<SendResult> {
    this.sent.push(message);
    logger.info('SMS (log provider, not sent)', { to: maskNumber(message.to), text: message.text, reference: message.reference });
    return { ok: true, providerMessageId: `log-${message.reference}` };
  }
}

type Fetch = typeof fetch;

/**
 * Arkesel SMS API v2 (https://developers.arkesel.com). POST /api/v2/sms/send with header `api-key`,
 * body `{ sender, message, recipients: ["233…"] }`. A 2xx with `status: "success"` means accepted.
 * Not yet exercised against Arkesel's live API — verify with a test key before go-live
 * (docs/ops/ENVIRONMENT_CHECKLIST.md).
 */
export class ArkeselSmsProvider implements SmsProvider {
  readonly name = 'arkesel';

  constructor(
    private readonly apiKey: string,
    private readonly senderId: string,
    private readonly fetchImpl: Fetch = fetch,
    private readonly baseUrl = 'https://sms.arkesel.com',
  ) {
    if (!apiKey) throw new Error('Arkesel needs SMS_API_KEY');
    if (!/^[A-Za-z0-9 ]{1,11}$/.test(senderId)) throw new Error('SMS_SENDER_ID must be 1–11 letters, digits or spaces');
  }

  async send(message: SmsMessage): Promise<SendResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api/v2/sms/send`, {
        method: 'POST',
        headers: { 'api-key': this.apiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender: message.senderId ?? this.senderId, message: message.text, recipients: [message.to.replace(/^\+/, '')] }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      return { ok: false, permanent: false, error: `network: ${error instanceof Error ? error.message : String(error)}` };
    }

    const body = (await response.json().catch(() => null)) as
      | { status?: string; message?: string; data?: { id?: string; recipient?: string }[] }
      | null;
    if (response.ok && body?.status === 'success') {
      return { ok: true, providerMessageId: body.data?.[0]?.id ?? null };
    }
    const error = `HTTP ${response.status}: ${body?.message ?? 'no message'}`;
    // 429 and 5xx are worth retrying; other 4xx (bad key, bad number, no balance) need a person.
    const permanent = response.status >= 400 && response.status < 500 && response.status !== 429;
    return { ok: false, permanent, error };
  }
}

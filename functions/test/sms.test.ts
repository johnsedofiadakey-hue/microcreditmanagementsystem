import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { processAgentCommand } from '../src/commands/processAgentCommand.js';
import type { Database } from '../src/db/types.js';
import { MAX_ATTEMPTS, backoffSeconds, dispatchSmsOutbox } from '../src/messaging/dispatch.js';
import { ArkeselSmsProvider, type SendResult, type SmsMessage, type SmsProvider } from '../src/messaging/providers.js';
import { SMS_SEGMENT_GSM7, gsm7Length, isGsm7, renderSms, type SmsOutboxPayload } from '../src/messaging/templates.js';
import { freshDatabase, seedBranch, signedCollection } from './helpers.js';

let db: Database;
let seed: Awaited<ReturnType<typeof seedBranch>>;

beforeEach(async () => {
  db = await freshDatabase();
  seed = await seedBranch(db);
});

afterEach(async () => {
  await db.close();
});

/** A provider whose answers are scripted per call; records every message it was asked to send. */
class ScriptedProvider implements SmsProvider {
  readonly name = 'scripted';
  readonly calls: SmsMessage[] = [];
  constructor(private readonly answers: (SendResult | Error)[] = []) {}
  async send(message: SmsMessage): Promise<SendResult> {
    this.calls.push(message);
    const answer = this.answers.shift() ?? { ok: true, providerMessageId: `msg-${this.calls.length}` };
    if (answer instanceof Error) throw answer;
    return answer;
  }
}

const BRAND = 'Susu';
const dispatch = (provider: SmsProvider, dedupeKeys?: string[]) => dispatchSmsOutbox(db, provider, { brand: BRAND, dedupeKeys });

async function postCollection(amountPesewas = 2_000, seq = 1) {
  const c = signedCollection(seed.key, { ...seed, amountPesewas, seq });
  const result = await processAgentCommand(db, c.id, c.body);
  expect(result.status).toBe('POSTED');
  return `sms:collection:${c.id}`;
}

async function row(dedupeKey: string) {
  const r = await db.query<{
    id: string;
    status: string;
    attempts: number;
    provider_message_id: string | null;
    last_error: string | null;
    due_in_seconds: number;
  }>(
    `select id, status, attempts, provider_message_id, last_error,
            extract(epoch from next_attempt_at - now())::int as due_in_seconds
       from outbox where dedupe_key = $1`,
    [dedupeKey],
  );
  return r.rows[0]!;
}

/** Make a retrying row due now, as if the backoff had passed. */
const makeDue = (dedupeKey: string) => db.query(`update outbox set next_attempt_at = now() where dedupe_key = $1`, [dedupeKey]);

describe('SMS receipts for posted collections', () => {
  it('sends one receipt per posted collection, to the member, in one GSM-7 segment', async () => {
    const key = await postCollection(2_000);
    const provider = new ScriptedProvider();
    expect(await dispatch(provider)).toEqual({ claimed: 1, sent: 1, retrying: 0, gaveUp: [] });

    expect(provider.calls).toHaveLength(1);
    const [message] = provider.calls;
    expect(message!.to).toBe('+233241234567');
    expect(message!.reference).toBe(key);
    // The receipt carries the account's business: its brand and its registered sender ID (ADR-001).
    expect(message!.senderId).toBe('GadufiaSusu');
    expect(message!.text).toMatch(/^Gadufia Susu: GHS 20\.00 received \d{2} \w{3} \d{2}:\d{2}\. Balance GHS 20\.00\. Ref [0-9A-F]{8}\./);
    expect(isGsm7(message!.text)).toBe(true);
    expect(gsm7Length(message!.text)).toBeLessThanOrEqual(SMS_SEGMENT_GSM7);

    expect(await row(key)).toMatchObject({ status: 'SENT', attempts: 1, provider_message_id: 'msg-1' });
    // Nothing left to send: a second run sends nothing.
    expect((await dispatch(provider)).claimed).toBe(0);
    expect(provider.calls).toHaveLength(1);
  });

  it('a redelivered command does not send a second receipt', async () => {
    const c = signedCollection(seed.key, { ...seed, amountPesewas: 1_000 });
    await processAgentCommand(db, c.id, c.body);
    await processAgentCommand(db, c.id, c.body);
    const provider = new ScriptedProvider();
    await dispatch(provider);
    await dispatch(provider);
    expect(provider.calls).toHaveLength(1);
  });

  it('still sends exactly one receipt when the provider fails once (BUILD_PLAN Step 5 “done when”)', async () => {
    const key = await postCollection();
    const provider = new ScriptedProvider([{ ok: false, permanent: false, error: 'HTTP 503: try later' }]);

    expect(await dispatch(provider)).toMatchObject({ claimed: 1, sent: 0, retrying: 1 });
    const retrying = await row(key);
    expect(retrying).toMatchObject({ status: 'PENDING', attempts: 1, last_error: 'HTTP 503: try later' });
    expect(retrying.due_in_seconds).toBeGreaterThan(50);

    // Not due yet: the next run leaves it alone.
    expect((await dispatch(provider)).claimed).toBe(0);
    await makeDue(key);
    expect(await dispatch(provider)).toMatchObject({ claimed: 1, sent: 1 });
    expect(await row(key)).toMatchObject({ status: 'SENT', attempts: 2, last_error: null });
    expect(provider.calls.map((c) => c.reference)).toEqual([key, key]);
  });

  it('a thrown provider error is a transient failure, not a crash', async () => {
    const key = await postCollection();
    const provider = new ScriptedProvider([new Error('socket hang up')]);
    expect(await dispatch(provider)).toMatchObject({ retrying: 1 });
    expect((await row(key)).last_error).toBe('socket hang up');
  });

  it('a permanent refusal fails at once and is reported for an exception', async () => {
    const key = await postCollection();
    const provider = new ScriptedProvider([{ ok: false, permanent: true, error: 'HTTP 422: invalid recipient' }]);
    const report = await dispatch(provider);
    expect(report.gaveUp).toEqual([{ outboxId: String((await row(key)).id), dedupeKey: key, error: 'HTTP 422: invalid recipient' }]);
    expect(await row(key)).toMatchObject({ status: 'FAILED', attempts: 1 });
    await makeDue(key);
    expect((await dispatch(new ScriptedProvider())).claimed).toBe(0);
  });

  it(`gives up after ${MAX_ATTEMPTS} transient failures`, async () => {
    const key = await postCollection();
    const failures = Array.from({ length: MAX_ATTEMPTS }, () => ({ ok: false as const, permanent: false, error: 'HTTP 500' }));
    const provider = new ScriptedProvider(failures);
    for (let i = 1; i < MAX_ATTEMPTS; i += 1) {
      expect((await dispatch(provider)).retrying).toBe(1);
      await makeDue(key);
    }
    expect((await dispatch(provider)).gaveUp).toHaveLength(1);
    expect(await row(key)).toMatchObject({ status: 'FAILED', attempts: MAX_ATTEMPTS });
  });

  it('a send that died mid-way (expired lease) is picked up again', async () => {
    const key = await postCollection();
    await db.query(`update outbox set status = 'SENDING', attempts = 1, lease_until = now() - interval '1 second' where dedupe_key = $1`, [key]);
    const provider = new ScriptedProvider();
    expect(await dispatch(provider)).toMatchObject({ claimed: 1, sent: 1 });
    expect(await row(key)).toMatchObject({ status: 'SENT', attempts: 2 });
  });

  it('a row leased by another run is not taken until its lease expires', async () => {
    const key = await postCollection();
    await db.query(`update outbox set status = 'SENDING', lease_until = now() + interval '2 minutes' where dedupe_key = $1`, [key]);
    expect((await dispatch(new ScriptedProvider())).claimed).toBe(0);
  });

  it('dedupeKeys limits a run to the given receipts (immediate send after posting)', async () => {
    const first = await postCollection(1_000, 1);
    const second = await postCollection(2_000, 2);
    const provider = new ScriptedProvider();
    expect((await dispatch(provider, [second])).sent).toBe(1);
    expect(provider.calls.map((c) => c.reference)).toEqual([second]);
    expect((await row(first)).status).toBe('PENDING');
  });

  it('a malformed payload fails permanently instead of retrying forever', async () => {
    await db.query(`insert into outbox (kind, dedupe_key, payload) values ('SMS', 'sms:bad', $1)`, [JSON.stringify({ to: '12345' })]);
    const report = await dispatch(new ScriptedProvider());
    expect(report.gaveUp[0]).toMatchObject({ dedupeKey: 'sms:bad' });
    expect(report.gaveUp[0]!.error).toMatch(/^invalid payload/);
  });
});

describe('the outbox is tamper-resistant', () => {
  it('payload and keys are frozen, sent rows stay sent, and nothing is deleted', async () => {
    const key = await postCollection();
    await expect(db.query(`update outbox set payload = '{}' where dedupe_key = $1`, [key])).rejects.toThrow(/cannot change/);
    await dispatch(new ScriptedProvider());
    await expect(db.query(`update outbox set status = 'PENDING' where dedupe_key = $1`, [key])).rejects.toThrow(/cannot change status/);
    await expect(db.query(`delete from outbox where dedupe_key = $1`, [key])).rejects.toThrow(/never deleted/);
  });
});

describe('renderSms', () => {
  const payload: SmsOutboxPayload = {
    to: '+233241234567',
    template: 'COLLECTION_RECEIPT',
    values: { amount: 'GH₵ 1,000,000.00', balance: 'GH₵ 99,999,999.99', reference: 'ABCD1234', postedAt: '2026-10-19T23:59:00Z' },
  };

  it('stays one GSM-7 segment even for the largest amounts and a long brand', () => {
    const text = renderSms(payload, 'Stormglide Microfinance');
    expect(isGsm7(text)).toBe(true);
    expect(gsm7Length(text)).toBeLessThanOrEqual(SMS_SEGMENT_GSM7);
    expect(text).toContain('19 Oct 23:59');
  });

  it('cleans a brand typed with characters outside GSM-7', () => {
    expect(renderSms(payload, 'Ama’s Susu ₵').startsWith("Ama's Susu: GHS")).toBe(true);
    expect(renderSms(payload, '₵₵').startsWith('Susu: ')).toBe(true);
  });

  it('backoff doubles from one minute and caps at six hours', () => {
    expect([1, 2, 3, 4].map(backoffSeconds)).toEqual([60, 120, 240, 480]);
    expect(backoffSeconds(30)).toBe(6 * 60 * 60);
  });
});

describe('ArkeselSmsProvider', () => {
  const message: SmsMessage = { to: '+233241234567', text: 'Hello', reference: 'sms:x' };
  const respond = (status: number, body: unknown) =>
    (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

  it('sends to the number without "+", with the key header, and reads the message id', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ status: 'success', data: [{ recipient: '233241234567', id: 'ark-1' }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const provider = new ArkeselSmsProvider('key-123', 'Susu', fetchImpl);
    expect(await provider.send(message)).toEqual({ ok: true, providerMessageId: 'ark-1' });
    expect(seen!.url).toBe('https://sms.arkesel.com/api/v2/sms/send');
    expect((seen!.init.headers as Record<string, string>)['api-key']).toBe('key-123');
    expect(JSON.parse(String(seen!.init.body))).toEqual({ sender: 'Susu', message: 'Hello', recipients: ['233241234567'] });
  });

  it('4xx is permanent; 429, 5xx and network errors are retried', async () => {
    expect(await new ArkeselSmsProvider('k', 'Susu', respond(401, { message: 'Invalid API key' })).send(message)).toEqual({
      ok: false,
      permanent: true,
      error: 'HTTP 401: Invalid API key',
    });
    expect(await new ArkeselSmsProvider('k', 'Susu', respond(429, {})).send(message)).toMatchObject({ ok: false, permanent: false });
    expect(await new ArkeselSmsProvider('k', 'Susu', respond(502, {})).send(message)).toMatchObject({ ok: false, permanent: false });
    const offline = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await new ArkeselSmsProvider('k', 'Susu', offline).send(message)).toEqual({
      ok: false,
      permanent: false,
      error: 'network: fetch failed',
    });
  });

  it('refuses to start without a key or with an invalid sender ID', () => {
    expect(() => new ArkeselSmsProvider('', 'Susu')).toThrow(/SMS_API_KEY/);
    expect(() => new ArkeselSmsProvider('k', 'Twelve-chars')).toThrow(/SMS_SENDER_ID/);
  });
});

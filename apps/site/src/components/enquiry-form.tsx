'use client';

import { ENQUIRY_INTERESTS, submitEnquiryRequestSchema, type EnquiryInterest, type SubmitEnquiryResult } from '@susu/shared';
import { httpsCallable } from 'firebase/functions';
import { CheckCircle2, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';
import { siteFunctions } from '@/lib/firebase';
import { cn } from '@/lib/utils';

const INTEREST_LABELS: Record<EnquiryInterest, string> = {
  SUSU: 'Susu savings (Gadufia Fiase)',
  MICRO_CREDIT: 'Micro-credit (STF)',
  WELFARE: 'Welfare membership (Opportunity)',
  OTHER: 'Something else',
};

type FieldErrors = Partial<Record<'fullName' | 'phone' | 'town' | 'interest' | 'message' | 'consent', string>>;

function initialInterest(value: string | null): EnquiryInterest {
  return (ENQUIRY_INTERESTS as readonly string[]).includes(value ?? '') ? (value as EnquiryInterest) : 'SUSU';
}

export function EnquiryForm() {
  const id = useId();
  const params = useSearchParams();
  const [interest, setInterest] = useState<EnquiryInterest>(() => initialInterest(params.get('interest')));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<SubmitEnquiryResult | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const form = new FormData(event.currentTarget);
    const raw = {
      fullName: String(form.get('fullName') ?? ''),
      phone: String(form.get('phone') ?? ''),
      town: String(form.get('town') ?? '') || undefined,
      interest,
      message: String(form.get('message') ?? '') || undefined,
      consent: form.get('consent') === 'on',
      website: String(form.get('website') ?? '') || undefined,
    };

    const parsed = submitEnquiryRequestSchema.safeParse(raw);
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof FieldErrors;
        next[key] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      // Send what the person typed (empty optional fields left out); the server normalises and re-validates.
      const payload = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined));
      const call = httpsCallable<typeof payload, SubmitEnquiryResult>(siteFunctions(), 'submitEnquiry');
      const result = await call(payload);
      setDone(result.data);
    } catch (error) {
      const code = (error as { code?: string }).code;
      setFormError(
        code === 'functions/resource-exhausted'
          ? 'We already have your details for today. We will call you back.'
          : 'We could not send your details just now. Please try again in a moment, or visit our Aflao office.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-3xl border border-primary/20 bg-primary-soft p-8 text-primary-strong" role="status">
        <CheckCircle2 className="size-10 text-primary" aria-hidden />
        <h3 className="mt-4 text-2xl font-bold">Thank you — we have your details.</h3>
        <p className="mt-2 leading-relaxed">
          A member of our team will call you on the number you gave us. If you call the office first, quote reference{' '}
          <strong className="font-mono text-base">{done.reference}</strong>.
        </p>
        <p className="mt-4 text-sm">
          Our staff will never ask for your mobile money PIN. <Link href="/stay-safe" className="font-semibold underline underline-offset-4">How to stay safe</Link>
        </p>
      </div>
    );
  }

  const field = 'mt-2 block w-full rounded-xl border border-border bg-background px-4 py-3 text-base text-foreground shadow-xs outline-none transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-4 focus:ring-primary/15';
  const errorText = (key: keyof FieldErrors) =>
    errors[key] ? (
      <p id={`${id}-${key}-error`} className="mt-1.5 text-sm text-destructive">
        {errors[key]}
      </p>
    ) : null;
  const described = (key: keyof FieldErrors) => (errors[key] ? `${id}-${key}-error` : undefined);

  return (
    <form onSubmit={onSubmit} noValidate className="rounded-3xl border border-border bg-surface p-6 shadow-sm sm:p-8">
      <fieldset>
        <legend className="text-sm font-semibold">I&apos;m interested in</legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {ENQUIRY_INTERESTS.map((value) => (
            <label
              key={value}
              className={cn(
                'flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 text-sm font-medium transition-colors',
                interest === value ? 'border-primary bg-primary-soft text-primary-strong' : 'border-border bg-background hover:border-primary/40',
              )}
            >
              <input
                type="radio"
                name="interest"
                value={value}
                checked={interest === value}
                onChange={() => setInterest(value)}
                className="size-4 accent-[var(--primary)]"
              />
              {INTEREST_LABELS[value]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-name`} className="text-sm font-semibold">Your name</label>
          <input id={`${id}-name`} name="fullName" autoComplete="name" className={field} aria-invalid={!!errors.fullName} aria-describedby={described('fullName')} />
          {errorText('fullName')}
        </div>
        <div>
          <label htmlFor={`${id}-phone`} className="text-sm font-semibold">Phone number</label>
          <input
            id={`${id}-phone`}
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="024 123 4567"
            className={field}
            aria-invalid={!!errors.phone}
            aria-describedby={described('phone')}
          />
          {errorText('phone')}
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-town`} className="text-sm font-semibold">
            Town or area <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <input id={`${id}-town`} name="town" autoComplete="address-level2" placeholder="e.g. Aflao, Denu, Ho" className={field} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-message`} className="text-sm font-semibold">
            Anything we should know? <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <textarea id={`${id}-message`} name="message" rows={4} maxLength={1000} className={cn(field, 'resize-y')} placeholder="e.g. Best time to call, where your shop is" />
        </div>
      </div>

      {/* Honeypot: hidden from people and screen readers. */}
      <div aria-hidden className="absolute left-[-10000px] top-auto size-px overflow-hidden">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div className="mt-6">
        <label className="flex items-start gap-3 text-sm leading-relaxed">
          <input name="consent" type="checkbox" className="mt-1 size-4 shrink-0 accent-[var(--primary)]" aria-invalid={!!errors.consent} aria-describedby={described('consent')} />
          <span>
            You may call or text me about this enquiry. I have read the{' '}
            <Link href="/privacy" className="font-semibold text-primary underline underline-offset-4">privacy notice</Link>.
          </span>
        </label>
        {errorText('consent')}
      </div>

      {formError && (
        <p className="mt-5 rounded-xl bg-warning-soft px-4 py-3 text-sm text-[#5c3a00]" role="alert">
          {formError}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-primary px-6 text-base font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary-strong disabled:opacity-70 sm:w-auto"
      >
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {busy ? 'Sending…' : 'Ask us to call you'}
      </button>
      <p className="mt-3 text-xs text-muted-foreground">We use your details only to reply to this enquiry. This does not open an account.</p>
    </form>
  );
}

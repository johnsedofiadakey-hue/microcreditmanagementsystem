'use client';

import {
  getMultiFactorResolver,
  PhoneAuthProvider,
  PhoneMultiFactorGenerator,
  RecaptchaVerifier,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  TotpMultiFactorGenerator,
  type MultiFactorResolver,
} from 'firebase/auth';
import { FirebaseError } from 'firebase/app';
import { ArrowRight, Eye, EyeOff, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth-context';
import { authErrorMessage } from '@/lib/errors';
import { firebase, usingEmulators } from '@/lib/firebase';

type Step =
  | { kind: 'password' }
  | { kind: 'mfa'; resolver: MultiFactorResolver; factor: 'totp' | 'phone'; verificationId?: string }
  | { kind: 'reset-sent' };

const loginQuotes = [
  'Every cedi deserves a clear record.',
  'Good records make trust visible.',
  'Care is counted in the details.',
] as const;

export default function SignInPage() {
  const router = useRouter();
  const { state } = useAuth();
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [quoteIndex, setQuoteIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const recaptchaRef = useRef<HTMLDivElement>(null);
  const verifierRef = useRef<RecaptchaVerifier | null>(null);

  useEffect(() => {
    if (state.status === 'ready' || state.status === 'no-role') router.replace('/');
  }, [state.status, router]);

  useEffect(() => () => verifierRef.current?.clear(), []);

  async function startSecondFactor(resolver: MultiFactorResolver) {
    const hint = resolver.hints[0];
    if (!hint) throw new Error('No second factor enrolled');
    if (hint.factorId === TotpMultiFactorGenerator.FACTOR_ID) {
      setStep({ kind: 'mfa', resolver, factor: 'totp' });
      return;
    }
    const { auth } = firebase();
    verifierRef.current ??= new RecaptchaVerifier(auth, recaptchaRef.current!, { size: 'invisible' });
    const verificationId = await new PhoneAuthProvider(auth).verifyPhoneNumber(
      { multiFactorHint: hint, session: resolver.session },
      verifierRef.current,
    );
    setStep({ kind: 'mfa', resolver, factor: 'phone', verificationId });
  }

  async function onPassword(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(firebase().auth, email.trim(), password);
    } catch (err) {
      if (err instanceof FirebaseError && err.code === 'auth/multi-factor-auth-required') {
        try {
          await startSecondFactor(getMultiFactorResolver(firebase().auth, err as Parameters<typeof getMultiFactorResolver>[1]));
        } catch (mfaErr) {
          setError(authErrorMessage(mfaErr));
        }
      } else {
        setError(authErrorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  async function onCode(e: FormEvent) {
    e.preventDefault();
    if (step.kind !== 'mfa') return;
    setBusy(true);
    setError(null);
    try {
      const hint = step.resolver.hints[0]!;
      const assertion =
        step.factor === 'totp'
          ? TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code.trim())
          : PhoneMultiFactorGenerator.assertion(PhoneAuthProvider.credential(step.verificationId!, code.trim()));
      await step.resolver.resolveSignIn(assertion);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onForgot() {
    if (!email.trim()) {
      setError('Enter your work email first, then choose “Forgot password”.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sendPasswordResetEmail(firebase().auth, email.trim());
    } catch {
      // Same message whether or not the account exists.
    } finally {
      setBusy(false);
      setStep({ kind: 'reset-sent' });
    }
  }

  return (
    <main className="grid min-h-dvh min-w-0 bg-background lg:grid-cols-[minmax(0,1.03fr)_minmax(0,0.97fr)]">
      <section className="field-auth-hero relative flex min-h-52 flex-col justify-between overflow-hidden px-6 py-5 text-[#fffaf0] sm:px-10 lg:min-h-dvh lg:px-12 lg:py-10">
        <div className="field-auth-orbit" aria-hidden="true"><span className="field-auth-orbit-dot" /></div>
        <div className="field-auth-path" aria-hidden="true" />
        <div className="field-auth-enter relative flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-accent font-heading text-2xl font-black text-[#173d33]">S</span>
          <span className="font-heading text-lg leading-[1.05] font-bold tracking-tight">Susu<br />Operations</span>
        </div>
        <div className="relative max-w-xl py-3 lg:py-0">
          <p className="mb-3 text-[11px] font-semibold tracking-[0.23em] text-[#e7c98f] uppercase">A clearer day starts here</p>
          <h2 key={quoteIndex} className="field-auth-quote max-w-xl font-heading text-[clamp(1.75rem,4.6vw,4.9rem)] leading-[1.04] font-bold tracking-[-0.055em]" aria-live="polite">
            {loginQuotes[quoteIndex]}
          </h2>
          <button
            type="button"
            onClick={() => setQuoteIndex((index) => (index + 1) % loginQuotes.length)}
            className="mt-3 inline-flex min-h-9 items-center gap-2 rounded-lg text-sm font-semibold text-[#f4dfb9] underline decoration-[#e7c98f]/60 underline-offset-8 transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-[#f4dfb9] focus-visible:outline-none lg:mt-5 lg:min-h-11"
            aria-label="Show another thought"
          >
            Another thought <ArrowRight className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="relative hidden items-center justify-between gap-4 text-[11px] font-medium tracking-[0.13em] text-[#c8d9cc] uppercase lg:flex">
          <span>Susu · cash · oversight</span><span className="normal-case tracking-normal">Built by Stormglide</span>
        </div>
      </section>

      <section className="flex min-w-0 items-center justify-center px-5 py-9 sm:px-10 lg:py-12">
        <div className="field-auth-enter w-full max-w-md rounded-2xl border border-border/70 bg-surface px-5 py-6 shadow-[0_18px_50px_-35px_rgba(23,61,51,0.32)] sm:px-9 sm:py-10 lg:border-0 lg:bg-transparent lg:shadow-none">
          <div className="mb-6 flex items-center justify-between gap-3 text-[11px] font-semibold tracking-[0.17em] text-muted-foreground uppercase lg:mb-8">
            <span className="font-heading text-sm tracking-normal text-primary">S / O</span><span>Staff access</span>
          </div>
          <h1 className="font-heading text-[clamp(1.8rem,3vw,2.4rem)] leading-tight font-bold tracking-[-0.04em]">
            {step.kind === 'mfa' ? 'One more check.' : step.kind === 'reset-sent' ? 'Check your email.' : 'Welcome back.'}
          </h1>
          <p className="mt-2 mb-5 text-sm leading-6 text-muted-foreground lg:mb-7">
            {step.kind === 'mfa'
              ? step.factor === 'totp'
                ? 'Enter the 6-digit code from your authenticator app.'
                : `Enter the code we sent to ${step.resolver.hints[0]?.displayName ?? 'your phone'}.`
              : step.kind === 'reset-sent'
                ? 'If an account exists for that email, a link to set a new password is on its way.'
                : 'Sign in with the work email your administrator set up for you.'}
          </p>

          {usingEmulators && <div className="mb-5"><Alert tone="info" title="Development mode">Connected to the local Firebase emulators.</Alert></div>}
          {error && <div className="mb-5"><Alert tone="error">{error}</Alert></div>}

          {step.kind === 'password' && (
            <form onSubmit={onPassword} className="grid gap-4 lg:gap-5" noValidate>
              <Field label="Work email" htmlFor="email"><Input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-12 bg-surface" placeholder="name@company.com" /></Field>
              <Field label="Password" htmlFor="password">
                <div className="relative">
                  <Input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="h-12 bg-surface pr-12" placeholder="Enter password" />
                  <button type="button" onClick={() => setShowPassword((visible) => !visible)} className="absolute top-0 right-0 flex size-12 items-center justify-center rounded-r-lg text-muted-foreground hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>
                    {showPassword ? <EyeOff className="size-5" aria-hidden="true" /> : <Eye className="size-5" aria-hidden="true" />}
                  </button>
                </div>
              </Field>
              <Button type="submit" size="lg" disabled={busy || !email.trim() || !password} className="field-auth-action mt-1 h-12 justify-between rounded-xl px-5">
                <span className="inline-flex items-center gap-2">{busy ? <Loader2 className="animate-spin" /> : <KeyRound />} Sign in</span><ArrowRight aria-hidden="true" />
              </Button>
              <button type="button" onClick={onForgot} disabled={busy} className="min-h-11 justify-self-start text-sm font-semibold text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">Forgot password?</button>
            </form>
          )}

          {step.kind === 'mfa' && (
            <form onSubmit={onCode} className="grid gap-5" noValidate>
              <Field label="Verification code" htmlFor="code"><Input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="h-12 bg-surface text-center font-mono text-lg tracking-[0.4em]" /></Field>
              <Button type="submit" size="lg" disabled={busy || code.length < 6} className="field-auth-action h-12 justify-between rounded-xl px-5"><span className="inline-flex items-center gap-2">{busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Verify code</span><ArrowRight aria-hidden="true" /></Button>
              <Button type="button" variant="ghost" onClick={() => setStep({ kind: 'password' })}>Use a different account</Button>
            </form>
          )}

          {step.kind === 'reset-sent' && <Button variant="outline" onClick={() => setStep({ kind: 'password' })}>Back to sign in</Button>}
          <div className="mt-5 border-t border-border pt-4 text-xs leading-5 text-muted-foreground lg:mt-8 lg:pt-5">Secure staff access · Field agents use the Android app.</div>
          <div ref={recaptchaRef} />
        </div>
      </section>
    </main>
  );
}

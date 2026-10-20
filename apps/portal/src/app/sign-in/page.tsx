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
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';
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

export default function SignInPage() {
  const router = useRouter();
  const { state } = useAuth();
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
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
    <main className="grid min-h-screen min-w-0 grid-cols-[minmax(0,1fr)] lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-sidebar p-12 text-sidebar-foreground lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 -right-24 size-[28rem] rounded-full bg-primary/30 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -left-20 size-[26rem] rounded-full bg-accent/20 blur-3xl"
        />
        <div className="relative flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary font-heading text-lg font-black text-white">
            S
          </span>
          <span className="font-heading text-lg font-bold text-white">Susu Portal</span>
        </div>
        <div className="relative grid max-w-md gap-4">
          <h2 className="font-heading text-4xl leading-tight font-bold text-white">
            Every cedi collected, handed over and accounted for.
          </h2>
          <p className="text-sidebar-muted">
            One record for field collections, branch cash and head-office oversight — with a second pair of eyes on
            every payout.
          </p>
        </div>
        <p className="relative text-xs text-sidebar-muted">Built by Stormglide</p>
      </section>

      <section className="flex min-w-0 items-center justify-center p-6">
        <div className="grid min-w-0 w-full max-w-sm gap-6">
          <div className="grid gap-1.5">
            <h1 className="font-heading text-2xl font-bold tracking-tight">
              {step.kind === 'mfa' ? 'Confirm it’s you' : step.kind === 'reset-sent' ? 'Check your email' : 'Sign in'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {step.kind === 'mfa'
                ? step.factor === 'totp'
                  ? 'Enter the 6-digit code from your authenticator app.'
                  : `Enter the code we sent to ${step.resolver.hints[0]?.displayName ?? 'your phone'}.`
                : step.kind === 'reset-sent'
                  ? 'If an account exists for that email, a link to set a new password is on its way.'
                  : 'Use the work email your administrator set up for you.'}
            </p>
          </div>

          {usingEmulators && (
            <Alert tone="info" title="Development mode">
              Connected to the local Firebase emulators.
            </Alert>
          )}
          {error && <Alert tone="error">{error}</Alert>}

          {step.kind === 'password' && (
            <form onSubmit={onPassword} className="grid gap-4" noValidate>
              <Field label="Work email" htmlFor="email">
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Field label="Password" htmlFor="password">
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
              <Button type="submit" size="lg" disabled={busy || !email || !password}>
                {busy ? <Loader2 className="animate-spin" /> : <KeyRound />}
                Sign in
              </Button>
              <button
                type="button"
                onClick={onForgot}
                className="justify-self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                Forgot password
              </button>
            </form>
          )}

          {step.kind === 'mfa' && (
            <form onSubmit={onCode} className="grid gap-4" noValidate>
              <Field label="Verification code" htmlFor="code">
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  className="text-center font-mono text-lg tracking-[0.4em]"
                />
              </Field>
              <Button type="submit" size="lg" disabled={busy || code.length < 6}>
                {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
                Verify
              </Button>
              <Button type="button" variant="ghost" onClick={() => setStep({ kind: 'password' })}>
                Use a different account
              </Button>
            </form>
          )}

          {step.kind === 'reset-sent' && (
            <Button variant="outline" onClick={() => setStep({ kind: 'password' })}>
              Back to sign in
            </Button>
          )}

          <div ref={recaptchaRef} />
        </div>
      </section>
    </main>
  );
}

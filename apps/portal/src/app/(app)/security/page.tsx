'use client';

import { EmailAuthProvider, multiFactor, reauthenticateWithCredential, reload, sendEmailVerification, TotpMultiFactorGenerator, type TotpSecret } from 'firebase/auth';
import { FirebaseError } from 'firebase/app';
import { CheckCircle2, Copy, KeyRound, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { useAuth, useSession } from '@/lib/auth-context';
import { usingEmulators } from '@/lib/firebase';

const REQUIRED = new Set(['SUPER_ADMIN', 'FINANCE', 'BRANCH_MANAGER']);

function message(error: unknown): string {
  if (error instanceof FirebaseError) {
    if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password') return 'That password is not correct.';
    if (error.code === 'auth/invalid-verification-code') return 'That code has expired or is not correct. Use the current code in your authenticator.';
    if (error.code === 'auth/operation-not-allowed' || error.code === 'auth/unsupported-first-factor') return 'Authenticator setup is not enabled for this Firebase project yet. Ask an administrator to check Identity Platform MFA settings.';
    if (error.code === 'auth/requires-recent-login') return 'Your session is too old. Sign out, sign in again, then return here.';
    if (error.code === 'auth/unverified-email') return 'Verify your work email before adding an authenticator. Use the verification link sent to your inbox.';
    if (usingEmulators && error.code === 'auth/invalid-argument') return 'The local Auth emulator could not generate an authenticator key. This step needs verification on the configured Identity Platform project.';
  }
  return 'Could not complete authenticator setup. Try again or contact your administrator.';
}

export default function SecurityPage() {
  const { user, claims } = useSession();
  const { signOut } = useAuth();
  const enrolled = multiFactor(user).enrolledFactors;
  const hasTotp = enrolled.some((factor) => factor.factorId === TotpMultiFactorGenerator.FACTOR_ID);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [secret, setSecret] = useState<TotpSecret | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState(user.emailVerified);

  async function sendVerification() {
    setBusy(true);
    setError(null);
    try {
      await sendEmailVerification(user);
      toast.success('Verification link sent to your work email.');
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }

  async function checkVerification() {
    setBusy(true);
    setError(null);
    try {
      await reload(user);
      setVerified(user.emailVerified);
      if (!user.emailVerified) setError('Your email is still unverified. Open the link in your inbox, then check again.');
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }

  async function begin(event: FormEvent) {
    event.preventDefault();
    if (!user.email || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
      setPassword('');
      const session = await multiFactor(user).getSession();
      setSecret(await TotpMultiFactorGenerator.generateSecret(session));
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }

  async function finish(event: FormEvent) {
    event.preventDefault();
    if (!secret || !/^\d{6,8}$/.test(code.trim()) || busy) return;
    setBusy(true);
    setError(null);
    try {
      await multiFactor(user).enroll(TotpMultiFactorGenerator.assertionForEnrollment(secret, code.trim()), 'Authenticator app');
      setSecret(null);
      setCode('');
      toast.success('Authenticator added. Sign in again to verify it.');
      await signOut();
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }

  return <div className="grid max-w-2xl gap-6">
    <PageHeader title="Account security" description="Protect your work account with a changing code from an authenticator app." />
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="size-5 text-primary" /> Two-step verification</CardTitle></CardHeader>
      <CardContent className="grid gap-5">
        {hasTotp ? <Alert tone="success"><span className="flex items-center gap-2"><CheckCircle2 className="size-4" /> Authenticator is enrolled. You will need its code when you next sign in.</span></Alert> : (
          <Alert tone="info" className={REQUIRED.has(claims.role) ? 'border-warning/25 bg-warning-soft' : undefined}>
            {REQUIRED.has(claims.role) ? 'Your role requires an authenticator before pilot use. Set it up now.' : 'Add an authenticator to protect your account.'}
          </Alert>
        )}
        {error && <Alert tone="error">{error}</Alert>}
        {!hasTotp && !verified && <div className="grid gap-3 rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm">
          <p className="font-semibold">Verify your work email first</p>
          <p>Firebase requires a verified email before authenticator enrolment. Open the verification link in your inbox, then return here.</p>
          <div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={busy} onClick={sendVerification}>Send verification link</Button><Button type="button" size="sm" variant="outline" disabled={busy} onClick={checkVerification}>I verified my email</Button></div>
        </div>}
        {enrolled.length > 0 && <div className="grid gap-2 text-sm"><p className="font-medium">Enrolled methods</p>{enrolled.map((factor) => <p key={factor.uid} className="rounded-lg border border-border px-3 py-2">{factor.displayName || (factor.factorId === 'totp' ? 'Authenticator app' : 'Phone code')}</p>)}</div>}
        {!hasTotp && verified && !secret && <form onSubmit={begin} className="grid gap-4">
          <p className="text-sm text-muted-foreground">Confirm your password to generate a private setup key. You will then enter one code from your authenticator.</p>
          <Field label="Current password" htmlFor="mfa-password"><Input id="mfa-password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
          <Button type="submit" disabled={!password || busy} className="justify-self-start"><KeyRound /> {busy ? 'Preparing…' : 'Start setup'}</Button>
        </form>}
        {!hasTotp && secret && <form onSubmit={finish} className="grid gap-4">
          <div className="grid gap-2 rounded-xl border border-primary/20 bg-primary-soft/40 p-4">
            <p className="text-sm font-semibold">Add this account to your authenticator app</p>
            <p className="text-sm text-muted-foreground">Choose manual setup and enter the key below. Keep this key private; it appears only during setup.</p>
            <code className="break-all rounded-lg bg-surface px-3 py-2 font-mono text-base font-semibold tracking-wider select-all">{secret.secretKey}</code>
            <Button type="button" size="sm" variant="outline" className="justify-self-start" onClick={async () => { await navigator.clipboard.writeText(secret.secretKey); toast.success('Setup key copied'); }}><Copy /> Copy setup key</Button>
            <p className="text-xs text-muted-foreground">Account: {user.email} · Issuer: Susu Operations · {secret.codeLength}-digit code every {secret.codeIntervalSeconds} seconds</p>
          </div>
          <Field label="Code from authenticator" htmlFor="mfa-code" hint="Enter the current code to finish setup."><Input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={8} required value={code} onChange={(event) => setCode(event.target.value)} /></Field>
          <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy || !/^\d{6,8}$/.test(code.trim())}>{busy ? 'Verifying…' : 'Verify and enable'}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => { setSecret(null); setCode(''); setError(null); }}>Cancel</Button></div>
        </form>}
      </CardContent>
    </Card>
  </div>;
}

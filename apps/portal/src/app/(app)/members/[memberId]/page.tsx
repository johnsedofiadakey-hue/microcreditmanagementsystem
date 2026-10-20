'use client';

import { formatCedis, openSusuAccountRequestSchema } from '@susu/shared';
import { ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, Loader2, PiggyBank, ShieldCheck, UserX } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { NativeSelect } from '@/components/ui/input';
import { KycChip, RecordStatus } from '@/components/ui/status-chip';
import { can } from '@/lib/access';
import { useSession } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import { LoadError } from '@/components/load-error';
import { AssignCollectorDialog } from './assign-collector-dialog';
import { toActionError } from '@/lib/errors';
import { approveMember, getMember, listSusuProducts, openSusuAccount, type MemberProfile } from '@/lib/members-api';
import { useAction } from '@/lib/use-action';
import { useBusinesses } from '@/lib/use-businesses';
import { useList } from '@/lib/use-list';
import { formatDateTime } from '@/lib/utils';

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function ApprovalPanel({ member }: { member: MemberProfile }) {
  const { user, claims } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMaker = member.createdBy === user.uid;
  const checker = can.approveMember(claims.role);

  if (member.status !== 'PENDING_APPROVAL') return null;

  return (
    <Card className="border-warning/30 bg-warning-soft/40">
      <CardContent className="grid gap-3">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-5 text-warning" aria-hidden />
          <div className="grid gap-1">
            <p className="font-heading font-bold">Awaiting approval</p>
            <p className="text-sm text-muted-foreground">
              Registered by <span className="font-mono text-xs">{isMaker ? 'you' : member.createdBy}</span> on{' '}
              {formatDateTime(member.createdAt)}. Check the details against the Ghana Card before approving. A Susu account
              can only be opened after approval.
            </p>
          </div>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        {!checker ? (
          <p className="text-sm text-muted-foreground">A branch manager, compliance officer or administrator approves new members.</p>
        ) : isMaker ? (
          <Alert tone="info">You registered this member, so a different person must approve them.</Alert>
        ) : (
          <div>
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await approveMember({ memberId: member.id });
                  toast.success(`${member.fullName} approved`, { description: 'You can now open a Susu account for them.' });
                } catch (err) {
                  setError(toActionError(err).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Approve member
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function OpenAccountDialog({ member }: { member: MemberProfile }) {
  const [open, setOpen] = useState(false);
  const { name: businessName } = useBusinesses();
  const { rows: products } = useList(() => listSusuProducts().then((r) => r.products.filter((p) => p.status === 'ACTIVE')), []);
  const [productId, setProductId] = useState('');
  const action = useAction(openSusuAccountRequestSchema, openSusuAccount);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const result = await action.run({ memberId: member.id, productId });
    if (result) {
      toast.success('Susu account opened', { description: 'Balance GH₵ 0.00. Collections recorded by agents will appear on it.' });
      setOpen(false);
      setProductId('');
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) action.reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <PiggyBank /> Open Susu account
        </Button>
      </DialogTrigger>
      <DialogContent title="Open a Susu account" description={`For ${member.fullName}. The account starts at GH₵ 0.00.`}>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          {action.error && <Alert tone="error">{action.error.message}</Alert>}
          <Field label="Product" htmlFor="acct-product" hint="Only the current version of each product is offered.">
            <NativeSelect id="acct-product" value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">Select a product</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {businessName(p.businessId)} — {p.name} · {p.frequency.toLowerCase()} · v{p.version}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={action.busy || !productId}>
              {action.busy && <Loader2 className="animate-spin" />} Open account
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function MemberProfilePage() {
  const { memberId } = useParams<{ memberId: string }>();
  const { claims } = useSession();
  const { branchName } = useBranch();
  const [reveal, setReveal] = useState(false);
  const { rows, loading, error } = useList(() => getMember({ memberId }).then((m) => (m ? [m] : [])), [memberId]);
  const member = rows[0];
  const fullCard = can.seeFullGhanaCard(claims.role);

  if (loading && !member) {
    return <Loader2 className="mx-auto mt-20 size-6 animate-spin text-primary" aria-label="Loading member" />;
  }
  if (!member && error) {
    return (
      <div className="py-20">
        <LoadError error={error} />
      </div>
    );
  }
  if (!member) {
    return (
      <div className="py-20">
        <EmptyState
          icon={UserX}
          title="Member not found"
          description="They may belong to a branch you can't see, or the link is wrong."
          action={
            <Button asChild variant="outline">
              <Link href="/members">Back to members</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const businessBalances = Array.from(
    member.accounts.reduce((balances, account) => {
      const current = balances.get(account.businessId);
      balances.set(account.businessId, {
        name: account.businessName,
        balancePesewas: (current?.balancePesewas ?? 0) + account.balancePesewas,
      });
      return balances;
    }, new Map<string, { name: string; balancePesewas: number }>()),
  );

  return (
    <div className="grid gap-6">
      <Link href="/members" className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Members
      </Link>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-2xl font-bold tracking-tight">{member.fullName}</h1>

          </div>
          <div className="flex flex-wrap items-center gap-2">
            <RecordStatus status={member.status} />
            <KycChip status={member.kycStatus} />
            <span className="text-[13px] text-muted-foreground">{branchName(member.branchId)}</span>
          </div>
        </div>
        {businessBalances.length > 0 && (
          <dl className="grid gap-2 text-left sm:text-right" aria-label="Balances by business">
            {businessBalances.map(([businessId, balance]) => (
              <div key={businessId}>
                <dt className="text-[13px] text-muted-foreground">{balance.name} balance</dt>
                <dd className="money font-heading text-xl font-bold">{formatCedis(balance.balancePesewas)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <ApprovalPanel member={member} />

      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
            <CardDescription>As captured at registration.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4">
              <Detail label="Mobile">{member.phone}</Detail>
              <Detail label="Ghana Card">
                <span className="flex items-center gap-2 font-mono">
                  {fullCard && reveal && member.ghanaCardNumber ? member.ghanaCardNumber : member.ghanaCardMasked}
                  {fullCard && member.ghanaCardNumber && (
                    <button
                      type="button"
                      onClick={() => setReveal((r) => !r)}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                      aria-label={reveal ? 'Hide Ghana Card number' : 'Show full Ghana Card number'}
                    >
                      {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  )}
                </span>
              </Detail>
              <Detail label="Date of birth">{member.dateOfBirth}</Detail>
              <Detail label="Photos">
                {member.photoUrls.length > 0 ? (
                  <span className="flex flex-wrap gap-2">
                    {member.photoUrls.map((url, i) => (
                      <a key={url} href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border border-border">
                        <img src={url} alt={`KYC photo ${i + 1}`} className="size-20 object-cover" />
                      </a>
                    ))}
                  </span>
                ) : member.photoCount ? (
                  `${member.photoCount} captured`
                ) : (
                  'None captured'
                )}
              </Detail>
              <Detail label="Registered">
                {formatDateTime(member.createdAt)} · <span className="font-mono text-xs">{member.createdBy}</span>
              </Detail>
              {member.approvedAt && (
                <Detail label="Approved">
                  {formatDateTime(member.approvedAt)} · <span className="font-mono text-xs">{member.approvedBy}</span>
                </Detail>
              )}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div className="grid gap-1">
              <CardTitle>Susu accounts</CardTitle>
              <CardDescription>Balances are what the company owes the member.</CardDescription>
            </div>
            {member.status === 'ACTIVE' && can.openSusuAccount(claims.role) && <OpenAccountDialog member={member} />}
          </CardHeader>
          <CardContent>
            {member.accounts.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {member.status === 'ACTIVE' ? 'No Susu account yet. Open one to start collecting.' : 'Accounts can be opened once the member is approved.'}
              </p>
            ) : (
              <ul className="grid divide-y divide-border">
                {member.accounts.map((a) => (
                  <li key={a.id}>
                    <Link
                      href={`/members/${member.id}/accounts/${a.id}`}
                      className="group flex items-center gap-3 py-3 focus-visible:outline-none"
                    >
                      <div className="grid flex-1 gap-0.5">
                        <span className="flex items-center gap-2 font-medium group-hover:text-primary group-focus-visible:underline">
                          {a.productName}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {a.businessName} · <span className="font-mono">{a.id.slice(0, 8)}</span>
                        </span>
                      </div>
                      <RecordStatus status={a.status} />
                      <span className="money w-32 text-right font-medium">{formatCedis(a.balancePesewas)}</span>
                      <ArrowRight className="size-4 text-muted-foreground group-hover:text-primary" />
                    </Link>
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
                      <p className="text-[13px] text-muted-foreground">
                        {a.collector ? (
                          <>
                            Collected by <span className="font-medium text-foreground">{a.collector.agentPairName}</span> ·{' '}
                            <span className="money">{formatCedis(a.collector.expectedPesewas)}</span> per visit
                          </>
                        ) : a.status === 'ACTIVE' ? (
                          'Not on any route yet — agents can’t see this account.'
                        ) : (
                          'Not on any route.'
                        )}
                      </p>
                      {member.status === 'ACTIVE' && a.status === 'ACTIVE' && can.assignCollector(claims.role) && (
                        <AssignCollectorDialog account={a} branchId={member.branchId} memberName={member.fullName} />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

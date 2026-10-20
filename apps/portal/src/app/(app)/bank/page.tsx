'use client';

import {
  createBankAccountRequestSchema,
  formatCedis,
  type BankAccountSummary,
  type BankDepositSummary,
  type BankLineStatus,
  type BankStatementLineSummary,
} from '@susu/shared';
import { Ban, FileUp, Landmark, Link2, Loader2, Plus } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { LoadError } from '@/components/load-error';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { ListPager } from '@/components/ui/list-pager';
import { PageHeader } from '@/components/ui/page-header';
import { StatusChip } from '@/components/ui/status-chip';
import { can } from '@/lib/access';
import { useSession } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import {
  createBankAccount,
  ignoreBankStatementLine,
  listBankAccounts,
  listBankDeposits,
  listBankStatementLines,
  matchBankDeposit,
} from '@/lib/bank-api';
import { toActionError } from '@/lib/errors';
import { useAction } from '@/lib/use-action';
import { useBusinesses } from '@/lib/use-businesses';
import { useList } from '@/lib/use-list';
import { usePagedList } from '@/lib/use-paged-list';
import { cn, formatDateTime } from '@/lib/utils';
import { ImportStatementDialog } from './import-dialog';

type Tab = 'deposits' | 'lines';
type Candidate = BankDepositSummary['candidates'][number];

function AddAccountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { businesses } = useBusinesses();
  const [businessId, setBusinessId] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountName, setAccountName] = useState('');
  const [last4, setLast4] = useState('');
  const action = useAction(createBankAccountRequestSchema, createBankAccount);

  useEffect(() => {
    if (open && !businessId && businesses[0]) setBusinessId(businesses[0].id);
  }, [open, businessId, businesses]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await action.run({ businessId, bankName, accountName, accountNumberLast4: last4 });
    if (result) {
      toast.success(`${bankName.trim()} account added`);
      setBankName('');
      setAccountName('');
      setLast4('');
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) { action.reset(); onClose(); } }}>
      <DialogContent title="Add a bank account" description="Each business banks separately. Only the last four digits of the account number are stored.">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          {action.error && !Object.keys(action.error.fieldErrors).length && <Alert tone="error">{action.error.message}</Alert>}
          <Field label="Business" htmlFor="ba-business" error={action.fieldError('businessId')}>
            <NativeSelect id="ba-business" value={businessId} onChange={(e) => setBusinessId(e.target.value)}>
              {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Bank" htmlFor="ba-bank" hint="e.g. GCB Bank, Ecobank Ghana" error={action.fieldError('bankName')}>
            <Input id="ba-bank" value={bankName} onChange={(e) => setBankName(e.target.value)} autoFocus />
          </Field>
          <Field label="Account name" htmlFor="ba-name" error={action.fieldError('accountName')}>
            <Input id="ba-name" value={accountName} onChange={(e) => setAccountName(e.target.value)} />
          </Field>
          <Field label="Last four digits of the account number" htmlFor="ba-last4" error={action.fieldError('accountNumberLast4')}>
            <Input id="ba-last4" inputMode="numeric" maxLength={4} value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, ''))} className="w-28 font-mono" />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={action.busy || last4.length !== 4}>
              {action.busy && <Loader2 className="animate-spin" />} Add account
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MatchDialog({
  selection,
  onClose,
}: {
  selection: { deposit: BankDepositSummary; candidate: Candidate } | null;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deposit = selection?.deposit;
  const candidate = selection?.candidate;
  const difference = deposit && candidate ? candidate.amountPesewas - deposit.amountPesewas : 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!deposit || !candidate || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await matchBankDeposit({ depositId: deposit.id, statementLineId: candidate.statementLineId, note: note.trim() || undefined });
      toast.success(result.differencePesewas === 0 ? 'Deposit confirmed by the bank' : 'Matched with a difference', {
        description: result.differencePesewas === 0 ? undefined : `${formatCedis(result.differencePesewas)} posted to branch variance and a difference case opened.`,
      });
      setNote('');
      onClose();
    } catch (cause) {
      setError(toActionError(cause).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!selection} onOpenChange={(next) => { if (!next && !busy) { setError(null); setNote(''); onClose(); } }}>
      <DialogContent title="Match deposit to bank line" description="Matching moves the money from cash in transit to the bank. It can’t be undone from the portal.">
        {deposit && candidate && (
          <form onSubmit={submit} className="grid gap-4">
            {error && <Alert tone="error">{error}</Alert>}
            <dl className="grid gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
              <div className="flex justify-between gap-3"><dt>Deposit recorded</dt><dd className="money font-medium">{formatCedis(deposit.amountPesewas)}</dd></div>
              <div className="flex justify-between gap-3"><dt>Slip / deposited on</dt><dd className="text-right"><span className="font-mono">{deposit.slipReference}</span> · {deposit.depositedOn}</dd></div>
              <div className="flex justify-between gap-3"><dt>Bank line</dt><dd className="money font-medium">{formatCedis(candidate.amountPesewas)}</dd></div>
              <div className="flex justify-between gap-3"><dt>Line date / reference</dt><dd className="text-right">{candidate.lineDate} · <span className="font-mono">{candidate.reference || '—'}</span></dd></div>
              <div className="flex justify-between gap-3 border-t border-border pt-2"><dt className="font-medium">Difference (bank − deposit)</dt><dd className={cn('money font-heading text-lg font-bold', difference !== 0 && 'text-warning')}>{formatCedis(difference)}</dd></div>
            </dl>
            {difference !== 0 && (
              <Alert tone="info">The difference is posted to the branch’s variance for this business and opens a “Bank deposit difference” case for follow-up.</Alert>
            )}
            <Field label="Note (optional)" htmlFor="match-note">
              <Textarea id="match-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => { setNote(''); setError(null); onClose(); }}>Cancel</Button>
              <Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" />} Match</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SetAsideDialog({ line, onClose }: { line: BankStatementLineSummary | null; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!line || busy) return;
    setBusy(true);
    setError(null);
    try {
      await ignoreBankStatementLine({ statementLineId: line.id, reason: reason.trim() });
      toast.success('Line set aside');
      setReason('');
      onClose();
    } catch (cause) {
      setError(toActionError(cause).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!line} onOpenChange={(next) => { if (!next && !busy) { setError(null); setReason(''); onClose(); } }}>
      <DialogContent title="Set this line aside?" description="For bank lines that are not branch deposits: charges, transfers, interest. It stays visible under “Set aside”.">
        {line && (
          <form onSubmit={submit} className="grid gap-4">
            {error && <Alert tone="error">{error}</Alert>}
            <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
              {line.lineDate} · <strong className="money">{formatCedis(line.amountPesewas)}</strong> · {line.description || line.reference || 'No description'}
            </p>
            <Field label="Reason" htmlFor="aside-reason" hint="Recorded in the audit log.">
              <Textarea id="aside-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Monthly account maintenance fee" autoFocus />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => { setReason(''); setError(null); onClose(); }}>Cancel</Button>
              <Button type="submit" disabled={busy || reason.trim().length < 3}>{busy && <Loader2 className="animate-spin" />} Set aside</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DepositsToMatch({ account, canAct }: { account: BankAccountSummary; canAct: boolean }) {
  const { user } = useSession();
  const { branchName } = useBranch();
  const [selection, setSelection] = useState<{ deposit: BankDepositSummary; candidate: Candidate } | null>(null);
  const { rows, nextCursor, loading, loadingMore, error, loadMore } = usePagedList(
    (cursor) =>
      listBankDeposits({ businessId: account.businessId, status: 'UNMATCHED', cursor }).then((r) => ({
        rows: r.deposits.filter((d) => d.bankAccountId === account.id),
        nextCursor: r.nextCursor,
      })),
    [account.id],
  );

  return (
    <div className="grid gap-3">
      <LoadError error={error} />
      {loading ? (
        <p role="status" className="text-sm text-muted-foreground">Loading deposits…</p>
      ) : rows.length === 0 ? (
        <Card><CardContent className="text-sm text-muted-foreground">No deposits are waiting for a bank match on this account.</CardContent></Card>
      ) : (
        rows.map((d) => {
          const own = d.recordedBy === user.uid;
          return (
            <Card key={d.id}>
              <CardContent className="grid gap-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="grid gap-0.5">
                    <p className="font-medium">{branchName(d.branchId)}</p>
                    <p className="text-[13px] text-muted-foreground">
                      Slip <span className="font-mono">{d.slipReference}</span> · deposited {d.depositedOn} · covers {d.days.map((x) => x.day).join(', ')}
                    </p>
                    <p className="text-xs text-muted-foreground">Recorded {formatDateTime(d.recordedAt)}</p>
                  </div>
                  <span className="money font-heading text-lg font-bold">{formatCedis(d.amountPesewas)}</span>
                </div>
                {own && <Alert tone="info">You recorded this deposit, so a different person must match it.</Alert>}
                {d.candidates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No unmatched credit on this account within 14 days of the deposit. Import a newer statement.</p>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {d.candidates.map((c) => (
                      <li key={c.statementLineId} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                        <span className="tabular-nums">{c.lineDate}</span>
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-mono text-xs">{c.reference || '—'}</span> · {c.description || 'No description'}
                        </span>
                        {c.sameAmount && <StatusChip tone="success" dot={false}>Same amount</StatusChip>}
                        {c.referenceMatches && <StatusChip tone="success" dot={false}>Reference matches</StatusChip>}
                        <span className="money font-medium">{formatCedis(c.amountPesewas)}</span>
                        {canAct && !own && (
                          <Button size="sm" variant="outline" onClick={() => setSelection({ deposit: d, candidate: c })}>
                            <Link2 /> Match
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })
      )}
      <ListPager count={rows.length} hasMore={!!nextCursor} loading={loadingMore} onLoadMore={loadMore} />
      <MatchDialog selection={selection} onClose={() => setSelection(null)} />
    </div>
  );
}

function StatementLines({ account, canAct }: { account: BankAccountSummary; canAct: boolean }) {
  const [status, setStatus] = useState<BankLineStatus | ''>('UNMATCHED');
  const [aside, setAside] = useState<BankStatementLineSummary | null>(null);
  const { rows, nextCursor, loading, loadingMore, error, loadMore } = usePagedList(
    (cursor) =>
      listBankStatementLines({ bankAccountId: account.id, status: status || undefined, cursor }).then((r) => ({ rows: r.lines, nextCursor: r.nextCursor })),
    [account.id, status],
  );

  return (
    <div className="grid gap-3">
      <Field label="Show" htmlFor="line-status" className="w-56">
        <NativeSelect id="line-status" value={status} onChange={(e) => setStatus(e.target.value as BankLineStatus | '')}>
          <option value="UNMATCHED">Unmatched</option>
          <option value="MATCHED">Matched to a deposit</option>
          <option value="IGNORED">Set aside</option>
          <option value="">All lines</option>
        </NativeSelect>
      </Field>
      <LoadError error={error} />
      <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-xs">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground uppercase">
            <tr>
              <th scope="col" className="h-10 px-4 text-left font-medium">Date</th>
              <th scope="col" className="px-4 text-left font-medium">Reference · description</th>
              <th scope="col" className="px-4 text-right font-medium">Amount</th>
              <th scope="col" className="hidden px-4 text-right font-medium xl:table-cell">Balance</th>
              <th scope="col" className="px-4 text-left font-medium">Status</th>
              <th scope="col" className="px-4"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-6 text-muted-foreground" role="status">Loading statement lines…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No lines here. Import the account’s statement to start matching.</td></tr>
            ) : (
              rows.map((line) => (
                <tr key={line.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 whitespace-nowrap tabular-nums">{line.lineDate}</td>
                  <td className="max-w-xs px-4 py-3">
                    <span className="font-mono text-xs">{line.reference || '—'}</span>
                    <span className="block truncate text-[13px] text-muted-foreground">{line.description || 'No description'}</span>
                    {line.ignoredReason && <span className="block text-xs text-muted-foreground">Set aside: {line.ignoredReason}</span>}
                  </td>
                  <td className={cn('money px-4 py-3 text-right font-medium', line.amountPesewas > 0 ? 'text-success' : '')}>{formatCedis(line.amountPesewas)}</td>
                  <td className="money hidden px-4 py-3 text-right text-muted-foreground xl:table-cell">{line.balanceAfterPesewas === null ? '—' : formatCedis(line.balanceAfterPesewas)}</td>
                  <td className="px-4 py-3">
                    <StatusChip tone={line.status === 'MATCHED' ? 'success' : line.status === 'IGNORED' ? 'neutral' : 'warning'}>
                      {line.status === 'MATCHED' ? 'Matched' : line.status === 'IGNORED' ? 'Set aside' : 'Unmatched'}
                    </StatusChip>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canAct && line.status === 'UNMATCHED' && (
                      <Button size="sm" variant="ghost" onClick={() => setAside(line)}><Ban /> Set aside</Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <ListPager count={rows.length} hasMore={!!nextCursor} loading={loadingMore} onLoadMore={loadMore} />
      <SetAsideDialog line={aside} onClose={() => setAside(null)} />
    </div>
  );
}

export default function BankPage() {
  const { claims } = useSession();
  const { businesses, name: businessName } = useBusinesses();
  const [businessId, setBusinessId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [tab, setTab] = useState<Tab>('deposits');
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const canAct = can.reconcileBank(claims.role);
  const { rows: accounts, loading, error } = useList(
    () => listBankAccounts({ businessId: businessId || undefined }).then((r) => r.bankAccounts),
    [businessId],
  );
  const account = accounts.find((a) => a.id === accountId) ?? accounts[0];

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Bank reconciliation"
        description="Match each branch deposit to the bank statement. Finance does the matching; the person who recorded a deposit can’t match it."
        actions={canAct && <Button variant="outline" onClick={() => setAdding(true)}><Plus /> Add bank account</Button>}
      />
      <Field label="Business" htmlFor="bank-business" className="w-72">
        <NativeSelect id="bank-business" value={businessId} onChange={(e) => { setBusinessId(e.target.value); setAccountId(''); }}>
          <option value="">All businesses</option>
          {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </NativeSelect>
      </Field>
      <LoadError error={error} />

      {loading ? (
        <p role="status" className="text-sm text-muted-foreground">Loading bank accounts…</p>
      ) : accounts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <Landmark className="size-6 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">
              {canAct ? 'No bank accounts yet. Add each business’s deposit account so branches can record deposits against it.' : 'No bank accounts have been registered yet.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div role="radiogroup" aria-label="Bank account" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {accounts.map((a) => {
              const selected = account?.id === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setAccountId(a.id)}
                  className={cn(
                    'rounded-xl border bg-surface p-4 text-left shadow-xs transition focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                    selected ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-primary/40',
                  )}
                >
                  <p className="text-[13px] text-muted-foreground">{businessName(a.businessId)}</p>
                  <p className="font-heading font-bold">{a.bankName}</p>
                  <p className="text-[13px]">{a.accountName} · <span className="font-mono">••••{a.accountNumberLast4}</span></p>
                  <p className="mt-2 text-xs text-muted-foreground">Confirmed by bank matches</p>
                  <p className="money font-heading text-lg font-bold">{formatCedis(a.balancePesewas)}</p>
                  {a.status !== 'ACTIVE' && <StatusChip tone="neutral">Closed</StatusChip>}
                </button>
              );
            })}
          </div>

          {account && (
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div className="grid gap-1">
                  <CardTitle>{account.bankName} · ••••{account.accountNumberLast4}</CardTitle>
                  <CardDescription>{businessName(account.businessId)}</CardDescription>
                </div>
                {canAct && <Button size="sm" onClick={() => setImporting(true)}><FileUp /> Import statement</Button>}
              </CardHeader>
              <CardContent className="grid gap-4">
                <div role="group" aria-label="Reconciliation view" className="flex gap-1 border-b border-border">
                  {([['deposits', 'Deposits to match'], ['lines', 'Statement lines']] as const).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={tab === id}
                      onClick={() => setTab(id)}
                      className={cn(
                        'min-h-11 border-b-2 px-3 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                        tab === id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {tab === 'deposits' ? (
                  <DepositsToMatch key={account.id} account={account} canAct={canAct} />
                ) : (
                  <StatementLines key={account.id} account={account} canAct={canAct} />
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
      {canAct && <AddAccountDialog open={adding} onClose={() => setAdding(false)} />}
      {canAct && account && <ImportStatementDialog account={account} open={importing} onClose={() => setImporting(false)} />}
    </div>
  );
}


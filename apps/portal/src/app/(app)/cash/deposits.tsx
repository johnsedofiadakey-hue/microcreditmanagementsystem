'use client';

import { formatCedis, parseCedis, type BankAccountSummary, type BankDepositSummary, type BranchDayDashboard } from '@susu/shared';
import { doc, getDoc } from 'firebase/firestore';
import { Landmark, Loader2, Plus } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { LoadError } from '@/components/load-error';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { ListPager } from '@/components/ui/list-pager';
import { StatusChip } from '@/components/ui/status-chip';
import { useSession } from '@/lib/auth-context';
import { listBankAccounts, listBankDeposits, recordBankDeposit } from '@/lib/bank-api';
import { getBranchCashDay } from '@/lib/cash-api';
import { toActionError } from '@/lib/errors';
import { firebase } from '@/lib/firebase';
import { useBusinesses } from '@/lib/use-businesses';
import { usePagedList } from '@/lib/use-paged-list';
import { formatDateTime, todayKey } from '@/lib/utils';

/** How far back the deposit form looks for closed days that still have cash to bank. */
const LOOKBACK_DAYS = 14;

function daysBack(count: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

interface BankableDay {
  day: string;
  countedPesewas: number;
  depositedPesewas: number;
  leftPesewas: number;
}

/**
 * Closed days of one business in this branch with cash still to bank: what the close counted, minus
 * what deposits already cover (from the published day dashboard). The server re-checks all of it.
 */
async function loadBankableDays(branchId: string, businessId: string): Promise<BankableDay[]> {
  const { db } = firebase();
  const days = daysBack(LOOKBACK_DAYS);
  const results = await Promise.all(
    days.map(async (day) => {
      const [cashDay, dashboard] = await Promise.all([
        getBranchCashDay({ branchId, day }),
        getDoc(doc(db, 'branchDashboards', branchId, 'days', day)).catch(() => null),
      ]);
      const item = cashDay.businesses.find((b) => b.businessId === businessId);
      if (!item || item.status !== 'CLOSED' || !item.count) return null;
      const published = dashboard?.exists() ? (dashboard.data() as BranchDayDashboard) : null;
      const depositedPesewas = published?.businesses.find((b) => b.businessId === businessId)?.depositedPesewas ?? 0;
      const leftPesewas = Math.max(0, item.count.countedPesewas - depositedPesewas);
      return { day, countedPesewas: item.count.countedPesewas, depositedPesewas, leftPesewas };
    }),
  );
  return results.filter((d): d is BankableDay => d !== null && d.leftPesewas > 0).sort((a, b) => (a.day < b.day ? -1 : 1));
}

function RecordDepositDialog({
  open,
  onClose,
  branchId,
  defaultBusinessId,
}: {
  open: boolean;
  onClose: () => void;
  branchId: string;
  defaultBusinessId: string;
}) {
  const { businesses } = useBusinesses();
  const [businessId, setBusinessId] = useState(defaultBusinessId);
  const [accounts, setAccounts] = useState<BankAccountSummary[]>([]);
  const [bankAccountId, setBankAccountId] = useState('');
  const [slipReference, setSlip] = useState('');
  const [depositedOn, setDepositedOn] = useState(todayKey());
  const [note, setNote] = useState('');
  const [bankable, setBankable] = useState<BankableDay[] | null>(null);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [loadingDays, setLoadingDays] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setBusinessId(defaultBusinessId || businesses[0]?.id || '');
  }, [open, defaultBusinessId, businesses]);

  useEffect(() => {
    if (!open || !businessId) return;
    let alive = true;
    setBankAccountId('');
    setBankable(null);
    setAmounts({});
    setLoadingDays(true);
    listBankAccounts({ businessId })
      .then((r) => {
        if (!alive) return;
        const active = r.bankAccounts.filter((a) => a.status === 'ACTIVE');
        setAccounts(active);
        if (active.length === 1) setBankAccountId(active[0]!.id);
      })
      .catch((cause) => alive && setError(toActionError(cause).message));
    loadBankableDays(branchId, businessId)
      .then((days) => alive && setBankable(days))
      .catch((cause) => alive && setError(toActionError(cause).message))
      .finally(() => alive && setLoadingDays(false));
    return () => {
      alive = false;
    };
  }, [open, branchId, businessId]);

  const lines = useMemo(() => {
    const out: { day: string; amountPesewas: number }[] = [];
    let invalid = false;
    for (const d of bankable ?? []) {
      const raw = amounts[d.day]?.trim();
      if (!raw) continue;
      try {
        const pesewas = parseCedis(raw);
        if (pesewas > 0) out.push({ day: d.day, amountPesewas: pesewas });
      } catch {
        invalid = true;
      }
    }
    return { out, invalid };
  }, [amounts, bankable]);
  const total = lines.out.reduce((sum, l) => sum + l.amountPesewas, 0);
  const overDay = (bankable ?? []).find((d) => {
    const line = lines.out.find((l) => l.day === d.day);
    return line && line.amountPesewas > d.leftPesewas;
  });
  const tooEarly = lines.out.some((l) => l.day > depositedOn);

  function reset() {
    setSlip('');
    setNote('');
    setAmounts({});
    setError(null);
    setDepositedOn(todayKey());
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !lines.out.length) return;
    setBusy(true);
    setError(null);
    try {
      const result = await recordBankDeposit({
        branchId,
        businessId,
        bankAccountId,
        amountPesewas: total,
        slipReference: slipReference.trim(),
        depositedOn,
        days: lines.out,
        note: note.trim() || undefined,
      });
      toast.success(`Deposit of ${formatCedis(total)} recorded`, {
        description: `Reference ${result.depositId.slice(0, 8).toUpperCase()}. Finance matches it to the bank statement.`,
      });
      reset();
      onClose();
    } catch (cause) {
      setError(toActionError(cause).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) { reset(); onClose(); } }}>
      <DialogContent
        className="max-w-2xl"
        title="Record a bank deposit"
        description="Cash taken from this business’s vault to its bank. It stays “Awaiting bank match” until finance matches it to the bank statement."
      >
        <form onSubmit={submit} className="grid gap-4" noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Business" htmlFor="dep-business">
              <NativeSelect id="dep-business" value={businessId} onChange={(e) => setBusinessId(e.target.value)}>
                {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Bank account" htmlFor="dep-account" hint={accounts.length ? undefined : 'Finance registers this business’s bank accounts first.'}>
              <NativeSelect id="dep-account" value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} disabled={!accounts.length}>
                <option value="">{accounts.length ? 'Select the account' : 'No bank account yet'}</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.bankName} · {a.accountName} · ••••{a.accountNumberLast4}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Deposit slip reference" htmlFor="dep-slip" hint="As printed on the bank’s slip or teller receipt.">
              <Input id="dep-slip" value={slipReference} onChange={(e) => setSlip(e.target.value)} className="font-mono" autoComplete="off" />
            </Field>
            <Field label="Deposited on" htmlFor="dep-date">
              <Input id="dep-date" type="date" value={depositedOn} max={todayKey()} onChange={(e) => e.target.value && setDepositedOn(e.target.value)} />
            </Field>
          </div>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-[13px] font-medium">Which closed days this cash came from</legend>
            {loadingDays ? (
              <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Checking the last {LOOKBACK_DAYS} days…</p>
            ) : !bankable?.length ? (
              <Alert tone="info">No closed day in the last {LOOKBACK_DAYS} days has cash left to bank for this business.</Alert>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs text-muted-foreground uppercase">
                    <tr>
                      <th scope="col" className="px-3 py-2 text-left font-medium">Day</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Close counted</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Left to bank</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">In this deposit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bankable.map((d) => (
                      <tr key={d.day} className="border-t border-border">
                        <td className="px-3 py-2 tabular-nums">{d.day}</td>
                        <td className="money px-3 py-2 text-right">{formatCedis(d.countedPesewas)}</td>
                        <td className="money px-3 py-2 text-right">{formatCedis(d.leftPesewas)}</td>
                        <td className="px-3 py-1.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              className="text-xs font-medium text-primary hover:underline"
                              onClick={() => setAmounts((a) => ({ ...a, [d.day]: (d.leftPesewas / 100).toFixed(2) }))}
                            >
                              All
                            </button>
                            <Input
                              aria-label={`Amount deposited from ${d.day}`}
                              inputMode="decimal"
                              placeholder="0.00"
                              value={amounts[d.day] ?? ''}
                              onChange={(e) => setAmounts((a) => ({ ...a, [d.day]: e.target.value }))}
                              className="h-9 w-32 text-right tabular-nums"
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {lines.invalid && <p role="alert" className="text-[13px] text-destructive">Amounts must look like 1250 or 1,250.50.</p>}
            {overDay && <p role="alert" className="text-[13px] text-destructive">{overDay.day}: more than is left to bank for that day.</p>}
            {tooEarly && <p role="alert" className="text-[13px] text-destructive">A deposit can’t be dated before a day it covers.</p>}
          </fieldset>

          <Field label="Note (optional)" htmlFor="dep-note">
            <Textarea id="dep-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>

          <div className="flex items-center justify-between rounded-lg bg-muted/40 px-4 py-3">
            <span className="text-sm text-muted-foreground">Deposit total</span>
            <span className="money font-heading text-xl font-bold">{formatCedis(total)}</span>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { reset(); onClose(); }} disabled={busy}>Cancel</Button>
            <Button
              type="submit"
              disabled={busy || !bankAccountId || !slipReference.trim() || !lines.out.length || lines.invalid || !!overDay || tooEarly}
            >
              {busy && <Loader2 className="animate-spin" />} Record deposit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DepositRow({ row, businessName }: { row: BankDepositSummary; businessName: (id: string) => string }) {
  const diff = row.match?.differencePesewas ?? 0;
  return (
    <li className="grid gap-2 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="grid gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{businessName(row.businessId)}</span>
          <StatusChip tone={row.status === 'MATCHED' ? (diff === 0 ? 'success' : 'warning') : 'warning'}>
            {row.status === 'MATCHED' ? (diff === 0 ? 'Bank confirmed' : 'Matched with difference') : 'Awaiting bank match'}
          </StatusChip>
        </div>
        <p className="text-[13px] text-muted-foreground">
          Slip <span className="font-mono">{row.slipReference}</span> · deposited {row.depositedOn} · covers {row.days.map((d) => d.day).join(', ')}
        </p>
        <p className="text-xs text-muted-foreground">Recorded {formatDateTime(row.recordedAt)}{row.note ? ` · ${row.note}` : ''}</p>
        {row.match && diff !== 0 && (
          <p className="text-[13px] text-warning">
            Bank shows {formatCedis(row.match.bankAmountPesewas)} ({diff < 0 ? 'short' : 'over'} by {formatCedis(Math.abs(diff))}). A difference case is open.
          </p>
        )}
      </div>
      <span className="money text-right font-heading text-lg font-bold">{formatCedis(row.amountPesewas)}</span>
    </li>
  );
}

export function DepositsView({ branchId, businessId, refresh, businessName }: { branchId: string; businessId: string; refresh: number; businessName: (id: string) => string }) {
  const { claims } = useSession();
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState<'' | 'UNMATCHED' | 'MATCHED'>('');
  const canRecord = claims.role === 'CASHIER' || claims.role === 'BRANCH_MANAGER';
  const { rows, nextCursor, loading, loadingMore, error, loadMore } = usePagedList(
    (cursor) =>
      listBankDeposits({ branchId, businessId: businessId || undefined, status: status || undefined, cursor }).then((r) => ({
        rows: r.deposits,
        nextCursor: r.nextCursor,
      })),
    [branchId, businessId, status, refresh],
  );
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label="Show" htmlFor="dep-status" className="w-56">
          <NativeSelect id="dep-status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="">All deposits</option>
            <option value="UNMATCHED">Awaiting bank match</option>
            <option value="MATCHED">Matched</option>
          </NativeSelect>
        </Field>
        {canRecord && (
          <Button onClick={() => setRecording(true)}>
            <Plus /> Record deposit
          </Button>
        )}
      </div>
      <LoadError error={error} />
      <Card>
        <CardContent className="py-0">
          {loading ? (
            <p role="status" className="py-6 text-sm text-muted-foreground">Loading deposits…</p>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Landmark className="size-6 text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">
                No deposits yet. After a business closes its day, record the cash taken to the bank here.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">{rows.map((row) => <DepositRow key={row.id} row={row} businessName={businessName} />)}</ul>
          )}
        </CardContent>
      </Card>
      <ListPager count={rows.length} hasMore={!!nextCursor} loading={loadingMore} onLoadMore={loadMore} />
      {canRecord && <RecordDepositDialog open={recording} onClose={() => setRecording(false)} branchId={branchId} defaultBusinessId={businessId} />}
    </div>
  );
}

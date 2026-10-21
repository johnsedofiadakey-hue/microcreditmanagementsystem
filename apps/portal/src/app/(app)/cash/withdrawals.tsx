'use client';

import { formatCedis, type WithdrawalStatus, type WithdrawalSummary } from '@susu/shared';
import { ArrowRight, BanknoteArrowDown, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { LoadError } from '@/components/load-error';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { NativeSelect, Textarea } from '@/components/ui/input';
import { ListPager } from '@/components/ui/list-pager';
import { StatusChip } from '@/components/ui/status-chip';
import { useSession } from '@/lib/auth-context';
import { approveWithdrawal, listWithdrawals, payWithdrawal, rejectWithdrawal } from '@/lib/cash-api';
import { toActionError } from '@/lib/errors';
import { usePagedList } from '@/lib/use-paged-list';
import { formatDateTime } from '@/lib/utils';

type Decision = 'approve' | 'reject' | 'pay';

function statusTone(status: WithdrawalStatus): 'success' | 'danger' | 'info' | 'warning' {
  if (status === 'PAID') return 'success';
  if (status === 'REJECTED') return 'danger';
  if (status === 'APPROVED') return 'info';
  return 'warning';
}

function statusLabel(status: WithdrawalStatus) {
  return status === 'PENDING_APPROVAL' ? 'Awaiting approval' : status.charAt(0) + status.slice(1).toLowerCase();
}

function DecisionDialog({
  selection,
  businessName,
  onClose,
}: {
  selection: { row: WithdrawalSummary; decision: Decision } | null;
  businessName: (id: string) => string;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const row = selection?.row;
  const decision = selection?.decision;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!row || !decision || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (decision === 'approve') await approveWithdrawal({ withdrawalId: row.id });
      else if (decision === 'reject') await rejectWithdrawal({ withdrawalId: row.id, reason: reason.trim() });
      else await payWithdrawal({ withdrawalId: row.id });
      toast.success(decision === 'approve' ? 'Withdrawal approved' : decision === 'reject' ? 'Withdrawal rejected' : 'Payout recorded');
      onClose();
    } catch (cause) {
      setError(toActionError(cause).message);
    } finally {
      setBusy(false);
    }
  }

  const title = decision === 'pay' ? 'Confirm cash payout' : decision === 'reject' ? 'Reject withdrawal' : 'Approve withdrawal';
  return (
    <Dialog open={!!selection} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent title={title} description="Check the member, business and amount before continuing.">
        {row && (
          <form onSubmit={submit} className="grid gap-4">
            <dl className="grid gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
              <div className="flex justify-between gap-3"><dt>Member</dt><dd className="text-right font-medium">{row.memberName}</dd></div>
              <div className="flex justify-between gap-3"><dt>Business</dt><dd className="text-right font-medium">{businessName(row.businessId)}</dd></div>
              <div className="flex justify-between gap-3"><dt>Amount</dt><dd className="money font-heading text-lg font-bold">{formatCedis(row.amountPesewas)}</dd></div>
              <div className="flex justify-between gap-3"><dt>Reference</dt><dd className="font-mono text-xs">{row.id.slice(0, 8).toUpperCase()}</dd></div>
            </dl>
            {decision === 'pay' && (
              <Alert tone="info">Pay only after verifying the member and counting out this business’s cash. This records a final ledger payout and sends a receipt.</Alert>
            )}
            {decision === 'approve' && (
              <Alert tone="info">Approval releases no cash. A different cashier must make the payout.</Alert>
            )}
            {decision === 'reject' && (
              <Field label="Reason" htmlFor="withdrawal-reject-reason" hint="The reason becomes part of this request’s record.">
                <Textarea id="withdrawal-reject-reason" required minLength={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
              </Field>
            )}
            {error && <Alert tone="error">{error}</Alert>}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
              <Button type="submit" variant={decision === 'reject' ? 'destructive' : 'default'} disabled={busy || (decision === 'reject' && reason.trim().length < 3)}>
                {busy ? 'Working…' : decision === 'pay' ? 'Record payout' : decision === 'reject' ? 'Reject request' : 'Approve request'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function WithdrawalResults({
  branchId,
  businessId,
  status,
  refresh,
  businessName,
}: {
  branchId: string;
  businessId: string;
  status: WithdrawalStatus | '';
  refresh: number;
  businessName: (id: string) => string;
}) {
  const { user, claims } = useSession();
  const { rows, loading, loadingMore, nextCursor, error, loadMore } = usePagedList(
    async (cursor) => {
      const result = await listWithdrawals({ branchId, businessId: businessId || undefined, status: status || undefined, cursor: cursor ?? undefined });
      return { rows: result.withdrawals, nextCursor: result.nextCursor ?? null };
    },
    [branchId, businessId, status, refresh],
  );
  const [selection, setSelection] = useState<{ row: WithdrawalSummary; decision: Decision } | null>(null);
  const role = claims.role;

  return (
    <>
      <LoadError error={error} />
      {loading ? (
        <Card><CardContent role="status" className="text-sm text-muted-foreground">Loading withdrawal requests…</CardContent></Card>
      ) : error ? null : rows.length === 0 ? (
        <Card><CardContent className="text-sm text-muted-foreground">No withdrawal requests match this selection.</CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {rows.map((row) => {
            const canCheck = row.status === 'PENDING_APPROVAL' && row.requestedBy !== user.uid &&
              (role === 'SUPER_ADMIN' || role === 'FINANCE' || (role === 'BRANCH_MANAGER' && !row.needsHeadOffice));
            const canPay = row.status === 'APPROVED' && (role === 'CASHIER' || role === 'BRANCH_MANAGER') &&
              row.requestedBy !== user.uid && row.decidedBy !== user.uid;
            return (
              <Card key={row.id}>
                <CardContent className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-heading font-bold">{row.memberName}</span>
                      <StatusChip tone={statusTone(row.status)}>{statusLabel(row.status)}</StatusChip>
                      {row.needsHeadOffice && row.status === 'PENDING_APPROVAL' && <StatusChip tone="warning">Head office approval</StatusChip>}
                    </div>
                    <p className="text-[13px] text-muted-foreground">{businessName(row.businessId)} · requested {formatDateTime(row.requestedAt)} · <span className="font-mono">{row.id.slice(0, 8).toUpperCase()}</span></p>
                    <p className="text-sm">{row.reason}</p>
                    {row.status === 'REJECTED' && row.rejectReason && <p className="text-sm text-destructive">Reason: {row.rejectReason}</p>}
                    <Link href={`/members/${row.memberId}/accounts/${row.susuAccountId}`} className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline">View account <ArrowRight className="size-3" /></Link>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <p className="money w-full font-heading text-xl font-bold sm:w-auto sm:text-right">{formatCedis(row.amountPesewas)}</p>
                    {canCheck && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setSelection({ row, decision: 'reject' })}>Reject</Button>
                        <Button size="sm" onClick={() => setSelection({ row, decision: 'approve' })}><ShieldCheck /> Approve</Button>
                      </>
                    )}
                    {canPay && <Button size="sm" onClick={() => setSelection({ row, decision: 'pay' })}><BanknoteArrowDown /> Record payout</Button>}
                    {row.status === 'PENDING_APPROVAL' && !canCheck && <span className="text-xs text-muted-foreground">{row.requestedBy === user.uid ? 'Needs another person' : 'Awaiting authorised checker'}</span>}
                    {row.status === 'APPROVED' && !canPay && (role === 'CASHIER' || role === 'BRANCH_MANAGER') &&
                      (row.requestedBy === user.uid || row.decidedBy === user.uid) && (
                        <span className="text-xs text-muted-foreground">{row.requestedBy === user.uid ? 'You requested this; another cashier must pay' : 'You approved this; another cashier must pay'}</span>
                      )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
          <ListPager count={rows.length} hasMore={!!nextCursor} loading={loadingMore} onLoadMore={loadMore} />
        </div>
      )}
      <DecisionDialog key={`${selection?.row.id ?? ''}:${selection?.decision ?? ''}`} selection={selection} businessName={businessName} onClose={() => setSelection(null)} />
    </>
  );
}

export function WithdrawalsView({
  branchId,
  businessId,
  refresh,
  businessName,
}: {
  branchId: string;
  businessId: string;
  refresh: number;
  businessName: (id: string) => string;
}) {
  const { claims } = useSession();
  const [status, setStatus] = useState<WithdrawalStatus | ''>(claims.role === 'CASHIER' ? 'APPROVED' : 'PENDING_APPROVAL');
  return (
    <section className="grid gap-4" aria-labelledby="withdrawals-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="withdrawals-title" className="font-heading text-lg font-bold">Withdrawal requests</h2>
          <p className="text-sm text-muted-foreground">Requests from all dates. Approval and payout require different people.</p>
        </div>
        <Field label="Status" htmlFor="withdrawal-status" className="min-w-48">
          <NativeSelect id="withdrawal-status" value={status} onChange={(event) => setStatus(event.target.value as WithdrawalStatus | '')}>
            <option value="PENDING_APPROVAL">Awaiting approval</option>
            <option value="APPROVED">Approved, unpaid</option>
            <option value="PAID">Paid</option>
            <option value="REJECTED">Rejected</option>
            <option value="">All statuses</option>
          </NativeSelect>
        </Field>
      </div>
      <WithdrawalResults key={`${branchId}:${businessId}:${status}`} branchId={branchId} businessId={businessId} status={status} refresh={refresh} businessName={businessName} />
    </section>
  );
}

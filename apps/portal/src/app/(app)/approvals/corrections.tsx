'use client';

import { CORRECTION_HEAD_OFFICE_THRESHOLD_PESEWAS, formatCedis, type CorrectionStatus, type CorrectionSummary } from '@susu/shared';
import { ArrowRight, Building2, Check, FilePen, Loader2, X } from 'lucide-react';
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
import { can } from '@/lib/access';
import { useSession } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import { approveCorrection, CORRECTION_KIND_LABEL, listCorrections, rejectCorrection } from '@/lib/corrections-api';
import { toActionError } from '@/lib/errors';
import { useBusinesses } from '@/lib/use-businesses';
import { usePagedList } from '@/lib/use-paged-list';
import { formatDateTime } from '@/lib/utils';

type Decision = { row: CorrectionSummary; action: 'approve' | 'reject' };

function effectCopy(row: CorrectionSummary) {
  if (row.kind === 'REVERSE_COLLECTION') return `Reverses the whole ${formatCedis(row.collectedPesewas)} from ${row.memberName} and the agent pair’s cash.`;
  if (row.kind === 'REDUCE_COLLECTION')
    return `Takes ${formatCedis(row.amountPesewas)} off ${row.memberName} and the pair’s cash; ${formatCedis(row.collectedPesewas - row.amountPesewas)} stays recorded.`;
  return `Moves ${formatCedis(row.amountPesewas)} from ${row.memberName} to ${row.toMemberName ?? 'the right member'}. Cash is not affected.`;
}

function statusChip(status: CorrectionStatus) {
  if (status === 'APPROVED') return <StatusChip tone="success">Approved</StatusChip>;
  if (status === 'REJECTED') return <StatusChip tone="danger">Rejected</StatusChip>;
  return <StatusChip tone="warning">Awaiting approval</StatusChip>;
}

function DecisionDialog({ decision, onClose }: { decision: Decision | null; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const row = decision?.row;
  const approving = decision?.action === 'approve';

  function close() {
    if (busy) return;
    setReason('');
    setError(null);
    onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!row || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (approving) {
        await approveCorrection({ correctionId: row.id });
        toast.success('Correction approved and posted');
      } else {
        await rejectCorrection({ correctionId: row.id, reason: reason.trim() });
        toast.success('Correction rejected', { description: 'The collection stays as recorded.' });
      }
      setReason('');
      onClose();
    } catch (cause) {
      // INSUFFICIENT_BALANCE here means the cash was handed over or withdrawn; the server says which.
      setError(toActionError(cause).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!decision} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent
        title={approving ? 'Approve this correction?' : 'Reject this correction?'}
        description={approving ? 'Approving posts the correction to the ledger. It is recorded under your name and can’t be undone here.' : 'The collection stays as it is. The requester sees your reason.'}
      >
        {row && (
          <form onSubmit={submit} className="grid gap-4">
            {error && <Alert tone="error">{error}</Alert>}
            <dl className="grid gap-1.5 rounded-lg border border-border bg-muted/30 p-3 text-sm">
              <div className="flex justify-between gap-3"><dt>Request</dt><dd className="font-medium">{CORRECTION_KIND_LABEL[row.kind]}</dd></div>
              <div className="flex justify-between gap-3"><dt>Member</dt><dd className="text-right">{row.memberName}</dd></div>
              <div className="flex justify-between gap-3"><dt>Collected</dt><dd className="money">{formatCedis(row.collectedPesewas)}</dd></div>
              <div className="flex justify-between gap-3"><dt>Correction</dt><dd className="money font-heading text-lg font-bold">{formatCedis(row.amountPesewas)}</dd></div>
            </dl>
            <p className="text-sm">{effectCopy(row)}</p>
            <p className="rounded-lg border border-border p-3 text-sm"><span className="text-muted-foreground">Requester’s reason: </span>{row.reason}</p>
            {!approving && (
              <Field label="Why are you rejecting it?" htmlFor="corr-reject-reason">
                <Textarea id="corr-reject-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
              </Field>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close} disabled={busy}>Cancel</Button>
              <Button type="submit" variant={approving ? 'default' : 'destructive'} disabled={busy || (!approving && reason.trim().length < 3)}>
                {busy && <Loader2 className="animate-spin" />} {approving ? 'Approve and post' : 'Reject'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CorrectionCard({ row, onDecide }: { row: CorrectionSummary; onDecide: (d: Decision) => void }) {
  const { user, claims } = useSession();
  const { branchName } = useBranch();
  const { name: businessName } = useBusinesses();
  const mine = row.requestedBy === user.uid;
  const checker = can.decideCorrection(claims.role);
  const canApprove = can.approveCorrectionAmount(claims.role, row.needsHeadOffice);

  return (
    <Card>
      <CardContent className="grid gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-heading font-bold">{CORRECTION_KIND_LABEL[row.kind]}</span>
              {statusChip(row.status)}
              {row.needsHeadOffice && (
                <StatusChip tone="info" dot={false}>
                  <Building2 className="size-3" aria-hidden /> Head office · over {formatCedis(CORRECTION_HEAD_OFFICE_THRESHOLD_PESEWAS)}
                </StatusChip>
              )}
            </div>
            <p className="text-sm">
              <Link href={`/members/${row.memberId}/accounts/${row.susuAccountId}`} className="font-medium hover:text-primary hover:underline">
                {row.memberName}
              </Link>
              {row.toMemberName && (
                <>
                  {' '}<ArrowRight className="inline size-3.5" aria-label="to" />{' '}
                  {row.toSusuAccountId ? (
                    <span className="font-medium">{row.toMemberName}</span>
                  ) : row.toMemberName}
                </>
              )}
              <span className="text-muted-foreground"> · {businessName(row.businessId)} · {branchName(row.branchId)}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              Collected {formatDateTime(row.collectedAt)} · ref <span className="font-mono">{row.collectionBatchId.slice(0, 8).toUpperCase()}</span>
            </p>
          </div>
          <div className="text-right">
            <p className="money font-heading text-lg font-bold">{formatCedis(row.amountPesewas)}</p>
            <p className="text-xs text-muted-foreground">of {formatCedis(row.collectedPesewas)} collected</p>
          </div>
        </div>

        <p className="text-sm">{effectCopy(row)}</p>
        <p className="rounded-lg bg-muted/40 p-3 text-sm">
          <span className="text-muted-foreground">Reason: </span>{row.reason}
          <span className="mt-1 block text-xs text-muted-foreground">
            Requested by {mine ? 'you' : <span className="font-mono">{row.requestedBy}</span>} · {formatDateTime(row.requestedAt)}
          </span>
        </p>

        {row.decision && (
          <p className={`rounded-lg border p-3 text-sm ${row.decision.decision === 'APPROVED' ? 'border-success/25 bg-success-soft' : 'border-destructive/25 bg-destructive-soft'}`}>
            <strong>{row.decision.decision === 'APPROVED' ? 'Approved' : 'Rejected'}</strong> by <span className="font-mono text-xs">{row.decision.decidedBy === user.uid ? 'you' : row.decision.decidedBy}</span> · {formatDateTime(row.decision.decidedAt)}
            {row.decision.reason && <span className="block">{row.decision.reason}</span>}
            {row.decision.batchId && <span className="block text-xs text-muted-foreground">Posted as ref <span className="font-mono">{row.decision.batchId.slice(0, 8).toUpperCase()}</span></span>}
          </p>
        )}

        {row.status === 'PENDING' && checker && (
          mine ? (
            <p className="text-[13px] text-muted-foreground">You requested this correction, so a different person must decide it.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {canApprove ? (
                <Button size="sm" onClick={() => onDecide({ row, action: 'approve' })}><Check /> Approve</Button>
              ) : (
                <span className="text-[13px] text-muted-foreground">Above the branch limit: head office approves.</span>
              )}
              <Button size="sm" variant="outline" onClick={() => onDecide({ row, action: 'reject' })}><X /> Reject</Button>
            </div>
          )
        )}
      </CardContent>
    </Card>
  );
}

export function CorrectionsView() {
  const { scope } = useBranch();
  const [status, setStatus] = useState<CorrectionStatus | ''>('PENDING');
  const [decision, setDecision] = useState<Decision | null>(null);
  const { rows, nextCursor, loading, loadingMore, error, loadMore } = usePagedList(
    (cursor) =>
      listCorrections({ branchId: scope ?? undefined, status: status || undefined, cursor }).then((r) => ({
        rows: r.corrections,
        nextCursor: r.nextCursor,
      })),
    [scope, status],
  );

  return (
    <div className="grid gap-4">
      <Field label="Show" htmlFor="corr-status" className="w-56">
        <NativeSelect id="corr-status" value={status} onChange={(e) => setStatus(e.target.value as CorrectionStatus | '')}>
          <option value="PENDING">Awaiting approval</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="">All corrections</option>
        </NativeSelect>
      </Field>
      <LoadError error={error} />
      {loading ? (
        <p role="status" className="text-sm text-muted-foreground">Loading corrections…</p>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <FilePen className="size-6 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">
              {status === 'PENDING'
                ? 'No corrections waiting. Request one from a collection line on the member’s statement.'
                : 'No corrections with this status.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        rows.map((row) => <CorrectionCard key={row.id} row={row} onDecide={setDecision} />)
      )}
      <ListPager count={rows.length} hasMore={!!nextCursor} loading={loadingMore} onLoadMore={loadMore} />
      <DecisionDialog decision={decision} onClose={() => setDecision(null)} />
    </div>
  );
}

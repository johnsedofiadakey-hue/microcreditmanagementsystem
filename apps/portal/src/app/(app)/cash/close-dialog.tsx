'use client';

import { formatCedis, type BranchCloseChecklist } from '@susu/shared';
import { AlertTriangle, LockKeyhole } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { closeBranchDay } from '@/lib/cash-api';
import { toActionError } from '@/lib/errors';
import { formatDateTime } from '@/lib/utils';

export function CloseDialog({ item }: { item: BranchCloseChecklist }) {
  const [open, setOpen] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = item.count;

  function close() {
    if (busy) return;
    setOpen(false);
    setReviewed(false);
    setNote('');
    setError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!count || !reviewed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await closeBranchDay({ branchId: item.branchId, businessId: item.businessId, day: item.day, note: note.trim() || undefined });
      toast.success('Business day closed', {
        description: result.caseId
          ? `A difference case ${result.caseId.slice(0, 8).toUpperCase()} is open for review.`
          : 'The count matched the vault. This close is now frozen.',
      });
      setOpen(false);
      setReviewed(false);
      setNote('');
    } catch (cause) {
      const actionError = toActionError(cause);
      setError(actionError.reason === 'EXPECTED_CASH_CHANGED'
        ? 'The vault changed since the count. Close this window, refresh the cash position, and ask a cashier to count again.'
        : actionError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); else setOpen(true); }}>
      <DialogTrigger asChild><Button size="sm"><LockKeyhole /> Close business day</Button></DialogTrigger>
      <DialogContent className="max-w-xl" title={`Close ${item.businessName}?`} description="The manager signs off this business’s cash day. The checklist is frozen after closing; late collections count on the next cash day.">
        <form onSubmit={submit} className="grid gap-4">
          {error && <Alert tone="error">{error}</Alert>}
          <div className="grid gap-3 rounded-xl border border-border bg-muted/20 p-4 text-sm">
            <p className="font-heading font-bold">{item.day} · {item.businessName}</p>
            <dl className="grid grid-cols-2 gap-3">
              <div><dt className="text-muted-foreground">Vault expected</dt><dd className="money font-semibold">{formatCedis(item.expectedCashPesewas)}</dd></div>
              <div><dt className="text-muted-foreground">Cashier counted</dt><dd className="money font-semibold">{count ? formatCedis(count.countedPesewas) : 'No count'}</dd></div>
              <div><dt className="text-muted-foreground">Difference</dt><dd className="money font-semibold">{count ? formatCedis(count.differencePesewas) : '—'}</dd></div>
              <div><dt className="text-muted-foreground">Counted at</dt><dd>{count ? formatDateTime(count.countedAt) : '—'}</dd></div>
            </dl>
            <p className="text-xs text-muted-foreground">Counted by {count?.countedBy ?? '—'}; a different person closes.</p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
            <p className="rounded-lg bg-muted/40 p-2">Collections <strong className="block money">{formatCedis(item.collectedTodayPesewas)}</strong></p>
            <p className="rounded-lg bg-muted/40 p-2">Handed over <strong className="block money">{formatCedis(item.handedOverTodayPesewas)}</strong></p>
            <p className="rounded-lg bg-muted/40 p-2">Paid out <strong className="block money">{formatCedis(item.paidOutTodayPesewas)}</strong></p>
            <p className="rounded-lg bg-muted/40 p-2">Pending declarations <strong className="block">{item.pendingDeclarations.count}</strong></p>
            <p className="rounded-lg bg-muted/40 p-2">Approved unpaid <strong className="block">{item.approvedUnpaid.count}</strong></p>
            <p className="rounded-lg bg-muted/40 p-2">Open cases <strong className="block">{item.openCases}</strong></p>
            <p className="rounded-lg bg-muted/40 p-2">Off route <strong className="block">{item.routeExceptions.offRouteCount}</strong></p>
            <p className="rounded-lg bg-muted/40 p-2">Carried in <strong className="block">{item.carriedIn.count}</strong></p>
            <p className="rounded-lg bg-muted/40 p-2">Missing phone records <strong className="block">{item.pairs.reduce((total, pair) => total + pair.missingRecordCount, 0)}</strong></p>
          </div>
          {item.warnings.length > 0 && (
            <div className="rounded-lg border border-warning/30 bg-warning-soft/40 p-3 text-sm">
              <p className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4" aria-hidden /> Review these before signing off</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">{item.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul>
            </div>
          )}
          <Field label="Manager note (optional)" htmlFor={`close-note-${item.businessId}`} hint="Explain any unresolved difference or follow-up needed.">
            <Textarea id={`close-note-${item.businessId}`} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm">
            <input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} className="mt-1 size-4 accent-[var(--primary)]" />
            <span>I reviewed the count, payouts, pending declarations and warnings for this business. I understand the close is final.</span>
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={close}>Cancel</Button>
            <Button type="submit" disabled={busy || !count || !reviewed}>{busy ? 'Closing…' : 'Confirm and close day'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

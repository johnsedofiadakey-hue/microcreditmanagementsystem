'use client';

import { formatCedis, parseCedis, type HandoverDeclarationLine, type HandoverDeclarationSummary, type HandoverResult } from '@susu/shared';
import { ArrowRightLeft, Check, Clock3, Loader2, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
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
import { confirmHandover, listHandoverDeclarations, listHandovers } from '@/lib/cash-api';
import { toActionError } from '@/lib/errors';
import { usePagedList } from '@/lib/use-paged-list';
import { formatDateTime } from '@/lib/utils';

type Selection = { declaration: HandoverDeclarationSummary; line: HandoverDeclarationLine };

function differenceCopy(difference: number, context: 'custody' | 'declaration') {
  if (difference === 0) return `Matches ${context}`;
  return `${formatCedis(Math.abs(difference))} ${difference < 0 ? 'less' : 'more'} than ${context}`;
}

function ConfirmDialog({ selection, onClose, onConfirmed }: {
  selection: Selection | null;
  onClose: () => void;
  onConfirmed: (result: HandoverResult) => void;
}) {
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expected = selection?.line.currentCustodyPesewas;
  let countedPesewas: number | null = null;
  let countError: string | null = null;
  if (counted.trim()) {
    try {
      countedPesewas = parseCedis(counted);
      if (countedPesewas < 0) countError = 'The count cannot be negative.';
    } catch {
      countError = 'Enter an amount like 115 or 115.50.';
    }
  }

  function close() {
    if (busy) return;
    setCounted('');
    setNote('');
    setError(null);
    onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selection || expected === null || expected === undefined || countedPesewas === null || countError || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await confirmHandover({
        declarationId: selection.declaration.id,
        businessId: selection.line.businessId,
        expectedPesewas: expected,
        countedPesewas,
        note: note.trim() || undefined,
      });
      onConfirmed(result);
      toast.success(result.caseId ? 'Handover recorded with a difference case' : 'Handover confirmed');
      onClose();
    } catch (cause) {
      const actionError = toActionError(cause);
      setError(actionError.reason === 'EXPECTED_CASH_CHANGED'
        ? 'The pair’s custody changed while you counted. Close this window, refresh the queue, and count again.'
        : actionError.message);
    } finally {
      setBusy(false);
    }
  }

  const custodyDifference = countedPesewas !== null && expected !== null && expected !== undefined ? countedPesewas - expected : null;
  const declarationDifference = countedPesewas !== null && selection ? countedPesewas - selection.line.declaredPesewas : null;

  return (
    <Dialog open={!!selection} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent title="Count and confirm handover" description="The agent has declared this cash. Count it independently before moving it into the branch vault.">
        {selection && (
          <form onSubmit={submit} className="grid gap-4">
            <div className="rounded-xl border border-primary/20 bg-primary-soft/30 p-4">
              <p className="font-heading font-bold">{selection.declaration.agentPairName} · {selection.line.businessName}</p>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-muted-foreground">Agent declared</dt><dd className="money font-semibold">{formatCedis(selection.line.declaredPesewas)}</dd></div>
                <div><dt className="text-muted-foreground">Current pair custody</dt><dd className="money font-semibold">{expected == null ? 'Refresh needed' : formatCedis(expected)}</dd></div>
              </dl>
            </div>
            {error && <Alert tone="error">{error}</Alert>}
            <Field label="Cash you counted" htmlFor="handover-count" error={countError ?? undefined} hint="Enter the amount physically received, even when it differs from the declaration.">
              <Input id="handover-count" inputMode="decimal" autoFocus value={counted} onChange={(event) => setCounted(event.target.value)} placeholder="0.00" className="text-right tabular-nums" />
            </Field>
            {custodyDifference !== null && declarationDifference !== null && (
              <Alert tone="info" className={custodyDifference || declarationDifference ? 'border-warning/30 bg-warning-soft/40 text-warning' : undefined}>
                {differenceCopy(custodyDifference, 'custody')}; {differenceCopy(declarationDifference, 'declaration')}.
                {custodyDifference || declarationDifference ? ' Confirmation opens a difference or dispute case.' : ' Both amounts match.'}
              </Alert>
            )}
            <Field label="Count note (optional)" htmlFor="handover-note" hint="A short explanation helps the reviewer if the amounts differ.">
              <Textarea id="handover-note" maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={close}>Cancel</Button>
              <Button type="submit" disabled={busy || countedPesewas === null || !!countError || expected === null}>
                {busy && <Loader2 className="animate-spin" />} Confirm counted cash
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function HandoversView({ branchId, businessId, refresh }: { branchId: string; businessId: string; refresh: number }) {
  const { claims } = useSession();
  const [status, setStatus] = useState<'OPEN' | 'ALL'>('OPEN');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [lastResult, setLastResult] = useState<HandoverResult | null>(null);
  const { rows, nextCursor, loading, loadingMore, error, loadMore } = usePagedList(
    async (cursor) => {
      const result = await listHandoverDeclarations({ branchId, status, cursor, limit: 50 });
      return { rows: result.declarations, nextCursor: result.nextCursor };
    },
    [branchId, status, refresh],
  );
  const { rows: recentHandovers, nextCursor: historyCursor, loadingMore: loadingHistory, loadMore: loadHistory, error: historyError } = usePagedList(
    async (cursor) => {
      const result = await listHandovers({ branchId, businessId: businessId || undefined, cursor: cursor ?? undefined });
      return { rows: result.handovers, nextCursor: result.nextCursor };
    },
    [branchId, businessId, refresh],
  );
  const canConfirm = claims.role === 'CASHIER' || claims.role === 'BRANCH_MANAGER';
  const visible = rows.map((declaration) => ({
    declaration,
    lines: declaration.lines.filter((line) => !businessId || line.businessId === businessId),
  })).filter(({ lines }) => lines.length > 0);

  return (
    <section className="grid gap-5" aria-labelledby="handover-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="handover-title" className="font-heading text-xl font-bold">Agent handovers</h2>
          <p className="text-sm text-muted-foreground">Agents declare on their phone. A cashier counts each business’s cash independently.</p>
        </div>
        <Field label="Show" htmlFor="handover-status" className="w-52">
          <NativeSelect id="handover-status" value={status} onChange={(event) => setStatus(event.target.value as 'OPEN' | 'ALL')}>
            <option value="OPEN">Awaiting count</option>
            <option value="ALL">All declarations</option>
          </NativeSelect>
        </Field>
      </div>
      {lastResult && (
        <Alert tone={lastResult.caseId ? 'info' : 'success'} className={lastResult.caseId ? 'border-warning/30 bg-warning-soft/40 text-warning' : undefined}>
          Handover {lastResult.handoverId.slice(0, 8).toUpperCase()} confirmed. {differenceCopy(lastResult.differencePesewas, 'custody')}; {differenceCopy(lastResult.declarationDifferencePesewas, 'declaration')}.
          {lastResult.caseId && <> Difference case {lastResult.caseId.slice(0, 8).toUpperCase()} is open in the Differences tab.</>}
        </Alert>
      )}
      <LoadError error={error} />
      {loading ? (
        <Card><CardContent role="status" className="text-sm text-muted-foreground">Loading agent declarations…</CardContent></Card>
      ) : error ? null : visible.length === 0 ? (
        <Card><CardContent className="flex items-center gap-3 text-sm text-muted-foreground"><Clock3 className="size-5" aria-hidden /> No handover declarations match this selection.</CardContent></Card>
      ) : visible.map(({ declaration, lines }) => (
        <Card key={declaration.id}>
          <CardContent className="grid gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-heading font-bold">{declaration.agentPairName}</h3>
                <p className="text-xs text-muted-foreground">Received {formatDateTime(declaration.receivedAt)} · phone ref {declaration.id.slice(0, 8).toUpperCase()}</p>
              </div>
              <StatusChip tone={lines.some((line) => line.status === 'DECLARED') ? 'warning' : 'success'}>
                {lines.some((line) => line.status === 'DECLARED') ? 'Awaiting count' : 'Reviewed'}
              </StatusChip>
            </div>
            <div className="grid gap-3">
              {lines.map((line) => (
                <div key={line.businessId} className="grid gap-3 rounded-xl border border-border bg-muted/20 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="grid gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{line.businessName}</span>
                      <StatusChip tone={line.status === 'CONFIRMED' ? 'success' : line.status === 'SUPERSEDED' ? 'neutral' : 'warning'}>{line.status === 'DECLARED' ? 'Awaiting count' : line.status === 'CONFIRMED' ? 'Confirmed' : 'Superseded'}</StatusChip>
                    </div>
                    <p className="text-xs text-muted-foreground">Agent declared {formatCedis(line.declaredPesewas)} · custody at declaration {formatCedis(line.custodyAtDeclarationPesewas)}</p>
                    {line.status === 'DECLARED' && line.currentCustodyPesewas !== null && (
                      <p className="text-xs text-muted-foreground">Current custody {formatCedis(line.currentCustodyPesewas)}</p>
                    )}
                    {line.status === 'CONFIRMED' && line.countedPesewas !== null && (
                      <p className="text-sm">Cashier counted <strong className="money">{formatCedis(line.countedPesewas)}</strong> · {differenceCopy(line.countedPesewas - line.declaredPesewas, 'declaration')}</p>
                    )}
                  </div>
                  {line.status === 'DECLARED' && canConfirm && line.currentCustodyPesewas !== null && (
                    <Button size="sm" onClick={() => setSelection({ declaration, line })}><ShieldCheck /> Count and confirm</Button>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
      <ListPager count={rows.length} hasMore={!!nextCursor} loading={loadingMore} onLoadMore={loadMore} />
      {recentHandovers.length > 0 && (
        <div className="grid gap-3 border-t border-border pt-5">
          <h3 className="font-heading font-bold">Recent confirmations</h3>
          {recentHandovers.map((handover) => (
            <Card key={handover.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <div className="flex items-center gap-2"><ArrowRightLeft className="size-4 text-primary" aria-hidden /> {handover.agentPairName} · {formatDateTime(handover.receivedAt)}</div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="money">{formatCedis(handover.countedPesewas)}</span>
                  {handover.differencePesewas === 0 ? <StatusChip tone="success"><Check className="size-3" /> Balanced</StatusChip> : <StatusChip tone="warning">{differenceCopy(handover.differencePesewas, 'custody')}</StatusChip>}
                  {handover.caseId && <span className="text-warning">Case {handover.caseId.slice(0, 8).toUpperCase()}</span>}
                </div>
              </CardContent>
            </Card>
          ))}
          <ListPager count={recentHandovers.length} hasMore={!!historyCursor} loading={loadingHistory} onLoadMore={loadHistory} />
        </div>
      )}
      <LoadError error={historyError} />
      <ConfirmDialog key={`${selection?.declaration.id ?? ''}:${selection?.line.businessId ?? ''}`} selection={selection} onClose={() => setSelection(null)} onConfirmed={setLastResult} />
    </section>
  );
}

'use client';

import { formatCedis, type CaseSummary } from '@susu/shared';
import { AlertTriangle, CheckCheck } from 'lucide-react';
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
import { listCases, resolveCase } from '@/lib/cash-api';
import { toActionError } from '@/lib/errors';
import { usePagedList } from '@/lib/use-paged-list';
import { formatDateTime } from '@/lib/utils';

function CaseResults({
  branchId,
  businessId,
  status,
  refresh,
  businessName,
}: {
  branchId: string;
  businessId: string;
  status: 'OPEN' | 'RESOLVED' | '';
  refresh: number;
  businessName: (id: string) => string;
}) {
  const { user, claims } = useSession();
  const { rows, loading, loadingMore, nextCursor, error, loadMore } = usePagedList(
    async (cursor) => {
      const result = await listCases({ branchId, businessId: businessId || undefined, status: status || undefined, cursor: cursor ?? undefined });
      return { rows: result.cases, nextCursor: result.nextCursor ?? null };
    },
    [branchId, businessId, status, refresh],
  );
  const [selected, setSelected] = useState<CaseSummary | null>(null);
  const [resolution, setResolution] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  function close() {
    setSelected(null);
    setResolution('');
    setActionError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await resolveCase({ caseId: selected.id, resolution: resolution.trim() });
      toast.success('Case resolved');
      close();
    } catch (cause) {
      setActionError(toActionError(cause).message);
    } finally {
      setBusy(false);
    }
  }

  const resolver = ['SUPER_ADMIN', 'FINANCE', 'COMPLIANCE', 'BRANCH_MANAGER'].includes(claims.role);

  return (
    <>
      <LoadError error={error} />
      {loading ? (
        <Card><CardContent role="status" className="text-sm text-muted-foreground">Loading cases…</CardContent></Card>
      ) : error ? null : rows.length === 0 ? (
        <Card><CardContent className="text-sm text-muted-foreground">No cases match this selection.</CardContent></Card>
      ) : (
        <div className="grid gap-3">
          {rows.map((row) => (
            <Card key={row.id}>
              <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-heading font-bold">{{ CLOSE_DIFFERENCE: 'Branch close difference', HANDOVER_DIFFERENCE: 'Cash handover difference', HANDOVER_DISPUTE: 'Handover disagreement', OFF_ROUTE_COLLECTION: 'Collection outside assigned route', DEPOSIT_DIFFERENCE: 'Bank deposit difference' }[row.kind] ?? row.kind}</span>
                    <StatusChip tone={row.status === 'OPEN' ? 'warning' : 'success'}>{row.status === 'OPEN' ? 'Open' : 'Resolved'}</StatusChip>
                  </div>
                  <p className="text-[13px] text-muted-foreground">{businessName(row.businessId)} · opened {formatDateTime(row.openedAt)} · <span className="font-mono">{row.id.slice(0, 8).toUpperCase()}</span></p>
                  <p className="text-sm">{row.summary}</p>
                  {row.resolution && <p className="text-sm text-muted-foreground">Resolution: {row.resolution}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                  <div className="sm:text-right">
                    <p className="money font-heading text-lg font-bold">{formatCedis(row.amountPesewas)}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.kind === 'OFF_ROUTE_COLLECTION' ? 'Collected outside assigned route' : row.kind === 'HANDOVER_DISPUTE' ? 'Cashier count minus agent declaration' : row.kind === 'DEPOSIT_DIFFERENCE' ? (row.amountPesewas < 0 ? 'Bank short of deposit' : row.amountPesewas > 0 ? 'Bank over deposit' : 'No difference') : row.amountPesewas < 0 ? 'Shortage' : row.amountPesewas > 0 ? 'Overage' : 'No difference'}
                    </p>
                  </div>
                  {row.status === 'OPEN' && resolver && row.openedBy !== user.uid && (
                    <Button size="sm" variant="outline" onClick={() => setSelected(row)}><CheckCheck /> Record resolution</Button>
                  )}
                  {row.status === 'OPEN' && row.openedBy === user.uid && <span className="text-xs text-muted-foreground">Needs another person</span>}
                </div>
              </CardContent>
            </Card>
          ))}
          <ListPager count={rows.length} hasMore={!!nextCursor} loading={loadingMore} onLoadMore={loadMore} />
        </div>
      )}
      <Dialog open={!!selected} onOpenChange={(open) => { if (!open && !busy) close(); }}>
        <DialogContent title="Resolve operational case" description="Record how this case was investigated and handled.">
          {selected && (
            <form onSubmit={submit} className="grid gap-4">
              <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                {businessName(selected.businessId)} · {selected.summary} · <strong className="money">{formatCedis(selected.amountPesewas)}</strong>
              </p>
              <Alert tone="info">This closes the case record. It does not change a cash or member balance.</Alert>
              <Field label="Resolution" htmlFor="case-resolution" hint="Include what was checked and who will follow up, if needed.">
                <Textarea id="case-resolution" required minLength={3} maxLength={500} value={resolution} onChange={(event) => setResolution(event.target.value)} />
              </Field>
              {actionError && <Alert tone="error">{actionError}</Alert>}
              <DialogFooter>
                <Button type="button" variant="outline" disabled={busy} onClick={close}>Cancel</Button>
                <Button type="submit" disabled={busy || resolution.trim().length < 3}>{busy ? 'Saving…' : 'Resolve case'}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CasesView({
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
  const [status, setStatus] = useState<'OPEN' | 'RESOLVED' | ''>('OPEN');
  return (
    <section className="grid gap-4" aria-labelledby="cases-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="cases-title" className="flex items-center gap-2 font-heading text-lg font-bold"><AlertTriangle className="size-5 text-warning" aria-hidden /> Cash & route exceptions</h2>
          <p className="text-sm text-muted-foreground">Cash differences, handover disagreements and off-route collections stay visible with their resolution history.</p>
        </div>
        <Field label="Status" htmlFor="case-status" className="min-w-44">
          <NativeSelect id="case-status" value={status} onChange={(event) => setStatus(event.target.value as 'OPEN' | 'RESOLVED' | '')}>
            <option value="OPEN">Open</option>
            <option value="RESOLVED">Resolved</option>
            <option value="">All statuses</option>
          </NativeSelect>
        </Field>
      </div>
      <CaseResults key={`${branchId}:${businessId}:${status}`} branchId={branchId} businessId={businessId} status={status} refresh={refresh} businessName={businessName} />
    </section>
  );
}

'use client';

import { formatCedis, type BranchCloseChecklist } from '@susu/shared';
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, RefreshCw, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { LoadError } from '@/components/load-error';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { NativeSelect } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { StatusChip } from '@/components/ui/status-chip';
import { useSession } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import { getBranchCashDay } from '@/lib/cash-api';
import { useBusinesses } from '@/lib/use-businesses';
import { useList } from '@/lib/use-list';
import { cn, formatDateTime, todayKey } from '@/lib/utils';
import { CasesView } from './cases';
import { CountDialog } from './count-dialog';
import { DepositsView } from './deposits';
import { WithdrawalsView } from './withdrawals';

type CashView = 'overview' | 'withdrawals' | 'deposits' | 'cases';

function Amount({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="money mt-1 font-heading text-lg font-bold">{formatCedis(value)}</dd>
    </div>
  );
}

function BusinessChecklist({ item }: { item: BranchCloseChecklist }) {
  const { claims } = useSession();
  const canCount = (claims.role === 'CASHIER' || claims.role === 'BRANCH_MANAGER') && item.day === todayKey() && item.status !== 'CLOSED';
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>{item.businessName}</CardTitle>
          <CardDescription>Cash and close position for this business only.</CardDescription>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <StatusChip tone={item.status === 'CLOSED' ? 'success' : item.status === 'COUNTED' ? 'info' : 'neutral'}>
            {item.status === 'CLOSED' ? 'Closed' : item.status === 'COUNTED' ? 'Counted' : 'Open'}
          </StatusChip>
          {canCount && <CountDialog item={item} />}
        </div>
      </CardHeader>
      <CardContent className="grid gap-5">
        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Amount label="Vault expected" value={item.expectedCashPesewas} />
          <Amount label="Collected today" value={item.collectedTodayPesewas} />
          <Amount label="Handed over today" value={item.handedOverTodayPesewas} />
          <Amount label="Paid out today" value={item.paidOutTodayPesewas} />
        </dl>

        {(item.pendingDeclarations?.count > 0 || item.carriedIn?.count > 0 || item.routeExceptions?.offRouteCount > 0 || item.routeExceptions?.previousRouteCount > 0 || item.postedAfterClose?.count > 0) && (
          <div className="grid gap-2 sm:grid-cols-2" aria-label="Cash items requiring attention">
            {item.pendingDeclarations?.count > 0 && (
              <p className="rounded-lg border border-warning/30 bg-warning-soft/40 p-3 text-sm">
                <strong>{item.pendingDeclarations.count} handover {item.pendingDeclarations.count === 1 ? 'declaration' : 'declarations'} awaiting cashier confirmation</strong><br />
                Agents declared {formatCedis(item.pendingDeclarations.declaredPesewas)} for this business.
              </p>
            )}
            {item.carriedIn?.count > 0 && (
              <p className="rounded-lg border border-info/25 bg-info-soft p-3 text-sm">
                <strong>{item.carriedIn.count} late {item.carriedIn.count === 1 ? 'collection' : 'collections'} carried into this day</strong><br />
                {formatCedis(item.carriedIn.amountPesewas)} was received after the previous close.
              </p>
            )}
            {(item.routeExceptions?.offRouteCount > 0 || item.routeExceptions?.previousRouteCount > 0) && (
              <p className="rounded-lg border border-warning/30 bg-warning-soft/40 p-3 text-sm">
                <strong>Route exceptions need review</strong><br />
                {item.routeExceptions.offRouteCount} collected outside the assigned route ({formatCedis(item.routeExceptions.offRoutePesewas)}); {item.routeExceptions.previousRouteCount} from a previous assignment.
              </p>
            )}
            {item.postedAfterClose?.count > 0 && (
              <p className="rounded-lg border border-warning/30 bg-warning-soft/40 p-3 text-sm">
                <strong>{item.postedAfterClose.count} {item.postedAfterClose.count === 1 ? 'collection' : 'collections'} arrived after this close</strong><br />
                {formatCedis(item.postedAfterClose.amountPesewas)} is counted on {item.postedAfterClose.countedOnDay ?? 'the next business day'}.
              </p>
            )}
          </div>
        )}

        <div className="grid gap-3 border-t border-border pt-4 text-sm sm:grid-cols-2">
          <div className="flex items-start gap-2">
            <ArrowDownToLine className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <p>
              <span className="font-medium">Cash count: </span>
              {item.count ? (
                <>{formatCedis(item.count.countedPesewas)} · difference {formatCedis(item.count.differencePesewas)} · {formatDateTime(item.count.countedAt)}</>
              ) : 'Not submitted'}
            </p>
          </div>
          <div className="flex items-start gap-2">
            <ArrowUpFromLine className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <p><span className="font-medium">Approved, unpaid: </span>{item.approvedUnpaid.count} · {formatCedis(item.approvedUnpaid.amountPesewas)}</p>
          </div>
          <p>Pending approvals: <strong>{item.pendingApprovals}</strong></p>
          <p>Open difference cases: <strong>{item.openCases}</strong></p>
        </div>

        {item.pairs.length > 0 && (
          <div className="border-t border-border pt-4">
            <h3 className="mb-2 text-sm font-semibold">Agent pair custody</h3>
            <ul className="divide-y divide-border text-sm">
              {item.pairs.map((pair) => (
                <li key={pair.agentPairId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{pair.agentPairName}</span>
                  <span className="flex items-center gap-3">
                    {pair.missingRecordCount > 0 && (
                      <span className="text-warning">{pair.missingRecordCount} missing phone records</span>
                    )}
                    <strong className="money">{formatCedis(pair.custodyPesewas)}</strong>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {item.warnings.length > 0 && (
          <div className="rounded-lg border border-warning/30 bg-warning-soft/40 p-3 text-sm">
            <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="size-4" aria-hidden /> Review before close</p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              {item.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}
            </ul>
          </div>
        )}

        {item.closedAt && <p className="text-xs text-muted-foreground">Closed {formatDateTime(item.closedAt)} by {item.closedBy}</p>}
      </CardContent>
    </Card>
  );
}

function CashDayDetails({ branchId, businessId, day, refresh }: { branchId: string; businessId: string; day: string; refresh: number }) {
  const { rows, loading, error } = useList(
    () => getBranchCashDay({ branchId, day }).then((result) => [result]),
    [branchId, day, refresh],
  );
  const cashDay = rows[0];
  const visibleBusinesses = cashDay?.businesses.filter((item) => !businessId || item.businessId === businessId);

  return (
    <>
      <LoadError error={error} />
      {loading ? (
        <Card><CardContent role="status" className="text-sm text-muted-foreground">Loading the cash checklist…</CardContent></Card>
      ) : error ? null : visibleBusinesses?.length ? (
        visibleBusinesses.map((item) => <BusinessChecklist key={item.businessId} item={item} />)
      ) : (
        <Card><CardContent className="text-sm text-muted-foreground">No business cash checklist is available for this branch and day.</CardContent></Card>
      )}
    </>
  );
}

export default function CashPage() {
  const { scope, branches, branchName } = useBranch();
  const { businesses, name: businessName } = useBusinesses();
  const [selectedBranch, setSelectedBranch] = useState('');
  const [businessId, setBusinessId] = useState('');
  const [day, setDay] = useState(todayKey);
  const [refresh, setRefresh] = useState(0);
  const [view, setView] = useState<CashView>('overview');
  const branchId = scope ?? selectedBranch;

  useEffect(() => {
    if (scope === null && selectedBranch && !branches.some((branch) => branch.id === selectedBranch)) {
      setSelectedBranch('');
    }
  }, [branches, scope, selectedBranch]);

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Cash & branch close"
        description="Review each business’s vault and close, approved payouts, and cash differences."
        actions={<Button variant="outline" onClick={() => setRefresh((value) => value + 1)} disabled={!branchId}><RefreshCw /> Refresh</Button>}
      />
      <div className="flex flex-wrap items-end gap-3">
        {scope === null && (
          <Field label="Branch" htmlFor="cash-branch" className="min-w-64">
            <NativeSelect id="cash-branch" value={selectedBranch} onChange={(event) => setSelectedBranch(event.target.value)}>
              <option value="">Select a branch</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name} ({branch.code})</option>)}
            </NativeSelect>
          </Field>
        )}
        <Field label="Business" htmlFor="cash-business" className="min-w-64">
          <NativeSelect id="cash-business" value={businessId} onChange={(event) => setBusinessId(event.target.value)}>
            <option value="">All businesses</option>
            {businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}
          </NativeSelect>
        </Field>
        {view === 'overview' && (
          <Field label="Business day (Accra)" htmlFor="cash-day" className="min-w-48">
            <input id="cash-day" type="date" value={day} max={todayKey()} onChange={(event) => { if (event.target.value) setDay(event.target.value); }} className="h-10 w-full rounded-lg border border-input bg-surface px-3 text-sm" />
          </Field>
        )}
      </div>
      <div role="group" aria-label="Cash operations" className="flex gap-1 overflow-x-auto border-b border-border">
        {([
          ['overview', 'Cash position'],
          ['withdrawals', 'Withdrawals'],
          ['deposits', 'Bank deposits'],
          ['cases', 'Differences'],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)}
            className={cn('min-h-11 shrink-0 border-b-2 px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              view === id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}
          >{label}</button>
        ))}
      </div>
      {branchId && <p className="text-sm text-muted-foreground">{branchName(branchId)} · {businessId ? businessName(businessId) : 'All businesses'} · {view === 'overview' ? day : 'All dates'}</p>}
      {!branchId ? (
        <Card><CardContent className="flex items-center gap-3 text-sm text-muted-foreground"><Wallet className="size-5" aria-hidden /> Select a branch to see its cash position.</CardContent></Card>
      ) : view === 'overview' ? (
        <CashDayDetails key={`${branchId}:${businessId}:${day}`} branchId={branchId} businessId={businessId} day={day} refresh={refresh} />
      ) : view === 'withdrawals' ? (
        <WithdrawalsView key={`${branchId}:${businessId}`} branchId={branchId} businessId={businessId} refresh={refresh} businessName={businessName} />
      ) : view === 'deposits' ? (
        <DepositsView key={`${branchId}:${businessId}`} branchId={branchId} businessId={businessId} refresh={refresh} businessName={businessName} />
      ) : (
        <CasesView key={`${branchId}:${businessId}`} branchId={branchId} businessId={businessId} refresh={refresh} businessName={businessName} />
      )}
    </div>
  );
}

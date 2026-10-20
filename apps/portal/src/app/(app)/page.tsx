'use client';

import { formatCedis, isHeadOffice, type BranchDayDashboard, type CompanyDayDashboard } from '@susu/shared';
import { doc, onSnapshot } from 'firebase/firestore';
import { Activity, ArrowRight, Building2, CloudOff, HandCoins, Landmark, Smartphone, TriangleAlert, UsersRound } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { StatusChip } from '@/components/ui/status-chip';
import { can, navFor, ROLE_LABELS } from '@/lib/access';
import { useSession } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import { firebase } from '@/lib/firebase';
import { useBusinesses } from '@/lib/use-businesses';
import { cn, formatDateTime, todayKey } from '@/lib/utils';

/** API.md §4 read models, published by Step 7 (`publishDayDashboards`). */
type BranchDay = BranchDayDashboard;
type CompanyDay = CompanyDayDashboard;

type Day = { kind: 'branch'; data: BranchDay | null } | { kind: 'company'; data: CompanyDay | null };

function useToday(scope: string | null, headOffice: boolean) {
  const [day, setDay] = useState<Day | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    setDay(null);
    setError(false);
    const { db } = firebase();
    const key = todayKey();
    if (scope === null && !headOffice) return;
    const ref =
      scope === null ? doc(db, 'dashboards', 'company', 'days', key) : doc(db, 'branchDashboards', scope, 'days', key);
    return onSnapshot(
      ref,
      (snap) =>
        setDay(
          scope === null
            ? { kind: 'company', data: snap.exists() ? (snap.data() as CompanyDay) : null }
            : { kind: 'branch', data: snap.exists() ? (snap.data() as BranchDay) : null },
        ),
      () => {
        setDay(null);
        setError(true);
      },
    );
  }, [scope, headOffice]);

  return { day, error };
}

function Stat({
  label,
  value,
  icon: Icon,
  money = false,
  hint,
}: {
  label: string;
  value: string;
  icon: typeof Activity;
  money?: boolean;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="grid gap-3">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
          <Icon className="size-4 text-muted-foreground" aria-hidden />
        </div>
        <p className={`font-heading text-2xl font-bold tracking-tight ${money ? 'money' : 'tabular-nums'}`}>{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export default function OverviewPage() {
  const { user, claims } = useSession();
  const { scope, branchName } = useBranch();
  const headOffice = isHeadOffice(claims.role);
  const { day, error } = useToday(scope, headOffice);
  const firstName = (user.displayName ?? '').split(' ')[0] || 'there';
  const shortcuts = navFor(claims.role)
    .flatMap((s) => s.items)
    .filter((i) => i.href !== '/' && !i.comingIn);

  const today = new Intl.DateTimeFormat('en-GH', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  return (
    <div className="grid gap-8">
      <PageHeader
        title={`Good day, ${firstName}`}
        description={`${today} · ${scope === null ? 'All branches' : branchName(scope)} · ${ROLE_LABELS[claims.role]}`}
      />

      <section aria-labelledby="today" className="grid gap-3">
        <div className="flex items-center justify-between">
          <h2 id="today" className="font-heading text-base font-bold">
            Today at a glance
          </h2>
          {day?.data == null && !error && day && <StatusChip tone="neutral">Figures not available</StatusChip>}
          {error && <StatusChip tone="warning">Live figures unavailable</StatusChip>}
        </div>

        {error || !day?.data ? (
          <Card>
            <CardContent>
              <p className="text-sm text-muted-foreground" role="status">
                {error
                  ? 'Could not load today’s figures. Check your connection or try again later.'
                  : day
                    ? 'Today’s dashboard has not been published yet. Collection and cash records remain available in their own screens.'
                    : 'Loading today’s figures…'}
              </p>
            </CardContent>
          </Card>
        ) : day.kind === 'company' ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Collected today" value={formatCedis(day.data.collectedPesewas)} icon={HandCoins} money />
            <Stat label="Branches open" value={String(day.data.branchesOpen)} icon={Building2} />
            <Stat label="Branches closed" value={String(day.data.branchesClosed)} icon={Building2} />
            <Stat label="Open exceptions" value={String(day.data.exceptions)} icon={Activity} />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="Collected today"
              value={formatCedis(day.data.collectedPesewas)}
              icon={HandCoins}
              money
              hint={`${day.data.collectionCount} collections synced`}
            />
            <Stat
              label="Handed over"
              value={formatCedis(day.data.handedOverPesewas)}
              icon={HandCoins}
              money
            />
            <Stat
              label="Active agent pairs"
              value={String(day.data.activePairs)}
              icon={UsersRound}
            />
            <Stat
              label="Waiting to sync"
              value={String(day.data.pendingSyncCount)}
              icon={CloudOff}
              hint="See agent phones for records not yet received"
            />
          </div>
        )}
        {day?.data && !error && (
          <p className="text-xs text-muted-foreground">
            Figures update live as collections post; only synced collections are counted. Updated {formatDateTime(day.data.computedAt)}.
          </p>
        )}
      </section>

      {day?.data && !error && <CashControls day={day} />}
      {day?.data && !error && <BusinessBreakdown day={day} />}
      {day?.kind === 'company' && day.data && !error && <BranchComparison data={day.data} />}

      {shortcuts.length > 0 && (
        <section aria-labelledby="shortcuts" className="grid gap-3">
          <h2 id="shortcuts" className="font-heading text-base font-bold">
            Your work
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {shortcuts.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group rounded-xl focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <Card className="h-full transition group-hover:border-primary/40 group-hover:shadow-sm">
                  <CardHeader className="flex-row items-center gap-3 pb-5">
                    <span className="flex size-9 items-center justify-center rounded-lg bg-primary-soft text-primary">
                      <item.icon className="size-4" aria-hidden />
                    </span>
                    <div className="grid flex-1 gap-0.5">
                      <CardTitle>{item.label}</CardTitle>
                      <CardDescription>{SHORTCUT_COPY[item.href] ?? ''}</CardDescription>
                    </div>
                    <ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
                  </CardHeader>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {can.manageDevices(claims.role) && (
        <Card className="border-dashed">
          <CardContent className="flex items-start gap-3">
            <Smartphone className="mt-0.5 size-4 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">
              Lost or replaced agent phone? Revoke it under <Link className="font-medium text-primary hover:underline" href="/admin/devices">Devices</Link>{' '}
              before binding the new one. The agent cannot record collections until the new phone is bound.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CashControls({ day }: { day: Day }) {
  const data = day.data!;
  const unmatched = data.unmatchedDeposits ?? { count: 0, amountPesewas: 0 };
  const oldest = day.kind === 'company' ? day.data?.unmatchedDeposits?.oldestDepositedOn : null;
  return (
    <section aria-labelledby="controls" className="grid gap-3">
      <h2 id="controls" className="font-heading text-base font-bold">Cash controls</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link href="/cash" className="group rounded-xl focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
          <Card className={cn('h-full transition group-hover:border-primary/40', data.openCases > 0 && 'border-warning/40 bg-warning-soft/30')}>
            <CardContent className="flex items-start gap-3">
              <TriangleAlert className={cn('mt-0.5 size-5', data.openCases > 0 ? 'text-warning' : 'text-muted-foreground')} aria-hidden />
              <div className="grid gap-0.5">
                <p className="font-heading font-bold">{data.openCases} open cash {data.openCases === 1 ? 'difference' : 'differences'}</p>
                <p className="text-[13px] text-muted-foreground">Handover, close and bank deposit differences waiting for an owner to resolve.</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href={day.kind === 'company' ? '/bank' : '/cash'} className="group rounded-xl focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
          <Card className={cn('h-full transition group-hover:border-primary/40', unmatched.count > 0 && 'border-warning/40 bg-warning-soft/30')}>
            <CardContent className="flex items-start gap-3">
              <Landmark className={cn('mt-0.5 size-5', unmatched.count > 0 ? 'text-warning' : 'text-muted-foreground')} aria-hidden />
              <div className="grid gap-0.5">
                <p className="font-heading font-bold">
                  {unmatched.count} {unmatched.count === 1 ? 'deposit' : 'deposits'} awaiting bank match · <span className="money">{formatCedis(unmatched.amountPesewas)}</span>
                </p>
                <p className="text-[13px] text-muted-foreground">
                  Cash that left a vault but isn’t confirmed on a bank statement yet{oldest ? `; oldest deposited ${oldest}` : ''}.
                </p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </section>
  );
}

function BusinessBreakdown({ day }: { day: Day }) {
  const { name } = useBusinesses();
  const rows = day.data?.businesses ?? [];
  if (!rows.length) return null;
  return (
    <section aria-labelledby="by-business" className="grid gap-3">
      <h2 id="by-business" className="font-heading text-base font-bold">By business</h2>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-xs">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground uppercase">
            <tr>
              <th scope="col" className="h-10 px-4 text-left font-medium">Business</th>
              <th scope="col" className="px-4 text-right font-medium">Collected</th>
              {day.kind === 'branch' && <th scope="col" className="px-4 text-right font-medium">Handed over</th>}
              <th scope="col" className="px-4 text-right font-medium">Paid out</th>
              {day.kind === 'branch' && <th scope="col" className="px-4 text-right font-medium">Banked · confirmed</th>}
            </tr>
          </thead>
          <tbody>
            {day.kind === 'branch'
              ? day.data!.businesses.map((b) => (
                  <tr key={b.businessId} className="border-b border-border last:border-0">
                    <td className="min-w-48 px-4 py-3">
                      <span className="font-medium">{name(b.businessId)}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-2">
                        <StatusChip tone={b.closed ? 'success' : 'neutral'}>{b.closed ? 'Day closed' : 'Open'}</StatusChip>
                        {b.openCases > 0 && <span className="text-xs text-warning">{b.openCases} open {b.openCases === 1 ? 'case' : 'cases'}</span>}
                      </span>
                    </td>
                    <td className="money px-4 py-3 text-right">{formatCedis(b.collectedPesewas)}</td>
                    <td className="money px-4 py-3 text-right">{formatCedis(b.handedOverPesewas)}</td>
                    <td className="money px-4 py-3 text-right">{formatCedis(b.paidOutPesewas)}</td>
                    <td className="money px-4 py-3 text-right">
                      {formatCedis(b.depositedPesewas)}
                      <span className="block text-xs text-muted-foreground">{formatCedis(b.bankConfirmedPesewas)} confirmed</span>
                    </td>
                  </tr>
                ))
              : day.data!.businesses.map((b) => (
                  <tr key={b.businessId} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-medium">{name(b.businessId)}</td>
                    <td className="money px-4 py-3 text-right">{formatCedis(b.collectedPesewas)}</td>
                    <td className="money px-4 py-3 text-right">{formatCedis(b.paidOutPesewas)}</td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BranchComparison({ data }: { data: CompanyDay }) {
  const { setScope } = useBranch();
  const branches = [...(data.branches ?? [])].sort((a, b) => b.collectedPesewas - a.collectedPesewas);
  if (!branches.length) return null;
  const top = Math.max(1, ...branches.map((b) => b.collectedPesewas));
  return (
    <section aria-labelledby="comparison" className="grid gap-3">
      <h2 id="comparison" className="font-heading text-base font-bold">Branch comparison</h2>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-xs">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-xs text-muted-foreground uppercase">
            <tr>
              <th scope="col" className="h-10 px-4 text-left font-medium">Branch</th>
              <th scope="col" className="px-4 text-left font-medium"><span className="sr-only">Share of top branch</span></th>
              <th scope="col" className="px-4 text-right font-medium">Collected today</th>
              <th scope="col" className="px-4 text-right font-medium">Collections</th>
              <th scope="col" className="px-4 text-left font-medium">Day</th>
            </tr>
          </thead>
          <tbody>
            {branches.map((b) => (
              <tr key={b.branchId} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setScope(b.branchId)}
                    className="text-left font-medium hover:text-primary hover:underline focus-visible:underline focus-visible:outline-none"
                    title="Switch to this branch"
                  >
                    {b.name} <span className="font-mono text-xs text-muted-foreground">{b.code}</span>
                  </button>
                </td>
                <td className="w-1/3 px-4 py-3">
                  <div className="h-2 rounded-full bg-muted" aria-hidden>
                    <div className="h-2 rounded-full bg-primary" style={{ width: `${(b.collectedPesewas / top) * 100}%` }} />
                  </div>
                </td>
                <td className="money px-4 py-3 text-right font-medium">{formatCedis(b.collectedPesewas)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{b.collectionCount}</td>
                <td className="px-4 py-3"><StatusChip tone={b.closed ? 'success' : 'neutral'}>{b.closed ? 'Closed' : 'Open'}</StatusChip></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const SHORTCUT_COPY: Record<string, string> = {
  '/bank': 'Match branch deposits to the bank statement',
  '/members': 'Register, search and review members',
  '/approvals': 'Requests waiting for a second person',
  '/cash': 'Vaults, agent custody and branch close by business',
  '/admin/products': 'Products and versions for each business',
  '/admin/branches': 'Branches and their codes',
  '/admin/staff': 'People, roles and branch access',
  '/admin/agent-pairs': 'Pair agents for field work',
  '/admin/devices': 'Bind or revoke agent phones',
  '/audit': 'Who did what, and when',
};

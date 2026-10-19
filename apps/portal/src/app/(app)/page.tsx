'use client';

import { formatCedis, isHeadOffice } from '@susu/shared';
import { doc, onSnapshot } from 'firebase/firestore';
import { Activity, ArrowRight, Building2, CloudOff, HandCoins, Smartphone, UsersRound } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { StatusChip } from '@/components/ui/status-chip';
import { can, navFor, ROLE_LABELS } from '@/lib/access';
import { useSession } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import { firebase } from '@/lib/firebase';
import { todayKey } from '@/lib/utils';

/** API.md §4 read models (planned — Step 7; rules already allow these reads). */
interface BranchDay {
  collectedPesewas: number;
  collectionCount: number;
  activePairs: number;
  handedOverPesewas: number;
  pendingSyncCount: number;
  closed: boolean;
}
interface CompanyDay {
  collectedPesewas: number;
  branchesClosed: number;
  branchesOpen: number;
  exceptions: number;
}

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
      scope === null ? doc(db, 'dashboards', 'company', 'days', key) : doc(db, 'dashboards', 'branches', scope, 'days', key);
    return onSnapshot(
      ref,
      (snap) =>
        setDay(
          scope === null
            ? { kind: 'company', data: snap.exists() ? (snap.data() as CompanyDay) : null }
            : { kind: 'branch', data: snap.exists() ? (snap.data() as BranchDay) : null },
        ),
      () => setError(true),
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
          {day?.data == null && !error && day && <StatusChip tone="neutral">No activity yet</StatusChip>}
          {error && <StatusChip tone="warning">Live figures unavailable</StatusChip>}
        </div>

        {day?.kind === 'company' ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Collected today" value={formatCedis(day.data?.collectedPesewas ?? 0)} icon={HandCoins} money />
            <Stat label="Branches open" value={String(day.data?.branchesOpen ?? 0)} icon={Building2} />
            <Stat label="Branches closed" value={String(day.data?.branchesClosed ?? 0)} icon={Building2} />
            <Stat label="Open exceptions" value={String(day.data?.exceptions ?? 0)} icon={Activity} />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat
              label="Collected today"
              value={formatCedis(day?.kind === 'branch' ? (day.data?.collectedPesewas ?? 0) : 0)}
              icon={HandCoins}
              money
              hint={`${day?.kind === 'branch' ? (day.data?.collectionCount ?? 0) : 0} collections synced`}
            />
            <Stat
              label="Handed over"
              value={formatCedis(day?.kind === 'branch' ? (day.data?.handedOverPesewas ?? 0) : 0)}
              icon={HandCoins}
              money
            />
            <Stat
              label="Active agent pairs"
              value={String(day?.kind === 'branch' ? (day.data?.activePairs ?? 0) : 0)}
              icon={UsersRound}
            />
            <Stat
              label="Waiting to sync"
              value={String(day?.kind === 'branch' ? (day.data?.pendingSyncCount ?? 0) : 0)}
              icon={CloudOff}
              hint="Recorded on phones, not yet received"
            />
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Figures update live as collections post. Only synced collections are counted.
        </p>
      </section>

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

const SHORTCUT_COPY: Record<string, string> = {
  '/members': 'Register, search and review members',
  '/approvals': 'Requests waiting for a second person',
  '/admin/products': 'Susu products and versions',
  '/admin/branches': 'Branches and their codes',
  '/admin/staff': 'People, roles and branch access',
  '/admin/agent-pairs': 'Pair agents for field work',
  '/admin/devices': 'Bind or revoke agent phones',
  '/audit': 'Who did what, and when',
};

'use client';

import type { MemberStatus } from '@susu/shared';
import type { ColumnDef } from '@tanstack/react-table';
import { Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { LoadError } from '@/components/load-error';
import { DataTable } from '@/components/ui/data-table';
import { ListPager } from '@/components/ui/list-pager';
import { PageHeader } from '@/components/ui/page-header';
import { KycChip, RecordStatus } from '@/components/ui/status-chip';
import { can } from '@/lib/access';
import { useSession } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import { searchMembers, type MemberRow } from '@/lib/members-api';
import { usePagedList } from '@/lib/use-paged-list';
import { cn, formatDateTime } from '@/lib/utils';
import { RegisterMemberDialog } from './register-member-dialog';

const FILTERS: { value: MemberStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'PENDING_APPROVAL', label: 'Awaiting approval' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'RESTRICTED', label: 'Restricted' },
];

export default function MembersPage() {
  const { claims } = useSession();
  const { scope, branchName } = useBranch();
  const [status, setStatus] = useState<MemberStatus | ''>('');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  const { rows, loading, loadingMore, nextCursor, error, loadMore } = usePagedList(
    async (cursor) => {
      const result = await searchMembers({ branchId: scope ?? undefined, query: debounced, status: status || undefined, cursor });
      return { rows: result.members, nextCursor: result.nextCursor };
    },
    [scope, debounced, status],
  );

  const columns = useMemo<ColumnDef<MemberRow, unknown>[]>(
    () => [
      {
        accessorKey: 'fullName',
        header: 'Member',
        cell: ({ row }) => (
          <Link
            href={`/members/${row.original.id}`}
            className="flex items-center gap-2 font-medium text-foreground hover:text-primary hover:underline focus-visible:underline focus-visible:outline-none"
          >
            {row.original.fullName}
          </Link>
        ),
      },
      {
        accessorKey: 'phoneMasked',
        header: 'Phone',
        enableSorting: false,
        cell: ({ getValue }) => <span className="font-mono text-[13px]">{String(getValue())}</span>,
      },
      {
        accessorKey: 'ghanaCardMasked',
        header: 'Ghana Card',
        enableSorting: false,
        cell: ({ getValue }) => <span className="font-mono text-[13px]">{String(getValue())}</span>,
      },
      { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <RecordStatus status={String(getValue())} /> },
      { accessorKey: 'kycStatus', header: 'KYC', cell: ({ getValue }) => <KycChip status={String(getValue())} /> },
      ...(scope === null
        ? [
            {
              id: 'branch',
              header: 'Branch',
              accessorFn: (r: MemberRow) => branchName(r.branchId),
              cell: ({ getValue }: { getValue: () => unknown }) => <span className="text-[13px]">{String(getValue())}</span>,
            } as ColumnDef<MemberRow, unknown>,
          ]
        : []),
      {
        accessorKey: 'createdAt',
        header: 'Registered',
        cell: ({ getValue }) => <span className="text-[13px] whitespace-nowrap tabular-nums">{formatDateTime(String(getValue()))}</span>,
      },
    ],
    [branchName, scope],
  );

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Members"
        description="Search by name, phone or full Ghana Card number. New members stay “Awaiting approval” until a second person approves them."
        actions={can.registerMember(claims.role) && <RegisterMemberDialog />}
      />
      <LoadError error={error} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          aria-label="Search members"
          placeholder="Name, 024…, or GHA-…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-10 w-full max-w-sm rounded-lg border border-input bg-surface px-3 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
        />
        <div role="radiogroup" aria-label="Filter by status" className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.value || 'all'}
              role="radio"
              aria-checked={status === f.value}
              onClick={() => setStatus(f.value)}
              className={cn(
                'h-8 rounded-full border px-3 text-[13px] font-medium transition focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none',
                status === f.value ? 'border-primary bg-primary text-white' : 'border-border bg-surface hover:bg-muted',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Filter these results"
        empty={
          <div className="flex flex-col items-center gap-2 text-center">
            <Users className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {debounced || status ? 'No members match. Try another name, phone or status.' : 'No members in this branch yet. Register the first one.'}
            </p>
          </div>
        }
      />
      <ListPager count={rows.length} hasMore={!!nextCursor} loading={loadingMore} onLoadMore={loadMore} />
    </div>
  );
}

'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { ArrowRight, ClipboardCheck } from 'lucide-react';
import Link from 'next/link';
import { useMemo } from 'react';
import { MockNotice } from '@/components/mock-notice';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { PageHeader } from '@/components/ui/page-header';
import { SampleTag, StatusChip } from '@/components/ui/status-chip';
import { useSession } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import { listPendingApprovals, type PendingApproval } from '@/lib/members-api';
import { useList } from '@/lib/use-list';
import { formatDateTime } from '@/lib/utils';

const KIND_LABEL: Record<PendingApproval['kind'], string> = {
  MEMBER_REGISTRATION: 'Member registration',
};

export default function ApprovalsPage() {
  const { user } = useSession();
  const { scope, branchName } = useBranch();
  const { rows, loading } = useList(() => listPendingApprovals({ branchId: scope ?? undefined }).then((r) => r.items), [scope]);

  const columns = useMemo<ColumnDef<PendingApproval, unknown>[]>(
    () => [
      {
        accessorKey: 'summary',
        header: 'Request',
        cell: ({ row }) => (
          <div className="grid">
            <span className="flex items-center gap-2 font-medium">
              {row.original.summary} {row.original.sample && <SampleTag />}
            </span>
            <span className="text-[13px] text-muted-foreground">{KIND_LABEL[row.original.kind]}</span>
          </div>
        ),
      },
      {
        id: 'branch',
        header: 'Branch',
        accessorFn: (r) => branchName(r.branchId),
        cell: ({ getValue }) => <span className="text-[13px]">{String(getValue())}</span>,
      },
      {
        accessorKey: 'requestedBy',
        header: 'Started by',
        cell: ({ getValue }) =>
          getValue() === user.uid ? (
            <StatusChip tone="info" dot={false}>You</StatusChip>
          ) : (
            <span className="font-mono text-xs">{String(getValue())}</span>
          ),
      },
      {
        accessorKey: 'requestedAt',
        header: 'Waiting since',
        cell: ({ getValue }) => <span className="text-[13px] whitespace-nowrap tabular-nums">{formatDateTime(String(getValue()))}</span>,
      },
      {
        id: 'action',
        header: '',
        enableSorting: false,
        meta: { align: 'right' },
        cell: ({ row }) =>
          row.original.requestedBy === user.uid ? (
            <span className="text-[13px] text-muted-foreground">Needs someone else</span>
          ) : (
            <Button asChild size="sm" variant="outline">
              <Link href={`/members/${row.original.id}`}>
                Review <ArrowRight />
              </Link>
            </Button>
          ),
      },
    ],
    [branchName, user.uid],
  );

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Approvals"
        description="Requests waiting for a second person. You can't approve anything you started yourself."
      />
      <MockNotice endpoint="listPendingApprovals" />
      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search requests"
        empty={
          <div className="flex flex-col items-center gap-2 text-center">
            <ClipboardCheck className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Nothing waiting. New registrations and requests appear here.</p>
          </div>
        }
      />
    </div>
  );
}

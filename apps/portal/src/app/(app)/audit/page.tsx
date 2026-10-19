'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { ScrollText } from 'lucide-react';
import { useMemo, useState } from 'react';
import { LoadError } from '@/components/load-error';
import { DataTable } from '@/components/ui/data-table';
import { Field } from '@/components/ui/field';
import { NativeSelect } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { StatusChip } from '@/components/ui/status-chip';
import { listAuditEvents, type AuditEventSummary } from '@/lib/api';
import { useBranch } from '@/lib/branch-context';
import { useList } from '@/lib/use-list';
import { formatDateTime } from '@/lib/utils';

const ENTITY_KINDS = [
  { value: '', label: 'Everything' },
  { value: 'branch', label: 'Branches' },
  { value: 'staff_user', label: 'Staff' },
  { value: 'agent_pair', label: 'Agent pairs' },
  { value: 'device', label: 'Devices' },
  { value: 'member', label: 'Members' },
  { value: 'susu_account', label: 'Susu accounts' },
  { value: 'collection', label: 'Collections' },
];

const ACTION_COPY: Record<string, string> = {
  'branch.created': 'Created branch',
  'staff.created': 'Added staff member',
  'agent_pair.created': 'Created agent pair',
  'device.bound': 'Bound phone',
  'device.revoked': 'Revoked phone',
  'member.registered': 'Registered member',
  'member.approved': 'Approved member',
  'susu_product.created': 'Created Susu product',
  'susu_account.opened': 'Opened Susu account',
  'collection.posted': 'Collection posted',
};

export default function AuditPage() {
  const { scope, branchName } = useBranch();
  const [entityKind, setEntityKind] = useState('');
  const { rows, loading, error } = useList(
    () => listAuditEvents({ branchId: scope ?? undefined, entityKind: entityKind || undefined }).then((r) => r.events),
    [scope, entityKind],
  );

  const columns = useMemo<ColumnDef<AuditEventSummary, unknown>[]>(
    () => [
      {
        accessorKey: 'at',
        header: 'When (server time)',
        cell: ({ row }) => (
          <span className="flex items-center gap-2 text-[13px] whitespace-nowrap tabular-nums">
            {formatDateTime(row.original.at)}
          </span>
        ),
      },
      {
        accessorKey: 'action',
        header: 'What',
        cell: ({ row }) => (
          <div className="grid">
            <span className="font-medium">{ACTION_COPY[row.original.action] ?? row.original.action}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {row.original.entityKind} · {row.original.entityId}
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'actorUid',
        header: 'Who',
        cell: ({ getValue }) => <span className="font-mono text-xs">{String(getValue())}</span>,
      },
      {
        accessorKey: 'channel',
        header: 'Channel',
        cell: ({ getValue }) => <StatusChip tone="neutral" dot={false}>{String(getValue())}</StatusChip>,
      },
      {
        id: 'branch',
        header: 'Branch',
        accessorFn: (r) => (r.branchId ? branchName(r.branchId) : '—'),
        cell: ({ getValue }) => <span className="text-[13px]">{String(getValue())}</span>,
      },
      {
        id: 'data',
        header: 'Details',
        enableSorting: false,
        accessorFn: (r) => JSON.stringify(r.data),
        cell: ({ row }) => (
          <code className="line-clamp-2 max-w-xs font-mono text-xs break-all text-muted-foreground">
            {JSON.stringify(row.original.data)}
          </code>
        ),
      },
    ],
    [branchName],
  );

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Audit log"
        description="Every action records who did it, from which channel and device, at server time. Entries cannot be edited or deleted."
        actions={
          <Field label="Show" htmlFor="audit-kind" className="w-48">
            <NativeSelect id="audit-kind" value={entityKind} onChange={(e) => setEntityKind(e.target.value)}>
              {ENTITY_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
        }
      />
      <LoadError error={error} />
      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search actions, people or IDs"
        empty={
          <div className="flex flex-col items-center gap-2 text-center">
            <ScrollText className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No audit entries match this filter.</p>
          </div>
        }
      />
    </div>
  );
}

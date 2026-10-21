'use client';

import { formatCedis } from '@susu/shared';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowLeft, FilePen, ReceiptText } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { LoadError } from '@/components/load-error';
import { Card, CardContent } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { ListPager } from '@/components/ui/list-pager';
import { RecordStatus, StatusChip } from '@/components/ui/status-chip';
import { can } from '@/lib/access';
import { useSession } from '@/lib/auth-context';
import { CORRECTION_STATEMENT_KINDS } from '@/lib/corrections-api';
import { getAccountStatement, type StatementLine } from '@/lib/members-api';
import { usePagedList } from '@/lib/use-paged-list';
import { formatDateTime } from '@/lib/utils';
import { RequestCorrectionDialog } from './request-correction-dialog';

const KIND_COPY: Record<string, string> = {
  SUSU_COLLECTION: 'Collection',
  WITHDRAWAL: 'Withdrawal',
  WITHDRAWAL_PAYOUT: 'Withdrawal paid',
  OPENING_BALANCE: 'Opening balance',
  ...CORRECTION_STATEMENT_KINDS,
};

function kindLabel(kind: string) {
  if (KIND_COPY[kind]) return KIND_COPY[kind];
  if (kind.startsWith('REVERSAL:')) return `Reversal of ${KIND_COPY[kind.slice(9)] ?? kind.slice(9)}`;
  return kind;
}

const isCorrection = (kind: string) => kind.startsWith('REVERSAL:') || kind.startsWith('CORRECTION:');

const money = (v: number) => (v ? formatCedis(v) : '—');

export default function StatementPage() {
  const { memberId, accountId } = useParams<{ memberId: string; accountId: string }>();
  const { claims } = useSession();
  const canCorrect = can.requestCorrection(claims.role);
  const [correcting, setCorrecting] = useState<StatementLine | null>(null);
  const { rows: pages, loading, loadingMore, nextCursor, error, loadMore } = usePagedList(
    async (cursor) => {
      const result = await getAccountStatement({ susuAccountId: accountId, cursor });
      return { rows: result ? [result] : [], nextCursor: result?.nextCursor ?? null };
    },
    [accountId],
  );
  const statement = pages[0];
  const account = statement?.account;
  const lines = pages.flatMap((page) => page.lines);

  const columns = useMemo<ColumnDef<StatementLine, unknown>[]>(
    () => [
      {
        accessorKey: 'postedAt',
        header: 'Posted (server time)',
        cell: ({ getValue }) => <span className="text-[13px] whitespace-nowrap tabular-nums">{formatDateTime(String(getValue()))}</span>,
      },
      {
        accessorKey: 'kind',
        header: 'Entry',
        cell: ({ row }) => (
          <div className="grid">
            <span className="flex items-center gap-2 font-medium">
              {kindLabel(row.original.kind)}
              {isCorrection(row.original.kind) && <StatusChip tone="warning">Approved correction</StatusChip>}
            </span>
            <span className="text-[13px] text-muted-foreground">{row.original.description}</span>
            {canCorrect && row.original.kind === 'SUSU_COLLECTION' && row.original.creditPesewas > 0 && (
              <button
                type="button"
                onClick={() => setCorrecting(row.original)}
                className="mt-1 inline-flex w-fit items-center gap-1 text-[13px] font-medium text-primary hover:underline focus-visible:underline focus-visible:outline-none"
              >
                <FilePen className="size-3.5" aria-hidden /> Request correction
              </button>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'creditPesewas',
        header: 'Paid in',
        meta: { align: 'right' },
        cell: ({ getValue }) => <span className="money text-success">{money(Number(getValue()))}</span>,
      },
      {
        accessorKey: 'debitPesewas',
        header: 'Paid out',
        meta: { align: 'right' },
        cell: ({ getValue }) => <span className="money">{money(Number(getValue()))}</span>,
      },
      {
        accessorKey: 'balanceAfterPesewas',
        header: 'Balance',
        meta: { align: 'right' },
        cell: ({ getValue }) => <span className="money font-medium">{formatCedis(Number(getValue()))}</span>,
      },
      {
        accessorKey: 'batchId',
        header: 'Reference',
        enableSorting: false,
        cell: ({ getValue }) => <span className="font-mono text-xs">{String(getValue()).slice(0, 8).toUpperCase()}</span>,
      },
    ],
    [canCorrect],
  );

  return (
    <div className="grid gap-6">
      <Link href={`/members/${memberId}`} className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Member profile
      </Link>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="grid gap-2">
          <h1 className="flex items-center gap-2 font-heading text-2xl font-bold tracking-tight">
            {account?.productName ?? 'Susu account'}
          </h1>
          <div className="flex items-center gap-2">
            {account && <RecordStatus status={account.status} />}
            {account && <span className="text-xs text-muted-foreground">{account.businessName}</span>}
            <span className="font-mono text-xs text-muted-foreground">{accountId}</span>
          </div>
        </div>
        <Card className="sm:min-w-56">
          <CardContent className="py-4">
            <p className="text-[13px] text-muted-foreground">Balance owed to member</p>
            <p className="money font-heading text-2xl font-bold">{account ? formatCedis(account.balancePesewas) : '—'}</p>
          </CardContent>
        </Card>
      </div>
      <LoadError error={error} />
      <p className="text-sm text-muted-foreground">
        Every line comes from the ledger. Nothing here can be edited: a wrong collection is fixed by a correction that a
        different person approves, and both lines stay visible.
      </p>
      <DataTable
        columns={columns}
        data={lines}
        loading={loading}
        searchPlaceholder="Search entries or references"
        empty={
          <div className="flex flex-col items-center gap-2 text-center">
            <ReceiptText className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No entries yet. Collections appear here once an agent's phone syncs.</p>
          </div>
        }
      />
      <ListPager count={lines.length} hasMore={!!nextCursor} loading={loadingMore} onLoadMore={loadMore} />
      {account && canCorrect && (
        <RequestCorrectionDialog line={correcting} memberId={memberId} account={account} onClose={() => setCorrecting(null)} />
      )}
    </div>
  );
}

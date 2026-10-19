'use client';

import { createBranchRequestSchema } from '@susu/shared';
import type { ColumnDef } from '@tanstack/react-table';
import { Building2, Loader2, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { LoadError } from '@/components/load-error';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { RecordStatus } from '@/components/ui/status-chip';
import { can } from '@/lib/access';
import { createBranch, listBranches, type BranchSummary } from '@/lib/api';
import { useSession } from '@/lib/auth-context';
import { useAction } from '@/lib/use-action';
import { useList } from '@/lib/use-list';

const columns: ColumnDef<BranchSummary, unknown>[] = [
  {
    accessorKey: 'name',
    header: 'Branch',
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <span className="font-medium">{row.original.name}</span>

      </div>
    ),
  },
  {
    accessorKey: 'code',
    header: 'Code',
    cell: ({ getValue }) => <span className="font-mono text-[13px]">{String(getValue())}</span>,
  },
  { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <RecordStatus status={String(getValue())} /> },
  {
    accessorKey: 'id',
    header: 'Branch ID',
    enableSorting: false,
    cell: ({ getValue }) => <span className="font-mono text-xs text-muted-foreground">{String(getValue())}</span>,
  },
];

function NewBranchDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const action = useAction(createBranchRequestSchema, createBranch);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const result = await action.run({ name, code });
    if (result) {
      toast.success(`${name.trim()} created`, { description: 'Its cash and variance accounts are ready.' });
      setOpen(false);
      setName('');
      setCode('');
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) action.reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus /> New branch
        </Button>
      </DialogTrigger>
      <DialogContent title="New branch" description="Creates the branch and opens its cash accounts in the ledger.">
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          {action.error && !Object.keys(action.error.fieldErrors).length && <Alert tone="error">{action.error.message}</Alert>}
          <Field label="Branch name" htmlFor="branch-name" error={action.fieldError('name')}>
            <Input
              id="branch-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Kumasi Central"
              aria-invalid={!!action.fieldError('name')}
              autoFocus
            />
          </Field>
          <Field
            label="Branch code"
            htmlFor="branch-code"
            hint="2–12 letters, digits or hyphens. Printed on receipts and reports."
            error={action.fieldError('code')}
          >
            <Input
              id="branch-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="KSI-01"
              className="font-mono uppercase"
              aria-invalid={!!action.fieldError('code')}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={action.busy}>
              {action.busy && <Loader2 className="animate-spin" />} Create branch
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function BranchesPage() {
  const { claims } = useSession();
  const { rows, loading, error } = useList(() => listBranches().then((r) => r.branches), []);
  const canCreate = can.createBranch(claims.role);

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Branches"
        description="Every branch has its own cash account and variance account in the ledger."
        actions={canCreate && <NewBranchDialog />}
      />
      <LoadError error={error} />
      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search branches"
        empty={
          <div className="flex flex-col items-center gap-3 text-center">
            <Building2 className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {canCreate ? 'No branches yet. Create the pilot branch to get started.' : 'No branches are visible to you yet.'}
            </p>
          </div>
        }
      />
    </div>
  );
}

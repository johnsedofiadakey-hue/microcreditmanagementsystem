'use client';

import { createSusuProductRequestSchema, susuFrequencySchema, type SusuFrequency } from '@susu/shared';
import type { ColumnDef } from '@tanstack/react-table';
import { Loader2, Package, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { LoadError } from '@/components/load-error';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, NativeSelect } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { RecordStatus } from '@/components/ui/status-chip';
import { can } from '@/lib/access';
import { useSession } from '@/lib/auth-context';
import { createSusuProduct, listSusuProducts, type ProductRow } from '@/lib/members-api';
import { useAction } from '@/lib/use-action';
import { useList } from '@/lib/use-list';

const FREQUENCY_LABEL: Record<SusuFrequency, string> = { DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly' };

const columns: ColumnDef<ProductRow, unknown>[] = [
  {
    accessorKey: 'name',
    header: 'Product',
    cell: ({ row }) => (
      <span className="flex items-center gap-2 font-medium">
        {row.original.name}
      </span>
    ),
  },
  { accessorKey: 'code', header: 'Code', cell: ({ getValue }) => <span className="font-mono text-[13px]">{String(getValue())}</span> },
  { accessorKey: 'version', header: 'Version', cell: ({ getValue }) => <span className="tabular-nums">v{String(getValue())}</span> },
  {
    accessorKey: 'frequency',
    header: 'Collected',
    cell: ({ getValue }) => FREQUENCY_LABEL[getValue() as SusuFrequency],
  },
  { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <RecordStatus status={String(getValue())} /> },
];

function NewProductDialog() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [frequency, setFrequency] = useState<SusuFrequency>('DAILY');
  const action = useAction(createSusuProductRequestSchema, createSusuProduct);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const result = await action.run({ code, name, frequency });
    if (result) {
      toast.success(`${name.trim()} v${result.data.version} is live`, {
        description: result.data.version > 1 ? 'The previous version is retired. Existing accounts keep their version.' : undefined,
      });
      setOpen(false);
      setCode('');
      setName('');
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
          <Plus /> New product or version
        </Button>
      </DialogTrigger>
      <DialogContent
        title="New Susu product"
        description="Reusing an existing code creates a new version and retires the old one for new accounts."
      >
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          {action.error && !Object.keys(action.error.fieldErrors).length && <Alert tone="error">{action.error.message}</Alert>}
          <Field label="Code" htmlFor="p-code" hint="2–24 letters, digits or hyphens, e.g. DAILY" error={action.fieldError('code')}>
            <Input id="p-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="font-mono uppercase" autoFocus />
          </Field>
          <Field label="Name" htmlFor="p-name" error={action.fieldError('name')}>
            <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Daily Susu" />
          </Field>
          <Field label="Collection frequency" htmlFor="p-freq" error={action.fieldError('frequency')}>
            <NativeSelect id="p-freq" value={frequency} onChange={(e) => setFrequency(e.target.value as SusuFrequency)}>
              {susuFrequencySchema.options.map((f) => (
                <option key={f} value={f}>
                  {FREQUENCY_LABEL[f]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Alert tone="info">Fees, cycle length and withdrawal rules are agreed in Stage 0 and arrive with a later backend step.</Alert>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={action.busy}>
              {action.busy && <Loader2 className="animate-spin" />} Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ProductsPage() {
  const { claims } = useSession();
  const { rows, loading, error } = useList(() => listSusuProducts().then((r) => r.products), []);
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Susu products"
        description="Products are versioned. Accounts stay on the version they were opened with."
        actions={can.createProduct(claims.role) && <NewProductDialog />}
      />
      <LoadError error={error} />
      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search products"
        empty={
          <div className="flex flex-col items-center gap-2 text-center">
            <Package className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No products yet. Create the first one so accounts can be opened.</p>
          </div>
        }
      />
    </div>
  );
}

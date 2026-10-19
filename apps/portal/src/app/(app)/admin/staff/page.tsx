'use client';

import { createStaffUserRequestSchema, isHeadOffice, type Role } from '@susu/shared';
import type { ColumnDef } from '@tanstack/react-table';
import { Check, Copy, Loader2, UserPlus, Users } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { LoadError } from '@/components/load-error';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, NativeSelect } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { RecordStatus, StatusChip } from '@/components/ui/status-chip';
import { creatableRoles, ROLE_LABELS } from '@/lib/access';
import { createStaffUser, listStaff, type StaffSummary } from '@/lib/api';
import { useSession } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import { useAction } from '@/lib/use-action';
import { useList } from '@/lib/use-list';

function SetupLink({ link, email }: { link: string; email: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="grid gap-3">
      <Alert tone="success" title="Account created">
        Send this password-setup link to <strong>{email}</strong> privately (not in a group chat). It works once.
      </Alert>
      <div className="flex gap-2">
        <Input readOnly value={link} aria-label="Password setup link" className="font-mono text-xs" onFocus={(e) => e.target.select()} />
        <Button
          type="button"
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(link);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

function AddStaffDialog() {
  const { claims } = useSession();
  const { branches, scope } = useBranch();
  const roles = creatableRoles(claims.role);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<Role>(roles.includes('AGENT') ? 'AGENT' : roles[0]!);
  const [branchIds, setBranchIds] = useState<string[]>(scope ? [scope] : []);
  const [created, setCreated] = useState<{ link: string; email: string } | null>(null);
  const action = useAction(createStaffUserRequestSchema, createStaffUser);

  const headOfficeRole = isHeadOffice(role);
  const singleBranch = role === 'AGENT';

  function reset() {
    setEmail('');
    setDisplayName('');
    setBranchIds(scope ? [scope] : []);
    setCreated(null);
    action.reset();
  }

  function toggleBranch(id: string) {
    setBranchIds((current) =>
      singleBranch ? [id] : current.includes(id) ? current.filter((b) => b !== id) : [...current, id],
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const ids = headOfficeRole ? [] : singleBranch ? branchIds.slice(0, 1) : branchIds;
    const result = await action.run({ email, displayName, role, branchIds: ids });
    if (result) {
      toast.success(`${displayName.trim()} added as ${ROLE_LABELS[role]}`);
      setCreated({ link: result.data.passwordSetupLink, email: email.trim() });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <UserPlus /> Add staff
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Add a staff member"
        description="They receive a password-setup link. There is no self sign-up."
      >
        {created ? (
          <>
            <SetupLink link={created.link} email={created.email} />
            <DialogFooter>
              <Button variant="outline" onClick={reset}>
                Add another
              </Button>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={onSubmit} className="grid gap-4" noValidate>
            {action.error && !Object.keys(action.error.fieldErrors).length && (
              <Alert tone="error">{action.error.message}</Alert>
            )}
            <Field label="Full name" htmlFor="staff-name" error={action.fieldError('displayName')}>
              <Input id="staff-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoFocus />
            </Field>
            <Field label="Work email" htmlFor="staff-email" error={action.fieldError('email')}>
              <Input id="staff-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Role" htmlFor="staff-role" error={action.fieldError('role')}>
              <NativeSelect
                id="staff-role"
                value={role}
                onChange={(e) => {
                  const next = e.target.value as Role;
                  setRole(next);
                  if (next === 'AGENT') setBranchIds((b) => b.slice(0, 1));
                }}
              >
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {headOfficeRole ? (
              <Alert tone="info">Head-office roles see every branch, so no branch is assigned.</Alert>
            ) : (
              <fieldset className="grid gap-2">
                <legend className="mb-1.5 text-[13px] font-medium">
                  {singleBranch ? 'Branch (an agent belongs to exactly one)' : 'Branches'}
                </legend>
                {branches.length === 0 && <p className="text-sm text-muted-foreground">Create a branch first.</p>}
                <div className="grid max-h-48 gap-1 overflow-y-auto rounded-lg border border-border p-1">
                  {branches.map((b) => (
                    <label
                      key={b.id}
                      className="flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-sm hover:bg-muted has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50"
                    >
                      <input
                        type={singleBranch ? 'radio' : 'checkbox'}
                        name="branch"
                        className="size-4 accent-[var(--primary)]"
                        checked={branchIds.includes(b.id)}
                        onChange={() => toggleBranch(b.id)}
                      />
                      <span className="flex-1">{b.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">{b.code}</span>

                    </label>
                  ))}
                </div>
                {action.fieldError('branchIds') && (
                  <p role="alert" className="text-[13px] text-destructive">
                    {action.fieldError('branchIds')}
                  </p>
                )}
              </fieldset>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={action.busy || (!headOfficeRole && branchIds.length === 0)}
              >
                {action.busy && <Loader2 className="animate-spin" />} Create account
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function StaffPage() {
  const { claims } = useSession();
  const { scope, branchName } = useBranch();
  const { rows, loading, error } = useList(() => listStaff({ branchId: scope ?? undefined }).then((r) => r.staff), [scope]);
  const canCreate = creatableRoles(claims.role).length > 0;

  const columns = useMemo<ColumnDef<StaffSummary, unknown>[]>(
    () => [
      {
        accessorKey: 'displayName',
        header: 'Name',
        cell: ({ row }) => (
          <div className="grid">
            <span className="flex items-center gap-2 font-medium">
              {row.original.displayName}
            </span>
            <span className="text-[13px] text-muted-foreground">{row.original.email}</span>
          </div>
        ),
        filterFn: (row, _id, value: string) =>
          `${row.original.displayName} ${row.original.email}`.toLowerCase().includes(value.toLowerCase()),
      },
      {
        accessorKey: 'role',
        header: 'Role',
        cell: ({ getValue }) => <StatusChip tone="info" dot={false}>{ROLE_LABELS[getValue() as Role]}</StatusChip>,
      },
      {
        id: 'branches',
        header: 'Branches',
        enableSorting: false,
        accessorFn: (r) => r.branchIds.join(' '),
        cell: ({ row }) =>
          isHeadOffice(row.original.role) ? (
            <span className="text-muted-foreground">All branches</span>
          ) : (
            <span className="text-[13px]">{row.original.branchIds.map(branchName).join(', ')}</span>
          ),
      },
      { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <RecordStatus status={String(getValue())} /> },
    ],
    [branchName],
  );

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Staff & roles"
        description={
          claims.role === 'BRANCH_MANAGER'
            ? 'Add cashiers, supervisors and agents to your branches.'
            : 'Everyone who can sign in, their role and the branches they work in.'
        }
        actions={canCreate && <AddStaffDialog />}
      />
      <LoadError error={error} />
      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search by name or email"
        empty={
          <div className="flex flex-col items-center gap-2 text-center">
            <Users className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No staff in this branch yet. Add the first person.</p>
          </div>
        }
      />
    </div>
  );
}

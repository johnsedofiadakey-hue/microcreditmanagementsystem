'use client';

import { createAgentPairRequestSchema } from '@susu/shared';
import type { ColumnDef } from '@tanstack/react-table';
import { Loader2, Plus, UsersRound } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { MockNotice } from '@/components/mock-notice';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, NativeSelect } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { RecordStatus, SampleTag } from '@/components/ui/status-chip';
import { can } from '@/lib/access';
import { createAgentPair, listAgentPairs, listStaff, type AgentPairSummary, type StaffSummary } from '@/lib/api';
import { useSession } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import { useAction } from '@/lib/use-action';
import { useList } from '@/lib/use-list';

function AgentPicker({
  id,
  label,
  value,
  onChange,
  agents,
  exclude,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (uid: string) => void;
  agents: StaffSummary[];
  exclude: string;
  error?: string;
}) {
  // Typing a UID is the fallback when no free agents are listed (or the person asks for it).
  const [preferManual, setPreferManual] = useState(false);
  const manual = preferManual || agents.length === 0;
  const setManual = (next: (m: boolean) => boolean) => setPreferManual(next(manual));

  return (
    <Field
      label={label}
      htmlFor={id}
      error={error}
      hint={
        <button type="button" className="font-medium text-primary hover:underline" onClick={() => setManual((m) => !m)}>
          {manual ? 'Choose from the list' : 'Enter a user ID instead'}
        </button>
      }
    >
      {manual ? (
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value.trim())} placeholder="Firebase user ID" className="font-mono text-[13px]" />
      ) : (
        <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error}>
          <option value="">Select an agent</option>
          {agents
            .filter((a) => a.uid !== exclude)
            .map((a) => (
              <option key={a.uid} value={a.uid}>
                {a.displayName} — {a.email}
              </option>
            ))}
        </NativeSelect>
      )}
    </Field>
  );
}

function NewPairDialog({ pairs }: { pairs: AgentPairSummary[] }) {
  const { branches, scope } = useBranch();
  const [open, setOpen] = useState(false);
  const [branchId, setBranchId] = useState(scope ?? branches[0]?.id ?? '');
  const [name, setName] = useState('');
  const [agentAUid, setA] = useState('');
  const [agentBUid, setB] = useState('');
  const [agents, setAgents] = useState<StaffSummary[]>([]);
  const action = useAction(createAgentPairRequestSchema, createAgentPair);

  useEffect(() => {
    if (!branchId) return;
    listStaff({ branchId }).then(({ staff }) => {
      // One active pair per agent (server-enforced); offer only agents who are free.
      const busy = new Set(pairs.filter((p) => p.status === 'ACTIVE').flatMap((p) => [p.agentAUid, p.agentBUid]));
      setAgents(staff.filter((s) => s.role === 'AGENT' && s.status === 'ACTIVE' && !busy.has(s.uid)));
    });
  }, [branchId, pairs]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const result = await action.run({ branchId, name, agentAUid, agentBUid });
    if (result) {
      toast.success(`${name.trim()} created`, {
        description: 'Both agents must sign out and back in on their phones to pick up the pair.',
      });
      setOpen(false);
      setName('');
      setA('');
      setB('');
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) action.reset();
        if (next) setBranchId(scope ?? branches[0]?.id ?? '');
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus /> New pair
        </Button>
      </DialogTrigger>
      <DialogContent
        title="New agent pair"
        description="Two agents from the same branch who collect together. The pair gets its own cash custody account."
      >
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          {action.error && !Object.keys(action.error.fieldErrors).length && <Alert tone="error">{action.error.message}</Alert>}
          <Field label="Branch" htmlFor="pair-branch" error={action.fieldError('branchId')}>
            <NativeSelect id="pair-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Pair name" htmlFor="pair-name" hint="Usually the area they cover." error={action.fieldError('name')}>
            <Input id="pair-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Adum Market Pair" />
          </Field>
          <AgentPicker id="pair-a" label="First agent" value={agentAUid} onChange={setA} agents={agents} exclude={agentBUid} error={action.fieldError('agentAUid')} />
          <AgentPicker id="pair-b" label="Second agent" value={agentBUid} onChange={setB} agents={agents} exclude={agentAUid} error={action.fieldError('agentBUid')} />
          {agentAUid && agentAUid === agentBUid && <Alert tone="error">A pair needs two different agents.</Alert>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={action.busy || !agentAUid || !agentBUid || agentAUid === agentBUid}>
              {action.busy && <Loader2 className="animate-spin" />} Create pair
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function AgentPairsPage() {
  const { claims } = useSession();
  const { scope, branchName } = useBranch();
  const { rows, loading } = useList(() => listAgentPairs({ branchId: scope ?? undefined }).then((r) => r.agentPairs), [scope]);
  const { rows: staff } = useList(() => listStaff({}).then((r) => r.staff), []);
  const nameOf = useMemo(() => {
    const byUid = new Map(staff.map((s) => [s.uid, s.displayName]));
    return (uid: string) => byUid.get(uid) ?? uid;
  }, [staff]);

  const columns = useMemo<ColumnDef<AgentPairSummary, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Pair',
        cell: ({ row }) => (
          <span className="flex items-center gap-2 font-medium">
            {row.original.name} {row.original.sample && <SampleTag />}
          </span>
        ),
      },
      {
        id: 'agents',
        header: 'Agents',
        accessorFn: (r) => `${nameOf(r.agentAUid)} ${nameOf(r.agentBUid)}`,
        cell: ({ row }) => (
          <span className="text-[13px]">
            {nameOf(row.original.agentAUid)} &amp; {nameOf(row.original.agentBUid)}
          </span>
        ),
      },
      {
        id: 'branch',
        header: 'Branch',
        accessorFn: (r) => branchName(r.branchId),
        cell: ({ getValue }) => <span className="text-[13px]">{String(getValue())}</span>,
      },
      { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <RecordStatus status={String(getValue())} /> },
    ],
    [branchName, nameOf],
  );

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Agent pairs"
        description="Agents always collect in pairs. Each pair holds collected cash in its custody account until handover."
        actions={can.createAgentPair(claims.role) && <NewPairDialog pairs={rows} />}
      />
      <MockNotice endpoint="listAgentPairs" />
      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search pairs or agents"
        empty={
          <div className="flex flex-col items-center gap-2 text-center">
            <UsersRound className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No agent pairs yet. Add two agents under Staff, then pair them here.</p>
          </div>
        }
      />
    </div>
  );
}

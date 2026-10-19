'use client';

import { bindDeviceRequestSchema, revokeDeviceRequestSchema } from '@susu/shared';
import type { ColumnDef } from '@tanstack/react-table';
import { Ban, Link2, Loader2, Smartphone } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { MockNotice } from '@/components/mock-notice';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { RecordStatus, SampleTag } from '@/components/ui/status-chip';
import { can } from '@/lib/access';
import {
  bindDevice,
  listAgentPairs,
  listDevices,
  listStaff,
  revokeDevice,
  type AgentPairSummary,
  type DeviceSummary,
} from '@/lib/api';
import { useSession } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import { useAction } from '@/lib/use-action';
import { useList } from '@/lib/use-list';
import { formatDateTime } from '@/lib/utils';

function BindDeviceDialog({ pairs, nameOf }: { pairs: AgentPairSummary[]; nameOf: (uid: string) => string }) {
  const [open, setOpen] = useState(false);
  const active = pairs.filter((p) => p.status === 'ACTIVE');
  const [deviceId, setDeviceId] = useState('');
  const [agentPairId, setPairId] = useState('');
  const [agentUid, setAgentUid] = useState('');
  const [label, setLabel] = useState('');
  const pair = active.find((p) => p.id === agentPairId);
  const action = useAction(bindDeviceRequestSchema, (input) => bindDevice(input, pair?.branchId ?? ''));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const ok = await action.run({ deviceId: deviceId.trim(), agentUid, agentPairId, label: label.trim() || undefined });
    if (ok) {
      toast.success('Phone bound', {
        description: `${nameOf(agentUid)} can now record collections on it. Any earlier phone for this agent was revoked.`,
      });
      setOpen(false);
      setDeviceId('');
      setPairId('');
      setAgentUid('');
      setLabel('');
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
          <Link2 /> Bind phone
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Bind a company phone"
        description="An agent can only record collections from a phone bound to them. Binding a new phone revokes their old one."
      >
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          {action.error && !Object.keys(action.error.fieldErrors).length && <Alert tone="error">{action.error.message}</Alert>}
          <Field
            label="Device ID"
            htmlFor="device-id"
            hint="Shown on the agent app's “This phone” screen after the agent signs in."
            error={action.fieldError('deviceId')}
          >
            <Input id="device-id" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} className="font-mono text-[13px]" autoFocus />
          </Field>
          <Field label="Agent pair" htmlFor="device-pair" error={action.fieldError('agentPairId')}>
            <NativeSelect
              id="device-pair"
              value={agentPairId}
              onChange={(e) => {
                setPairId(e.target.value);
                setAgentUid('');
              }}
            >
              <option value="">Select a pair</option>
              {active.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Agent" htmlFor="device-agent" error={action.fieldError('agentUid')}>
            <NativeSelect id="device-agent" value={agentUid} onChange={(e) => setAgentUid(e.target.value)} disabled={!pair}>
              <option value="">{pair ? 'Select the agent who carries this phone' : 'Choose a pair first'}</option>
              {pair &&
                [pair.agentAUid, pair.agentBUid].map((uid) => (
                  <option key={uid} value={uid}>
                    {nameOf(uid)}
                  </option>
                ))}
            </NativeSelect>
          </Field>
          <Field label="Label (optional)" htmlFor="device-label" hint="Model and asset tag, e.g. “Samsung A15 · tag 0042”." error={action.fieldError('label')}>
            <Input id="device-label" value={label} onChange={(e) => setLabel(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={action.busy || !deviceId.trim() || !agentUid}>
              {action.busy && <Loader2 className="animate-spin" />} Bind phone
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RevokeDialog({ device, agentName }: { device: DeviceSummary; agentName: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const action = useAction(revokeDeviceRequestSchema, revokeDevice);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const ok = await action.run({ deviceId: device.id, reason });
    if (ok) {
      toast.success('Phone revoked', { description: 'Anything it sends from now on will be rejected.' });
      setOpen(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          action.reset();
          setReason('');
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive-soft">
          <Ban /> Revoke
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Revoke this phone?"
        description={`${agentName} will not be able to record collections on ${device.label ?? device.id}. Collections it already sent are not affected.`}
      >
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          {action.error && !Object.keys(action.error.fieldErrors).length && <Alert tone="error">{action.error.message}</Alert>}
          <Field label="Reason" htmlFor="revoke-reason" hint="Recorded in the audit log." error={action.fieldError('reason')}>
            <Textarea id="revoke-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Phone reported lost on 18 Oct" autoFocus />
          </Field>
          <Alert tone="info">
            Ask the agent how many records are waiting to sync on this phone. Revoking it means those will be rejected.
          </Alert>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Keep phone
            </Button>
            <Button type="submit" variant="destructive" disabled={action.busy || reason.trim().length < 3}>
              {action.busy && <Loader2 className="animate-spin" />} Revoke phone
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function DevicesPage() {
  const { claims } = useSession();
  const { scope, branchName } = useBranch();
  const { rows, loading } = useList(() => listDevices({ branchId: scope ?? undefined }).then((r) => r.devices), [scope]);
  const { rows: pairs } = useList(() => listAgentPairs({ branchId: scope ?? undefined }).then((r) => r.agentPairs), [scope]);
  const { rows: staff } = useList(() => listStaff({}).then((r) => r.staff), []);
  const manage = can.manageDevices(claims.role);

  const nameOf = useMemo(() => {
    const byUid = new Map(staff.map((s) => [s.uid, s.displayName]));
    return (uid: string) => byUid.get(uid) ?? uid;
  }, [staff]);
  const pairName = useMemo(() => {
    const byId = new Map(pairs.map((p) => [p.id, p.name]));
    return (id: string) => byId.get(id) ?? id.slice(0, 8);
  }, [pairs]);

  const columns = useMemo<ColumnDef<DeviceSummary, unknown>[]>(
    () => [
      {
        accessorKey: 'label',
        header: 'Phone',
        cell: ({ row }) => (
          <div className="grid">
            <span className="flex items-center gap-2 font-medium">
              {row.original.label ?? 'Unlabelled phone'} {row.original.sample && <SampleTag />}
            </span>
            <span className="font-mono text-xs text-muted-foreground">{row.original.id}</span>
          </div>
        ),
      },
      {
        id: 'agent',
        header: 'Agent',
        accessorFn: (r) => nameOf(r.agentUid),
        cell: ({ row }) => (
          <div className="grid text-[13px]">
            <span>{nameOf(row.original.agentUid)}</span>
            <span className="text-muted-foreground">{pairName(row.original.agentPairId)}</span>
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
        accessorKey: 'boundAt',
        header: 'Bound',
        cell: ({ getValue }) => <span className="text-[13px] whitespace-nowrap tabular-nums">{formatDateTime(String(getValue()))}</span>,
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ row }) => (
          <div className="grid gap-0.5">
            <RecordStatus status={row.original.status} />
            {row.original.revokeReason && <span className="text-xs text-muted-foreground">{row.original.revokeReason}</span>}
          </div>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        meta: { align: 'right' },
        cell: ({ row }) =>
          manage && row.original.status === 'ACTIVE' ? (
            <RevokeDialog device={row.original} agentName={nameOf(row.original.agentUid)} />
          ) : null,
      },
    ],
    [branchName, manage, nameOf, pairName],
  );

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Devices"
        description="Company phones bound to agents. A lost or replaced phone must be revoked before the agent can continue."
        actions={manage && <BindDeviceDialog pairs={pairs} nameOf={nameOf} />}
      />
      <MockNotice endpoint="listDevices" />
      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        searchPlaceholder="Search phones or agents"
        empty={
          <div className="flex flex-col items-center gap-2 text-center">
            <Smartphone className="size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No phones bound yet. Have the agent sign in on their phone, then bind its device ID here.
            </p>
          </div>
        }
      />
    </div>
  );
}

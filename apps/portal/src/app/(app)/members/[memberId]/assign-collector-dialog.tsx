'use client';

import { assignCollectorRequestSchema, formatCedis, parseCedis } from '@susu/shared';
import { Loader2, Route } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, NativeSelect } from '@/components/ui/input';
import { listAgentPairs } from '@/lib/api';
import { toActionError } from '@/lib/errors';
import { assignCollector, unassignCollector, type MemberAccount } from '@/lib/members-api';
import { useAction } from '@/lib/use-action';
import { useList } from '@/lib/use-list';

/** Choose the agent pair that collects an account and the amount they expect per visit. */
export function AssignCollectorDialog({
  account,
  branchId,
  memberName,
}: {
  account: MemberAccount;
  branchId: string;
  memberName: string;
}) {
  const current = account.collector;
  const [open, setOpen] = useState(false);
  const { rows: pairs } = useList(
    () => listAgentPairs({ branchId }).then((r) => r.agentPairs.filter((p) => p.status === 'ACTIVE')),
    [branchId],
  );
  const [agentPairId, setAgentPairId] = useState(current?.agentPairId ?? '');
  const [amount, setAmount] = useState(current ? (current.expectedPesewas / 100).toFixed(2) : '');
  const [amountError, setAmountError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const action = useAction(assignCollectorRequestSchema, assignCollector);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setAmountError(null);
    let expectedPesewas: number;
    try {
      expectedPesewas = parseCedis(amount);
    } catch {
      setAmountError('Enter an amount like 20 or 20.50');
      return;
    }
    const result = await action.run({ susuAccountId: account.id, agentPairId, expectedPesewas });
    if (result) {
      const pairName = pairs.find((p) => p.id === agentPairId)?.name ?? 'the agent pair';
      toast.success(`${memberName} is on ${pairName}’s route`, {
        description: `${formatCedis(expectedPesewas)} expected per visit. The agents’ phones update when they are online.`,
      });
      setOpen(false);
    }
  }

  async function onRemove() {
    setRemoving(true);
    setRemoveError(null);
    try {
      await unassignCollector({ susuAccountId: account.id });
      toast.success(`${memberName} is off the route`, { description: 'The agents’ phones drop this account when they are online.' });
      setOpen(false);
    } catch (err) {
      setRemoveError(toActionError(err).message);
    } finally {
      setRemoving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setAgentPairId(current?.agentPairId ?? '');
          setAmount(current ? (current.expectedPesewas / 100).toFixed(2) : '');
        } else {
          action.reset();
          setAmountError(null);
          setRemoveError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Route /> {current ? 'Change' : 'Assign collector'}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={current ? 'Change collector' : 'Assign a collector'}
        description={`${account.productName} for ${memberName}. The pair sees this member on today’s route in the agent app.`}
      >
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          {(action.error || removeError) && <Alert tone="error">{removeError ?? action.error?.message}</Alert>}
          <Field label="Agent pair" htmlFor="collector-pair" error={action.fieldError('agentPairId')}>
            <NativeSelect id="collector-pair" value={agentPairId} onChange={(e) => setAgentPairId(e.target.value)}>
              <option value="">Select an agent pair</option>
              {pairs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            label="Expected per visit (GH₵)"
            htmlFor="collector-amount"
            hint="What the member agreed to pay each visit. Agents can still record a different amount."
            error={amountError ?? action.fieldError('expectedPesewas')}
          >
            <Input
              id="collector-amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="20.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <DialogFooter className="sm:justify-between">
            {current ? (
              <Button type="button" variant="ghost" className="text-destructive" disabled={removing || action.busy} onClick={onRemove}>
                {removing && <Loader2 className="animate-spin" />} Remove from route
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={action.busy || removing || !agentPairId}>
                {action.busy && <Loader2 className="animate-spin" />} {current ? 'Save' : 'Assign'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

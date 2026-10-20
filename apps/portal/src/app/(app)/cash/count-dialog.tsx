'use client';

import { formatCedis, parseCedis, submitBranchCountRequestSchema, type BranchCloseChecklist } from '@susu/shared';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import { submitBranchCount } from '@/lib/cash-api';
import { useAction } from '@/lib/use-action';

export function CountDialog({ item }: { item: BranchCloseChecklist }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const action = useAction(submitBranchCountRequestSchema, submitBranchCount);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setParseError(null);
    let countedPesewas: number;
    try {
      countedPesewas = parseCedis(amount);
    } catch {
      setParseError('Enter a cedi amount with no more than two decimal places.');
      return;
    }
    const result = await action.run({
      branchId: item.branchId,
      businessId: item.businessId,
      day: item.day,
      countedPesewas,
      note: note.trim() || undefined,
    });
    if (result) {
      toast.success('Cash count recorded', {
        description: result.data.differencePesewas === 0
          ? 'The count matches the expected vault balance.'
          : `Difference: ${formatCedis(result.data.differencePesewas)}. A manager must review it at close.`,
      });
      setOpen(false);
      setAmount('');
      setNote('');
      action.reset();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!action.busy) { setOpen(next); if (!next) { action.reset(); setParseError(null); } } }}>
      <DialogTrigger asChild><Button size="sm" variant="outline">{item.count ? 'Count again' : 'Record count'}</Button></DialogTrigger>
      <DialogContent title="Record branch cash count" description={`Count only the cash belonging to ${item.businessName}.`}>
        <form onSubmit={submit} className="grid gap-4">
          <dl className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
            <div className="flex justify-between gap-3"><dt>Business</dt><dd className="text-right font-medium">{item.businessName}</dd></div>
            <div className="mt-2 flex justify-between gap-3"><dt>Expected in vault</dt><dd className="money font-heading font-bold">{formatCedis(item.expectedCashPesewas)}</dd></div>
          </dl>
          <Field label="Cash counted (GH₵)" htmlFor={`cash-count-${item.businessId}`} hint="Enter what is physically in this business’s vault, even if it differs from expected.">
            <Input id={`cash-count-${item.businessId}`} inputMode="decimal" autoComplete="off" placeholder="0.00" required value={amount} onChange={(event) => setAmount(event.target.value)} aria-invalid={!!(parseError || action.fieldError('countedPesewas'))} />
          </Field>
          <Field label="Note (optional)" htmlFor={`cash-count-note-${item.businessId}`}>
            <Textarea id={`cash-count-note-${item.businessId}`} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
          {parseError && <Alert tone="error">{parseError}</Alert>}
          {action.error && <Alert tone="error">{action.error.message}</Alert>}
          <Alert tone="info">Submitting this count does not close the day. A different manager reviews the count and any difference before close.</Alert>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={action.busy} onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={action.busy || !amount.trim()}>{action.busy ? 'Recording…' : 'Record count'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

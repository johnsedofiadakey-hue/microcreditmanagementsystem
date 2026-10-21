'use client';

import {
  CORRECTION_HEAD_OFFICE_THRESHOLD_PESEWAS,
  formatCedis,
  parseCedis,
  type CorrectionKind,
  type MemberAccount,
  type MemberRow,
  type StatementLine,
} from '@susu/shared';
import { Loader2, Search } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, NativeSelect, Textarea } from '@/components/ui/input';
import { requestCollectionCorrection } from '@/lib/corrections-api';
import { toActionError } from '@/lib/errors';
import { getMember, searchMembers } from '@/lib/members-api';
import { cn, formatDateTime } from '@/lib/utils';

const CHOICES: { kind: CorrectionKind; title: string; detail: string }[] = [
  {
    kind: 'REVERSE_COLLECTION',
    title: 'The member did not pay',
    detail: 'The whole collection is reversed from the member and from the agent pair’s cash.',
  },
  {
    kind: 'REDUCE_COLLECTION',
    title: 'The amount was too high',
    detail: 'Enter what the member really paid. The excess comes off the member and the pair’s cash.',
  },
  {
    kind: 'MOVE_COLLECTION',
    title: 'It was recorded for the wrong member',
    detail: 'The amount moves to the right member’s account in the same business. Cash is not affected.',
  },
];

export function RequestCorrectionDialog({
  line,
  memberId,
  account,
  onClose,
}: {
  line: StatementLine | null;
  memberId: string;
  account: Pick<MemberAccount, 'id' | 'businessId' | 'businessName'>;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<CorrectionKind>('REVERSE_COLLECTION');
  const [correct, setCorrect] = useState('');
  const [reason, setReason] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MemberRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [target, setTarget] = useState<{ member: MemberRow; accounts: MemberAccount[] } | null>(null);
  const [toAccountId, setToAccountId] = useState('');
  const [branchId, setBranchId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const collected = line?.creditPesewas ?? 0;

  useEffect(() => {
    if (!line || branchId) return;
    getMember({ memberId })
      .then((m) => setBranchId(m?.branchId ?? null))
      .catch((cause) => setError(toActionError(cause).message));
  }, [line, memberId, branchId]);

  function reset() {
    setKind('REVERSE_COLLECTION');
    setCorrect('');
    setReason('');
    setQuery('');
    setResults([]);
    setTarget(null);
    setToAccountId('');
    setError(null);
  }

  function close() {
    if (busy) return;
    reset();
    onClose();
  }

  async function search() {
    if (!branchId || query.trim().length < 2) return;
    setSearching(true);
    setError(null);
    setTarget(null);
    setToAccountId('');
    try {
      const { members } = await searchMembers({ branchId, query: query.trim(), status: 'ACTIVE' });
      setResults(members.filter((m) => m.id !== memberId));
    } catch (cause) {
      setError(toActionError(cause).message);
    } finally {
      setSearching(false);
    }
  }

  async function pick(member: MemberRow) {
    setSearching(true);
    setError(null);
    try {
      const profile = await getMember({ memberId: member.id });
      const accounts = (profile?.accounts ?? []).filter(
        (a) => a.businessId === account.businessId && a.status === 'ACTIVE' && a.id !== account.id,
      );
      setTarget({ member, accounts });
      setToAccountId(accounts.length === 1 ? accounts[0]!.id : '');
    } catch (cause) {
      setError(toActionError(cause).message);
    } finally {
      setSearching(false);
    }
  }

  let correctPesewas: number | null = null;
  let correctError: string | null = null;
  if (kind === 'REDUCE_COLLECTION' && correct.trim()) {
    try {
      correctPesewas = parseCedis(correct);
      if (correctPesewas < 1 || correctPesewas >= collected) correctError = `Must be more than GH₵ 0.00 and less than ${formatCedis(collected)}.`;
    } catch {
      correctError = 'Type an amount like 15 or 15.50.';
    }
  }
  const effect =
    kind === 'REVERSE_COLLECTION' ? collected : kind === 'REDUCE_COLLECTION' ? (correctPesewas && !correctError ? collected - correctPesewas : 0) : collected;
  const needsHeadOffice = effect > CORRECTION_HEAD_OFFICE_THRESHOLD_PESEWAS;
  const ready =
    reason.trim().length >= 10 &&
    (kind !== 'REDUCE_COLLECTION' || (correctPesewas !== null && !correctError)) &&
    (kind !== 'MOVE_COLLECTION' || !!toAccountId);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!line || !ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await requestCollectionCorrection({
        collectionBatchId: line.batchId,
        kind,
        correctPesewas: kind === 'REDUCE_COLLECTION' ? correctPesewas! : undefined,
        toSusuAccountId: kind === 'MOVE_COLLECTION' ? toAccountId : undefined,
        reason: reason.trim(),
      });
      toast.success('Correction requested', {
        description: result.needsHeadOffice
          ? 'Head office must approve it. Nothing changes until a different person approves.'
          : 'A different person must approve it. Nothing changes until then.',
      });
      reset();
      onClose();
    } catch (cause) {
      setError(toActionError(cause).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!line} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent
        className="max-w-xl"
        title="Request a correction"
        description="Posted collections are never edited. Your request goes to a different authorised person; only their approval changes any balance."
      >
        {line && (
          <form onSubmit={submit} className="grid gap-4" noValidate>
            {error && <Alert tone="error">{error}</Alert>}
            <dl className="grid gap-1.5 rounded-lg border border-border bg-muted/30 p-3 text-sm">
              <div className="flex justify-between gap-3"><dt>Collection</dt><dd className="money font-heading text-lg font-bold">{formatCedis(collected)}</dd></div>
              <div className="flex justify-between gap-3"><dt>Posted</dt><dd>{formatDateTime(line.postedAt)}</dd></div>
              <div className="flex justify-between gap-3"><dt>Reference</dt><dd className="font-mono text-xs">{line.batchId.slice(0, 8).toUpperCase()}</dd></div>
            </dl>

            <fieldset className="grid gap-2">
              <legend className="mb-1 text-[13px] font-medium">What went wrong?</legend>
              {CHOICES.map((choice) => (
                <label
                  key={choice.kind}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50',
                    kind === choice.kind ? 'border-primary bg-primary-soft/40' : 'border-border hover:bg-muted/40',
                  )}
                >
                  <input
                    type="radio"
                    name="correction-kind"
                    className="mt-1 size-4 accent-[var(--primary)]"
                    checked={kind === choice.kind}
                    onChange={() => setKind(choice.kind)}
                  />
                  <span className="grid gap-0.5">
                    <span className="font-medium">{choice.title}</span>
                    <span className="text-[13px] text-muted-foreground">{choice.detail}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            {kind === 'REDUCE_COLLECTION' && (
              <Field label="What the member really paid" htmlFor="corr-correct" error={correctError ?? undefined} hint={`Recorded: ${formatCedis(collected)}`}>
                <Input id="corr-correct" inputMode="decimal" value={correct} onChange={(e) => setCorrect(e.target.value)} placeholder="0.00" className="w-40 text-right tabular-nums" />
              </Field>
            )}

            {kind === 'MOVE_COLLECTION' && (
              <div className="grid gap-2">
                <div className="flex gap-2" role="search">
                  <Input
                    aria-label="Find the right member"
                    placeholder="Right member’s name, phone or Ghana Card"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void search();
                      }
                    }}
                  />
                  <Button type="button" variant="outline" onClick={() => void search()} disabled={searching || query.trim().length < 2 || !branchId}>
                    {searching ? <Loader2 className="animate-spin" /> : <Search />} Find
                  </Button>
                </div>
                {results.length > 0 && !target && (
                  <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                    {results.map((m) => (
                      <li key={m.id}>
                        <button type="button" onClick={() => pick(m)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none">
                          <span className="font-medium">{m.fullName}</span>
                          <span className="font-mono text-xs text-muted-foreground">{m.phoneMasked}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {target && (
                  <div className="grid gap-2 rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span>Move to <strong>{target.member.fullName}</strong></span>
                      <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => { setTarget(null); setToAccountId(''); }}>
                        Change
                      </button>
                    </div>
                    {target.accounts.length === 0 ? (
                      <p className="text-[13px] text-destructive">They have no active {account.businessName} account to move it to.</p>
                    ) : (
                      <Field label={`Their ${account.businessName} account`} htmlFor="corr-to">
                        <NativeSelect id="corr-to" value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
                          <option value="">Select the account</option>
                          {target.accounts.map((a) => <option key={a.id} value={a.id}>{a.productName} · {a.id.slice(0, 8)}</option>)}
                        </NativeSelect>
                      </Field>
                    )}
                  </div>
                )}
              </div>
            )}

            <Field label="Reason" htmlFor="corr-reason" hint="What happened, and how you found out. At least 10 characters; the approver and the audit log see it.">
              <Textarea id="corr-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>

            {needsHeadOffice && (
              <Alert tone="info">Above {formatCedis(CORRECTION_HEAD_OFFICE_THRESHOLD_PESEWAS)}: head office (finance, compliance or an administrator) must approve this.</Alert>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={close} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy || !ready}>
                {busy && <Loader2 className="animate-spin" />} Send for approval
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

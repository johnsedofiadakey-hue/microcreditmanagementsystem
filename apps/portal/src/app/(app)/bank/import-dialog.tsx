'use client';

import { formatCedis, type BankAccountSummary } from '@susu/shared';
import { FileUp, Loader2 } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { NativeSelect } from '@/components/ui/input';
import { importBankStatement } from '@/lib/bank-api';
import { toActionError } from '@/lib/errors';
import { guessMapping, parseCsv, toStatementLines, type ColumnMapping, type CsvTable } from '@/lib/statement-csv';

/** importBankStatement accepts up to 1,000 lines per call (API.md §2). */
const MAX_LINES_PER_CALL = 1000;

const FIELDS: { key: keyof ColumnMapping; label: string; required?: boolean }[] = [
  { key: 'date', label: 'Date', required: true },
  { key: 'amount', label: 'Amount (signed)' },
  { key: 'credit', label: 'Credit / money in' },
  { key: 'debit', label: 'Debit / money out' },
  { key: 'reference', label: 'Reference' },
  { key: 'description', label: 'Description' },
  { key: 'balance', label: 'Running balance' },
];

export function ImportStatementDialog({
  account,
  open,
  onClose,
}: {
  account: BankAccountSummary;
  open: boolean;
  onClose: () => void;
}) {
  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<CsvTable | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => (table && mapping ? toStatementLines(table, mapping) : null), [table, mapping]);
  const amountMapped = mapping && (mapping.amount >= 0 || (mapping.credit >= 0 && mapping.debit >= 0) || mapping.credit >= 0);
  const credits = parsed?.lines.filter((l) => l.amountPesewas > 0) ?? [];
  const debits = parsed?.lines.filter((l) => l.amountPesewas < 0) ?? [];

  function reset() {
    setFileName('');
    setTable(null);
    setMapping(null);
    setError(null);
  }

  async function onFile(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError('That file is over 5 MB. Export a shorter date range.');
      return;
    }
    const text = await file.text();
    const next = parseCsv(text);
    if (!next.headers.length || !next.rows.length) {
      setError('No rows found. Export the statement as CSV with a header row.');
      return;
    }
    setFileName(file.name);
    setTable(next);
    setMapping(guessMapping(next.headers));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!parsed?.lines.length || busy) return;
    setBusy(true);
    setError(null);
    let imported = 0;
    let duplicates = 0;
    try {
      for (let i = 0; i < parsed.lines.length; i += MAX_LINES_PER_CALL) {
        const result = await importBankStatement({ bankAccountId: account.id, lines: parsed.lines.slice(i, i + MAX_LINES_PER_CALL) });
        imported += result.imported;
        duplicates += result.duplicates;
      }
      toast.success(`${imported} statement ${imported === 1 ? 'line' : 'lines'} imported`, {
        description: duplicates ? `${duplicates} already imported earlier were skipped.` : undefined,
      });
      reset();
      onClose();
    } catch (cause) {
      setError(`${toActionError(cause).message}${imported ? ` (${imported} lines were imported before this error; importing again is safe.)` : ''}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) { reset(); onClose(); } }}>
      <DialogContent
        className="max-w-2xl"
        title="Import a bank statement"
        description={`${account.bankName} · ${account.accountName} · ••••${account.accountNumberLast4}. Export the statement from online banking as CSV. Importing an overlapping period is safe; repeated lines are skipped.`}
      >
        <form onSubmit={submit} className="grid gap-4" noValidate>
          {error && <Alert tone="error">{error}</Alert>}
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border p-4 text-sm hover:bg-muted/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50">
            <FileUp className="size-5 text-primary" aria-hidden />
            <span className="flex-1">{fileName || 'Choose a CSV file'}</span>
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>

          {table && mapping && (
            <>
              <fieldset className="grid gap-3 sm:grid-cols-2">
                <legend className="mb-2 text-[13px] font-medium">Which column holds each field</legend>
                {FIELDS.map((f) => (
                  <Field key={f.key} label={f.label} htmlFor={`map-${f.key}`}>
                    <NativeSelect
                      id={`map-${f.key}`}
                      value={mapping[f.key]}
                      onChange={(e) => setMapping({ ...mapping, [f.key]: Number(e.target.value) })}
                    >
                      <option value={-1}>{f.required ? 'Select a column' : 'Not in this file'}</option>
                      {table.headers.map((h, i) => <option key={`${i}-${h}`} value={i}>{h || `Column ${i + 1}`}</option>)}
                    </NativeSelect>
                  </Field>
                ))}
              </fieldset>
              {mapping.amount >= 0 && (mapping.credit >= 0 || mapping.debit >= 0) && (
                <Alert tone="info">A signed amount column is mapped, so the credit and debit columns are ignored.</Alert>
              )}
              {!amountMapped && <Alert tone="error">Map either a signed amount column, or credit and debit columns.</Alert>}

              {parsed && amountMapped && mapping.date >= 0 && (
                <div className="grid gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm">
                  <p>
                    <strong>{parsed.lines.length}</strong> {parsed.lines.length === 1 ? 'line' : 'lines'} ready: {credits.length} {credits.length === 1 ? 'credit' : 'credits'} ({formatCedis(credits.reduce((s, l) => s + l.amountPesewas, 0))}),{' '}
                    {debits.length} {debits.length === 1 ? 'debit' : 'debits'} ({formatCedis(debits.reduce((s, l) => s + l.amountPesewas, 0))}).
                  </p>
                  {parsed.lines.slice(0, 3).map((l, i) => (
                    <p key={i} className="font-mono text-xs text-muted-foreground">
                      {l.date} · {formatCedis(l.amountPesewas)} · {l.reference || '—'} · {l.description || '—'}
                    </p>
                  ))}
                  {parsed.problems.length > 0 && (
                    <details>
                      <summary className="cursor-pointer text-warning">{parsed.problems.length} {parsed.problems.length === 1 ? 'row' : 'rows'} will be skipped</summary>
                      <ul className="mt-1 list-disc pl-5 text-xs">
                        {parsed.problems.slice(0, 20).map((p) => <li key={p.row}>Row {p.row}: {p.message}</li>)}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => { reset(); onClose(); }}>Cancel</Button>
            <Button type="submit" disabled={busy || !parsed?.lines.length || !amountMapped || (mapping?.date ?? -1) < 0}>
              {busy && <Loader2 className="animate-spin" />} Import {parsed?.lines.length ? `${parsed.lines.length} lines` : ''}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

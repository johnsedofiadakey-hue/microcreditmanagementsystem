'use client';

import {
  ENQUIRY_INTERESTS,
  ENQUIRY_OUTCOMES,
  type EnquiryInterest,
  type EnquiryOutcome,
  type EnquiryStatus,
  type EnquirySummary,
} from '@susu/shared';
import { ArrowRight, MessageCircle, Phone, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { LoadError } from '@/components/load-error';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { NativeSelect, Textarea } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { StatusChip } from '@/components/ui/status-chip';
import { can } from '@/lib/access';
import { useSession } from '@/lib/auth-context';
import { onDataChanged } from '@/lib/data-events';
import { listEnquiries, updateEnquiry } from '@/lib/enquiries-api';
import { toActionError } from '@/lib/errors';
import { formatDateTime } from '@/lib/utils';

const INTEREST: Record<EnquiryInterest, string> = {
  SUSU: 'Susu savings', MICRO_CREDIT: 'Micro-credit', WELFARE: 'Welfare', OTHER: 'Other',
};
const OUTCOME: Record<EnquiryOutcome, string> = {
  JOINED: 'Joined', NOT_INTERESTED: 'Not interested', UNREACHABLE: 'Unreachable', DUPLICATE: 'Duplicate', OTHER: 'Other',
};
const STATUS: Record<EnquiryStatus, { label: string; tone: 'warning' | 'info' | 'neutral' }> = {
  NEW: { label: 'New', tone: 'warning' }, CONTACTED: { label: 'Contacted', tone: 'info' }, CLOSED: { label: 'Closed', tone: 'neutral' },
};

function age(iso: string): string {
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

function Detail({ enquiry, onClose, onUpdated, mayUpdate }: {
  enquiry: EnquirySummary;
  onClose: () => void;
  onUpdated: (row: EnquirySummary) => void;
  mayUpdate: boolean;
}) {
  const [action, setAction] = useState<'CONTACTED' | 'CLOSED' | null>(null);
  const [outcome, setOutcome] = useState<EnquiryOutcome | ''>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!action || note.trim().length < 3 || (action === 'CLOSED' && !outcome) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const row = await updateEnquiry({ enquiryId: enquiry.id, status: action, note: note.trim(), ...(action === 'CLOSED' ? { outcome: outcome as EnquiryOutcome } : {}) });
      onUpdated(row);
      setAction(null);
      setNote('');
      setOutcome('');
      toast.success(action === 'CLOSED' ? 'Enquiry closed' : 'Call recorded');
    } catch (cause) {
      const mapped = toActionError(cause);
      setError(mapped.reason === 'CONFLICT' ? 'This enquiry was already closed by someone else. Refresh the list.' : mapped.message);
    } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" title={`${enquiry.fullName} · ${enquiry.reference}`} description={`${INTEREST[enquiry.interest]} enquiry from ${enquiry.town || 'town not given'}`}>
        <div className="grid gap-5 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <StatusChip tone={STATUS[enquiry.status].tone}>{STATUS[enquiry.status].label}</StatusChip>
            <span className="text-muted-foreground">Received {formatDateTime(enquiry.createdAt)} · {age(enquiry.createdAt)}</span>
          </div>
          <a href={`tel:${enquiry.phone}`} className="inline-flex min-h-11 items-center gap-2 text-primary underline underline-offset-4"><Phone className="size-4" aria-hidden />{enquiry.phone}</a>
          {enquiry.message && <div className="rounded-xl border border-border bg-muted/20 p-4"><p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Message</p><p className="whitespace-pre-wrap">{enquiry.message}</p></div>}
          {enquiry.status === 'CLOSED' && enquiry.outcome && <p>Outcome: <strong>{OUTCOME[enquiry.outcome]}</strong></p>}
          <section aria-labelledby="enquiry-history" className="grid gap-3">
            <h3 id="enquiry-history" className="font-heading font-bold">Follow-up history</h3>
            {enquiry.notes.length === 0 ? <p className="text-muted-foreground">No calls recorded yet.</p> : (
              <ol className="grid gap-2 border-l-2 border-border pl-4">
                {enquiry.notes.map((entry, index) => (
                  <li key={`${entry.at}-${index}`} className="rounded-lg bg-muted/25 p-3">
                    <div className="mb-1 flex flex-wrap gap-2 text-xs text-muted-foreground"><strong className="text-foreground">{entry.status === 'CLOSED' ? 'Closed' : 'Call recorded'}</strong><span>{formatDateTime(entry.at)}</span><span>by {entry.byUid}</span>{entry.outcome && <span>· {OUTCOME[entry.outcome]}</span>}</div>
                    <p className="whitespace-pre-wrap">{entry.note}</p>
                  </li>
                ))}
              </ol>
            )}
          </section>
          {mayUpdate && enquiry.status !== 'CLOSED' && (
            <section className="grid gap-3 border-t border-border pt-4">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant={action === 'CONTACTED' ? 'default' : 'outline'} onClick={() => { setAction('CONTACTED'); setError(null); }}>Record call</Button>
                <Button size="sm" variant={action === 'CLOSED' ? 'default' : 'outline'} onClick={() => { setAction('CLOSED'); setError(null); }}>Close enquiry</Button>
              </div>
              {action && <form onSubmit={submit} className="grid gap-3">
                {error && <Alert tone="error">{error}</Alert>}
                {action === 'CLOSED' && <Field label="Outcome" htmlFor="enquiry-outcome">
                  <NativeSelect id="enquiry-outcome" required value={outcome} onChange={(event) => setOutcome(event.target.value as EnquiryOutcome | '')}>
                    <option value="">Choose outcome</option>
                    {ENQUIRY_OUTCOMES.map((value) => <option key={value} value={value}>{OUTCOME[value]}</option>)}
                  </NativeSelect>
                </Field>}
                <Field label={action === 'CLOSED' ? 'Close note' : 'Call note'} htmlFor="enquiry-note" hint="At least 3 characters. This becomes part of the enquiry history.">
                  <Textarea id="enquiry-note" required minLength={3} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} />
                </Field>
                <DialogFooter><Button type="submit" disabled={busy || note.trim().length < 3 || (action === 'CLOSED' && !outcome)}>{busy ? 'Saving…' : action === 'CLOSED' ? 'Confirm close' : 'Save call'}</Button></DialogFooter>
              </form>}
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function EnquiriesPage() {
  const { claims } = useSession();
  const mayUpdate = can.updateEnquiries(claims.role);
  const [status, setStatus] = useState<EnquiryStatus | ''>('NEW');
  const [interest, setInterest] = useState<EnquiryInterest | ''>('');
  const [rows, setRows] = useState<EnquirySummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [moreBusy, setMoreBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const refresh = useCallback(async (alive: () => boolean) => {
    setLoading(true);
    try {
      const page = await listEnquiries({ status: status || undefined, interest: interest || undefined });
      if (alive()) { setRows(page.enquiries); setCursor(page.nextCursor); setError(null); }
    } catch (cause) { if (alive()) setError(cause); }
    finally { if (alive()) setLoading(false); }
  }, [status, interest]);

  useEffect(() => {
    let active = true;
    void refresh(() => active);
    const unsubscribe = onDataChanged(() => { void refresh(() => active); });
    return () => { active = false; unsubscribe(); };
  }, [refresh]);

  async function older() {
    if (!cursor || moreBusy) return;
    setMoreBusy(true);
    try {
      const page = await listEnquiries({ status: status || undefined, interest: interest || undefined, cursor });
      setRows((previous) => [...previous, ...page.enquiries.filter((item) => !previous.some((existing) => existing.id === item.id))]);
      setCursor(page.nextCursor);
      setError(null);
    } catch (cause) { setError(cause); }
    finally { setMoreBusy(false); }
  }

  const selected = rows.find((item) => item.id === selectedId);

  return <div className="grid gap-6">
    <PageHeader title="Enquiries" description="Call back people who contacted the website. Every follow-up is recorded with a note." actions={<Button variant="outline" size="sm" onClick={() => void refresh(() => true)}><RefreshCw /> Refresh</Button>} />
    <div className="flex flex-wrap gap-3">
      <Field label="Status" htmlFor="enquiry-status" className="min-w-40">
        <NativeSelect id="enquiry-status" value={status} onChange={(event) => setStatus(event.target.value as EnquiryStatus | '')}>
          <option value="">All statuses</option><option value="NEW">New</option><option value="CONTACTED">Contacted</option><option value="CLOSED">Closed</option>
        </NativeSelect>
      </Field>
      <Field label="Interest" htmlFor="enquiry-interest" className="min-w-44">
        <NativeSelect id="enquiry-interest" value={interest} onChange={(event) => setInterest(event.target.value as EnquiryInterest | '')}>
          <option value="">All interests</option>{ENQUIRY_INTERESTS.map((value) => <option key={value} value={value}>{INTEREST[value]}</option>)}
        </NativeSelect>
      </Field>
    </div>
    <LoadError error={error} />
    {loading && rows.length === 0 ? <p className="text-sm text-muted-foreground">Loading enquiries…</p> : rows.length === 0 ? (
      <Card><CardContent className="flex items-center gap-3 text-sm text-muted-foreground"><MessageCircle className="size-5" /> No enquiries in this view.</CardContent></Card>
    ) : <div className="grid gap-3">
      {rows.map((item) => <Card key={item.id} className="transition-[border-color,transform] hover:-translate-y-0.5 hover:border-primary/35 motion-reduce:transform-none">
        <CardContent className="flex flex-wrap items-start justify-between gap-3 sm:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><strong className="font-heading text-base">{item.fullName}</strong><StatusChip tone={STATUS[item.status].tone}>{STATUS[item.status].label}</StatusChip><span className="font-mono text-xs text-muted-foreground">{item.reference}</span></div>
            <p className="mt-1 text-sm text-muted-foreground">{INTEREST[item.interest]} · {item.town || 'Town not given'} · {age(item.createdAt)}</p>
            {item.message && <p className="mt-2 line-clamp-2 max-w-2xl text-sm">{item.message}</p>}
            <a href={`tel:${item.phone}`} className="mt-2 inline-flex min-h-8 items-center gap-1.5 text-sm text-primary underline underline-offset-4"><Phone className="size-3.5" aria-hidden />{item.phone}</a>
          </div>
          <Button size="sm" variant="outline" onClick={() => setSelectedId(item.id)}>Review <ArrowRight /></Button>
        </CardContent>
      </Card>)}
      {cursor && <Button className="justify-self-center" variant="outline" disabled={moreBusy} onClick={() => void older()}>{moreBusy ? 'Loading…' : 'Show older enquiries'}</Button>}
    </div>}
    {selected && <Detail key={selected.id} enquiry={selected} mayUpdate={mayUpdate} onClose={() => setSelectedId(null)} onUpdated={(row) => setRows((previous) => previous.map((item) => item.id === row.id ? row : item))} />}
  </div>;
}

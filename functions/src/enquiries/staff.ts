import { randomUUID } from 'node:crypto';
import {
  ENQUIRY_UPDATE_ROLES,
  ENQUIRY_VIEW_ROLES,
  type EnquiryNote,
  type EnquirySummary,
  type ListEnquiriesRequest,
  type ListEnquiriesResult,
  type UpdateEnquiryRequest,
} from '@susu/shared';
import { FieldValue, Timestamp, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore';
import type { Actor } from '../lib/actor.js';
import { DomainError } from '../lib/errors.js';
import { requireRole } from '../lib/permissions.js';

/**
 * Staff follow-up of website enquiries (API.md §2). Enquiries have no branch yet, so every viewing
 * role sees all of them (the client has one office today). Notes are append-only: each update adds one.
 */

const iso = (value: unknown): string | null => (value instanceof Timestamp ? value.toDate().toISOString() : null);

function toSummary(doc: DocumentSnapshot): EnquirySummary {
  const d = doc.data()!;
  const notes = ((d.notes as Array<Record<string, unknown>> | undefined) ?? []).map(
    (n): EnquiryNote => ({
      status: n.status as EnquiryNote['status'],
      outcome: (n.outcome as EnquiryNote['outcome']) ?? null,
      note: n.note as string,
      byUid: n.byUid as string,
      at: iso(n.at) ?? '',
    }),
  );
  return {
    id: doc.id,
    reference: d.reference,
    fullName: d.fullName,
    phone: d.phone,
    town: d.town ?? null,
    interest: d.interest,
    message: d.message ?? null,
    status: d.status,
    outcome: d.outcome ?? null,
    createdAt: iso(d.createdAt) ?? '',
    updatedAt: iso(d.updatedAt),
    notes,
  };
}

export async function listEnquiries(firestore: Firestore, actor: Actor, input: ListEnquiriesRequest): Promise<ListEnquiriesResult> {
  requireRole(actor, ENQUIRY_VIEW_ROLES);
  const limit = input.limit ?? 50;
  let query = firestore.collection('enquiries').orderBy('createdAt', 'desc');
  if (input.status) query = query.where('status', '==', input.status);
  if (input.interest) query = query.where('interest', '==', input.interest);
  if (input.cursor) {
    const after = await firestore.collection('enquiries').doc(input.cursor).get();
    if (!after.exists) throw new DomainError('NOT_FOUND', 'That page is no longer available; reload the list');
    query = query.startAfter(after);
  }
  const page = await query.limit(limit + 1).get();
  const docs = page.docs.slice(0, limit);
  return { enquiries: docs.map(toSummary), nextCursor: page.docs.length > limit ? docs[docs.length - 1]!.id : null };
}

export async function updateEnquiry(firestore: Firestore, actor: Actor, input: UpdateEnquiryRequest): Promise<EnquirySummary> {
  requireRole(actor, ENQUIRY_UPDATE_ROLES);
  const ref = firestore.collection('enquiries').doc(input.enquiryId);
  await firestore.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists) throw new DomainError('NOT_FOUND', 'Enquiry not found');
    if (doc.get('status') === 'CLOSED') throw new DomainError('CONFLICT', 'This enquiry is already closed');
    const note = {
      id: randomUUID(),
      status: input.status,
      outcome: input.status === 'CLOSED' ? input.outcome! : null,
      note: input.note,
      byUid: actor.uid,
      at: Timestamp.now(),
    };
    tx.update(ref, {
      status: input.status,
      outcome: note.outcome,
      notes: FieldValue.arrayUnion(note),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actor.uid,
    });
  });
  return toSummary(await ref.get());
}

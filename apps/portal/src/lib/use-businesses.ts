'use client';

import { listBusinesses, type BusinessSummary } from './api';
import { useList } from './use-list';

/** The businesses, plus a name lookup for labels. Loaded once per screen; they rarely change. */
export function useBusinesses() {
  const { rows, loading, error } = useList<BusinessSummary>(() => listBusinesses().then((r) => r.businesses), []);
  const name = (id: string) => rows.find((b) => b.id === id)?.name ?? 'Business';
  return { businesses: rows, loading, error, name };
}

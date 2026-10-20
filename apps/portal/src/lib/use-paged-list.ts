'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { onDataChanged } from './data-events';

/** Cursor-backed lists. Refreshes start at page one so writes cannot splice stale pages together. */
export function usePagedList<T>(
  load: (cursor: string | null) => Promise<{ rows: T[]; nextCursor: string | null }>,
  deps: readonly unknown[],
) {
  const [rows, setRows] = useState<T[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const generation = useRef(0);
  const alive = useRef(false);

  useEffect(() => {
    alive.current = true;
    const refresh = async () => {
      const current = ++generation.current;
      setLoading(true);
      setLoadingMore(false);
      setRows([]);
      setNextCursor(null);
      try {
        const page = await load(null);
        if (!alive.current || generation.current !== current) return;
        setRows(page.rows);
        setNextCursor(page.nextCursor);
        setError(null);
      } catch (cause) {
        if (alive.current && generation.current === current) setError(cause);
      } finally {
        if (alive.current && generation.current === current) setLoading(false);
      }
    };
    void refresh();
    const unsubscribe = onDataChanged(() => { void refresh(); });
    return () => {
      alive.current = false;
      generation.current += 1;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loading || loadingMore) return;
    const current = generation.current;
    setLoadingMore(true);
    try {
      const page = await load(nextCursor);
      if (!alive.current || generation.current !== current) return;
      setRows((previous) => [...previous, ...page.rows]);
      setNextCursor(page.nextCursor);
      setError(null);
    } catch (cause) {
      if (alive.current && generation.current === current) setError(cause);
    } finally {
      if (alive.current && generation.current === current) setLoadingMore(false);
    }
  }, [load, loading, loadingMore, nextCursor]);

  return { rows, nextCursor, loading, loadingMore, error, loadMore };
}

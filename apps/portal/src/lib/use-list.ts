'use client';

import { useEffect, useState } from 'react';
import { onDataChanged } from './data-events';

/** Load a list, and reload when deps change or any write succeeds (data-events.ts). */
export function useList<T>(load: () => Promise<T[]>, deps: readonly unknown[]) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let alive = true;
    const refresh = () =>
      load()
        .then((r) => {
          if (!alive) return;
          setRows(r);
          setError(null);
        })
        .catch((e: unknown) => alive && setError(e))
        .finally(() => alive && setLoading(false));
    setLoading(true);
    refresh();
    const unsubscribe = onDataChanged(refresh);
    return () => {
      alive = false;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { rows, loading, error };
}

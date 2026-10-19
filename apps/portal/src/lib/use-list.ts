'use client';

import { useEffect, useState } from 'react';
import { mockStore } from './mock-store';

/** Load a list and reload when deps change. TODO(api): drop the mockStore subscription with the mocks. */
export function useList<T>(load: () => Promise<T[]>, deps: readonly unknown[]) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const refresh = () =>
      load()
        .then((r) => alive && setRows(r))
        .finally(() => alive && setLoading(false));
    setLoading(true);
    refresh();
    const unsubscribe = mockStore.subscribe(refresh);
    return () => {
      alive = false;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { rows, loading };
}

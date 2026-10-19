'use client';

/**
 * A tiny "something changed on the server" signal. Every successful write in api.ts / members-api.ts
 * calls `dataChanged()`; open lists (useList, the branch switcher) reload when it fires.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function dataChanged() {
  for (const listener of listeners) listener();
}

export function onDataChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

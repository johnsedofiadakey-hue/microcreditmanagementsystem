'use client';

import { useCallback, useState } from 'react';
import type { z } from 'zod';
import { toActionError, type ActionError } from './errors';

/**
 * Validate with the shared Zod schema (same one the callable uses), then run the action.
 * Field errors come from the client-side parse first and from `details.issues` second.
 * `run` resolves to `{ data }` on success (even when the callable returns null) and `undefined` on failure.
 */
export function useAction<S extends z.ZodType, R>(schema: S, action: (input: z.output<S>) => Promise<R>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);

  const run = useCallback(
    async (raw: z.input<S>): Promise<{ data: R } | undefined> => {
      setError(null);
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          const key = issue.path.join('.');
          fieldErrors[key] ??= issue.message;
        }
        setError({ message: 'Check the highlighted fields.', fieldErrors });
        return undefined;
      }
      setBusy(true);
      try {
        return { data: await action(parsed.data) };
      } catch (err) {
        setError(toActionError(err));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [schema, action],
  );

  const reset = useCallback(() => setError(null), []);
  return { run, busy, error, reset, fieldError: (path: string) => error?.fieldErrors[path] };
}

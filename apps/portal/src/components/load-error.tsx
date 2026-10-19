import { CircleAlert } from 'lucide-react';
import { toActionError } from '@/lib/errors';

/** Shown under a list when its read call failed, so an empty table is never mistaken for "no records". */
export function LoadError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">
      <CircleAlert className="size-4 shrink-0" aria-hidden />
      <span>Could not load this list. {toActionError(error).message}</span>
    </p>
  );
}

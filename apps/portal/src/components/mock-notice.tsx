import { FlaskConical } from 'lucide-react';

/** Marks screens whose list comes from mocked data until the endpoint is built. */
export function MockNotice({ endpoint }: { endpoint: string }) {
  return (
    <p className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-[13px] text-muted-foreground">
      <FlaskConical className="size-4 shrink-0" aria-hidden />
      <span>
        This list uses sample data until <code className="rounded bg-muted px-1 font-mono text-xs">{endpoint}</code> is
        built. Anything you create here is sent to the server for real.
      </span>
    </p>
  );
}

import { cn } from '@/lib/utils';

/** Placeholder mark until the client supplies logos: a coin with three bands, one per business. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={cn('size-9 shrink-0', className)} aria-hidden>
      <circle cx="20" cy="20" r="19" fill="#173d33" />
      <circle cx="20" cy="20" r="14.5" fill="none" stroke="#d9ad61" strokeWidth="1.5" />
      <rect x="11" y="13" width="18" height="3.6" rx="1.8" fill="#d9ad61" />
      <rect x="11" y="18.2" width="18" height="3.6" rx="1.8" fill="#4fae8c" />
      <rect x="11" y="23.4" width="18" height="3.6" rx="1.8" fill="#e08a5f" />
    </svg>
  );
}

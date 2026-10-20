'use client';

import { Button } from './button';

export function ListPager({
  count,
  hasMore,
  loading,
  onLoadMore,
}: {
  count: number;
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
}) {
  if (count === 0 && !hasMore) return null;
  return (
    <div className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <p>{count} loaded{hasMore ? ' · more records available' : ' · all records loaded'}. Table search and sorting use loaded records.</p>
      {hasMore && (
        <Button type="button" variant="outline" disabled={loading} onClick={onLoadMore}>
          {loading ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </div>
  );
}

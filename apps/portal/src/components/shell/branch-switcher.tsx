'use client';

import { Building2, ChevronsUpDown, Globe2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useBranch } from '@/lib/branch-context';

const ALL = '__all__';

export function BranchSwitcher() {
  const { branches, scope, setScope, canSwitch, canSeeAll } = useBranch();
  const current = branches.find((b) => b.id === scope);
  const label = scope === null ? 'All branches' : (current?.name ?? 'Branch');
  const sub = scope === null ? `${branches.length} branches` : current?.code;

  const body = (
    <>
      <span className="flex size-7 items-center justify-center rounded-md bg-primary-soft text-primary">
        {scope === null ? <Globe2 className="size-4" /> : <Building2 className="size-4" />}
      </span>
      <span className="grid text-left leading-tight">
        <span className="text-sm font-medium">{label}</span>
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      </span>
    </>
  );

  if (!canSwitch) {
    return <div className="flex items-center gap-2.5 rounded-lg px-2 py-1">{body}</div>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Switch branch"
        className="flex items-center gap-2.5 rounded-lg border border-border bg-surface py-1 pr-2 pl-1 shadow-xs transition hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        {body}
        <ChevronsUpDown className="ml-1 size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-96 overflow-y-auto">
        <DropdownMenuLabel>Working in</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={scope ?? ALL} onValueChange={(v) => setScope(v === ALL ? null : v)}>
          {canSeeAll && (
            <>
              <DropdownMenuRadioItem value={ALL}>All branches</DropdownMenuRadioItem>
              <DropdownMenuSeparator />
            </>
          )}
          {branches.map((b) => (
            <DropdownMenuRadioItem key={b.id} value={b.id}>
              <span className="flex-1">{b.name}</span>
              <span className="text-xs text-muted-foreground">{b.code}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

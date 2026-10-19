'use client';

import { LogOut, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ROLE_LABELS } from '@/lib/access';
import { useAuth, useSession } from '@/lib/auth-context';

function initials(name: string) {
  return name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

export function UserMenu() {
  const { user, claims } = useSession();
  const { signOut, refreshClaims } = useAuth();
  const name = user.displayName || user.email || 'Signed in';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className="flex items-center gap-2.5 rounded-full p-0.5 pr-3 transition hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white">
          {initials(name)}
        </span>
        <span className="hidden text-left leading-tight sm:grid">
          <span className="max-w-40 truncate text-sm font-medium">{name}</span>
          <span className="text-xs text-muted-foreground">{ROLE_LABELS[claims.role]}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="grid">
          <span className="truncate text-sm text-foreground">{user.email}</span>
          <span>{ROLE_LABELS[claims.role]}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            await refreshClaims();
            toast.success('Your role and branches are up to date');
          }}
        >
          <RefreshCw /> Refresh my access
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => signOut()}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

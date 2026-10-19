'use client';

import { Menu, ShieldAlert, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { rolesForPath } from '@/lib/access';
import { useSession } from '@/lib/auth-context';
import { usingEmulators } from '@/lib/firebase';
import { BranchSwitcher } from './branch-switcher';
import { SidebarNav } from './sidebar';
import { UserMenu } from './user-menu';

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 px-3">
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary font-heading text-base font-black text-white">
        S
      </span>
      <span className="font-heading text-[15px] font-bold text-white">Susu Portal</span>
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { claims } = useSession();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => setMobileOpen(false), [pathname]);

  const allowed = rolesForPath(pathname);
  const permitted = !allowed || allowed.includes(claims.role);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-screen flex-col gap-8 overflow-y-auto bg-sidebar px-3 py-5 lg:flex">
        <Brand />
        <SidebarNav />
        {usingEmulators && (
          <p className="mt-auto rounded-lg bg-white/5 px-3 py-2 text-xs text-sidebar-muted">
            Emulators · local data only
          </p>
        )}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="absolute inset-0 bg-black/40" aria-label="Close menu" onClick={() => setMobileOpen(false)} />
          <aside className="relative flex h-full w-72 flex-col gap-8 overflow-y-auto bg-sidebar px-3 py-5">
            <div className="flex items-center justify-between">
              <Brand />
              <button
                onClick={() => setMobileOpen(false)}
                className="rounded-md p-2 text-sidebar-foreground hover:bg-sidebar-active"
                aria-label="Close menu"
              >
                <X className="size-5" />
              </button>
            </div>
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur sm:px-6">
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu" onClick={() => setMobileOpen(true)}>
            <Menu className="size-5" />
          </Button>
          <BranchSwitcher />
          <div className="ml-auto">
            <UserMenu />
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
          {permitted ? (
            children
          ) : (
            <div className="py-20">
              <EmptyState
                icon={ShieldAlert}
                title="This area is not part of your role"
                description="If you need it for your work, ask your administrator to review your access."
                action={
                  <Button asChild variant="outline">
                    <Link href="/">Back to overview</Link>
                  </Button>
                }
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

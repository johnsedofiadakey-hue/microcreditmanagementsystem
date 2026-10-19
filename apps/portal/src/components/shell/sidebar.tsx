'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { navFor } from '@/lib/access';
import { useSession } from '@/lib/auth-context';
import { cn } from '@/lib/utils';

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { claims } = useSession();

  return (
    <nav aria-label="Main" className="grid gap-6">
      {navFor(claims.role).map((section) => (
        <div key={section.title} className="grid gap-1">
          <p className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-sidebar-muted uppercase">
            {section.title}
          </p>
          {section.items.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            const Icon = item.icon;
            if (item.comingIn) {
              return (
                <span
                  key={item.href}
                  aria-disabled="true"
                  title={`Arrives with backend ${item.comingIn}`}
                  className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-muted/70"
                >
                  <Icon className="size-4" aria-hidden />
                  <span className="flex-1">{item.label}</span>
                  <span className="rounded-md bg-white/5 px-1.5 py-px text-[10px] font-medium">Soon</span>
                </span>
              );
            }
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none',
                  active
                    ? 'bg-sidebar-active font-medium text-white'
                    : 'text-sidebar-foreground hover:bg-sidebar-active/60 hover:text-white',
                )}
              >
                <Icon className={cn('size-4', active ? 'text-accent' : '')} aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

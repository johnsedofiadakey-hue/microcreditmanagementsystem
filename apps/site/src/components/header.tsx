'use client';

import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { site } from '@/content/site';
import { cn } from '@/lib/utils';
import { BrandMark } from './brand';
import { Container } from './ui';

const NAV = [
  { href: '/susu', label: 'Susu savings' },
  { href: '/micro-credit', label: 'Micro-credit' },
  { href: '/welfare', label: 'Welfare' },
  { href: '/how-to-join', label: 'How to join' },
  { href: '/stay-safe', label: 'Stay safe' },
];

export function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <Container className="flex h-16 items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2.5" aria-label={`${site.name} home`}>
          <BrandMark />
          <span className="leading-tight">
            <span className="block font-heading text-base font-bold text-primary-strong">{site.name}</span>
            <span className="block text-[11px] font-medium text-muted-foreground">Susu · Credit · Welfare</span>
          </span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={pathname === item.href ? 'page' : undefined}
              className={cn(
                'rounded-full px-3.5 py-2 text-sm font-medium text-foreground/80 transition-colors hover:bg-muted hover:text-foreground',
                pathname === item.href && 'bg-primary-soft text-primary-strong',
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/contact"
            className="hidden min-h-10 items-center rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary-strong sm:inline-flex"
          >
            Talk to us
          </Link>
          <button
            type="button"
            className="inline-flex size-11 items-center justify-center rounded-full text-primary-strong hover:bg-muted lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
            <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
          </button>
        </div>
      </Container>

      {open && (
        <nav id="mobile-nav" aria-label="Main" className="border-t border-border bg-surface lg:hidden">
          <Container className="flex flex-col py-3">
            {[...NAV, { href: '/contact', label: 'Talk to us' }].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={pathname === item.href ? 'page' : undefined}
                className="rounded-xl px-3 py-3 text-base font-medium text-foreground hover:bg-muted"
              >
                {item.label}
              </Link>
            ))}
          </Container>
        </nav>
      )}
    </header>
  );
}

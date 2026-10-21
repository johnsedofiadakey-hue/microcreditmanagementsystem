import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Container({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8', className)} {...props} />;
}

const buttonStyles = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary-strong shadow-sm',
  accent: 'bg-accent text-primary-strong hover:bg-[#e6bd74] shadow-sm',
  outline: 'border border-primary/25 text-primary-strong hover:bg-primary-soft',
  ghostLight: 'border border-white/25 text-white hover:bg-white/10',
} as const;

export function ButtonLink({
  href,
  variant = 'primary',
  className,
  children,
}: {
  href: string;
  variant?: keyof typeof buttonStyles;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors',
        buttonStyles[variant],
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function Eyebrow({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cn('text-xs font-semibold uppercase tracking-[0.18em] text-primary', className)}>{children}</p>;
}

export function SectionHeading({
  eyebrow,
  title,
  intro,
  align = 'left',
}: {
  eyebrow?: string;
  title: ReactNode;
  intro?: ReactNode;
  align?: 'left' | 'center';
}) {
  return (
    <div className={cn('max-w-2xl', align === 'center' && 'mx-auto text-center')}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 className="mt-3 text-3xl font-bold sm:text-4xl">{title}</h2>
      {intro && <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">{intro}</p>}
    </div>
  );
}

/** Inner-page hero: compact, on the deep green field. */
export function PageHero({ eyebrow, title, intro, children }: { eyebrow: string; title: ReactNode; intro: ReactNode; children?: ReactNode }) {
  return (
    <section className="hero-field relative overflow-hidden text-white">
      <div className="orbit right-[-18%] top-[-30%] w-[min(70vw,34rem)]" aria-hidden>
        <span className="orbit-dot" />
      </div>
      <Container className="relative py-16 sm:py-20">
        <p className="rise text-xs font-semibold uppercase tracking-[0.18em] text-accent">{eyebrow}</p>
        <h1 className="rise rise-1 mt-4 max-w-3xl text-4xl font-black leading-[1.05] sm:text-5xl">{title}</h1>
        <p className="rise rise-2 mt-5 max-w-2xl text-base leading-relaxed text-white/80 sm:text-lg">{intro}</p>
        {children && <div className="rise rise-3 mt-8 flex flex-wrap gap-3">{children}</div>}
      </Container>
    </section>
  );
}

export function Notice({ tone = 'info', title, children }: { tone?: 'info' | 'warning'; title: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'rounded-2xl border p-5 text-sm leading-relaxed',
        tone === 'info' ? 'border-primary/20 bg-primary-soft text-primary-strong' : 'border-warning/25 bg-warning-soft text-[#5c3a00]',
      )}
    >
      <p className="font-semibold">{title}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

export function Prose({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-3xl space-y-5 text-base leading-relaxed text-foreground/90 [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 [&_h2]:mt-10 [&_h2]:text-2xl [&_h2]:font-bold [&_li]:mt-2 [&_ul]:list-disc [&_ul]:pl-6">
      {children}
    </div>
  );
}

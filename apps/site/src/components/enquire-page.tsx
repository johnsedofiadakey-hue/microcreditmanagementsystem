import type { LucideIcon } from 'lucide-react';
import { Check } from 'lucide-react';
import type { Business } from '@/content/site';
import { cn } from '@/lib/utils';
import { ButtonLink, Container, Notice, PageHero, SectionHeading } from './ui';

/**
 * Page for a business whose products are not yet on the platform (STF, OPWS). Describes the business
 * and asks people to talk to us — no rates, terms or online applications until the client signs them off.
 */
export function EnquirePage({
  business,
  interest,
  title,
  intro,
  points,
  forWho,
  icon: Icon,
}: {
  business: Business;
  interest: 'MICRO_CREDIT' | 'WELFARE';
  title: string;
  intro: string;
  points: { title: string; body: string }[];
  forWho: string[];
  icon: LucideIcon;
}) {
  const tone = business.tone === 'stf' ? { soft: 'bg-stf-soft', text: 'text-stf' } : { soft: 'bg-opws-soft', text: 'text-opws' };
  return (
    <>
      <PageHero eyebrow={business.name} title={title} intro={intro}>
        <ButtonLink href={`/contact?interest=${interest}`} variant="accent">Talk to us</ButtonLink>
      </PageHero>

      <section className="py-20">
        <Container className="grid gap-12 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <SectionHeading eyebrow="How we work" title={business.tagline} />
            <div className="mt-10 grid gap-5 sm:grid-cols-2">
              {points.map((p) => (
                <div key={p.title} className="rounded-3xl border border-border bg-surface p-6">
                  <span className={cn('inline-flex size-11 items-center justify-center rounded-2xl', tone.soft, tone.text)}>
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <h3 className="mt-5 text-lg font-bold">{p.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
                </div>
              ))}
            </div>
          </div>
          <aside className="space-y-5 lg:pt-24">
            <div className="rounded-3xl border border-border bg-surface p-6">
              <h3 className="text-lg font-bold">Who it is for</h3>
              <ul className="mt-4 space-y-3">
                {forWho.map((w) => (
                  <li key={w} className="flex gap-3 text-sm leading-relaxed">
                    <Check className={cn('mt-0.5 size-4 shrink-0', tone.text)} aria-hidden />
                    {w}
                  </li>
                ))}
              </ul>
            </div>
            <Notice title="Terms are explained in person">
              Every application is assessed individually. Our staff will explain the full terms, in writing, before you agree to anything.
              We never ask for an upfront payment to &ldquo;approve&rdquo; an application.
            </Notice>
            <ButtonLink href={`/contact?interest=${interest}`} className="w-full">Ask us to call you</ButtonLink>
          </aside>
        </Container>
      </section>
    </>
  );
}

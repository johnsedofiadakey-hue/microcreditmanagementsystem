import { ArrowRight, BadgeCheck, MessageSquareText, ShieldCheck, Smartphone, UsersRound, WalletCards } from 'lucide-react';
import Link from 'next/link';
import { PhoneReceipt } from '@/components/phone-receipt';
import { SavingsCalculator } from '@/components/savings-calculator';
import { ButtonLink, Container, Eyebrow, SectionHeading } from '@/components/ui';
import { businesses, type Business } from '@/content/site';
import { cn } from '@/lib/utils';

const TONE: Record<Business['tone'], { bar: string; soft: string; text: string }> = {
  gadufia: { bar: 'bg-gadufia', soft: 'bg-gadufia-soft', text: 'text-gadufia' },
  stf: { bar: 'bg-stf', soft: 'bg-stf-soft', text: 'text-stf' },
  opws: { bar: 'bg-opws', soft: 'bg-opws-soft', text: 'text-opws' },
};

const ICONS = { gadufia: WalletCards, stf: BadgeCheck, opws: UsersRound } as const;

const STEPS = [
  {
    title: 'Register once with your Ghana Card',
    body: 'Visit the office or meet a collector. We record your details and photo once, and you can then join any of our three businesses.',
  },
  {
    title: 'Save a little every day',
    body: 'Your collector comes to your shop, stall or home on agreed days. Pay the amount you chose — no trip to the bank.',
  },
  {
    title: 'Get an SMS for every payment',
    body: 'Each payment is recorded against your account and an SMS receipt shows the amount, your new balance and a reference.',
  },
  {
    title: 'Withdraw at the office',
    body: 'Ask for your savings at the branch. A withdrawal is checked and approved by two different staff members before you are paid.',
  },
];

const PROMISES = [
  { icon: MessageSquareText, title: 'A receipt for every cedi', body: 'If you pay and no SMS arrives by the end of the day, tell us. Every payment must have a receipt.' },
  { icon: ShieldCheck, title: 'Two people check every payout', body: 'No single member of staff can release your money on their own.' },
  { icon: Smartphone, title: 'Registered collectors only', body: 'Our collectors carry staff ID and record payments on a registered company phone.' },
];

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section className="hero-field relative overflow-hidden text-white">
        <div className="orbit right-[-20%] top-[-25%] w-[min(90vw,44rem)]" aria-hidden>
          <span className="orbit-dot" />
        </div>
        <Container className="relative grid gap-14 py-16 sm:py-20 lg:grid-cols-[1.15fr_1fr] lg:items-center lg:py-28">
          <div>
            <p className="rise text-xs font-semibold uppercase tracking-[0.18em] text-accent">Woezɔ · Welcome · Aflao, Volta Region</p>
            <h1 className="rise rise-1 mt-5 text-[2.6rem] font-black leading-[1.02] sm:text-6xl">
              Save a little every day.
              <span className="block text-accent">See every cedi recorded.</span>
            </h1>
            <p className="rise rise-2 mt-6 max-w-xl text-lg leading-relaxed text-white/80">
              Gadufia Fiase Susu collects your daily savings at your door and sends you an SMS receipt for every payment. Together with
              STF Micro-Credit and Opportunity Welfare, we help traders and families in Aflao grow steadily.
            </p>
            <div className="rise rise-3 mt-9 flex flex-wrap gap-3">
              <ButtonLink href="/contact?interest=SUSU" variant="accent">
                Start saving with us <ArrowRight className="size-4" aria-hidden />
              </ButtonLink>
              <ButtonLink href="/how-to-join" variant="ghostLight">
                How to join
              </ButtonLink>
            </div>
            <dl className="rise rise-4 mt-12 grid max-w-lg grid-cols-3 gap-6 border-t border-white/15 pt-6">
              <div>
                <dt className="text-xs text-white/60">Businesses</dt>
                <dd className="mt-1 font-heading text-2xl font-bold">3</dd>
              </div>
              <div>
                <dt className="text-xs text-white/60">Registration</dt>
                <dd className="mt-1 font-heading text-2xl font-bold">Once</dd>
              </div>
              <div>
                <dt className="text-xs text-white/60">SMS receipts</dt>
                <dd className="mt-1 font-heading text-2xl font-bold">Always</dd>
              </div>
            </dl>
          </div>
          <PhoneReceipt className="rise rise-2" />
        </Container>
      </section>

      {/* Three businesses */}
      <section className="py-20 sm:py-24" aria-labelledby="businesses-heading">
        <Container>
          <SectionHeading
            eyebrow="One family of businesses"
            title={<span id="businesses-heading">Three businesses. One registration. Your money kept apart.</span>}
            intro="Register once and you can save, borrow or join the welfare scheme. Each business is run separately and keeps its members' money in its own accounts."
          />
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {businesses.map((b) => {
              const Icon = ICONS[b.key];
              const tone = TONE[b.tone];
              return (
                <Link
                  key={b.key}
                  href={b.href}
                  className="group relative flex flex-col overflow-hidden rounded-3xl border border-border bg-surface p-7 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <span className={cn('absolute inset-x-0 top-0 h-1.5', tone.bar)} aria-hidden />
                  <span className={cn('inline-flex size-12 items-center justify-center rounded-2xl', tone.soft, tone.text)}>
                    <Icon className="size-6" aria-hidden />
                  </span>
                  <h3 className="mt-5 text-xl font-bold">{b.shortName}</h3>
                  <p className={cn('mt-1 text-sm font-semibold', tone.text)}>{b.tagline}</p>
                  <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">{b.summary}</p>
                  <span className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-primary-strong">
                    {b.availability === 'open' ? 'See how Susu works' : 'Talk to us'}
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </span>
                </Link>
              );
            })}
          </div>
        </Container>
      </section>

      {/* How it works */}
      <section className="border-y border-border bg-surface py-20 sm:py-24" aria-labelledby="how-heading">
        <Container className="grid gap-12 lg:grid-cols-[1fr_1.3fr]">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <SectionHeading
              eyebrow="How Susu works"
              title={<span id="how-heading">Simple for you. Careful with your money.</span>}
              intro="Susu is the trusted Ghanaian way to save in small, regular amounts. We keep the tradition and add a clear record you can check at any time."
            />
            <ButtonLink href="/susu" variant="outline" className="mt-8">
              More about Susu savings
            </ButtonLink>
          </div>
          <ol className="space-y-4">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-5 rounded-3xl border border-border bg-background p-6">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-strong font-heading text-lg font-bold text-accent">
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-lg font-bold">{step.title}</h3>
                  <p className="mt-1.5 leading-relaxed text-muted-foreground">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      {/* Calculator */}
      <section className="py-20 sm:py-24" aria-labelledby="calc-heading">
        <Container>
          <SectionHeading
            align="center"
            eyebrow="Plan your savings"
            title={<span id="calc-heading">Small daily amounts add up</span>}
            intro="Move the sliders to see what steady saving looks like over a few months."
          />
          <div className="mt-12">
            <SavingsCalculator />
          </div>
        </Container>
      </section>

      {/* Promises */}
      <section className="bg-primary-strong py-20 text-white sm:py-24" aria-labelledby="promise-heading">
        <Container>
          <div className="max-w-2xl">
            <Eyebrow className="text-accent">Our promise</Eyebrow>
            <h2 id="promise-heading" className="mt-3 text-3xl font-bold sm:text-4xl">
              Your savings are protected by clear rules, not by trust alone.
            </h2>
          </div>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {PROMISES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-3xl border border-white/10 bg-white/5 p-7">
                <Icon className="size-7 text-accent" aria-hidden />
                <h3 className="mt-5 text-lg font-bold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/75">{body}</p>
              </div>
            ))}
          </div>
          <Link href="/stay-safe" className="mt-10 inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline">
            How to stay safe with your money <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Container>
      </section>

      {/* CTA */}
      <section className="py-20 sm:py-24">
        <Container>
          <div className="relative overflow-hidden rounded-[2rem] bg-accent-soft px-6 py-14 text-center sm:px-14">
            <h2 className="mx-auto max-w-2xl text-3xl font-bold sm:text-4xl">Ready to start? We will come to you.</h2>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
              Leave your name and number and a member of our team will call you to arrange a visit.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <ButtonLink href="/contact?interest=SUSU">Ask us to call you</ButtonLink>
              <ButtonLink href="/how-to-join" variant="outline">
                What to bring
              </ButtonLink>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}

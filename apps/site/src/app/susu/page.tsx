import type { Metadata } from 'next';
import { CalendarCheck2, HandCoins, MessageSquareText, UsersRound } from 'lucide-react';
import { Faq } from '@/components/faq';
import { SavingsCalculator } from '@/components/savings-calculator';
import { ButtonLink, Container, PageHero, SectionHeading } from '@/components/ui';
import { businessByKey } from '@/content/site';

const business = businessByKey('gadufia');

export const metadata: Metadata = {
  title: 'Susu savings',
  description: `${business.name}: daily Susu savings collected at your door in Aflao, with an SMS receipt for every payment.`,
};

const FEATURES = [
  { icon: CalendarCheck2, title: 'You choose the amount', body: 'Agree a daily amount that fits your business. Market women, drivers, artisans and shop owners all save with us.' },
  { icon: UsersRound, title: 'Collectors work in pairs', body: 'Our collectors are registered staff who work in pairs on fixed routes, so you see familiar faces on agreed days.' },
  { icon: MessageSquareText, title: 'SMS receipt every time', body: 'Each payment is recorded on a registered company phone and confirmed to you by SMS with your new balance.' },
  { icon: HandCoins, title: 'Safe withdrawals', body: 'Withdraw at the office. Two different staff members check and approve each payout before you are paid.' },
];

const FAQ = [
  { q: 'Who can save with Gadufia Fiase Susu?', a: 'Anyone 18 or older with a Ghana Card. Most of our members are traders, artisans and small business owners in and around Aflao.' },
  { q: 'What if the collector misses a day or I miss a payment?', a: 'Nothing is lost. Your balance is simply what you have paid in, and every payment you make has its own receipt.' },
  { q: 'What if I pay but no SMS arrives?', a: 'Collectors can record payments even with no network; the SMS is sent as soon as the phone reconnects, normally the same day. If no receipt arrives by the end of the day, call or visit the office and tell us the date and amount.' },
  { q: 'Are there fees?', a: 'Our staff will explain the terms of your Susu plan, including any charges and when you can withdraw, before you start. Ask for them in writing if you wish.' },
  { q: 'Can I also borrow or join the welfare scheme?', a: 'Yes. Because you register once, you can talk to STF Micro-Credit or Opportunity Welfare without registering again.' },
];

export default function SusuPage() {
  return (
    <>
      <PageHero
        eyebrow={business.name}
        title="Daily Susu savings, collected at your door"
        intro="Keep your trading day going. Our collector comes to you, takes your daily savings and your phone confirms every cedi."
      >
        <ButtonLink href="/contact?interest=SUSU" variant="accent">Start saving</ButtonLink>
        <ButtonLink href="/how-to-join" variant="ghostLight">What to bring</ButtonLink>
      </PageHero>

      <section className="py-20">
        <Container>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-3xl border border-border bg-surface p-6">
                <span className="inline-flex size-11 items-center justify-center rounded-2xl bg-gadufia-soft text-gadufia">
                  <Icon className="size-5" aria-hidden />
                </span>
                <h2 className="mt-5 text-lg font-bold">{title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="border-y border-border bg-surface py-20">
        <Container>
          <SectionHeading eyebrow="Plan your savings" title="See what steady saving adds up to" />
          <div className="mt-10">
            <SavingsCalculator />
          </div>
        </Container>
      </section>

      <section className="py-20">
        <Container className="grid gap-12 lg:grid-cols-[1fr_1.5fr]">
          <SectionHeading eyebrow="Questions" title="Common questions about Susu" intro="Can't find your answer? Ask us to call you." />
          <Faq items={FAQ} />
        </Container>
      </section>
    </>
  );
}

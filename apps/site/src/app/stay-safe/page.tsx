import type { Metadata } from 'next';
import { BadgeCheck, KeyRound, MessageSquareWarning, ReceiptText } from 'lucide-react';
import { ButtonLink, Container, PageHero, SectionHeading } from '@/components/ui';
import { contact } from '@/content/site';

export const metadata: Metadata = {
  title: 'Stay safe with your money',
  description: 'How to recognise our collectors, check your receipts and avoid fraud.',
};

const RULES = [
  { icon: BadgeCheck, title: 'Check the collector', body: 'Our collectors carry company staff ID and work in pairs on fixed routes. If someone new comes, ask for ID or call the office first.' },
  { icon: ReceiptText, title: 'Every payment has an SMS', body: 'You should get an SMS with the amount, your balance and a reference for each payment. No receipt by the end of the day? Tell us.' },
  { icon: KeyRound, title: 'Never share your PIN', body: 'Our staff will never ask for your mobile money PIN, a one-time code or your password — not by phone, not in person.' },
  { icon: MessageSquareWarning, title: 'No fees to “release” money', body: 'We never ask for a payment to approve a loan or release your savings. Anyone who does is not acting for us.' },
];

export default function StaySafePage() {
  return (
    <>
      <PageHero
        eyebrow="Stay safe"
        title="Your money, your receipt, your right to ask"
        intro="Most fraud can be stopped with four simple habits. Share them with your family and fellow traders."
      />
      <section className="py-20">
        <Container>
          <div className="grid gap-5 md:grid-cols-2">
            {RULES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex gap-5 rounded-3xl border border-border bg-surface p-7">
                <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                  <Icon className="size-6" aria-hidden />
                </span>
                <div>
                  <h2 className="text-lg font-bold">{title}</h2>
                  <p className="mt-2 leading-relaxed text-muted-foreground">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </Container>
      </section>
      <section className="pb-20">
        <Container>
          <div className="rounded-[2rem] bg-primary-strong px-6 py-12 text-white sm:px-12">
            <SectionHeading
              title={<span className="text-white">Something doesn&apos;t look right?</span>}
              intro={
                <span className="text-white/75">
                  A missing receipt, a wrong balance or a collector you don&apos;t recognise — tell us straight away
                  {contact.phone ? ` on ${contact.phone}` : ' at our Aflao office'}. Every report is recorded and followed up by someone
                  other than the staff member involved.
                </span>
              }
            />
            <ButtonLink href="/contact?interest=OTHER" variant="accent" className="mt-8">Report a problem</ButtonLink>
          </div>
        </Container>
      </section>
    </>
  );
}

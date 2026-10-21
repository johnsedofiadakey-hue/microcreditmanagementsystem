import type { Metadata } from 'next';
import { Camera, CircleCheckBig, IdCard, Phone } from 'lucide-react';
import { ButtonLink, Container, Notice, PageHero, SectionHeading } from '@/components/ui';

export const metadata: Metadata = {
  title: 'How to join',
  description: 'What to bring and what happens when you register with Gadufia Fiase Susu, STF Micro-Credit or Opportunity Welfare.',
};

const BRING = [
  { icon: IdCard, title: 'Your Ghana Card', body: 'We record your Ghana Card number and take a photo of the card. It is the only ID you need.' },
  { icon: Phone, title: 'The phone number you use', body: 'Your SMS receipts go to this number, so give one that you keep with you.' },
  { icon: Camera, title: 'A moment for a photo', body: 'We take a clear photo of you so staff can recognise you at the office and on the route.' },
];

const STEPS = [
  { title: 'Meet us', body: 'Visit the office, or ask us to call you and a collector will visit your shop or home.' },
  { title: 'We record your details', body: 'Your name, date of birth, Ghana Card, phone number and photos are entered on a registered company phone or at the office.' },
  { title: 'A supervisor checks them', body: 'A second member of staff reviews your details and Ghana Card before your membership is approved. You can still talk to us while this happens.' },
  { title: 'Choose your plan', body: 'Agree your daily amount and collection days. Staff explain the terms of your plan before you start.' },
  { title: 'Start saving', body: 'From your first payment, you get an SMS receipt for each one.' },
];

export default function HowToJoinPage() {
  return (
    <>
      <PageHero
        eyebrow="How to join"
        title="Register once. Join any of our businesses."
        intro="Joining takes a few minutes. Bring your Ghana Card and the phone number you use — we do the rest."
      >
        <ButtonLink href="/contact" variant="accent">Ask us to visit you</ButtonLink>
      </PageHero>

      <section className="py-20">
        <Container>
          <SectionHeading eyebrow="What to bring" title="Three things, that is all" />
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {BRING.map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-3xl border border-border bg-surface p-7">
                <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-[#8a5f14]">
                  <Icon className="size-6" aria-hidden />
                </span>
                <h3 className="mt-5 text-lg font-bold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="border-y border-border bg-surface py-20">
        <Container className="grid gap-12 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <SectionHeading
              eyebrow="What happens"
              title="From hello to your first receipt"
              intro="We check who you are carefully because it protects your savings: nobody else can claim to be you."
            />
            <div className="mt-8">
              <Notice title="Your details are private">
                We use your Ghana Card and photos only to confirm who you are and to protect your account. Read our{' '}
                <a href="/privacy" className="font-semibold underline underline-offset-4">privacy notice</a>.
              </Notice>
            </div>
          </div>
          <ol className="relative ml-4 space-y-6 border-l-2 border-dashed border-primary/25 pl-8 sm:ml-5">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative">
                <span className="absolute -left-[2.85rem] flex size-9 items-center justify-center rounded-full bg-primary font-heading text-sm font-bold text-white ring-4 ring-surface">
                  {i === STEPS.length - 1 ? <CircleCheckBig className="size-4" aria-hidden /> : i + 1}
                </span>
                <h3 className="text-lg font-bold">{s.title}</h3>
                <p className="mt-1.5 leading-relaxed text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>
    </>
  );
}

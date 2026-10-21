import type { Metadata } from 'next';
import { Clock, Mail, MapPin, Phone } from 'lucide-react';
import { Suspense } from 'react';
import { EnquiryForm } from '@/components/enquiry-form';
import { Container, PageHero } from '@/components/ui';
import { branches, contact } from '@/content/site';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Ask us to call you, or visit our office in Aflao, Volta Region.',
};

export default function ContactPage() {
  const details = [
    { icon: MapPin, label: 'Head office', value: [contact.directions, contact.postal, `${contact.region}, ${contact.country}`].filter(Boolean).join(' · ') },
    contact.phone && { icon: Phone, label: 'Phone', value: contact.phone, href: `tel:${contact.phone.replace(/\s/g, '')}` },
    contact.email && { icon: Mail, label: 'Email', value: contact.email, href: `mailto:${contact.email}` },
    contact.hours && { icon: Clock, label: 'Opening hours', value: contact.hours },
  ].filter(Boolean) as { icon: typeof MapPin; label: string; value: string; href?: string }[];

  return (
    <>
      <PageHero
        eyebrow="Talk to us"
        title="Leave your number. We will call you."
        intro="Tell us what you are interested in and a member of our team will call you back to answer questions or arrange a visit."
      />
      <section className="py-16 sm:py-20">
        <Container className="grid gap-10 lg:grid-cols-[1.5fr_1fr]">
          <Suspense>
            <EnquiryForm />
          </Suspense>
          <aside className="space-y-4">
            {details.map(({ icon: Icon, label, value, href }) => (
              <div key={label} className="flex gap-4 rounded-3xl border border-border bg-surface p-6">
                <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
                  <Icon className="size-5" aria-hidden />
                </span>
                <div>
                  <p className="text-sm font-semibold">{label}</p>
                  {href ? (
                    <a href={href} className="mt-1 block text-muted-foreground hover:text-primary">{value}</a>
                  ) : (
                    <p className="mt-1 leading-relaxed text-muted-foreground">{value}</p>
                  )}
                </div>
              </div>
            ))}
            {branches.length > 0 && (
              <div className="rounded-3xl border border-border bg-surface p-6">
                <p className="text-sm font-semibold">Branches</p>
                <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                  {branches.map((b) => (
                    <li key={b.name}>
                      <span className="font-medium text-foreground">{b.name}</span>, {b.town}
                      {b.directions && ` — ${b.directions}`}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="px-2 text-sm leading-relaxed text-muted-foreground">
              Already a member with a question about a payment? Have your SMS reference ready when you call or visit.
            </p>
          </aside>
        </Container>
      </section>
    </>
  );
}

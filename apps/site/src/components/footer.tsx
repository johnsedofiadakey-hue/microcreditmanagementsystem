import Link from 'next/link';
import { businesses, contact } from '@/content/site';
import { BrandMark } from './brand';
import { Container } from './ui';

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-auto bg-primary-strong text-white/80">
      <div className="kente-strip" aria-hidden />
      <Container className="grid gap-10 py-14 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5">
            <BrandMark />
            <span className="font-heading text-lg font-bold text-white">Serving Aflao and the Volta Region</span>
          </div>
          <ul className="mt-5 space-y-2 text-sm">
            {businesses.map((b) => (
              <li key={b.key}>
                <Link href={b.href} className="hover:text-white">
                  {b.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-sm font-semibold text-white">Visit or write</p>
          <address className="mt-4 space-y-1.5 text-sm not-italic">
            <p>{contact.postal}</p>
            <p>
              {contact.region}, {contact.country}
            </p>
            {contact.phone && (
              <p>
                <a href={`tel:${contact.phone.replace(/\s/g, '')}`} className="hover:text-white">
                  {contact.phone}
                </a>
              </p>
            )}
            {contact.email && (
              <p>
                <a href={`mailto:${contact.email}`} className="hover:text-white">
                  {contact.email}
                </a>
              </p>
            )}
            {contact.hours && <p>{contact.hours}</p>}
          </address>
        </div>

        <div>
          <p className="text-sm font-semibold text-white">Information</p>
          <ul className="mt-4 space-y-2 text-sm">
            <li><Link href="/how-to-join" className="hover:text-white">How to join</Link></li>
            <li><Link href="/stay-safe" className="hover:text-white">Stay safe with your money</Link></li>
            <li><Link href="/contact" className="hover:text-white">Contact and enquiries</Link></li>
            <li><Link href="/privacy" className="hover:text-white">Privacy notice</Link></li>
            <li><Link href="/accessibility" className="hover:text-white">Accessibility</Link></li>
          </ul>
        </div>
      </Container>
      <Container className="flex flex-col gap-2 border-t border-white/10 py-6 text-xs text-white/60 sm:flex-row sm:justify-between">
        <p>© {year} Gadufia Fiase Susu Services, STF Micro-Credit Services and Opportunity People&apos;s Welfare Scheme International Association.</p>
        <p>Each business keeps its members&apos; money separately.</p>
      </Container>
    </footer>
  );
}

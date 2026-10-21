import type { Metadata } from 'next';
import { Container, PageHero, Prose } from '@/components/ui';
import { contact } from '@/content/site';

export const metadata: Metadata = {
  title: 'Accessibility',
  description: 'Our commitment to making this website usable by everyone.',
};

export default function AccessibilityPage() {
  return (
    <>
      <PageHero
        eyebrow="Accessibility"
        title="A website everyone can use"
        intro="Many of our members use basic smartphones and slow connections. We build this site to work for them, and for people who use assistive technology."
      />
      <section className="py-16 sm:py-20">
        <Container>
          <Prose>
            <h2>What we do</h2>
            <ul>
              <li>We aim to meet the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA.</li>
              <li>Pages work on small screens, with large tap targets and text that can be enlarged up to 200%.</li>
              <li>Every page can be used with a keyboard, and has clear headings and labels for screen readers.</li>
              <li>Colours have strong contrast, and we never rely on colour alone to give information.</li>
              <li>Movement on the page is switched off if your device asks for reduced motion.</li>
              <li>Pages are light so they load on slow mobile data.</li>
            </ul>
            <h2>Prefer to talk?</h2>
            <p>
              You never need the website to use our services. Visit our office at {contact.postal}
              {contact.phone ? ` or call ${contact.phone}` : ''}, or ask a collector, and we will help you in English, Ewe or the language you
              prefer.
            </p>
            <h2>Tell us about a problem</h2>
            <p>
              If something on this site is hard to use, please <a href="/contact?interest=OTHER">let us know</a> and we will fix it.
            </p>
          </Prose>
        </Container>
      </section>
    </>
  );
}

import type { Metadata } from 'next';
import { Container, Notice, PageHero, Prose } from '@/components/ui';
import { contact } from '@/content/site';

export const metadata: Metadata = {
  title: 'Privacy notice',
  description: 'How we collect, use and protect your personal information.',
};

export default function PrivacyPage() {
  return (
    <>
      <PageHero
        eyebrow="Privacy"
        title="How we look after your information"
        intro="We collect only what we need to serve you and protect your money, and we handle it in line with Ghana's Data Protection Act, 2012 (Act 843)."
      />
      <section className="py-16 sm:py-20">
        <Container>
          <div className="mb-10 max-w-3xl">
            <Notice tone="warning" title="Draft for review">
              This notice is a draft prepared for the client&apos;s review. It becomes final once approved by the businesses and their
              data protection adviser.
            </Notice>
          </div>
          <Prose>
            <h2>Who we are</h2>
            <p>
              This website is shared by Gadufia Fiase Susu Services, STF Micro-Credit Services and Opportunity People&apos;s Welfare Scheme
              International Association, {contact.postal}, {contact.region}. Each business is responsible for the information of its own
              members.
            </p>
            <h2>What we collect</h2>
            <ul>
              <li><strong>From this website:</strong> your name, phone number, town and message when you ask us to call you.</li>
              <li><strong>When you register:</strong> your name, date of birth, Ghana Card number and a photo of the card, a photo of you, and your phone number.</li>
              <li><strong>When you save or borrow:</strong> each payment, withdrawal and receipt, with the time and the staff member involved.</li>
            </ul>
            <h2>Why we use it</h2>
            <ul>
              <li>To reply to your enquiry and arrange a visit.</li>
              <li>To confirm who you are, so nobody else can use your account.</li>
              <li>To record your money accurately and send you SMS receipts.</li>
              <li>To meet our legal and regulatory obligations and to detect and prevent fraud.</li>
            </ul>
            <h2>Who sees it</h2>
            <p>
              Only staff who need it for their work, with access limited to their branch and role. We use service providers to send SMS
              and to host our systems securely; they may only use your information to provide that service. We do not sell your
              information.
            </p>
            <h2>How long we keep it</h2>
            <p>
              Website enquiries are kept only as long as needed to respond and follow up. Account and transaction records are kept for
              the periods the law requires for financial records.
            </p>
            <h2>Your rights</h2>
            <p>
              You can ask to see the information we hold about you, ask us to correct it, or object to how we use it. Visit or write to
              us at {contact.postal}
              {contact.email ? ` or email ${contact.email}` : ''}.
            </p>
          </Prose>
        </Container>
      </section>
    </>
  );
}

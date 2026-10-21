import type { Metadata } from 'next';
import { BadgeCheck } from 'lucide-react';
import { EnquirePage } from '@/components/enquire-page';
import { businessByKey } from '@/content/site';

const business = businessByKey('stf');

export const metadata: Metadata = {
  title: 'Micro-credit',
  description: `${business.name}: credit for traders and small businesses in Aflao and the Volta Region.`,
};

export default function MicroCreditPage() {
  return (
    <EnquirePage
      business={business}
      interest="MICRO_CREDIT"
      icon={BadgeCheck}
      title="Credit that grows with your business"
      intro="STF Micro-Credit supports traders, artisans and small enterprises with working capital. Talk to our team about what your business needs."
      points={[
        { title: 'Built on your record', body: 'Your savings history with Gadufia Fiase Susu helps us understand your business and how you manage money.' },
        { title: 'One registration', body: 'Already a Susu member? You are already registered — no need to bring your documents again.' },
        { title: 'Clear written terms', body: 'Before you agree to anything, we explain the amount, the repayments and every charge, and give them to you in writing.' },
        { title: 'Advice first', body: 'We talk through what your business needs and whether credit is the right step now, or saving first is better.' },
      ]}
      forWho={['Market traders and shop owners', 'Artisans and small workshops', 'Existing Susu members who save regularly']}
    />
  );
}

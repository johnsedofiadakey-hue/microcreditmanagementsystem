import type { Metadata } from 'next';
import { UsersRound } from 'lucide-react';
import { EnquirePage } from '@/components/enquire-page';
import { businessByKey } from '@/content/site';

const business = businessByKey('opws');

export const metadata: Metadata = {
  title: 'Welfare',
  description: `${business.name}: members supporting members when families need it most.`,
};

export default function WelfarePage() {
  return (
    <EnquirePage
      business={business}
      interest="WELFARE"
      icon={UsersRound}
      title="Members supporting members"
      intro="Opportunity People's Welfare Scheme brings members together so that support is there in hard times. Talk to us about joining."
      points={[
        { title: 'Contribute together', body: 'Members make regular contributions to a shared welfare fund, kept separate from our other businesses.' },
        { title: 'Clear rules', body: 'What the scheme supports and how is set out in the association’s rules, which we will explain before you join.' },
        { title: 'One registration', body: 'Members of Gadufia Fiase Susu or STF Micro-Credit can join without registering again.' },
        { title: 'Ask us anything', body: 'Our team will take you through how contributions, support and membership work, in the language you prefer.' },
      ]}
      forWho={['Families who want support in hard times', 'Traders and workers in Aflao and nearby towns', 'Existing members of our other businesses']}
    />
  );
}

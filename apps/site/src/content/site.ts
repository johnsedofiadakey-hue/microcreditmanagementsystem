/**
 * Every business fact the public site shows lives here, so the client can review one file.
 *
 * Rules for this file (blueprint §4 public website; PROJECT_PLAN UI row "Public site"):
 * - No rates, fees, loan terms or welfare benefits until the client signs the business rules.
 * - STF Micro-Credit and OPWS Welfare are described as "talk to us" — the platform does not yet run
 *   their products, so the site never offers to open those accounts online.
 * - `null` means "not confirmed yet": the page leaves that detail out rather than showing a placeholder.
 */

export type BusinessKey = 'gadufia' | 'stf' | 'opws';

export interface Business {
  key: BusinessKey;
  /** Matches the platform's business code (ADR-001). */
  code: 'GADUFIA' | 'STF' | 'OPWS';
  name: string;
  shortName: string;
  href: string;
  tagline: string;
  summary: string;
  /** Live on the platform today (Susu), or talk-to-us only. */
  availability: 'open' | 'enquire';
  /** CSS colour token name from globals.css. */
  tone: 'gadufia' | 'stf' | 'opws';
}

export const businesses: Business[] = [
  {
    key: 'gadufia',
    code: 'GADUFIA',
    name: 'Gadufia Fiase Susu Services',
    shortName: 'Gadufia Fiase Susu',
    href: '/susu',
    tagline: 'Daily savings, collected at your door',
    summary:
      'Save a small amount every day with a collector who comes to your shop, stall or home. Every payment is recorded and confirmed to you by SMS.',
    availability: 'open',
    tone: 'gadufia',
  },
  {
    key: 'stf',
    code: 'STF',
    name: 'STF Micro-Credit Services',
    shortName: 'STF Micro-Credit',
    href: '/micro-credit',
    tagline: 'Credit for traders and small businesses',
    summary:
      'Working capital for traders, artisans and small enterprises, built on the savings record you keep with us.',
    availability: 'enquire',
    tone: 'stf',
  },
  {
    key: 'opws',
    code: 'OPWS',
    name: "Opportunity People's Welfare Scheme International Association",
    shortName: 'Opportunity Welfare',
    href: '/welfare',
    tagline: 'Members supporting members',
    summary:
      'A welfare association where members contribute together so that support is there when a family needs it most.',
    availability: 'enquire',
    tone: 'opws',
  },
];

export const businessByKey = (key: BusinessKey): Business => businesses.find((b) => b.key === key)!;

export const contact = {
  town: 'Aflao',
  region: 'Volta Region',
  country: 'Ghana',
  postal: 'P.O. Box FL 21, Aflao',
  /** Street directions to the head office. To confirm with the client. */
  directions: null as string | null,
  /** Main office line, e.g. '+233 24 000 0000'. To confirm with the client. */
  phone: null as string | null,
  /** WhatsApp number if different from phone. To confirm with the client. */
  whatsapp: null as string | null,
  email: null as string | null,
  /** e.g. 'Monday to Saturday, 7:30 am – 5:30 pm'. To confirm with the client. */
  hours: null as string | null,
};

/** Branches beyond head office. Empty until the client confirms the list. */
export const branches: { name: string; town: string; directions: string | null }[] = [];

export const site = {
  /** Shown in the header and browser tab. The client has not named an umbrella brand, so we lead with the live business. */
  name: 'Gadufia Fiase',
  title: 'Gadufia Fiase Susu, STF Micro-Credit and Opportunity Welfare — Aflao',
  description:
    'Daily Susu savings collected at your door, with an SMS receipt for every payment. Gadufia Fiase Susu Services, STF Micro-Credit Services and Opportunity Welfare, Aflao, Volta Region.',
  url: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3001',
  /** Search engines may index the site only once the client approves the copy (NEXT_PUBLIC_SITE_INDEXABLE=true). */
  indexable: process.env.NEXT_PUBLIC_SITE_INDEXABLE === 'true',
};

import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';
import { site } from '@/content/site';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: site.title, template: `%s · ${site.name}` },
  description: site.description,
  robots: site.indexable ? undefined : { index: false, follow: false },
  openGraph: { type: 'website', locale: 'en_GH', siteName: site.name, title: site.title, description: site.description },
};

export const viewport: Viewport = { themeColor: '#173d33' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GH" className={inter.variable}>
      <head>
        {/* Satoshi (headings) is served by Fontshare; Inter is self-hosted by next/font. */}
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=satoshi@500,700,900&display=swap" />
      </head>
      <body className="flex min-h-dvh flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-accent focus:px-4 focus:py-2 focus:font-semibold focus:text-primary-strong">
          Skip to content
        </a>
        <Header />
        <main id="main" className="flex-1">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}

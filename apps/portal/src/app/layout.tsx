import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import localFont from 'next/font/local';
import { Toaster } from 'sonner';
import { Providers } from './providers';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const satoshi = localFont({
  src: [
    { path: '../fonts/satoshi_medium.ttf', weight: '500', style: 'normal' },
    { path: '../fonts/satoshi_bold.ttf', weight: '700', style: 'normal' },
    { path: '../fonts/satoshi_black.ttf', weight: '900', style: 'normal' },
  ],
  variable: '--font-satoshi',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Susu Portal', template: '%s · Susu Portal' },
  description: 'Branch and head-office portal for Susu collections, members and cash control.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GH" className={`${inter.variable} ${satoshi.variable}`}>
      <body>
        <Providers>{children}</Providers>
        <Toaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}

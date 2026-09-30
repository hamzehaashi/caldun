import type { Metadata } from 'next';
import { DM_Sans, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-sans' });
const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'CALDUN — Investment Research Workspace',
  description: 'Filing-derived fundamentals, forecasts, valuation, and analyst memo workflows.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${dmSans.variable} ${ibmPlexMono.variable}`}>{children}</body>
    </html>
  );
}

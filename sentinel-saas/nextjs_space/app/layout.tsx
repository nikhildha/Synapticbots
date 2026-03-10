import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { SessionProvider } from '@/components/providers/session-provider';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { TickerTape } from '@/components/ticker-tape';

const inter = Inter({ subsets: ['latin'] });

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Synaptic - Premium Crypto Trading Bot',
  description: 'Advanced automated cryptocurrency trading platform for CoinDCX and Binance exchanges',
  metadataBase: new URL(process.env.NEXTAUTH_URL || 'https://synaptic.ai'),
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
  },
  openGraph: {
    title: 'Synaptic - Premium Crypto Trading Bot',
    description: 'Advanced automated cryptocurrency trading platform',
    images: ['/og-image.png'],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head></head>
      <body className={inter.className} suppressHydrationWarning>
        <SessionProvider>
          <ThemeProvider>
            <TickerTape />
            <div style={{ paddingTop: '38px' }}>
              {children}
            </div>
          </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
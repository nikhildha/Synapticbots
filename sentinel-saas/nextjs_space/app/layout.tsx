import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { SessionProvider } from '@/components/providers/session-provider';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { TickerTape } from '@/components/ticker-tape';

const inter = Inter({ subsets: ['latin'] });

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  metadataBase: new URL('https://synapticbots.in'),
  title: {
    default: 'Synaptic — AI-Powered Crypto Trading Bot | CoinDCX & Binance',
    template: '%s | Synaptic',
  },
  description: 'Synaptic is an AI-powered automated crypto trading bot using HMM regime detection and Athena AI. Trade smarter on CoinDCX and Binance with real-time signals, multi-timeframe analysis, and risk management.',
  keywords: [
    'crypto trading bot', 'automated cryptocurrency trading', 'AI trading bot',
    'CoinDCX bot', 'Binance trading bot', 'HMM trading', 'algorithmic trading India',
    'crypto bot India', 'Synaptic trading', 'automated crypto trading platform',
  ],
  authors: [{ name: 'Synaptic', url: 'https://synapticbots.in' }],
  creator: 'Synaptic',
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
  },
  openGraph: {
    type: 'website',
    url: 'https://synapticbots.in',
    siteName: 'Synaptic',
    title: 'Synaptic — AI-Powered Crypto Trading Bot',
    description: 'Automated crypto trading with HMM-based regime detection and Athena AI signals. Built for CoinDCX and Binance.',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Synaptic AI Trading Bot' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Synaptic — AI-Powered Crypto Trading Bot',
    description: 'Automated crypto trading with HMM-based regime detection and Athena AI signals.',
    images: ['/og-image.png'],
  },
  alternates: {
    canonical: 'https://synapticbots.in',
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
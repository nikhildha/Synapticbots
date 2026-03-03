import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'SENTINEL AI — AI-Powered Crypto Trading Bot',
  description:
    'SENTINEL AI detects Bull, Bear, Chop & Crash market regimes in real time and trades automatically. Built for Indian crypto markets. CoinDCX + Binance supported.',
  keywords: 'crypto trading bot, AI trading, CoinDCX, Bitcoin, HMM regime detection, crypto signals India',
  authors: [{ name: 'SENTINEL AI' }],
  openGraph: {
    title: 'SENTINEL AI — AI-Powered Crypto Trading Bot',
    description: 'Real-time regime detection. Automated trading. Built for India.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SENTINEL AI',
    description: 'AI-Powered Crypto Trading Bot for Indian Markets',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="scroll-smooth">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  )
}

'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown } from 'lucide-react'

const faqs = [
  {
    q: 'Is my API key safe? What permissions does SENTINEL AI need?',
    a: "Your API keys are stored encrypted in your browser's local storage and are never transmitted to our servers. For paper trading, read-only permissions are sufficient. For live trading, enable trade permissions but never enable withdrawal — SENTINEL AI never touches your withdrawals.",
  },
  {
    q: 'Which exchanges are supported?',
    a: 'CoinDCX (primary — Indian traders) and Binance are both fully supported. CoinDCX is recommended for INR deposits and withdrawals, while Binance works best for USDT-margined pairs. More exchanges coming in Q2 2026.',
  },
  {
    q: 'What exactly is "paper trading" and can I test without real money?',
    a: "Paper trading simulates trades using real market prices but with virtual funds — no real money is ever placed. You can run in paper mode indefinitely on the Starter plan. It's the best way to validate SENTINEL AI's strategy against your risk tolerance before going live.",
  },
  {
    q: 'How does the AI know which regime the market is in?',
    a: 'SENTINEL uses a 4-state Gaussian Hidden Markov Model (HMM) trained on 8 market features: log returns, volatility, volume change, RSI, VWAP position, support/resistance position, open interest change, and funding rate. The model outputs a probability distribution over Bull, Bear, Chop, and Crash states.',
  },
  {
    q: 'What does "conviction score" mean and how does it affect trading?',
    a: 'The conviction score (0–100) aggregates 7 signals: HMM regime (25 pts), BTC macro (20 pts), funding rate (12 pts), S/R and VWAP alignment (12 pts), open interest (8 pts), volume (5 pts), and sentiment (18 pts). Scores below 40 result in no trade. Higher scores drive higher leverage and larger position sizes.',
  },
  {
    q: 'How does SENTINEL handle Indian tax rules for crypto?',
    a: 'SENTINEL groups all trades by Indian Financial Year (April–March) and applies Section 115BBH rules: 30% flat tax on VDA profits. The Pro and Elite plans generate a CSV export per FY with net P&L, TDS-deducted amounts (Section 194S), and per-trade details compatible with most CA software.',
  },
  {
    q: 'Can I cancel my subscription at any time?',
    a: "Yes — cancel any time from your account settings. Your subscription remains active until the end of the current billing period. We don't charge cancellation fees and don't offer prorated refunds for the remaining billing period.",
  },
  {
    q: "What happens if there's a market crash or a major hack news event?",
    a: 'Two things happen automatically. First, the HMM model rapidly transitions to the Crash/Panic state and no new long positions are opened. Second, the Sentiment Intelligence module parses hack/exploit keywords from live news. If detected, the conviction score is immediately forced to zero, vetoing any open or pending orders.',
  },
]

export default function FAQ() {
  const [open, setOpen] = useState<number | null>(null)

  return (
    <section id="faq" className="py-24 bg-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold mb-4">
            Got questions?
          </div>
          <h2 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight">
            Frequently asked{' '}
            <span className="text-gradient">questions.</span>
          </h2>
        </motion.div>

        {/* Accordion */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
          className="divide-y divide-slate-100 border border-slate-200 rounded-2xl overflow-hidden"
        >
          {faqs.map((item, i) => (
            <div key={i} className="bg-white">
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="w-full flex items-center justify-between gap-4 px-6 py-5 text-left hover:bg-slate-50 transition-colors"
              >
                <span className="text-sm font-semibold text-slate-900">{item.q}</span>
                <ChevronDown
                  className={`w-4 h-4 text-slate-400 flex-shrink-0 transition-transform duration-200 ${
                    open === i ? 'rotate-180' : ''
                  }`}
                />
              </button>

              <AnimatePresence initial={false}>
                {open === i && (
                  <motion.div
                    key="answer"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: 'easeInOut' }}
                    className="overflow-hidden"
                  >
                    <p className="px-6 pb-5 text-sm text-slate-500 leading-relaxed">{item.a}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </motion.div>

        <p className="mt-8 text-center text-sm text-slate-400">
          Still have questions?{' '}
          <a href="mailto:support@sentinelai.in" className="text-blue-600 hover:underline font-medium">
            Email our team
          </a>
        </p>
      </div>
    </section>
  )
}

'use client'

import { motion } from 'framer-motion'
import { Brain, Newspaper, Shield, Monitor, FileText, Layers } from 'lucide-react'

const features = [
  {
    icon: Brain,
    title: 'HMM Regime Engine',
    description:
      'A 4-state Gaussian HMM processes 8 market features — returns, volatility, RSI, funding, order flow and more — to classify every coin as Bull, Bear, Chop or Crash every 5 minutes.',
    color: 'text-violet-600',
    bg: 'bg-violet-50',
    border: 'border-violet-200',
    badge: 'Core AI',
    badgeColor: 'bg-violet-100 text-violet-700',
  },
  {
    icon: Newspaper,
    title: 'Sentiment Intelligence',
    description:
      'Real-time NLP analysis across CryptoPanic, Reddit, RSS feeds and the Fear & Greed index. Hack/exploit alerts trigger an instant veto on any open or pending trade.',
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    badge: 'New',
    badgeColor: 'bg-blue-100 text-blue-700',
  },
  {
    icon: Shield,
    title: 'Dynamic Risk Manager',
    description:
      'Conviction scoring across 7 factors drives dynamic leverage (0–35×), position sizing, adaptive stop-loss, take-profit targets, and a kill switch that halts trading on drawdown.',
    color: 'text-green-600',
    bg: 'bg-green-50',
    border: 'border-green-200',
    badge: null,
    badgeColor: '',
  },
  {
    icon: Monitor,
    title: 'Real-time Dashboard',
    description:
      'Live WebSocket feed shows regime heatmap, open positions, conviction breakdown, order-book walls, and funding rates. Everything updates the moment the bot acts.',
    color: 'text-amber-600',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    badge: null,
    badgeColor: '',
  },
  {
    icon: FileText,
    title: 'Indian Tax Reports',
    description:
      'Auto-generated trade history grouped by Indian Financial Year (Apr–Mar). One-click CSV export with P&L, TDS, and STT figures ready for your CA or ITR filing.',
    color: 'text-rose-600',
    bg: 'bg-rose-50',
    border: 'border-rose-200',
    badge: 'Pro',
    badgeColor: 'bg-rose-100 text-rose-700',
  },
  {
    icon: Layers,
    title: 'Multi-Coin Mode',
    description:
      'Scan up to 50 coins in parallel. The bot allocates capital across the top-conviction setups and manages each position independently — with per-coin stop-loss and sizing.',
    color: 'text-indigo-600',
    bg: 'bg-indigo-50',
    border: 'border-indigo-200',
    badge: 'Elite',
    badgeColor: 'bg-indigo-100 text-indigo-700',
  },
]

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
}

const card = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4 } },
}

export default function Features() {
  return (
    <section id="features" className="py-24 bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-200 text-slate-600 text-xs font-semibold mb-4">
            Everything you need
          </div>
          <h2 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight">
            Professional-grade tools.{' '}
            <span className="text-gradient">Zero compromise.</span>
          </h2>
          <p className="mt-4 text-lg text-slate-500 max-w-xl mx-auto">
            Every feature is purpose-built for Indian crypto markets and the realities of 24/7 automated trading.
          </p>
        </motion.div>

        {/* Grid */}
        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-60px' }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          {features.map((f) => (
            <motion.div
              key={f.title}
              variants={card}
              className="bg-white rounded-2xl border border-slate-200 p-6 shadow-card hover:shadow-card-hover transition-all duration-300 hover:-translate-y-1 flex flex-col gap-4"
            >
              {/* Icon + badge row */}
              <div className="flex items-start justify-between">
                <div
                  className={`w-11 h-11 rounded-xl ${f.bg} ${f.border} border flex items-center justify-center flex-shrink-0`}
                >
                  <f.icon className={`w-5 h-5 ${f.color}`} />
                </div>
                {f.badge && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${f.badgeColor}`}>
                    {f.badge}
                  </span>
                )}
              </div>

              <div>
                <h3 className="text-base font-bold text-slate-900 mb-1.5">{f.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{f.description}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}

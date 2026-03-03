'use client'

import { motion } from 'framer-motion'
import { KeyRound, Brain, LineChart, ArrowRight } from 'lucide-react'

const steps = [
  {
    icon: KeyRound,
    number: '01',
    title: 'Connect Your Exchange',
    description:
      'Add your CoinDCX or Binance API keys in Settings. Takes under 2 minutes. Read-only permissions for paper trading — full permissions for live.',
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
  },
  {
    icon: Brain,
    number: '02',
    title: 'AI Detects the Regime',
    description:
      'Every 5 minutes, SENTINEL scans up to 50 coins using a Gaussian HMM with 8 market features — returns, volatility, RSI, sentiment, orderflow and more.',
    color: 'text-purple-600',
    bg: 'bg-purple-50',
    border: 'border-purple-200',
  },
  {
    icon: LineChart,
    number: '03',
    title: 'Bot Trades Automatically',
    description:
      'When conviction is high, the bot enters with a calibrated position size, sets stop-loss and take-profit, and trails both as the trade moves in your favour.',
    color: 'text-green-600',
    bg: 'bg-green-50',
    border: 'border-green-200',
  },
]

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-16"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 text-slate-600 text-xs font-semibold mb-4">
            Simple by design
          </div>
          <h2 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight">
            Automated. Intelligent.{' '}
            <span className="text-gradient">Indian-Market Ready.</span>
          </h2>
          <p className="mt-4 text-lg text-slate-500 max-w-xl mx-auto">
            Three steps from sign-up to your first automated trade.
          </p>
        </motion.div>

        {/* Steps */}
        <div className="relative grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Connector lines (desktop) */}
          <div className="hidden lg:block absolute top-20 left-1/3 right-1/3 h-px bg-gradient-to-r from-blue-200 via-purple-200 to-green-200 z-0" />

          {steps.map((step, i) => (
            <motion.div
              key={step.number}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: 0.4, delay: i * 0.12 }}
              className="relative z-10"
            >
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-card hover:shadow-card-hover transition-all duration-300 hover:-translate-y-1">
                {/* Number badge */}
                <div className="flex items-center justify-between mb-4">
                  <div
                    className={`w-12 h-12 rounded-xl ${step.bg} ${step.border} border flex items-center justify-center`}
                  >
                    <step.icon className={`w-6 h-6 ${step.color}`} />
                  </div>
                  <span className="text-4xl font-black text-slate-100 select-none">{step.number}</span>
                </div>

                <h3 className="text-lg font-bold text-slate-900 mb-2">{step.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{step.description}</p>

                {/* Arrow for non-last steps */}
                {i < steps.length - 1 && (
                  <div className="lg:hidden mt-4 flex justify-center">
                    <ArrowRight className="w-5 h-5 text-slate-300 rotate-90" />
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

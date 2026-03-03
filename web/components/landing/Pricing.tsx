'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Zap } from 'lucide-react'

const plans = [
  {
    name: 'Starter',
    monthly: 0,
    annual: 0,
    description: 'Paper-trade and learn the system at zero cost.',
    highlight: false,
    cta: 'Get Started Free',
    ctaStyle: 'bg-slate-900 text-white hover:bg-slate-800',
    features: [
      '1 coin monitored',
      'Paper trading only',
      '4-state regime detection',
      'Basic dashboard',
      'Regime signals (15-min delay)',
      'Email support',
    ],
    missing: ['Live trading', 'Multi-coin mode', 'Sentiment engine', 'Indian tax reports', 'API access'],
  },
  {
    name: 'Pro',
    monthly: 999,
    annual: 9990,
    description: 'For serious traders who want full automation on live markets.',
    highlight: true,
    cta: 'Start Pro Trial',
    ctaStyle: 'bg-gradient-to-r from-blue-600 to-violet-600 text-white hover:opacity-90',
    features: [
      '15 coins monitored',
      'Live trading (CoinDCX + Binance)',
      '4-state regime detection',
      'Full real-time dashboard',
      'Real-time regime signals',
      'Sentiment intelligence',
      'Indian FY tax reports',
      'Telegram alerts',
      'Priority support',
    ],
    missing: ['50-coin multi-coin mode', 'Dedicated account manager'],
  },
  {
    name: 'Elite',
    monthly: 2499,
    annual: 24990,
    description: 'Maximum power for professional traders and family offices.',
    highlight: false,
    cta: 'Go Elite',
    ctaStyle: 'bg-slate-900 text-white hover:bg-slate-800',
    features: [
      '50 coins monitored',
      'Live trading (all exchanges)',
      '4-state regime detection',
      'Full real-time dashboard',
      'Real-time regime signals',
      'Sentiment intelligence',
      'Indian FY tax reports',
      'Telegram alerts',
      'Multi-coin mode (50 coins)',
      'API access',
      'Dedicated account manager',
      'Custom regime thresholds',
    ],
    missing: [],
  },
]

export default function Pricing() {
  const [annual, setAnnual] = useState(false)

  return (
    <section id="pricing" className="py-24 bg-slate-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-200 text-slate-600 text-xs font-semibold mb-4">
            Simple pricing
          </div>
          <h2 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight">
            Start free.{' '}
            <span className="text-gradient">Scale when you&apos;re ready.</span>
          </h2>
          <p className="mt-4 text-lg text-slate-500 max-w-xl mx-auto">
            All plans include paper trading. Upgrade only when you want to trade live.
          </p>

          {/* Toggle */}
          <div className="mt-8 inline-flex items-center gap-3 bg-white border border-slate-200 rounded-full p-1 shadow-sm">
            <button
              onClick={() => setAnnual(false)}
              className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-all ${
                !annual ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setAnnual(true)}
              className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-all flex items-center gap-1.5 ${
                annual ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Annual
              <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full font-bold">
                2 months free
              </span>
            </button>
          </div>
        </motion.div>

        {/* Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-stretch">
          {plans.map((plan, i) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className={`relative rounded-2xl border p-8 flex flex-col ${
                plan.highlight
                  ? 'border-blue-500 bg-white shadow-xl shadow-blue-100 ring-2 ring-blue-500 ring-offset-2'
                  : 'border-slate-200 bg-white shadow-card'
              }`}
            >
              {plan.highlight && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                  <span className="bg-gradient-to-r from-blue-600 to-violet-600 text-white text-[10px] font-bold px-3 py-1 rounded-full flex items-center gap-1">
                    <Zap className="w-3 h-3" /> Most Popular
                  </span>
                </div>
              )}

              <div className="mb-6">
                <h3 className="text-lg font-black text-slate-900">{plan.name}</h3>
                <p className="mt-1 text-sm text-slate-500">{plan.description}</p>

                <div className="mt-4 flex items-end gap-1">
                  {plan.monthly === 0 ? (
                    <span className="text-4xl font-black text-slate-900">Free</span>
                  ) : (
                    <>
                      <span className="text-4xl font-black text-slate-900">
                        ₹{(annual ? plan.annual / 10 : plan.monthly).toLocaleString('en-IN')}
                      </span>
                      <span className="text-slate-400 text-sm mb-1">/mo</span>
                    </>
                  )}
                </div>
                {annual && plan.annual > 0 && (
                  <p className="mt-1 text-xs text-green-600 font-semibold">
                    Billed ₹{plan.annual.toLocaleString('en-IN')}/yr · Save ₹{(plan.monthly * 2).toLocaleString('en-IN')}
                  </p>
                )}
              </div>

              {/* CTA */}
              <button
                className={`w-full py-3 rounded-xl text-sm font-bold transition-all duration-200 ${plan.ctaStyle}`}
                onClick={() => alert('Auth coming soon — stay tuned!')}
              >
                {plan.cta}
              </button>

              {/* Feature list */}
              <ul className="mt-6 space-y-2.5 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-slate-700">
                    <Check className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                    {f}
                  </li>
                ))}
                {plan.missing.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-slate-400 line-through">
                    <span className="w-4 h-4 mt-0.5 flex-shrink-0 text-slate-300">✕</span>
                    {f}
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>

        <p className="mt-8 text-center text-xs text-slate-400">
          All prices in INR inclusive of GST · Cancel anytime · Razorpay / UPI accepted
        </p>
      </div>
    </section>
  )
}

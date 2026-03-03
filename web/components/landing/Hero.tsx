'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Play, Shield, Zap, TrendingUp } from 'lucide-react'
import { regimeClass, regimeDotClass, regimeLabel } from '@/lib/utils'

interface BotState {
  symbol: string
  regime: string
  confidence: number
  trade_count: number
}

const MINI_COINS = ['BTC', 'ETH', 'SOL', 'BNB', 'AVAX', 'MATIC']

export default function Hero() {
  const [state, setState] = useState<BotState | null>(null)

  useEffect(() => {
    fetch('/api/state')
      .then((r) => r.json())
      .then((d) => setState(d))
      .catch(() => {})
  }, [])

  const regime = state?.regime ?? 'BULLISH'
  const confidence = state?.confidence ?? 0.92
  const confPct = Math.round(confidence * 100)

  return (
    <section className="relative min-h-screen flex items-center pt-16 overflow-hidden bg-gradient-radial from-slate-50 via-blue-50/30 to-slate-100">
      {/* Background grid */}
      <div className="absolute inset-0 bg-grid opacity-60 pointer-events-none" />

      {/* Radial glow */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-blue-400/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 grid grid-cols-1 lg:grid-cols-5 gap-12 items-center">
        {/* Left — text (60%) */}
        <div className="lg:col-span-3">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-xs font-semibold mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
              AI-Powered Regime Detection — Live Now
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-slate-900 leading-tight tracking-tight">
              Trade Crypto with{' '}
              <span className="text-gradient">Machine Intelligence</span>
            </h1>

            <p className="mt-5 text-lg text-slate-600 leading-relaxed max-w-xl">
              SENTINEL AI detects <strong>Bull, Bear, Chop &amp; Crash</strong> regimes in real time
              — and trades automatically. Built for Indian markets. Connected to CoinDCX &amp; Binance.
            </p>

            {/* CTAs */}
            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <a
                href="/dashboard"
                className="inline-flex items-center justify-center gap-2 px-6 py-3.5 text-sm font-bold text-white bg-gradient-to-r from-blue-500 to-blue-700 rounded-xl shadow-lg hover:shadow-xl hover:from-blue-600 hover:to-blue-800 transition-all"
              >
                Start for Free
                <ArrowRight className="w-4 h-4" />
              </a>
              <button className="inline-flex items-center justify-center gap-2 px-6 py-3.5 text-sm font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-all shadow-sm">
                <Play className="w-4 h-4 text-blue-500 fill-blue-500" />
                Watch Demo
              </button>
            </div>

            {/* Trust row */}
            <div className="mt-6 flex flex-wrap items-center gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5 text-green-500" />
                No credit card
              </span>
              <span className="flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-blue-500" />
                Paper trading free
              </span>
              <span className="flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-purple-500" />
                CoinDCX + Binance
              </span>
            </div>
          </motion.div>
        </div>

        {/* Right — live regime card (40%) */}
        <div className="lg:col-span-2 flex justify-center lg:justify-end">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="animate-float w-full max-w-sm"
          >
            <div className="bg-white rounded-2xl shadow-2xl border border-slate-200/80 p-5 space-y-4">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Live Signal</div>
                  <div className="text-lg font-black text-slate-900">{state?.symbol?.replace('USDT', '') ?? 'BTC'} / USDT</div>
                </div>
                <div className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wide ${regimeClass(regime)}`}>
                  {regimeLabel(regime)}
                </div>
              </div>

              {/* Confidence bar */}
              <div>
                <div className="flex justify-between text-xs font-medium mb-1.5">
                  <span className="text-slate-500">AI Confidence</span>
                  <span className="text-slate-900 font-bold">{confPct}%</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-blue-400 to-blue-600 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${confPct}%` }}
                    transition={{ duration: 1, delay: 0.4 }}
                  />
                </div>
              </div>

              {/* Mini heatmap */}
              <div>
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Top Coins</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {MINI_COINS.map((coin, i) => (
                    <motion.div
                      key={coin}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.3 + i * 0.06 }}
                      className="bg-slate-50 rounded-lg p-2 text-center"
                    >
                      <div className="text-[11px] font-bold text-slate-700">{coin}</div>
                      <div className={`mt-0.5 w-2 h-2 rounded-full mx-auto ${i % 3 === 0 ? 'bg-green-400' : i % 3 === 1 ? 'bg-red-400' : 'bg-amber-400'}`} />
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* Footer */}
              <div className="pt-2 border-t border-slate-100 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-xs text-slate-500 font-medium">Bot running · updated every 5 min</span>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}

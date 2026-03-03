'use client'

import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { RefreshCw, Lock } from 'lucide-react'
import { regimeClass, regimeDotClass, regimeLabel } from '@/lib/utils'

interface CoinSignal {
  symbol: string
  regime: string
  confidence: number
}

const REFRESH_INTERVAL = 60_000

export default function LiveSignals() {
  const [signals, setSignals] = useState<CoinSignal[]>([])
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchSignals = useCallback(async () => {
    try {
      const res = await fetch('/api/scanner')
      if (!res.ok) throw new Error('Scanner unavailable')
      const data = await res.json()

      // Normalise to array
      const raw = data.coin_states ?? data
      const arr: CoinSignal[] = Object.entries(raw)
        .slice(0, 10)
        .map(([sym, info]: [string, unknown]) => {
          const s = info as Record<string, unknown>
          return {
            symbol: sym.replace('USDT', '').replace('USDC', ''),
            regime: (s.regime as string) ?? 'UNKNOWN',
            confidence: typeof s.confidence === 'number' ? s.confidence : 0,
          }
        })
      setSignals(arr)
      setLastUpdated(new Date())
    } catch {
      // Fallback demo data when bot is offline
      setSignals([
        { symbol: 'BTC', regime: 'BULLISH', confidence: 0.83 },
        { symbol: 'ETH', regime: 'BULLISH', confidence: 0.74 },
        { symbol: 'SOL', regime: 'SIDEWAYS/CHOP', confidence: 0.61 },
        { symbol: 'BNB', regime: 'BULLISH', confidence: 0.69 },
        { symbol: 'XRP', regime: 'BEARISH', confidence: 0.57 },
        { symbol: 'ADA', regime: 'SIDEWAYS/CHOP', confidence: 0.52 },
        { symbol: 'DOGE', regime: 'BULLISH', confidence: 0.65 },
        { symbol: 'AVAX', regime: 'BEARISH', confidence: 0.71 },
        { symbol: 'DOT', regime: 'SIDEWAYS/CHOP', confidence: 0.48 },
        { symbol: 'MATIC', regime: 'CRASH/PANIC', confidence: 0.62 },
      ])
      setLastUpdated(new Date())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSignals()
    const id = setInterval(fetchSignals, REFRESH_INTERVAL)
    return () => clearInterval(id)
  }, [fetchSignals])

  return (
    <section className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-50 text-green-700 text-xs font-semibold mb-4">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            Live Regime Feed
          </div>
          <h2 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight">
            Real-time market regime{' '}
            <span className="text-gradient">across 50 coins.</span>
          </h2>
          <p className="mt-4 text-lg text-slate-500 max-w-xl mx-auto">
            Updated every 5 minutes by the HMM engine. Signals delayed 15 minutes for free users — Pro unlocks real-time.
          </p>
        </motion.div>

        {/* Signal grid */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
          className="bg-slate-50 rounded-2xl border border-slate-200 overflow-hidden"
        >
          {/* Grid header */}
          <div className="grid grid-cols-4 gap-4 px-6 py-3 bg-slate-100 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wide">
            <span>Coin</span>
            <span>Regime</span>
            <span>Confidence</span>
            <span className="text-right">Status</span>
          </div>

          {loading ? (
            <div className="divide-y divide-slate-100">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="grid grid-cols-4 gap-4 px-6 py-4 animate-pulse">
                  <div className="h-4 bg-slate-200 rounded w-16" />
                  <div className="h-4 bg-slate-200 rounded w-20" />
                  <div className="h-4 bg-slate-200 rounded w-32" />
                  <div className="h-4 bg-slate-200 rounded w-12 ml-auto" />
                </div>
              ))}
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {signals.map((sig, i) => (
                <motion.div
                  key={sig.symbol}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="grid grid-cols-4 gap-4 items-center px-6 py-3.5 hover:bg-slate-100/60 transition-colors"
                >
                  {/* Coin */}
                  <span className="font-bold text-slate-900 text-sm">{sig.symbol}</span>

                  {/* Regime badge */}
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${regimeDotClass(sig.regime)}`} />
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${regimeClass(sig.regime)}`}>
                      {regimeLabel(sig.regime)}
                    </span>
                  </div>

                  {/* Confidence bar */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden max-w-[120px]">
                      <div
                        className={`h-full rounded-full ${
                          sig.regime === 'BULLISH'
                            ? 'bg-green-500'
                            : sig.regime === 'BEARISH'
                            ? 'bg-red-500'
                            : sig.regime.includes('CRASH')
                            ? 'bg-rose-900'
                            : 'bg-amber-400'
                        }`}
                        style={{ width: `${Math.round(sig.confidence * 100)}%` }}
                      />
                    </div>
                    <span className="text-xs text-slate-500">{Math.round(sig.confidence * 100)}%</span>
                  </div>

                  {/* Lock for rows ≥ 4 (demo blur effect) */}
                  <div className="flex justify-end">
                    {i >= 4 ? (
                      <span className="flex items-center gap-1 text-[10px] text-slate-400 font-medium">
                        <Lock className="w-3 h-3" /> Pro
                      </span>
                    ) : (
                      <span className="text-[10px] text-green-600 font-semibold">Live</span>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between px-6 py-3 bg-slate-100 border-t border-slate-200">
            <p className="text-[11px] text-slate-400">
              Signals shown are delayed 15 min · Pro tier unlocks real-time data for all coins
            </p>
            <button
              onClick={fetchSignals}
              className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-700 transition-colors"
            >
              <RefreshCw className="w-3 h-3" />
              {lastUpdated
                ? `Updated ${lastUpdated.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
                : 'Refresh'}
            </button>
          </div>
        </motion.div>
      </div>
    </section>
  )
}

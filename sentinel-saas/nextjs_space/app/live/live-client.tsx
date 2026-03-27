'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Header } from '@/components/header';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp, TrendingDown, Activity, Zap, DollarSign,
  Target, Shield, RefreshCw, Wifi, WifiOff, AlertTriangle
} from 'lucide-react';

// ──────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────
interface LiveTrade {
  id: string;
  trade_id?: string;
  symbol: string;
  side: string;
  leverage: number;
  capital: number;
  entry_price: number;
  current_price?: number | null;
  stop_loss: number;
  take_profit: number;
  unrealized_pnl?: number;
  entry_time: string;
  bot_name?: string;
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────
const sign = (v: number) => (v >= 0 ? '+' : '');
const isLong = (t: LiveTrade) => {
  const s = (t.side || '').toLowerCase();
  return s === 'buy' || s === 'long';
};
const calcPnl = (t: LiveTrade, ltp: number) => {
  const entry = t.entry_price;
  if (!entry || entry === 0) return { pnl: 0, pct: 0 };
  const dir = isLong(t) ? 1 : -1;
  const pnl = ((ltp - entry) / entry) * dir * t.leverage * t.capital;
  const pct = pnl / t.capital * 100;
  return { pnl: Math.round(pnl * 100) / 100, pct: Math.round(pct * 10) / 10 };
};
const fmtPrice = (v: number) => {
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 1 });
  if (v >= 1) return v.toFixed(3);
  return v.toFixed(5);
};
const fmtTime = (iso: string) => {
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diff = Math.floor((now - d.getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m ago`;
    return d.toLocaleDateString();
  } catch { return '—'; }
};
const pnlColor = (v: number) => v > 0 ? '#22C55E' : v < 0 ? '#EF4444' : '#9CA3AF';

// ──────────────────────────────────────────────────────────────
// Live Trade Card
// ──────────────────────────────────────────────────────────────
function TradeCard({ trade, ltp }: { trade: LiveTrade; ltp: number | null }) {
  const price = ltp ?? trade.current_price ?? trade.entry_price;
  const { pnl, pct } = calcPnl(trade, price);
  const long = isLong(trade);
  const slDist = long ? ((trade.stop_loss - price) / price) * 100 : ((price - trade.stop_loss) / price) * 100;
  const tpDist = long ? ((trade.take_profit - price) / price) * 100 : ((price - trade.take_profit) / price) * 100;
  const coin = trade.symbol.replace('USDT', '');

  // Risk gauge (distance from entry to SL / entry to TP)
  const entryToSl = Math.abs((trade.entry_price - trade.stop_loss) / trade.entry_price) * 100;
  const entryToTp = Math.abs((trade.take_profit - trade.entry_price) / trade.entry_price) * 100;
  const totalRange = entryToSl + entryToTp;
  const progressToTp = totalRange > 0 ? (Math.abs((price - trade.entry_price) / trade.entry_price) * 100 / totalRange) * 100 : 0;
  const clampedProg = Math.max(0, Math.min(100, progressToTp));

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      style={{
        background: 'var(--color-surface)',
        border: `1px solid ${pnl > 0 ? 'rgba(34,197,94,0.3)' : pnl < 0 ? 'rgba(239,68,68,0.3)' : 'var(--color-border)'}`,
        borderRadius: 18,
        padding: '18px 20px',
        position: 'relative',
        overflow: 'hidden',
        boxShadow: pnl > 0
          ? '0 0 30px rgba(34,197,94,0.12), 0 4px 20px rgba(0,0,0,0.3)'
          : pnl < 0
          ? '0 0 30px rgba(239,68,68,0.1), 0 4px 20px rgba(0,0,0,0.3)'
          : '0 4px 20px rgba(0,0,0,0.3)',
      }}
      whileHover={{ translateY: -2 }}
    >
      {/* Top stripe */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: pnl > 0
          ? 'linear-gradient(90deg, transparent, #22C55E, transparent)'
          : pnl < 0
          ? 'linear-gradient(90deg, transparent, #EF4444, transparent)'
          : 'linear-gradient(90deg, transparent, var(--color-primary), transparent)',
      }} />

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Coin badge */}
          <div style={{
            width: 40, height: 40, borderRadius: 12,
            background: long ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
            border: `1px solid ${long ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 900, color: long ? '#22C55E' : '#EF4444',
            fontFamily: 'var(--font-mono, monospace)',
          }}>
            {coin.slice(0, 3)}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--color-text)' }}>{coin}</span>
              <span style={{
                fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 5,
                background: long ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                color: long ? '#22C55E' : '#EF4444',
                border: `1px solid ${long ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
              }}>
                {long ? 'LONG' : 'SHORT'}
              </span>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5,
                background: 'rgba(239,68,68,0.1)',
                color: '#EF4444',
                border: '1px solid rgba(239,68,68,0.2)',
              }}>
                {trade.leverage}×
              </span>
            </div>
            <div style={{ fontSize: 10, color: 'var(--color-text-secondary)', marginTop: 2 }}>
              {trade.bot_name || 'Live Engine'} · {fmtTime(trade.entry_time)}
            </div>
          </div>
        </div>

        {/* Live PnL badge */}
        <div style={{
          textAlign: 'right',
          padding: '8px 12px', borderRadius: 10,
          background: pnl > 0 ? 'rgba(34,197,94,0.1)' : pnl < 0 ? 'rgba(239,68,68,0.1)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${pnl >= 0 ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
        }}>
          <div style={{
            fontSize: 18, fontWeight: 900,
            fontFamily: 'var(--font-mono, monospace)',
            color: pnlColor(pnl),
            textShadow: `0 0 10px ${pnlColor(pnl)}44`,
          }}>
            {sign(pnl)}${Math.abs(pnl).toFixed(2)}
          </div>
          <div style={{
            fontSize: 11, fontWeight: 700, color: pnlColor(pct),
            fontFamily: 'monospace',
          }}>
            {sign(pct)}{Math.abs(pct).toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Price row */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
        gap: 10, marginBottom: 14,
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 }}>
            Entry
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)', fontFamily: 'monospace' }}>
            {fmtPrice(trade.entry_price)}
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 }}>
            LTP
          </div>
          <div style={{ fontSize: 14, fontWeight: 900, color: pnlColor(pnl), fontFamily: 'monospace' }}>
            {ltp ? fmtPrice(ltp) : '—'}
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 }}>
            Capital
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)', fontFamily: 'monospace' }}>
            ${trade.capital}
          </div>
        </div>
      </div>

      {/* SL / TP */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
        <div style={{
          padding: '8px 10px', borderRadius: 10,
          background: 'rgba(239,68,68,0.06)',
          border: '1px solid rgba(239,68,68,0.15)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
            <Shield size={10} style={{ color: '#EF4444' }} />
            <span style={{ fontSize: 9, fontWeight: 700, color: '#EF4444', textTransform: 'uppercase', letterSpacing: 1 }}>Stop Loss</span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#EF4444', fontFamily: 'monospace' }}>
            {fmtPrice(trade.stop_loss)}
          </div>
          <div style={{ fontSize: 9, color: '#EF444480', marginTop: 1 }}>
            {slDist >= 0 ? `${slDist.toFixed(2)}% away` : `${Math.abs(slDist).toFixed(2)}% breached`}
          </div>
        </div>
        <div style={{
          padding: '8px 10px', borderRadius: 10,
          background: 'rgba(34,197,94,0.06)',
          border: '1px solid rgba(34,197,94,0.15)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
            <Target size={10} style={{ color: '#22C55E' }} />
            <span style={{ fontSize: 9, fontWeight: 700, color: '#22C55E', textTransform: 'uppercase', letterSpacing: 1 }}>Take Profit</span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#22C55E', fontFamily: 'monospace' }}>
            {fmtPrice(trade.take_profit)}
          </div>
          <div style={{ fontSize: 9, color: '#22C55E80', marginTop: 1 }}>
            {tpDist >= 0 ? `${tpDist.toFixed(2)}% to target` : 'Target reached'}
          </div>
        </div>
      </div>

      {/* Progress bar: SL ← entry → TP */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 8, color: '#EF4444', fontWeight: 700 }}>SL</span>
          <span style={{ fontSize: 8, color: 'var(--color-text-secondary)', fontWeight: 600 }}>ENTRY</span>
          <span style={{ fontSize: 8, color: '#22C55E', fontWeight: 700 }}>TP</span>
        </div>
        <div style={{ height: 6, borderRadius: 6, background: 'var(--color-border)', position: 'relative', overflow: 'hidden' }}>
          {/* Entry marker at 50% */}
          <div style={{
            position: 'absolute', left: '50%', top: 0, bottom: 0, width: 2,
            background: 'var(--color-text-secondary)', transform: 'translateX(-50%)',
          }} />
          {/* Price fill */}
          <div style={{
            height: '100%', borderRadius: 6,
            width: `${long ? (50 + clampedProg / 2) : (50 - clampedProg / 2)}%`,
            background: pnl >= 0
              ? 'linear-gradient(90deg, transparent 50%, #22C55E 100%)'
              : 'linear-gradient(90deg, #EF4444 0%, transparent 50%)',
            transition: 'width 0.5s ease',
            minWidth: 0,
          }} />
        </div>
      </div>
    </motion.div>
  );
}

// ──────────────────────────────────────────────────────────────
// Main Page
// ──────────────────────────────────────────────────────────────
export function LiveClient() {
  const [trades, setTrades] = useState<LiveTrade[]>([]);
  const [ltpPrices, setLtpPrices] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [lastSync, setLastSync] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const fetchTrades = useCallback(async () => {
    try {
      const res = await fetch('/api/live-trades', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setTrades(data.trades || []);
        setLastSync(new Date().toLocaleTimeString());
      }
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTrades();
    const t = setInterval(fetchTrades, 5000);
    return () => clearInterval(t);
  }, [fetchTrades]);

  // Dynamic WebSocket subscription based on active symbols
  useEffect(() => {
    const symbols = [...new Set(trades.map(t => t.symbol.toLowerCase()))];
    if (symbols.length === 0) return;

    wsRef.current?.close();
    setWsStatus('connecting');

    const streams = symbols.map(s => `${s}@miniTicker`).join('/');
    const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
    wsRef.current = ws;

    ws.onopen = () => setWsStatus('connected');
    ws.onclose = () => setWsStatus('disconnected');
    ws.onerror = () => { setWsStatus('disconnected'); ws.close(); };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        const d = msg.data;
        if (d?.s && d?.c) {
          setLtpPrices(prev => ({ ...prev, [d.s]: parseFloat(d.c) }));
        }
      } catch {}
    };
    return () => ws.close();
  }, [trades.map(t => t.symbol).sort().join(',')]);

  // ── Summary Stats ──────────────────────────────────────────
  const totalUnrealized = trades.reduce((s, t) => {
    const ltp = ltpPrices[t.symbol] ?? t.current_price ?? t.entry_price;
    return s + calcPnl(t, ltp).pnl;
  }, 0);
  const totalCapital = trades.reduce((s, t) => s + t.capital, 0);
  const winning = trades.filter(t => calcPnl(t, ltpPrices[t.symbol] ?? t.entry_price).pnl > 0).length;

  return (
    <div style={{ minHeight: '100vh' }}>
      <Header />

      <main style={{ paddingTop: 96, paddingBottom: 48, paddingLeft: 16, paddingRight: 16 }}>
        <div style={{ maxWidth: 1400, margin: '0 auto' }}>

          {/* ── Hero Header ── */}
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            style={{ marginBottom: 24 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <div style={{
                    width: 10, height: 10, borderRadius: '50%',
                    background: wsStatus === 'connected' ? '#22C55E' : wsStatus === 'connecting' ? '#F59E0B' : '#EF4444',
                    boxShadow: `0 0 8px ${wsStatus === 'connected' ? '#22C55E' : wsStatus === 'connecting' ? '#F59E0B' : '#EF4444'}`,
                    animation: wsStatus === 'connected' ? 'pulse 2s ease-in-out infinite' : 'none',
                  }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-secondary)', letterSpacing: 2, textTransform: 'uppercase' }}>
                    {wsStatus === 'connected' ? 'Live Feed Active' : wsStatus === 'connecting' ? 'Connecting…' : 'Feed Offline'}
                  </span>
                </div>
                <h1 style={{ fontSize: 28, fontWeight: 900, color: 'var(--color-text)', margin: 0, letterSpacing: -0.5 }}>
                  Live Trades
                </h1>
                <p style={{ color: 'var(--color-text-secondary)', fontSize: 13, marginTop: 4 }}>
                  Real-time active live-mode positions with margin & PnL tracking
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {lastSync && (
                  <span style={{ fontSize: 11, color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>
                    Synced {lastSync}
                  </span>
                )}
                <button
                  onClick={fetchTrades}
                  style={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 10, padding: '8px 14px', cursor: 'pointer',
                    color: 'var(--color-text-secondary)',
                    display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600,
                  }}
                >
                  <RefreshCw size={13} /> Refresh
                </button>
              </div>
            </div>
          </motion.div>

          {/* ── Summary Strip ── */}
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
            style={{
              display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 14, marginBottom: 24,
            }}
          >
            {[
              {
                label: 'Open Positions',
                value: String(trades.length),
                icon: <Activity size={16} style={{ color: '#00E5FF' }} />,
                color: '#00E5FF',
              },
              {
                label: 'Unrealized PnL',
                value: `${sign(totalUnrealized)}$${Math.abs(totalUnrealized).toFixed(2)}`,
                icon: <DollarSign size={16} style={{ color: pnlColor(totalUnrealized) }} />,
                color: pnlColor(totalUnrealized),
              },
              {
                label: 'Capital Deployed',
                value: `$${totalCapital.toFixed(0)}`,
                icon: <Zap size={16} style={{ color: '#F59E0B' }} />,
                color: '#F59E0B',
              },
              {
                label: 'Positions in Profit',
                value: trades.length > 0 ? `${winning}/${trades.length}` : '—',
                icon: <TrendingUp size={16} style={{ color: '#22C55E' }} />,
                color: '#22C55E',
              },
            ].map(s => (
              <div key={s.label} style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 16, padding: '14px 18px',
                boxShadow: '0 2px 12px rgba(0,0,0,0.2)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  {s.icon}
                  <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: 1.2 }}>
                    {s.label}
                  </span>
                </div>
                <div style={{
                  fontSize: 22, fontWeight: 900,
                  fontFamily: 'var(--font-mono, monospace)',
                  color: s.color,
                  textShadow: `0 0 10px ${s.color}33`,
                }}>
                  {s.value}
                </div>
              </div>
            ))}
          </motion.div>

          {/* ── Trade Cards Grid ── */}
          {loading ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              {[1, 2, 3].map(i => (
                <div key={i} style={{
                  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                  borderRadius: 18, height: 280,
                  animation: 'pulse 1.5s ease-in-out infinite',
                }} />
              ))}
            </div>
          ) : trades.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 22, padding: '80px 40px',
                textAlign: 'center',
              }}
            >
              <AlertTriangle size={40} style={{ color: '#F59E0B', margin: '0 auto 16px' }} />
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text)', marginBottom: 8 }}>
                No Live Trades Active
              </div>
              <div style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
                Live mode trades will appear here in real-time once the engine deploys them.
              </div>
            </motion.div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              <AnimatePresence mode="popLayout">
                {trades.map(t => (
                  <TradeCard
                    key={t.id}
                    trade={t}
                    ltp={ltpPrices[t.symbol] ?? null}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}

'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TrendingUp, TrendingDown, RefreshCw, Zap, Brain } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────
interface TickerData {
  symbol: string;
  display: string;
  price: number;
  change_pct: number;
  open_price?: number;
  high_24h?: number;
  low_24h?: number;
}

interface MarketStructureData {
  timestamp: string | null;
  tickers: TickerData[];
  llm_summary: string | null;
  timeframe: string;
}

// ── Constants ──────────────────────────────────────────────────
const LIVE_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'AVAXUSDT'];

const COIN_META: Record<string, { icon: string; color: string }> = {
  BTC:  { icon: '₿',  color: '#F59E0B' },
  ETH:  { icon: 'Ξ',  color: '#818CF8' },
  SOL:  { icon: '◎',  color: '#14F195' },
  AVAX: { icon: '🔺', color: '#E84142' },
};

function fmtPrice(price: number, sym: string): string {
  if (sym === 'BTC') return price.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (price >= 1000) return price.toLocaleString('en-US', { maximumFractionDigits: 1 });
  if (price >= 1) return price.toFixed(2);
  return price.toFixed(4);
}

// ── Inline ticker chip ──────────────────────────────────────────
function TickerChip({
  ticker,
  livePrice,
}: {
  ticker: TickerData;
  livePrice: number | null;
}) {
  const meta = COIN_META[ticker.display] ?? { icon: '◈', color: '#00E5FF' };
  const price = livePrice ?? ticker.price;

  // UTC 00:00 change
  const openPx = ticker.open_price ?? 0;
  const utcChange = openPx > 0 ? ((price - openPx) / openPx) * 100 : ticker.change_pct;
  const isUp = utcChange >= 0;

  // Flash on price change
  const prevRef = useRef(price);
  const [flash, setFlash] = useState<'up' | 'dn' | null>(null);
  useEffect(() => {
    if (livePrice !== null && Math.abs(livePrice - prevRef.current) > 0.0001) {
      setFlash(livePrice > prevRef.current ? 'up' : 'dn');
      prevRef.current = livePrice;
      const t = setTimeout(() => setFlash(null), 500);
      return () => clearTimeout(t);
    }
  }, [livePrice]);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 12px',
      background: flash === 'up'
        ? 'rgba(34,197,94,0.06)'
        : flash === 'dn'
        ? 'rgba(239,68,68,0.06)'
        : 'var(--color-surface-light)',
      borderRadius: 10,
      border: `1px solid ${meta.color}20`,
      transition: 'background 0.4s ease',
      flex: '1 1 0',
      minWidth: 0,
    }}>
      {/* Icon + name */}
      <div style={{
        fontSize: 14, color: meta.color, fontWeight: 800, lineHeight: 1,
        flexShrink: 0,
      }}>
        {ticker.display}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Price */}
        <div style={{
          fontSize: 13, fontWeight: 800,
          fontFamily: 'var(--font-mono, monospace)',
          color: flash === 'up' ? '#22C55E' : flash === 'dn' ? '#EF4444' : 'var(--color-text)',
          whiteSpace: 'nowrap',
          transition: 'color 0.3s ease',
        }}>
          ${fmtPrice(price, ticker.display)}
        </div>

        {/* 24h change */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 3, marginTop: 1,
        }}>
          {isUp
            ? <TrendingUp size={9} style={{ color: '#22C55E', flexShrink: 0 }} />
            : <TrendingDown size={9} style={{ color: '#EF4444', flexShrink: 0 }} />}
          <span style={{
            fontSize: 10, fontWeight: 700,
            color: isUp ? '#22C55E' : '#EF4444',
            fontFamily: 'monospace',
          }}>
            {isUp ? '+' : ''}{utcChange.toFixed(2)}%
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Main Panel ──────────────────────────────────────────────────
export function MarketStructurePanel() {
  const [data, setData] = useState<MarketStructureData | null>(null);
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const [summaryExpanded, setSummaryExpanded] = useState(true);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/market-structure', { cache: 'no-store' });
      if (res.ok) {
        const d = await res.json();
        setData(d);
        if (d.timestamp) setLastUpdate(d.timestamp);
      }
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 60_000);
    return () => clearInterval(t);
  }, []);

  // Binance WebSocket
  useEffect(() => {
    const streams = LIVE_SYMBOLS.map(s => `${s.toLowerCase()}@miniTicker`).join('/');
    const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        const d = msg.data;
        if (d?.s && d?.c) {
          setLivePrices(prev => ({ ...prev, [d.s]: parseFloat(d.c) }));
        }
      } catch {}
    };
    ws.onerror = () => ws.close();
    return () => ws.close();
  }, []);

  const fmtAgo = (iso: string | null) => {
    if (!iso) return '';
    try {
      const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
      if (diff < 60) return `${diff}s ago`;
      if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
      return `${Math.floor(diff / 3600)}h ago`;
    } catch { return ''; }
  };

  // Tickers: from API or WS-only fallbacks
  const tickers: TickerData[] = data?.tickers?.length
    ? data.tickers
    : LIVE_SYMBOLS.map(sym => ({
        symbol: sym,
        display: sym.replace('USDT', ''),
        price: livePrices[sym] ?? 0,
        change_pct: 0,
      }));

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 18,
        overflow: 'hidden',
        boxShadow: '0 4px 24px rgba(0,0,0,0.35)',
        marginBottom: 20,
      }}
    >
      {/* Top colour bar */}
      <div style={{
        height: 2,
        background: 'linear-gradient(90deg, #F59E0B60, #818CF860, #14F19560, #E8414260)',
      }} />

      {/* One wide row: header + tickers + insight */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '140px 1fr 1fr',
        gap: 0,
        alignItems: 'stretch',
        minHeight: 76,
      }}>

        {/* ── Left: Label block ── */}
        <div style={{
          borderRight: '1px solid var(--color-border)',
          padding: '10px 14px',
          display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Zap size={12} style={{ color: '#F59E0B', flexShrink: 0 }} />
            <span style={{
              fontSize: 11, fontWeight: 800, color: '#F59E0B',
              letterSpacing: 0.5, textTransform: 'uppercase',
            }}>
              Markets
            </span>
          </div>
          <div style={{ fontSize: 9, color: 'var(--color-text-secondary)', letterSpacing: 1, textTransform: 'uppercase' }}>
            15-Min AI Analysis
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            {lastUpdate && (
              <span style={{ fontSize: 9, color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>
                {fmtAgo(lastUpdate)}
              </span>
            )}
            <button
              onClick={fetchData}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--color-text-secondary)', padding: 0, lineHeight: 1,
              }}
              title="Refresh"
            >
              <RefreshCw size={10} />
            </button>
          </div>
        </div>

        {/* ── Centre: 4 compact ticker chips ── */}
        <div style={{
          borderRight: '1px solid var(--color-border)',
          padding: '8px 12px',
          display: 'flex', gap: 8, alignItems: 'center',
        }}>
          {tickers.map(t => (
            <TickerChip
              key={t.symbol}
              ticker={t}
              livePrice={livePrices[t.symbol] ?? null}
            />
          ))}
        </div>

        {/* ── Right: AI Insight text ── */}
        <div style={{
          padding: '10px 14px',
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
          overflow: 'hidden',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5 }}>
            <Brain size={11} style={{ color: '#818CF8', flexShrink: 0 }} />
            <span style={{
              fontSize: 9, fontWeight: 700, color: '#818CF8',
              textTransform: 'uppercase', letterSpacing: 1.2,
            }}>
              GPT-4o Insight · 15m
            </span>
          </div>
          <div style={{
            fontSize: 11,
            lineHeight: 1.6,
            color: loading
              ? 'var(--color-text-secondary)'
              : data?.llm_summary
              ? 'var(--color-text)'
              : 'var(--color-text-secondary)',
            fontStyle: (loading || !data?.llm_summary) ? 'italic' : 'normal',
            display: '-webkit-box',
            WebkitLineClamp: 4,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}>
            {loading
              ? 'Loading AI market structure analysis…'
              : data?.llm_summary
              ? data.llm_summary
              : 'Analysis will appear after the next engine cycle (~15 min).'}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

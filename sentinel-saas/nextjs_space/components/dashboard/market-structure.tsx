'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus, RefreshCw, ChevronDown, ChevronUp, Zap } from 'lucide-react';

interface TickerData {
  symbol: string;
  display: string;
  price: number;
  change_pct: number;
  open_price?: number;
  high_24h?: number;
  low_24h?: number;
  volume_usd?: number;
}

interface MarketStructureData {
  timestamp: string | null;
  tickers: TickerData[];
  llm_summary: string | null;
  timeframe: string;
}

const LIVE_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'AAVEUSDT'];

const TICKER_META: Record<string, { icon: string; color: string; glow: string }> = {
  BTC:  { icon: '₿',  color: '#F59E0B', glow: 'rgba(245,158,11,0.25)' },
  ETH:  { icon: 'Ξ',  color: '#818CF8', glow: 'rgba(129,140,248,0.25)' },
  SOL:  { icon: '◎',  color: '#14F195', glow: 'rgba(20,241,149,0.25)' },
  AAVE: { icon: '👻', color: '#B6509E', glow: 'rgba(182,80,158,0.25)' },
};

function formatPrice(price: number, sym: string): string {
  if (sym === 'BTC') return price.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (price >= 1000) return price.toLocaleString('en-US', { maximumFractionDigits: 1 });
  if (price >= 1) return price.toFixed(2);
  return price.toFixed(4);
}

function formatVol(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toFixed(0)}`;
}

function TickerCard({ ticker, livePrice }: { ticker: TickerData; livePrice: number | null }) {
  const meta = TICKER_META[ticker.display] || { icon: '◈', color: '#00E5FF', glow: 'rgba(0,229,255,0.2)' };
  const price = livePrice ?? ticker.price;
  // Compute change from 00:00 UTC open
  const openPx = ticker.open_price || 0;
  const utcChange = openPx > 0 ? ((price - openPx) / openPx) * 100 : ticker.change_pct;
  const isUp = utcChange >= 0;
  const prevPrice = useRef(price);
  const [flash, setFlash] = useState<null | 'up' | 'down'>(null);

  useEffect(() => {
    if (livePrice !== null && Math.abs(livePrice - prevPrice.current) > 0.0001) {
      setFlash(livePrice > prevPrice.current ? 'up' : 'down');
      prevPrice.current = livePrice;
      const t = setTimeout(() => setFlash(null), 600);
      return () => clearTimeout(t);
    }
  }, [livePrice]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        background: 'var(--color-surface)',
        border: `1px solid ${isUp ? meta.color + '30' : 'rgba(239,68,68,0.2)'}`,
        borderRadius: 16,
        padding: '16px 18px',
        position: 'relative',
        overflow: 'hidden',
        boxShadow: isUp
          ? `0 0 20px ${meta.glow}, 0 2px 12px rgba(0,0,0,0.3)`
          : '0 2px 12px rgba(0,0,0,0.3)',
        transition: 'box-shadow 0.3s ease',
      }}
      whileHover={{ scale: 1.02 }}
    >
      {/* Top accent bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: `linear-gradient(90deg, transparent, ${meta.color}88, transparent)`,
      }} />

      {/* Flash overlay */}
      <AnimatePresence>
        {flash && (
          <motion.div
            initial={{ opacity: 0.3 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            style={{
              position: 'absolute', inset: 0, borderRadius: 16,
              background: flash === 'up' ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
              pointerEvents: 'none',
            }}
          />
        )}
      </AnimatePresence>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 10,
            background: `${meta.color}18`,
            border: `1px solid ${meta.color}30`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 15, color: meta.color, fontWeight: 700,
          }}>
            {meta.icon}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--color-text)', letterSpacing: 0.3 }}>
              {ticker.display}
            </div>
            <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--color-text-secondary)', letterSpacing: 1.2, textTransform: 'uppercase' }}>
              /USDT
            </div>
          </div>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '3px 10px', borderRadius: 8,
          background: isUp ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
          border: `1px solid ${isUp ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
        }}>
          {isUp ? (
            <TrendingUp size={11} style={{ color: '#22C55E' }} />
          ) : (
            <TrendingDown size={11} style={{ color: '#EF4444' }} />
          )}
          <span style={{
            fontSize: 12, fontWeight: 800, fontFamily: 'var(--font-mono, monospace)',
            color: isUp ? '#22C55E' : '#EF4444',
          }}>
            {isUp ? '+' : ''}{utcChange.toFixed(2)}%
          </span>
        </div>
      </div>

      {/* Price */}
      <div style={{
        fontSize: 22, fontWeight: 900,
        fontFamily: 'var(--font-mono, monospace)',
        color: flash === 'up' ? '#22C55E' : flash === 'down' ? '#EF4444' : 'var(--color-text)',
        letterSpacing: -0.5,
        transition: 'color 0.3s ease',
        textShadow: flash ? (flash === 'up' ? '0 0 12px rgba(34,197,94,0.5)' : '0 0 12px rgba(239,68,68,0.5)') : 'none',
      }}>
        ${formatPrice(price, ticker.display)}
      </div>

      {/* Stats row */}
      <div style={{
        display: 'flex', gap: 12, marginTop: 10,
        paddingTop: 10, borderTop: '1px solid var(--color-border)',
      }}>
        {ticker.high_24h != null && (
          <div>
            <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: 1 }}>24H High</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#22C55E', fontFamily: 'monospace' }}>
              ${formatPrice(ticker.high_24h, ticker.display)}
            </div>
          </div>
        )}
        {ticker.low_24h != null && (
          <div>
            <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: 1 }}>24H Low</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#EF4444', fontFamily: 'monospace' }}>
              ${formatPrice(ticker.low_24h, ticker.display)}
            </div>
          </div>
        )}
        {ticker.volume_usd != null && ticker.volume_usd > 0 && (
          <div style={{ marginLeft: 'auto' }}>
            <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: 1 }}>Volume</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>
              {formatVol(ticker.volume_usd)}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}


export function MarketStructurePanel() {
  const [data, setData] = useState<MarketStructureData | null>(null);
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);

  // Fetch structured data (LLM summary + 24h stats) from our API
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
    const t = setInterval(fetchData, 60_000); // refresh summary every 60s
    return () => clearInterval(t);
  }, []);

  // Binance WebSocket for live prices
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

  const formatTimeAgo = (iso: string | null) => {
    if (!iso) return '';
    try {
      const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
      if (diff < 60) return `${diff}s ago`;
      if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
      return `${Math.floor(diff / 3600)}h ago`;
    } catch { return ''; }
  };

  // Use live prices from WS, fall back to API data tickers
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
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 22,
        overflow: 'hidden',
        marginBottom: 24,
        boxShadow: '0 4px 30px rgba(0,0,0,0.4)',
      }}
    >
      {/* Top accent line */}
      <div style={{
        height: 2,
        background: 'linear-gradient(90deg, transparent, #F59E0B60, #818CF860, #14F19560, #B6509E60, transparent)',
      }} />

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 20px 12px',
        borderBottom: '1px solid var(--color-border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: 'rgba(245,158,11,0.15)',
            border: '1px solid rgba(245,158,11,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Zap size={14} style={{ color: '#F59E0B' }} />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--color-text)', letterSpacing: 0.5 }}>
              Market Structure
            </div>
            <div style={{ fontSize: 9, color: 'var(--color-text-secondary)', letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 600 }}>
              15-Minute AI Analysis • BTC · ETH · SOL · AAVE
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {lastUpdate && (
            <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>
              {formatTimeAgo(lastUpdate)}
            </span>
          )}
          <button
            onClick={fetchData}
            style={{
              background: 'var(--color-surface-light)',
              border: '1px solid var(--color-border)',
              borderRadius: 8, padding: '5px 8px', cursor: 'pointer',
              color: 'var(--color-text-secondary)',
            }}
            title="Refresh"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {/* Ticker Grid */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 16, padding: '16px 20px',
      }}>
        {tickers.map(t => (
          <TickerCard
            key={t.symbol}
            ticker={t}
            livePrice={livePrices[t.symbol] ?? null}
          />
        ))}
      </div>

      {/* LLM Summary */}
      {(data?.llm_summary || loading) && (
        <div style={{
          borderTop: '1px solid var(--color-border)',
          padding: '0 20px',
        }}>
          {/* Collapse toggle */}
          <button
            onClick={() => setExpanded(x => !x)}
            style={{
              width: '100%', background: 'none', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 0', color: 'var(--color-text-secondary)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#F59E0B', boxShadow: '0 0 6px #F59E0B' }} />
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', color: '#F59E0B' }}>
                AI Market Structure Briefing
              </span>
            </div>
            {expanded ? (
              <ChevronUp size={14} style={{ color: 'var(--color-text-secondary)' }} />
            ) : (
              <ChevronDown size={14} style={{ color: 'var(--color-text-secondary)' }} />
            )}
          </button>

          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25 }}
                style={{ overflow: 'hidden' }}
              >
                <div style={{
                  padding: '0 0 18px',
                  fontSize: 13,
                  lineHeight: 1.75,
                  color: loading ? 'var(--color-text-secondary)' : 'var(--color-text)',
                  fontStyle: loading ? 'italic' : 'normal',
                  borderLeft: '2px solid rgba(245,158,11,0.4)',
                  paddingLeft: 14,
                  marginBottom: 4,
                }}>
                  {loading ? 'Loading AI market structure analysis…' : data?.llm_summary}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
}

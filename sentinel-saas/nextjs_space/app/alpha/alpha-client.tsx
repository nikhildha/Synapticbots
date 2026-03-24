'use client';

/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  ALPHA MODULE — CLIENT UI                                           ║
 * ║  Polls /api/alpha every 15 seconds.                                 ║
 * ║  Shows: regime cards, portfolio summary, open trades, closed trades ║
 * ║                                                                     ║
 * ║  ISOLATION: reads ONLY from /api/alpha — never /api/trades,        ║
 * ║  /api/bots, or any main-engine endpoint.                            ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { useState, useEffect, useCallback } from 'react';
import { Header }   from '@/components/header';
import { motion }   from 'framer-motion';
import { TrendingUp, TrendingDown, Minus, RefreshCw, AlertTriangle } from 'lucide-react';

/* ═══ Types ═══════════════════════════════════════════════════════════════ */

interface RegimeInfo {
  regime: string;        // "BULL" | "BEAR"
  margin: number;
  passes_filter: boolean;
}

interface AlphaTrade {
  trade_id: string;
  symbol: string;
  side: string;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  be_trigger: number;
  be_activated: boolean;
  qty: number;
  margin_usdt: number;
  notional_usdt: number;
  regime: string;
  regime_margin: number;
  vol_zscore: number;
  atr_at_entry: number;
  opened_at: string;
  closed_at?: string;
  exit_price?: number;
  exit_reason?: string;
  net_pnl?: number;
  pnl_pct?: number;
  paper_mode: boolean;
  status: string;
}

interface Portfolio {
  openCount: number;
  closedCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  totalNetPnl: number;
  totalFees: number;
}

interface AlphaData {
  ok: boolean;
  cycle: number;
  lastRun: string | null;
  paperMode: boolean;
  regimeMap: Record<string, RegimeInfo | null>;
  openTrades: AlphaTrade[];
  closedTrades: AlphaTrade[];
  portfolio: Portfolio;
}

/* ═══ Constants ═══════════════════════════════════════════════════════════ */

const COINS = ['AAVEUSDT', 'SNXUSDT', 'COMPUSDT', 'BNBUSDT'];
const COIN_SHORT = (s: string) => s.replace('USDT', '');
const POLL_MS = 15_000;

/* ═══ Formatting ══════════════════════════════════════════════════════════ */

const fmt$    = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(2);
const fmtPct  = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
const fmtP    = (v: number) => v.toFixed(4);
const pnlColor = (v: number) => v > 0 ? '#22C55E' : v < 0 ? '#EF4444' : '#6B7280';

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function duration(open: string, close?: string): string {
  const end = close ? new Date(close) : new Date();
  const s = Math.floor((end.getTime() - new Date(open).getTime()) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/* ═══ Sub-components ══════════════════════════════════════════════════════ */

function RegimeCard({ symbol, info }: { symbol: string; info: RegimeInfo | null | undefined }) {
  const coin = COIN_SHORT(symbol);
  const regime = info?.regime ?? '—';
  const margin = info?.margin ?? 0;
  const passes = info?.passes_filter ?? false;

  const isBull = regime === 'BULL';
  const isBear = regime === 'BEAR';
  const borderColor = isBull ? '#22C55E' : isBear ? '#EF4444' : '#374151';
  const bgColor     = isBull ? 'rgba(34,197,94,0.08)' : isBear ? 'rgba(239,68,68,0.08)' : 'transparent';

  return (
    <div style={{
      border: `1px solid ${borderColor}`,
      background: bgColor,
      borderRadius: 12,
      padding: '16px 20px',
      minWidth: 140,
      flex: 1,
    }}>
      <div style={{ fontSize: 12, color: '#6B7280', fontWeight: 600, letterSpacing: '1px', marginBottom: 6 }}>
        {coin}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        {isBull && <TrendingUp size={18} color="#22C55E" />}
        {isBear && <TrendingDown size={18} color="#EF4444" />}
        {!isBull && !isBear && <Minus size={18} color="#6B7280" />}
        <span style={{ fontSize: 18, fontWeight: 700, color: borderColor }}>{regime}</span>
      </div>
      <div style={{ fontSize: 12, color: '#9CA3AF' }}>
        margin <span style={{ color: '#E5E7EB', fontWeight: 600 }}>{(margin * 100).toFixed(0)}%</span>
      </div>
      <div style={{ marginTop: 4, fontSize: 11 }}>
        {passes
          ? <span style={{ color: '#22C55E' }}>✓ filter passed</span>
          : <span style={{ color: '#6B7280' }}>· below threshold</span>}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={{
      background: 'var(--color-surface)',
      border: '1px solid var(--color-surface-light)',
      borderRadius: 12,
      padding: '16px 20px',
      flex: 1,
      minWidth: 120,
    }}>
      <div style={{ fontSize: 11, color: '#6B7280', fontWeight: 600, letterSpacing: '1px', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color ?? '#E5E7EB' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function ExitBadge({ reason }: { reason?: string }) {
  const colors: Record<string, string> = {
    TP:       '#22C55E',
    SL:       '#EF4444',
    BE_SL:    '#F0B90B',
    DIR_FLIP: '#00E5FF',
    MANUAL:   '#9CA3AF',
  };
  const labels: Record<string, string> = {
    TP: 'TP', SL: 'SL', BE_SL: 'BE SL', DIR_FLIP: 'FLIP', MANUAL: 'MANUAL',
  };
  const key = reason ?? '';
  const c = colors[key] ?? '#6B7280';
  return (
    <span style={{
      display: 'inline-block', padding: '2px 7px', borderRadius: 6,
      fontSize: 11, fontWeight: 700, color: c,
      border: `1px solid ${c}`, background: `${c}18`,
    }}>
      {labels[key] ?? key}
    </span>
  );
}

function OpenTradesTable({ trades }: { trades: AlphaTrade[] }) {
  if (trades.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '32px', color: '#6B7280', fontSize: 14 }}>
        No open trades — engine is monitoring for signals
      </div>
    );
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #1F2937' }}>
            {['ID', 'Symbol', 'Side', 'Entry', 'SL', 'TP', 'BE', 'Capital', 'Regime', 'vol_z', 'Opened', 'Duration'].map(h => (
              <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: '#6B7280', fontSize: 11, fontWeight: 600, letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trades.map(t => {
            const isLong = t.side === 'LONG';
            return (
              <tr key={t.trade_id} style={{ borderBottom: '1px solid #111827' }}>
                <td style={{ padding: '10px', color: '#F0B90B', fontFamily: 'monospace', fontSize: 12 }}>{t.trade_id}</td>
                <td style={{ padding: '10px', color: '#E5E7EB', fontWeight: 600 }}>{COIN_SHORT(t.symbol)}</td>
                <td style={{ padding: '10px' }}>
                  <span style={{ color: isLong ? '#22C55E' : '#EF4444', fontWeight: 700 }}>
                    {isLong ? '▲ LONG' : '▼ SHORT'}
                  </span>
                </td>
                <td style={{ padding: '10px', color: '#E5E7EB', fontFamily: 'monospace' }}>{fmtP(t.entry_price)}</td>
                <td style={{ padding: '10px', color: '#EF4444', fontFamily: 'monospace' }}>{fmtP(t.stop_loss)}</td>
                <td style={{ padding: '10px', color: '#22C55E', fontFamily: 'monospace' }}>{fmtP(t.take_profit)}</td>
                <td style={{ padding: '10px', color: t.be_activated ? '#F0B90B' : '#6B7280', fontSize: 12 }}>
                  {t.be_activated ? '🛡️ ON' : fmtP(t.be_trigger)}
                </td>
                <td style={{ padding: '10px', color: '#9CA3AF' }}>${t.margin_usdt}</td>
                <td style={{ padding: '10px', color: t.regime === 'BULL' ? '#22C55E' : '#EF4444', fontWeight: 600, fontSize: 12 }}>
                  {t.regime}
                </td>
                <td style={{ padding: '10px', color: '#9CA3AF' }}>{t.vol_zscore?.toFixed(2)}</td>
                <td style={{ padding: '10px', color: '#6B7280', fontSize: 12 }}>{timeAgo(t.opened_at)}</td>
                <td style={{ padding: '10px', color: '#9CA3AF', fontSize: 12 }}>{duration(t.opened_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ClosedTradesTable({ trades }: { trades: AlphaTrade[] }) {
  if (trades.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '32px', color: '#6B7280', fontSize: 14 }}>
        No closed trades yet
      </div>
    );
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #1F2937' }}>
            {['ID', 'Symbol', 'Side', 'Entry', 'Exit', 'P&L', 'P&L%', 'Reason', 'Duration', 'Closed'].map(h => (
              <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: '#6B7280', fontSize: 11, fontWeight: 600, letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trades.map(t => {
            const isLong = t.side === 'LONG';
            const pnl    = t.net_pnl ?? 0;
            return (
              <tr key={t.trade_id} style={{ borderBottom: '1px solid #111827' }}>
                <td style={{ padding: '10px', color: '#F0B90B', fontFamily: 'monospace', fontSize: 12 }}>{t.trade_id}</td>
                <td style={{ padding: '10px', color: '#E5E7EB', fontWeight: 600 }}>{COIN_SHORT(t.symbol)}</td>
                <td style={{ padding: '10px' }}>
                  <span style={{ color: isLong ? '#22C55E' : '#EF4444', fontWeight: 700 }}>
                    {isLong ? '▲ L' : '▼ S'}
                  </span>
                </td>
                <td style={{ padding: '10px', color: '#9CA3AF', fontFamily: 'monospace', fontSize: 12 }}>{fmtP(t.entry_price)}</td>
                <td style={{ padding: '10px', color: '#E5E7EB', fontFamily: 'monospace', fontSize: 12 }}>{t.exit_price ? fmtP(t.exit_price) : '—'}</td>
                <td style={{ padding: '10px', fontWeight: 700, fontFamily: 'monospace', color: pnlColor(pnl) }}>
                  {fmt$(pnl)}
                </td>
                <td style={{ padding: '10px', fontFamily: 'monospace', color: pnlColor(pnl) }}>
                  {fmtPct(t.pnl_pct ?? 0)}
                </td>
                <td style={{ padding: '10px' }}>
                  <ExitBadge reason={t.exit_reason} />
                </td>
                <td style={{ padding: '10px', color: '#9CA3AF', fontSize: 12 }}>
                  {t.closed_at ? duration(t.opened_at, t.closed_at) : '—'}
                </td>
                <td style={{ padding: '10px', color: '#6B7280', fontSize: 12 }}>{timeAgo(t.closed_at ?? null)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ═══ Main Component ══════════════════════════════════════════════════════ */

export function AlphaClient({ userName }: { userName: string }) {
  const [data, setData]       = useState<AlphaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/alpha', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
      setLastFetch(new Date());
    } catch (e: any) {
      setError(e.message ?? 'Failed to load Alpha data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, POLL_MS);
    return () => clearInterval(timer);
  }, [fetchData]);

  const p = data?.portfolio;
  const engineRunning = data ? (Date.now() - new Date(data.lastRun ?? 0).getTime()) < 30 * 60 * 1000 : false;

  return (
    <>
      <Header />
      <div style={{ minHeight: '100vh', background: 'var(--color-bg)', paddingTop: '90px', paddingBottom: '60px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 16px' }}>

          {/* ── Header bar ── */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h1 style={{ fontSize: 28, fontWeight: 800, color: '#F0B90B', letterSpacing: '-0.5px', marginBottom: 2, textShadow: '0 0 20px rgba(240,185,11,0.3)' }}>
                ⚡ Alpha Engine
              </h1>
              <div style={{ fontSize: 13, color: '#6B7280' }}>
                QUAD vol=1.5 · SL 3.5× · TP 9× · BE @3.0× · 25× flat · Bybit
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {data && (
                <span style={{
                  padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700,
                  background: data.paperMode ? 'rgba(0,229,255,0.1)' : 'rgba(239,68,68,0.1)',
                  border: `1px solid ${data.paperMode ? '#00E5FF' : '#EF4444'}`,
                  color: data.paperMode ? '#00E5FF' : '#EF4444',
                }}>
                  {data.paperMode ? '📄 PAPER' : '🔴 LIVE'}
                </span>
              )}
              {engineRunning
                ? <span style={{ padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: 'rgba(34,197,94,0.1)', border: '1px solid #22C55E', color: '#22C55E' }}>● ENGINE RUNNING</span>
                : <span style={{ padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: 'rgba(107,114,128,0.1)', border: '1px solid #374151', color: '#6B7280' }}>○ ENGINE IDLE</span>
              }
              <button
                onClick={fetchData}
                style={{ background: 'none', border: '1px solid #374151', borderRadius: 8, padding: '6px 10px', color: '#9CA3AF', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <RefreshCw size={14} /> <span style={{ fontSize: 12 }}>{lastFetch ? timeAgo(lastFetch.toISOString()) : '—'}</span>
              </button>
            </div>
          </div>

          {/* ── Engine not connected notice ── */}
          {!loading && !error && !engineRunning && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
              background: 'rgba(240,185,11,0.05)', border: '1px solid rgba(240,185,11,0.2)',
              borderRadius: 10, marginBottom: 24, fontSize: 13, color: '#D1D5DB',
            }}>
              <AlertTriangle size={16} color="#F0B90B" />
              Alpha engine has not run in the last 30 minutes — waiting for next cycle.
            </div>
          )}

          {/* ── Error state ── */}
          {error && (
            <div style={{ padding: '16px', background: 'rgba(239,68,68,0.1)', border: '1px solid #EF4444', borderRadius: 10, color: '#EF4444', marginBottom: 24, fontSize: 14 }}>
              Error loading Alpha data: {error}
            </div>
          )}

          {/* ── Skeleton ── */}
          {loading && (
            <div style={{ textAlign: 'center', padding: '60px', color: '#6B7280' }}>
              Loading Alpha data…
            </div>
          )}

          {data && !loading && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>

              {/* ── Regime row ── */}
              <section style={{ marginBottom: 28 }}>
                <h2 style={{ fontSize: 13, fontWeight: 600, color: '#6B7280', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 12 }}>
                  HMM Regime — 1h · Cycle #{data.cycle} · {data.lastRun ? timeAgo(data.lastRun) : 'never'}
                </h2>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {COINS.map(sym => (
                    <RegimeCard key={sym} symbol={sym} info={data.regimeMap[sym]} />
                  ))}
                </div>
              </section>

              {/* ── Portfolio stats ── */}
              <section style={{ marginBottom: 28 }}>
                <h2 style={{ fontSize: 13, fontWeight: 600, color: '#6B7280', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 12 }}>
                  Portfolio
                </h2>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <StatCard label="TOTAL P&L" value={`$${p!.totalNetPnl >= 0 ? '+' : ''}${p!.totalNetPnl.toFixed(2)}`} color={pnlColor(p!.totalNetPnl)} />
                  <StatCard label="WIN RATE" value={`${p!.winRate.toFixed(0)}%`} sub={`${p!.winCount}W / ${p!.lossCount}L`} color={p!.winRate >= 50 ? '#22C55E' : '#EF4444'} />
                  <StatCard label="OPEN" value={p!.openCount} sub="active trades" color="#00E5FF" />
                  <StatCard label="CLOSED" value={p!.closedCount} sub="total trades" />
                  <StatCard label="FEES PAID" value={`$${p!.totalFees.toFixed(2)}`} sub="round-trip" color="#6B7280" />
                </div>
              </section>

              {/* ── Open trades ── */}
              <section style={{ marginBottom: 28 }}>
                <div style={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-surface-light)',
                  borderRadius: 12, overflow: 'hidden',
                }}>
                  <div style={{ padding: '16px 20px', borderBottom: '1px solid #1F2937', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 style={{ fontSize: 15, fontWeight: 700, color: '#E5E7EB', margin: 0 }}>
                      Open Trades
                      <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 10, background: 'rgba(0,229,255,0.1)', color: '#00E5FF', fontSize: 12 }}>
                        {data.openTrades.length}
                      </span>
                    </h2>
                    <span style={{ fontSize: 11, color: '#6B7280' }}>auto-refresh 15s</span>
                  </div>
                  <OpenTradesTable trades={data.openTrades} />
                </div>
              </section>

              {/* ── Closed trades ── */}
              <section>
                <div style={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-surface-light)',
                  borderRadius: 12, overflow: 'hidden',
                }}>
                  <div style={{ padding: '16px 20px', borderBottom: '1px solid #1F2937' }}>
                    <h2 style={{ fontSize: 15, fontWeight: 700, color: '#E5E7EB', margin: 0 }}>
                      Closed Trades
                      <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 10, background: 'rgba(107,114,128,0.1)', color: '#9CA3AF', fontSize: 12 }}>
                        {data.portfolio.closedCount} total · showing last {Math.min(50, data.closedTrades.length)}
                      </span>
                    </h2>
                  </div>
                  <ClosedTradesTable trades={data.closedTrades} />
                </div>
              </section>

            </motion.div>
          )}
        </div>
      </div>
    </>
  );
}

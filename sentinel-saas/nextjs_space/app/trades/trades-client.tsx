'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Header } from '@/components/header';
import { BtcCandlestickChart } from '@/components/btc-candlestick-chart';
import { Download, TrendingUp, TrendingDown, Clock, Search, X, BarChart3, RefreshCw, Trash2 } from 'lucide-react';
import { motion } from 'framer-motion';

/* ═══ Types ═══ */
interface Trade {
  id: string; coin: string; symbol?: string; position: string; regime: string;
  confidence: number; leverage: number; capital: number;
  entryPrice: number; currentPrice?: number | null;
  exitPrice?: number | null; stopLoss: number; takeProfit: number;
  slType: string; targetType?: string | null; status: string; mode?: string;
  activePnl: number; activePnlPercent: number;
  totalPnl: number; totalPnlPercent: number;
  exitPercent?: number | null; exitReason?: string | null;
  fee: number;
  entryTime: string; exitTime?: string | null;
  botName?: string;
  botId?: string | null;
  sessionId?: string | null;
}

/* ═══ Utilities ═══ */
const fmt$ = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(2);
const fmtPct = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
const fmtPrice = (v: number) => v.toFixed(4);
const pnlColor = (v: number) => v > 0 ? '#22C55E' : v < 0 ? '#EF4444' : '#6B7280';

/* ═══ Determine if a trade is truly active ═══ */
function isTradeActive(t: any): boolean {
  const st = (t.status || '').toLowerCase().trim();
  // A trade is ONLY active if status says active AND there's no exit data
  if (st !== 'active') return false;
  if (t.exit_price || t.exitPrice || t.exit_time || t.exitTime || t.exit_timestamp) return false;
  if (t.exit_reason || t.exitReason) return false;
  return true;
}

/* ═══ Map raw engine trade to typed Trade ═══ */
function mapTrade(t: any): Trade {
  const status = isTradeActive(t) ? 'active' : 'closed';
  // Use trade_id + symbol as unique key to avoid React key collisions from duplicate trade_ids
  const baseId = t.trade_id || t.id || `T-${Math.random().toString(36).slice(2, 8)}`;
  const sym = t.symbol || t.coin || '';
  const uniqueId = `${baseId}-${sym}`;

  // Determine SL type from engine data
  const slType = t.sl_type || t.slType || 'Default';

  // Determine current target level from engine data
  const t1Hit = t.t1_hit || t.t1Hit || false;
  const t2Hit = t.t2_hit || t.t2Hit || false;
  let targetType = t.target_type || t.tp_type || t.targetType || 'T1';
  if (t2Hit) targetType = 'T3';
  else if (t1Hit) targetType = 'T2';

  return {
    id: uniqueId,
    coin: sym.replace('USDT', ''),
    symbol: sym,
    position: (t.side || t.position || '').toLowerCase(),
    regime: t.regime || '',
    confidence: t.confidence || 0,
    leverage: t.leverage || 1,
    capital: t.capital || t.position_size || 0,
    entryPrice: t.entry_price || t.entryPrice || 0,
    currentPrice: t.current_price || t.currentPrice || null,
    exitPrice: t.exit_price || t.exitPrice || null,
    stopLoss: t.trailing_sl || t.trailingSl || t.stop_loss || t.stopLoss || 0,
    takeProfit: t.trailing_tp || t.trailingTp || t.take_profit || t.takeProfit || 0,
    slType: (t.trailing_active || t.trailingActive) ? `Trail (${slType})` : slType,
    targetType,
    status,
    mode: t.mode || 'paper',
    activePnl: t.unrealized_pnl || t.active_pnl || t.activePnl || 0,
    activePnlPercent: t.unrealized_pnl_pct || t.activePnlPercent || 0,
    totalPnl: t.realized_pnl || t.pnl || t.total_pnl || t.totalPnl || 0,
    totalPnlPercent: t.realized_pnl_pct || t.pnl_pct || t.totalPnlPercent || 0,
    exitPercent: t.exit_percent || null,
    exitReason: t.exit_reason || t.exitReason || null,
    entryTime: t.entry_time || t.entry_timestamp || t.entryTime || t.timestamp || new Date().toISOString(),
    exitTime: t.exit_time || t.exit_timestamp || t.exitTime || null,
    fee: (() => {
      // Prefer exchange_fee (live), then commission (engine-calculated), then manual fee
      const f = [t.exchange_fee, t.commission, t.fee].find(v => v != null && v > 0);
      if (f) return f;
      // Fallback for closed trades: estimate as 0.1% round-trip × leveraged capital
      const st = (t.status || '').toLowerCase();
      if (st !== 'active' && t.capital && t.leverage) {
        return Math.round(t.capital * t.leverage * 0.001 * 10000) / 10000;
      }
      return 0;
    })(),
    botName: t.bot_name || t.botName || 'Unknown Bot',
    botId: t.bot_id || t.botId || null,
  };
}

/* ═══ Card Wrapper ═══ */
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={className} style={{
      background: 'rgba(17, 24, 39, 0.8)', backdropFilter: 'blur(12px)',
      border: '1px solid rgba(255,255,255,0.06)', borderRadius: '16px', padding: '20px',
    }}>{children}</div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <Card>
      <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px', color: '#6B7280', marginBottom: '6px' }}>{label}</div>
      <div style={{ fontSize: '22px', fontWeight: 700, color: color || '#F0F4F8' }}>{value}</div>
      {sub && <div style={{ fontSize: '11px', color: '#6B7280', marginTop: '4px' }}>{sub}</div>}
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════════════ */
/*  MAIN COMPONENT                                                   */
/* ═══════════════════════════════════════════════════════════════════ */

interface TradesClientProps { trades: Trade[]; }

export function TradesClient({ trades: initialTrades }: TradesClientProps) {
  const [mounted, setMounted] = useState(false);
  const [trades, setTrades] = useState<Trade[]>(initialTrades);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'closed'>('active');
  const [closingTradeId, setClosingTradeId] = useState<string | null>(null);
  const [confirmingTradeId, setConfirmingTradeId] = useState<string | null>(null); // two-click Book Profit
  const [confirmingClear, setConfirmingClear] = useState(false); // two-click Clear Trades

  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [posFilter, setPosFilter] = useState<string>('all');
  const [regimeFilter, setRegimeFilter] = useState<string>('all');
  const [coinSearch, setCoinSearch] = useState('');
  const [pnlFilter, setPnlFilter] = useState<'all' | 'profit' | 'loss'>('all');
  const [modeFilter, setModeFilter] = useState<'all' | 'paper' | 'live'>('all');
  const [sessionFilter, setSessionFilter] = useState<string>('all');
  const [lastRefresh, setLastRefresh] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [clearSuccess, setClearSuccess] = useState<string | null>(null);
  const [isExitingAll, setIsExitingAll] = useState(false);
  const [confirmExitAll, setConfirmExitAll] = useState(false);
  const clearPauseRef = useRef(false); // blocks auto-refresh after clearing

  useEffect(() => { setMounted(true); }, []);

  // Auto-refresh from engine every 15s
  const refreshTrades = useCallback(async () => {
    // Skip refresh if trades were just cleared (pause for 30s)
    if (clearPauseRef.current) return;
    setIsRefreshing(true);
    try {
      const res = await fetch('/api/bot-state', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        const raw = data?.tradebook?.trades || [];
        // Always update — even if empty — so stale trades get cleared
        setTrades(raw.map(mapTrade));
        setLastRefresh(new Date().toLocaleTimeString());
      }
    } catch {
      // silent
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // Live price polling from CoinDCX every 1.5s for active trade symbols (BUG-11: unified with dashboard)
  useEffect(() => {
    async function fetchLivePrices() {
      const activeSymbols = [...new Set(
        (trades ?? []).filter(t => (t.status || '').toLowerCase() === 'active')
          .map(t => (t.symbol || t.coin + 'USDT').toUpperCase())
          .filter(Boolean)
      )];
      if (activeSymbols.length === 0) return;
      try {
        // Use CoinDCX public prices (same source as dashboard)
        const res = await fetch('/api/coindcx/prices', { cache: 'no-store' });
        if (res.ok) {
          const prices = await res.json();
          const map: Record<string, number> = {};
          Object.entries(prices).forEach(([pair, info]: [string, any]) => {
            const sym = pair.replace(/^B-/, '').replace('_', '');
            if (info?.ls) map[sym] = parseFloat(info.ls);
          });
          // Only update if we got some prices
          if (Object.keys(map).length > 0) setLivePrices(map);
        }
      } catch { /* silent */ }
    }
    fetchLivePrices();
    const timer = setInterval(fetchLivePrices, 1500);
    return () => clearInterval(timer);
  }, [trades]);

  useEffect(() => {
    refreshTrades(); // initial fetch
    const timer = setInterval(refreshTrades, 5000);
    return () => clearInterval(timer);
  }, [refreshTrades]);

  /* ── Filter trades — case-insensitive matching ── */
  const filtered = useMemo(() => {
    return (trades ?? []).filter(t => {
      const tStatus = (t.status || '').toLowerCase();
      const tMode = (t.mode || '').toLowerCase();
      const tPos = (t.position || '').toLowerCase();
      const tRegime = (t.regime || '').toLowerCase();

      // Double-check active/closed using original trade data, not just mapped status
      const tradeIsActive = tStatus === 'active';
      if (statusFilter === 'active' && !tradeIsActive) return false;
      if (statusFilter === 'closed' && tradeIsActive) return false;
      if (modeFilter !== 'all' && tMode !== modeFilter) return false;
      if (sessionFilter !== 'all' && t.sessionId !== sessionFilter) return false;
      if (posFilter !== 'all') {
        const posMatch = posFilter === 'long'
          ? ['long', 'buy'].includes(tPos)
          : ['short', 'sell'].includes(tPos);
        if (!posMatch) return false;
      }
      if (regimeFilter !== 'all' && !tRegime.includes(regimeFilter)) return false;
      if (coinSearch && !t.coin.toLowerCase().includes(coinSearch.toLowerCase())) return false;
      if (pnlFilter === 'profit') {
        const pnl = tStatus === 'active' ? t.activePnl : t.totalPnl;
        if (pnl <= 0) return false;
      }
      if (pnlFilter === 'loss') {
        const pnl = tStatus === 'active' ? t.activePnl : t.totalPnl;
        if (pnl >= 0) return false;
      }
      return true;
    });
  }, [trades, statusFilter, modeFilter, posFilter, regimeFilter, coinSearch, pnlFilter, sessionFilter]);

  /* ── Portfolio Stats (respects master mode filter) ── */
  const CAPITAL_PER_TRADE = 100;
  const modeFiltered = useMemo(() => {
    if (modeFilter === 'all') return trades ?? [];
    return (trades ?? []).filter(t => (t.mode || '').toLowerCase() === modeFilter);
  }, [trades, modeFilter]);

  const stats = useMemo(() => {
    const all = modeFiltered;
    const active = all.filter(t => (t.status || '').toLowerCase() === 'active');
    const closed = all.filter(t => (t.status || '').toLowerCase() !== 'active');
    const wins = closed.filter(t => t.totalPnl > 0);
    const losses = closed.filter(t => t.totalPnl <= 0);
    const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
    const realizedPnl = closed.reduce((s, t) => s + (t.totalPnl || 0), 0);
    // Recalculate unrealized PnL from live prices (matches table P&L formula)
    const unrealizedPnl = active.reduce((s, t) => {
      const sym = (t.symbol || t.coin + 'USDT').toUpperCase();
      const cp = livePrices[sym] || t.currentPrice || t.entryPrice;
      if (!cp || !t.entryPrice || t.entryPrice === 0) return s;
      const pos = (t.position || '').toLowerCase();
      const isLong = pos === 'long' || pos === 'buy';
      const diff = isLong ? (cp - t.entryPrice) : (t.entryPrice - cp);
      const pnl = Math.round(diff / t.entryPrice * t.leverage * t.capital * 10000) / 10000;
      return s + pnl;
    }, 0);
    const combinedPnl = realizedPnl + unrealizedPnl;

    // Compute P&L % from live prices for active trades (avoids stale engine values)
    const activePnlPcts = active.map(t => {
      const sym = (t.symbol || t.coin + 'USDT').toUpperCase();
      const cp = livePrices[sym] || t.currentPrice || t.entryPrice;
      if (!cp || !t.entryPrice || t.entryPrice === 0 || !t.capital || t.capital === 0) return 0;
      const pos = (t.position || '').toLowerCase();
      const isLong = pos === 'long' || pos === 'buy';
      const diff = isLong ? (cp - t.entryPrice) : (t.entryPrice - cp);
      const pnl = Math.round(diff / t.entryPrice * t.leverage * t.capital * 10000) / 10000;
      return Math.round(pnl / t.capital * 100 * 100) / 100;
    });
    const allPnlPcts = [
      ...closed.map(t => t.totalPnlPercent || 0),
      ...activePnlPcts,
    ];
    const bestTrade = allPnlPcts.length > 0 ? Math.max(...allPnlPcts) : 0;
    const worstTrade = allPnlPcts.length > 0 ? Math.min(...allPnlPcts) : 0;

    // Max drawdown as % of total deployed capital
    const totalDeployedCapital = all.length * CAPITAL_PER_TRADE;
    let peak = 0, maxDD = 0, cumPnl = 0;
    const sortedClosed = [...closed].sort((a, b) => (a.entryTime || '').localeCompare(b.entryTime || ''));
    sortedClosed.forEach(t => {
      cumPnl += t.totalPnl || 0;
      if (cumPnl > peak) peak = cumPnl;
      const dd = peak - cumPnl;
      if (dd > maxDD) maxDD = dd;
    });
    const totalEquity = cumPnl + unrealizedPnl;
    if (totalEquity < peak) {
      const dd = peak - totalEquity;
      if (dd > maxDD) maxDD = dd;
    }
    const maxDDPct = totalDeployedCapital > 0 ? (maxDD / totalDeployedCapital * 100) : 0;

    const grossProfit = wins.reduce((s, t) => s + t.totalPnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.totalPnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
    const avgLoss = losses.length > 0 ? grossLoss / losses.length : 1;
    const riskReward = avgLoss > 0 ? avgWin / avgLoss : 0;

    return {
      total: all.length, active: active.length, closed: closed.length,
      wins: wins.length, losses: losses.length, winRate,
      realizedPnl, unrealizedPnl, combinedPnl,
      bestTrade, worstTrade,
      maxDD, maxDDPct, profitFactor, riskReward,
    };
  }, [modeFiltered, livePrices]);

  /* ── CSV Export (all trades, respects mode filter only) ── */
  const exportCSV = () => {
    // Export all trades for the selected mode (ignoring status/position/regime filters)
    const exportTrades = modeFiltered;
    const headers = ['Bot', 'Type', 'Coin', 'Side', 'Leverage', 'Capital', 'Entry Price', 'Exit Price', 'SL', 'TP', 'SL Type', 'Target Type', 'P&L $', 'P&L %', 'Fee', 'Status', 'Entry Time', 'Exit Time'];
    const rows = exportTrades.map(t => [
      t.botName || 'Unknown Bot', t.mode || 'paper', t.coin, t.position, t.leverage, t.capital,
      t.entryPrice, t.exitPrice || t.currentPrice || '', t.stopLoss, t.takeProfit,
      t.slType, t.targetType,
      t.status === 'active' ? t.activePnl : t.totalPnl,
      t.status === 'active' ? t.activePnlPercent : t.totalPnlPercent,
      t.fee || '',
      t.status, t.entryTime, t.exitTime || '',
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `tradebook_${modeFilter}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const uniqueRegimes = useMemo(() => [...new Set(trades?.map(t => t.regime?.toLowerCase()).filter(Boolean))], [trades]);

  // Unique sessions for dropdown: { id, label }
  const uniqueSessions = useMemo(() => {
    const seen = new Map<string, string>();
    (trades ?? []).forEach(t => {
      if (t.sessionId && !seen.has(t.sessionId)) {
        seen.set(t.sessionId, t.sessionId);
      }
    });
    return Array.from(seen.keys());
  }, [trades]);

  const clearAllTrades = async () => {
    // Two-click pattern: first click sets confirmingClear, second executes
    if (!confirmingClear) {
      setConfirmingClear(true);
      setTimeout(() => setConfirmingClear(false), 5000); // auto-cancel after 5s
      return;
    }
    setConfirmingClear(false);
    setIsClearing(true);
    setClearSuccess(null);
    try {
      const res = await fetch('/api/reset-trades', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setTrades([]);
        // Pause auto-refresh for 30s so cleared state isn't overwritten
        clearPauseRef.current = true;
        setTimeout(() => { clearPauseRef.current = false; }, 30000);
        setClearSuccess(`✅ Cleared ${data.deletedCount || 0} trades`);
        setTimeout(() => setClearSuccess(null), 8000);
      } else {
        const err = await res.json();
        setClearSuccess(`❌ ${err.error || 'Failed to clear trades'}`);
        setTimeout(() => setClearSuccess(null), 5000);
      }
    } catch {
      setClearSuccess('❌ Network error');
      setTimeout(() => setClearSuccess(null), 5000);
    } finally {
      setIsClearing(false);
    }
  };

  if (!mounted) return null;

  return (
    <div className="min-h-screen">
      <Header />
      <main className="pt-24 pb-12 px-4">
        <div className="max-w-7xl mx-auto">

          {/* ─── Hero ─── */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold mb-1">Trade Journal</h1>
                <p className="text-sm text-[var(--color-text-secondary)]">
                  Complete history · Portfolio analytics · Auto-refreshes every 15s
                  {lastRefresh && <span style={{ marginLeft: '8px', color: '#06B6D4' }}>Last: {lastRefresh}</span>}
                  {clearSuccess && <span style={{ marginLeft: '8px', color: '#22C55E', fontWeight: 600 }}>{clearSuccess}</span>}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={exportCSV} style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '10px 14px', borderRadius: '12px', border: 'none',
                  background: 'rgba(8, 145, 178, 0.15)', color: '#0EA5E9',
                  fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                }}>
                  <Download size={14} /> Export CSV
                </button>
                {/* Exit All — two-click confirmation */}
                <button
                  onClick={async () => {
                    if (!confirmExitAll) {
                      setConfirmExitAll(true);
                      setTimeout(() => setConfirmExitAll(false), 5000);
                      return;
                    }
                    setIsExitingAll(true);
                    setConfirmExitAll(false);
                    try {
                      const res = await fetch('/api/trades/exit-all', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ mode: modeFilter }),
                      });
                      const data = await res.json();
                      if (data.success) {
                        setClearSuccess(`Exited ${data.totalClosed} trades · PnL: $${(data.totalPnl || 0).toFixed(2)}`);
                        setTimeout(() => setClearSuccess(null), 8000);
                        // Refresh
                        const refreshRes = await fetch('/api/bot-state', { cache: 'no-store' });
                        if (refreshRes.ok) {
                          const rd = await refreshRes.json();
                          setTrades((rd?.tradebook?.trades || []).map(mapTrade));
                        }
                      } else {
                        setClearSuccess(`Error: ${data.error}`);
                        setTimeout(() => setClearSuccess(null), 5000);
                      }
                    } catch {
                      setClearSuccess('Exit all failed');
                      setTimeout(() => setClearSuccess(null), 5000);
                    } finally {
                      setIsExitingAll(false);
                    }
                  }}
                  disabled={isExitingAll}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '10px 14px', borderRadius: '12px', border: 'none',
                    background: confirmExitAll ? 'rgba(245,158,11,0.3)' : 'rgba(245,158,11,0.1)',
                    color: '#F59E0B',
                    fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                    opacity: isExitingAll ? 0.5 : 1,
                    ...(confirmExitAll ? { border: '1px solid #F59E0B' } : {}),
                  }}
                >
                  ⚡ {isExitingAll ? 'Exiting...' : confirmExitAll ? '⚠️ Confirm Exit All' : `Exit All${modeFilter !== 'all' ? ` (${modeFilter})` : ''}`}
                </button>
                <button onClick={clearAllTrades} disabled={isClearing} style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '10px 14px', borderRadius: '12px', border: 'none',
                  background: confirmingClear ? 'rgba(239,68,68,0.3)' : 'rgba(239,68,68,0.1)',
                  color: '#EF4444',
                  fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                  opacity: isClearing ? 0.5 : 1,
                  ...(confirmingClear ? { animation: 'pulse 1s infinite', border: '1px solid #EF4444' } : {}),
                }}>
                  <Trash2 size={14} /> {isClearing ? 'Clearing...' : confirmingClear ? '⚠️ Click again to confirm' : 'Clear Trades'}
                </button>
              </div>
            </div>
          </motion.div>

          {/* ═══ Master Mode Filter ═══ */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 }} className="mb-4">
            <div style={{
              display: 'inline-flex', gap: '0', borderRadius: '10px', overflow: 'hidden',
              border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(17,24,39,0.7)',
            }}>
              {(['all', 'paper', 'live'] as const).map(m => (
                <button key={m} onClick={() => setModeFilter(m)} style={{
                  padding: '8px 20px', border: 'none', cursor: 'pointer',
                  fontSize: '13px', fontWeight: 600,
                  background: modeFilter === m
                    ? m === 'paper' ? 'rgba(34,197,94,0.2)' : m === 'live' ? 'rgba(239,68,68,0.2)' : 'rgba(6,182,212,0.15)'
                    : 'transparent',
                  color: modeFilter === m
                    ? m === 'paper' ? '#22C55E' : m === 'live' ? '#EF4444' : '#06B6D4'
                    : '#6B7280',
                  borderRight: m !== 'live' ? '1px solid rgba(255,255,255,0.08)' : 'none',
                  transition: 'all 0.2s',
                }}>
                  {m === 'all' ? 'All Modes' : m === 'paper' ? '🟢 Paper' : '🔴 Live'}
                </button>
              ))}
            </div>
          </motion.div>

          {/* ═══ Portfolio Summary Stats ═══ */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="mb-6">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '12px' }}>
              <StatCard label="Total Trades" value={String(stats.total)} sub={`${stats.active} active · ${stats.closed} closed`} />
              <StatCard label="Win Rate" value={stats.winRate.toFixed(1) + '%'} sub={`${stats.wins}W / ${stats.losses}L`} color={stats.winRate >= 50 ? '#22C55E' : '#EF4444'} />
              <StatCard label="Total PNL" value={'$' + fmt$(stats.combinedPnl)} sub={`Realized: $${fmt$(stats.realizedPnl)} · Active: $${fmt$(stats.unrealizedPnl)}`} color={pnlColor(stats.combinedPnl)} />
              <StatCard label="Active PNL" value={'$' + fmt$(stats.unrealizedPnl)} sub={`${stats.active} open positions`} color={pnlColor(stats.unrealizedPnl)} />
              <StatCard label="Best / Worst" value={fmtPct(stats.bestTrade)} sub={fmtPct(stats.worstTrade) + ' worst'} color={pnlColor(stats.bestTrade)} />
              <StatCard label="Max Drawdown" value={stats.maxDDPct.toFixed(2) + '%'} sub={`$${stats.maxDD.toFixed(2)} · PF: ${stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)}`} color="#EF4444" />
            </div>
          </motion.div>

          {/* ═══ Filter Bar ═══ */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="mb-6">
            <Card>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' }}>
                {(['all', 'active', 'closed'] as const).map(s => (
                  <button key={s} onClick={() => setStatusFilter(s)} style={{
                    padding: '6px 14px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                    fontSize: '13px', fontWeight: 600,
                    background: statusFilter === s ? '#0891B2' : 'rgba(255,255,255,0.05)',
                    color: statusFilter === s ? '#fff' : '#9CA3AF',
                    transition: 'all 0.2s',
                  }}>
                    {s === 'all' ? `All (${stats.total})` : s === 'active' ? `Active (${stats.active})` : `Closed (${stats.closed})`}
                  </button>
                ))}

                <div style={{ width: '1px', height: '20px', background: 'rgba(255,255,255,0.1)' }} />

                {/* Session filter — only shown when multiple sessions exist */}
                {uniqueSessions.length > 1 && (
                  <select value={sessionFilter} onChange={e => setSessionFilter(e.target.value)} style={{
                    padding: '6px 10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)',
                    background: 'rgba(255,255,255,0.04)', color: '#D1D5DB', fontSize: '13px',
                  }}>
                    <option value="all">All Sessions</option>
                    {uniqueSessions.map((sid, i) => (
                      <option key={sid} value={sid}>Run #{uniqueSessions.length - i}</option>
                    ))}
                  </select>
                )}

                <select value={posFilter} onChange={e => setPosFilter(e.target.value)} style={{
                  padding: '6px 10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.04)', color: '#D1D5DB', fontSize: '13px',
                }}>
                  <option value="all">All Positions</option>
                  <option value="long">Long / Buy</option>
                  <option value="short">Short / Sell</option>
                </select>

                <select value={regimeFilter} onChange={e => setRegimeFilter(e.target.value)} style={{
                  padding: '6px 10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.04)', color: '#D1D5DB', fontSize: '13px',
                }}>
                  <option value="all">All Regimes</option>
                  {uniqueRegimes.map(r => <option key={r} value={r}>{r}</option>)}
                </select>

                <select value={pnlFilter} onChange={e => setPnlFilter(e.target.value as any)} style={{
                  padding: '6px 10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.04)', color: '#D1D5DB', fontSize: '13px',
                }}>
                  <option value="all">All P&L</option>
                  <option value="profit">Profit Only</option>
                  <option value="loss">Loss Only</option>
                </select>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto' }}>
                  {/* Paper/Live mode indicator */}
                  <span style={{
                    padding: '4px 12px', borderRadius: '8px', fontSize: '11px', fontWeight: 800,
                    letterSpacing: '0.5px',
                    background: modeFilter === 'live'
                      ? 'rgba(239,68,68,0.2)' : modeFilter === 'paper'
                        ? 'rgba(34,197,94,0.2)' : 'rgba(6,182,212,0.15)',
                    color: modeFilter === 'live'
                      ? '#F87171' : modeFilter === 'paper'
                        ? '#4ADE80' : '#06B6D4',
                    border: `1px solid ${modeFilter === 'live'
                      ? 'rgba(239,68,68,0.4)' : modeFilter === 'paper'
                        ? 'rgba(34,197,94,0.4)' : 'rgba(6,182,212,0.3)'}`,
                  }}>
                    {modeFilter === 'live' ? '🔴 LIVE' : modeFilter === 'paper' ? '🟢 PAPER' : '📊 ALL MODES'}
                  </span>
                  <div style={{ position: 'relative' }}>
                    <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#6B7280' }} />
                    <input value={coinSearch} onChange={e => setCoinSearch(e.target.value)}
                      placeholder="Search coin..."
                      style={{
                        padding: '6px 10px 6px 30px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)',
                        background: 'rgba(255,255,255,0.04)', color: '#D1D5DB', fontSize: '13px', width: '150px',
                      }} />
                    {coinSearch && (
                      <X size={12} onClick={() => setCoinSearch('')}
                        style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', color: '#6B7280' }} />
                    )}
                  </div>
                </div>
              </div>
            </Card>
          </motion.div>

          {/* ═══ Trade Journal Table ═══ */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
            {filtered.length > 0 ? (
              <Card>
                <div style={{ overflowX: 'auto', maxHeight: '600px', overflowY: 'auto' }}>
                  <table style={{ width: '100%', minWidth: '1300px', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid rgba(255,255,255,0.08)' }}>
                        {['Bot', 'Coin', 'Position', 'Leverage', 'Capital', 'Entry', 'LTP', 'Stop Loss', 'Target Price', 'SL Type', 'PnL', 'PnL %', 'Fee', 'Status', 'Exit', 'Action'].map(h => (
                          <th key={h} style={{
                            padding: '10px 10px', textAlign: h === 'Bot' || h === 'Coin' ? 'left' : 'center',
                            fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px',
                            color: '#6B7280', position: 'sticky', top: 0, background: 'rgba(17, 24, 39, 0.95)',
                          }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(t => {
                        const isActive = (t.status || '').toLowerCase() === 'active';
                        const sym = (t.symbol || t.coin + 'USDT').toUpperCase();
                        const livePrice = livePrices[sym];
                        const currentPrice = isActive ? (livePrice || t.currentPrice || t.entryPrice) : null;
                        const pos = (t.position || '').toLowerCase();
                        const isLong = pos === 'long' || pos === 'buy';
                        // Recalculate P&L from live price for active trades
                        let pnl: number, pnlPct: number;
                        if (isActive && currentPrice) {
                          const diff = isLong ? (currentPrice - t.entryPrice) : (t.entryPrice - currentPrice);
                          pnl = t.entryPrice > 0 ? Math.round(diff / t.entryPrice * t.leverage * t.capital * 10000) / 10000 : 0;
                          pnlPct = t.capital > 0 ? Math.round(pnl / t.capital * 100 * 100) / 100 : 0;
                        } else {
                          pnl = t.totalPnl;
                          pnlPct = t.totalPnlPercent;
                        }
                        const duration = getDuration(t.entryTime, t.exitTime);

                        return (
                          <tr key={t.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                            <td style={{ padding: '10px', color: '#0891B2', fontWeight: 600, fontSize: '12px' }}>
                              {t.botName || 'Unknown Bot'}
                              {t.sessionId && (
                                <div style={{ fontSize: '9px', color: '#6B7280', marginTop: '2px' }}>
                                  {(() => {
                                    const idx = uniqueSessions.indexOf(t.sessionId);
                                    return idx === -1 ? 'Legacy' : `Run #${uniqueSessions.length - idx}`;
                                  })()}
                                </div>
                              )}
                            </td>
                            <td style={{ padding: '10px', fontWeight: 700, color: '#F0F4F8' }}>
                              {t.coin.replace('USDT', '')}
                            </td>
                            <td style={{ padding: '10px', textAlign: 'center' }}>
                              <span style={{
                                padding: '2px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: 700,
                                color: isLong ? '#22C55E' : '#EF4444',
                                background: isLong ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                              }}>
                                {isLong ? '▲ LONG' : '▼ SHORT'}
                              </span>
                            </td>
                            <td style={{ padding: '10px', textAlign: 'center', color: '#D1D5DB' }}>{t.leverage}×</td>
                            <td style={{ padding: '10px', textAlign: 'center', color: '#D1D5DB' }}>${t.capital}</td>
                            <td style={{ padding: '10px', textAlign: 'center', color: '#D1D5DB', fontFamily: 'monospace', fontSize: '12px' }}>{fmtPrice(t.entryPrice)}</td>
                            <td style={{ padding: '10px', textAlign: 'center', fontFamily: 'monospace', fontSize: '12px' }}>
                              {isActive && currentPrice ? (
                                <span style={{ color: livePrice ? '#22C55E' : '#9CA3AF', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                                  {livePrice && <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22C55E', animation: 'pulse 2s infinite', display: 'inline-block' }} />}
                                  {fmtPrice(currentPrice)}
                                </span>
                              ) : <span style={{ color: '#6B7280' }}>—</span>}
                            </td>
                            <td style={{ padding: '10px', textAlign: 'center', color: '#EF4444', fontFamily: 'monospace', fontSize: '12px' }}>{fmtPrice(t.stopLoss)}</td>
                            <td style={{ padding: '10px', textAlign: 'center', color: '#22C55E', fontFamily: 'monospace', fontSize: '12px' }}>{fmtPrice(t.takeProfit)}</td>
                            <td style={{ padding: '10px', textAlign: 'center' }}>
                              <span style={{
                                padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 600,
                                background: (t.slType || '').includes('Trail') ? 'rgba(34,197,94,0.15)' : 'rgba(107,114,128,0.15)',
                                color: (t.slType || '').includes('Trail') ? '#22C55E' : '#9CA3AF',
                              }}>
                                {(t.slType || '').includes('Trail') ? '🛡️ ' : ''}{t.slType || 'Default'}
                              </span>
                            </td>

                            <td style={{ padding: '10px', textAlign: 'center', fontWeight: 700, color: pnlColor(pnl) }}>
                              {fmt$(pnl)}
                            </td>
                            <td style={{ padding: '10px', textAlign: 'center', fontWeight: 700, color: pnlColor(pnlPct) }}>
                              {fmtPct(pnlPct)}
                            </td>
                            <td style={{ padding: '10px', textAlign: 'center', fontFamily: 'monospace', fontSize: '11px', color: t.fee > 0 ? '#F59E0B' : '#4B5563' }}>
                              {!isActive && t.fee > 0 ? `$${t.fee.toFixed(4)}` : '—'}
                            </td>
                            <td style={{ padding: '10px', textAlign: 'center' }}>
                              <span style={{
                                padding: '2px 8px', borderRadius: '6px', fontSize: '10px', fontWeight: 700,
                                color: isActive ? '#22C55E' : '#6B7280',
                                background: isActive ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.05)',
                              }}>
                                {isActive ? '● ACTIVE' : t.exitReason || 'CLOSED'}
                              </span>
                            </td>
                            <td style={{ padding: '10px', textAlign: 'center', fontFamily: 'monospace', fontSize: '12px', color: '#D1D5DB' }}>
                              {!isActive && t.exitPrice ? fmtPrice(t.exitPrice) : '—'}
                            </td>

                            <td style={{ padding: '10px', textAlign: 'center' }}>
                              {isActive && (
                                <button
                                  disabled={closingTradeId === t.id}
                                  onClick={async () => {
                                    // Two-click pattern: first click shows confirm, second executes
                                    if (confirmingTradeId !== t.id) {
                                      setConfirmingTradeId(t.id);
                                      setTimeout(() => setConfirmingTradeId(prev => prev === t.id ? null : prev), 5000);
                                      return;
                                    }
                                    setConfirmingTradeId(null);
                                    setClosingTradeId(t.id);
                                    try {
                                      const res = await fetch('/api/trades/close', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ tradeId: t.id, symbol: t.symbol }),
                                      });
                                      if (res.ok) {
                                        // Remove from local state immediately
                                        setTrades(prev => prev.filter(tr => tr.id !== t.id));
                                      } else {
                                        const err = await res.json();
                                        setClearSuccess(`❌ ${err.error || 'Failed to close trade'}`);
                                        setTimeout(() => setClearSuccess(null), 5000);
                                      }
                                    } catch {
                                      setClearSuccess('❌ Network error');
                                      setTimeout(() => setClearSuccess(null), 5000);
                                    } finally {
                                      setClosingTradeId(null);
                                    }
                                  }}
                                  style={{
                                    padding: '4px 10px', borderRadius: '6px',
                                    border: confirmingTradeId === t.id ? '1px solid #22C55E' : 'none',
                                    fontSize: '10px', fontWeight: 700, cursor: 'pointer',
                                    background: pnl >= 0 ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)',
                                    color: pnl >= 0 ? '#22C55E' : '#EF4444',
                                    transition: 'all 0.2s',
                                    opacity: closingTradeId === t.id ? 0.5 : 1,
                                  }}
                                >
                                  {closingTradeId === t.id ? '...' : confirmingTradeId === t.id ? '⚡ Confirm?' : pnl >= 0 ? '💰 Book Profit' : '✕ Close'}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{ marginTop: '12px', fontSize: '12px', color: '#6B7280', textAlign: 'right' }}>
                  Showing {filtered.length} of {trades.length} trades
                </div>
              </Card>
            ) : (
              <Card>
                <div style={{ textAlign: 'center', padding: '60px 0' }}>
                  <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'rgba(8,145,178,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}><BarChart3 size={24} style={{ color: '#0891B2' }} /></div>
                  <div style={{ fontSize: '18px', fontWeight: 600, color: '#D1D5DB', marginBottom: '8px' }}>No Trades Found</div>
                  <div style={{ fontSize: '14px', color: '#6B7280' }}>
                    {statusFilter === 'all' ? 'Deploy a bot to start trading' : `No ${statusFilter} trades match your filters`}
                  </div>
                </div>
              </Card>
            )}
          </motion.div>

          {/* ═══ P&L Timeline ═══ */}
          {(() => {
            const allTrades = modeFiltered;
            if (allTrades.length < 1) return null;

            // Use the same values as the stat cards above
            const totalUnrealized = stats.unrealizedPnl;
            const cumRealized = stats.realizedPnl;

            // Build cumulative realized PnL over time for chart line
            const closed = allTrades
              .filter(t => (t.status || '').toLowerCase() !== 'active' && t.exitTime)
              .sort((a, b) => new Date(a.exitTime!).getTime() - new Date(b.exitTime!).getTime());

            const active = allTrades.filter(t => (t.status || '').toLowerCase() === 'active');

            let cumR = 0;
            const realizedPoints = closed.map(t => {
              cumR += t.totalPnl || 0;
              return { time: new Date(t.exitTime!).getTime(), realized: cumR, total: cumR };
            });

            // Add current moment with unrealized on top
            const now = Date.now();
            const allPoints = [
              ...realizedPoints,
              ...(active.length > 0 ? [{ time: now, realized: cumRealized, total: cumRealized + totalUnrealized }] : []),
            ];

            if (allPoints.length < 1) return null;

            const totalPnl = stats.combinedPnl;
            const pnlColor = totalPnl >= 0 ? '#22C55E' : '#EF4444';

            // Y-axis range for PnL
            const allValues = allPoints.map(p => p.total);
            const minV = Math.min(0, ...allValues);
            const maxV = Math.max(0, ...allValues);
            const pnlRange = maxV - minV || 1;
            const padV = pnlRange * 0.1;
            const yMin = minV - padV;
            const yMax = maxV + padV;
            const yRange = yMax - yMin;

            // Time range
            const timeStart = allPoints[0].time;
            const timeEnd = allPoints[allPoints.length - 1].time;
            const timeRange = timeEnd - timeStart || 1;



            // SVG dimensions
            const W = 960, H = 280, PADL = 60, PADR = 70, PADT = 25, PADB = 40;
            const chartW = W - PADL - PADR;
            const chartH = H - PADT - PADB;

            const toX = (t: number) => PADL + ((t - timeStart) / timeRange) * chartW;
            const toY = (v: number) => PADT + (1 - (v - yMin) / yRange) * chartH;
            const zeroY = toY(0);

            // PnL line + area
            const pnlLine = allPoints.map(p => `${toX(p.time)},${toY(p.total)}`).join(' ');
            const areaPath = `M${toX(allPoints[0].time)},${zeroY} L${allPoints.map(p => `${toX(p.time)},${toY(p.total)}`).join(' L')} L${toX(allPoints[allPoints.length - 1].time)},${zeroY} Z`;



            // Grid lines (5)
            const gridValues = Array.from({ length: 5 }, (_, i) => yMin + (yRange * i) / 4);

            // Date labels
            const numLabels = Math.min(5, allPoints.length);
            const labelIndices = Array.from({ length: numLabels }, (_, i) => Math.floor((i * (allPoints.length - 1)) / (numLabels - 1 || 1)));
            const dateLabels = [...new Set(labelIndices)].map(i => allPoints[i]);

            // Stats

            return (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="mt-8">
                <div style={{
                  background: 'linear-gradient(135deg, rgba(17,24,39,0.95) 0%, rgba(15,23,42,0.9) 100%)',
                  backdropFilter: 'blur(20px)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: '20px',
                  overflow: 'hidden',
                }}>
                  {/* Header */}
                  <div style={{
                    padding: '20px 24px 0 24px',
                    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                  }}>
                    <div>
                      <div style={{
                        fontSize: '13px', fontWeight: 800, textTransform: 'uppercase' as const,
                        letterSpacing: '2px', color: '#6B7280', marginBottom: '6px',
                      }}>📈 P&L Timeline</div>
                      <div style={{ fontSize: '32px', fontWeight: 800, color: pnlColor, lineHeight: 1.1 }}>
                        {fmt$(totalPnl)}
                        <span style={{ fontSize: '13px', fontWeight: 600, marginLeft: '8px', color: '#6B7280' }}>
                          Total PnL
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '20px', fontSize: '11px' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <span style={{ width: '14px', height: '3px', background: pnlColor, borderRadius: '2px', display: 'inline-block' }} />
                        <span style={{ color: '#9CA3AF' }}>Cumulative PnL</span>
                      </span>
                    </div>
                  </div>

                  {/* Stat Chips */}
                  <div style={{
                    display: 'flex', gap: '10px', padding: '14px 24px',
                    flexWrap: 'wrap' as const,
                  }}>
                    {[
                      { label: 'Realized', value: fmt$(stats.realizedPnl), color: stats.realizedPnl >= 0 ? '#22C55E' : '#EF4444' },
                      { label: 'Unrealized', value: fmt$(stats.unrealizedPnl), color: stats.unrealizedPnl >= 0 ? '#22C55E' : '#EF4444' },
                      { label: 'Active', value: `${stats.active}`, color: '#06B6D4' },
                      { label: 'Closed', value: `${stats.closed}`, color: '#8B5CF6' },
                      { label: 'Win Rate', value: `${stats.winRate.toFixed(0)}%`, color: stats.winRate >= 50 ? '#22C55E' : '#EF4444' },
                    ].map((chip, i) => (
                      <div key={i} style={{
                        padding: '6px 14px', borderRadius: '10px',
                        background: `${chip.color}0D`,
                        border: `1px solid ${chip.color}22`,
                        display: 'flex', alignItems: 'center', gap: '6px',
                      }}>
                        <span style={{ fontSize: '10px', fontWeight: 600, color: '#6B7280', textTransform: 'uppercase' as const, letterSpacing: '0.5px' }}>{chip.label}</span>
                        <span style={{ fontSize: '13px', fontWeight: 700, color: chip.color, fontFamily: 'monospace' }}>{chip.value}</span>
                      </div>
                    ))}
                  </div>

                  {/* Chart */}
                  <div style={{ padding: '0 8px 16px 8px' }}>
                    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '260px' }}>
                      <defs>
                        <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={pnlColor} stopOpacity="0.20" />
                          <stop offset="100%" stopColor={pnlColor} stopOpacity="0.01" />
                        </linearGradient>

                        <filter id="pnlGlow">
                          <feGaussianBlur stdDeviation="3" result="blur" />
                          <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                          </feMerge>
                        </filter>
                      </defs>

                      {/* Grid lines */}
                      {gridValues.map((v, i) => (
                        <g key={i}>
                          <line x1={PADL} y1={toY(v)} x2={W - PADR} y2={toY(v)}
                            stroke="rgba(255,255,255,0.04)" strokeDasharray="4,6" />
                          <text x={PADL - 8} y={toY(v) + 3.5} fontSize="9" fill="#4B5563" textAnchor="end" fontFamily="monospace">
                            {fmt$(v)}
                          </text>
                        </g>
                      ))}

                      {/* Zero baseline */}
                      <line x1={PADL} y1={zeroY} x2={W - PADR} y2={zeroY}
                        stroke="rgba(255,255,255,0.12)" strokeDasharray="6,4" />
                      <text x={PADL - 8} y={zeroY + 3.5} fontSize="9" fill="#9CA3AF" textAnchor="end" fontWeight="600" fontFamily="monospace">$0</text>



                      {/* PnL area fill */}
                      <path d={areaPath} fill="url(#pnlGradient)" />

                      {/* PnL line with glow */}
                      <polyline points={pnlLine} fill="none" stroke={pnlColor} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" filter="url(#pnlGlow)" />

                      {/* Data dots on PnL line */}
                      {allPoints.length <= 30 && allPoints.map((p, i) => (
                        <circle key={i} cx={toX(p.time)} cy={toY(p.total)} r="2.5"
                          fill={p.total >= 0 ? '#22C55E' : '#EF4444'} stroke="rgba(0,0,0,0.3)" strokeWidth="0.5" />
                      ))}

                      {/* Current value dot (glowing) */}
                      <circle cx={toX(allPoints[allPoints.length - 1].time)} cy={toY(totalPnl)}
                        r="5" fill={pnlColor} stroke="rgba(0,0,0,0.3)" strokeWidth="1" />
                      <circle cx={toX(allPoints[allPoints.length - 1].time)} cy={toY(totalPnl)}
                        r="10" fill="none" stroke={pnlColor} strokeWidth="1.5" opacity="0.3">
                        <animate attributeName="r" values="5;12;5" dur="2s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="0.4;0.1;0.4" dur="2s" repeatCount="indefinite" />
                      </circle>

                      {/* Date labels */}
                      {dateLabels.map((p, i) => (
                        <text key={i} x={toX(p.time)} y={H - 10} fontSize="9" fill="#4B5563" textAnchor="middle" fontFamily="monospace">
                          {new Date(p.time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </text>
                      ))}

                      {/* Axes */}
                      <line x1={PADL} y1={PADT} x2={PADL} y2={PADT + chartH} stroke="rgba(255,255,255,0.06)" />
                      <line x1={PADL} y1={PADT + chartH} x2={W - PADR} y2={PADT + chartH} stroke="rgba(255,255,255,0.06)" />
                    </svg>
                  </div>
                </div>
              </motion.div>
            );
          })()}

          {/* ═══ BTC/USDT Candlestick Chart ═══ */}
          <div className="mt-8">
            <BtcCandlestickChart />
          </div>

        </div>
      </main>
    </div>
  );
}

/* ─── Duration Helper ─── */
function getDuration(entry: string, exit?: string | null): string {
  try {
    const start = new Date(entry);
    const end = exit ? new Date(exit) : new Date();
    const diffMs = end.getTime() - start.getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ${mins % 60}m`;
    const days = Math.floor(hrs / 24);
    return `${days}d ${hrs % 24}h`;
  } catch { return '—'; }
}
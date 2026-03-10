'use client';

import { useState, useEffect, useCallback } from 'react';
import { Header } from '@/components/header';
import { StatsCard } from '@/components/stats-card';
import { BotCard } from '@/components/bot-card';
import { RegimeCard, PnlCard, ActivePositionsCard, SignalSummaryTable } from '@/components/dashboard/command-center';
import { EngineConsole } from '@/components/dashboard/engine-console';
import { Bot, TrendingUp, Activity, DollarSign, Zap } from 'lucide-react';
import Link from 'next/link';
import { motion } from 'framer-motion';

interface DashboardClientProps {
  user: {
    id: string;
    name: string;
    email: string;
    subscription: any;
  };
  stats: {
    activeBots: number;
    totalBots: number;
    activeTrades: number;
    totalTrades: number;
    totalPnl: number;
    activePnl: number;
  };
  bots: any[];
  recentTrades: any[];
}

interface BotState {
  state: { regime: string; confidence: number; symbol: string; timestamp: string | null };
  multi: {
    coins_scanned: number;
    eligible_count: number;
    deployed_count: number;
    total_trades: number;
    active_positions: Record<string, any>;
    coin_states: Record<string, any>;
    cycle: number;
    timestamp: string | null;
  };
  tradebook: { trades: any[]; summary: any };
}

export function DashboardClient({ user, stats, bots, recentTrades }: DashboardClientProps) {
  const [mounted, setMounted] = useState(false);
  const [botState, setBotState] = useState<BotState | null>(null);
  const [lastRefresh, setLastRefresh] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [feedHealth, setFeedHealth] = useState<any>(null);
  const [pnlScope, setPnlScope] = useState<'session' | 'all'>('all');
  const [walletBalance, setWalletBalance] = useState<{ binance: number | null; coindcx: number | null }>({ binance: null, coindcx: null });
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});

  const fetchBotState = useCallback(async () => {
    try {
      setIsRefreshing(true);
      const res = await fetch('/api/bot-state', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setBotState(data);
        setLastRefresh(new Date().toLocaleTimeString());
      }
    } catch {
      // silent
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    fetchBotState();
    const interval = setInterval(fetchBotState, 15000); // refresh every 15s

    // Fetch wallet balances once on mount, then every 60s
    const fetchWalletBalance = async () => {
      try {
        const res = await fetch('/api/wallet-balance', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          setWalletBalance({ binance: data.binance, coindcx: data.coindcx });
        }
      } catch { /* silent */ }
    };
    fetchWalletBalance();
    const walletInterval = setInterval(fetchWalletBalance, 15000);

    // Fetch feed health for admin
    if ((user as any)?.role === 'admin') {
      const fetchHealth = async () => {
        try {
          const [liveRes, fgRes] = await Promise.all([
            fetch('/api/live-market', { cache: 'no-store' }),
            fetch('https://api.alternative.me/fng/?limit=1'),
          ]);
          setFeedHealth({
            liveMarket: liveRes.ok ? 'ok' : 'error',
            liveMarketTime: new Date().toISOString(),
            fearGreed: fgRes.ok ? 'ok' : 'error',
            fearGreedTime: new Date().toISOString(),
          });
        } catch {
          setFeedHealth({ liveMarket: 'error', fearGreed: 'error' });
        }
      };
      fetchHealth();
      const healthInterval = setInterval(fetchHealth, 60000);
      return () => { clearInterval(interval); clearInterval(walletInterval); clearInterval(healthInterval); };
    }

    return () => { clearInterval(interval); clearInterval(walletInterval); };
  }, [fetchBotState]);

  // Live price polling from CoinDCX every 3s (proxied — covers all futures pairs)
  useEffect(() => {
    async function fetchCdxPrices() {
      try {
        const res = await fetch('/api/coindcx/prices', { cache: 'no-store' });
        if (!res.ok) return;
        const prices = await res.json(); // { "B-BTC_USDT": { ls: 70678.1 }, ... }
        const map: Record<string, number> = {};
        Object.entries(prices).forEach(([pair, info]: [string, any]) => {
          // "B-BTC_USDT" → "BTCUSDT"
          const sym = pair.replace(/^B-/, '').replace('_', '');
          if (info?.ls) map[sym] = parseFloat(info.ls);
        });
        if (Object.keys(map).length > 0) setLivePrices(map);
      } catch { /* silent */ }
    }
    fetchCdxPrices();
    const timer = setInterval(fetchCdxPrices, 3000);
    return () => clearInterval(timer);
  }, []);

  const handleBotToggle = async (botId: string, currentStatus: boolean) => {
    try {
      const response = await fetch('/api/bots/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId, isActive: !currentStatus }),
      });

      if (response.ok) {
        window.location.reload();
      }
    } catch (error) {
      console.error('Error toggling bot:', error);
    }
  };

  if (!mounted) {
    return null;
  }

  const formatCurrency = (value: number) => `$${value.toFixed(2)}`;

  const multi = botState?.multi;
  // Prefer live trades from bot-state API; fall back to SSR Prisma trades
  const apiTrades = botState?.tradebook?.trades || [];
  const ssrTradesNormalized = (recentTrades || []).map((t: any) => ({
    ...t,
    symbol: t.coin || t.symbol || '',
    side: t.position === 'long' ? 'BUY' : 'SELL',
    status: (t.status || '').toUpperCase(),
    entry_price: t.entryPrice || t.entry_price || 0,
    current_price: t.currentPrice || t.current_price || null,
    exit_price: t.exitPrice || t.exit_price || null,
    stop_loss: t.stopLoss || t.stop_loss || 0,
    take_profit: t.takeProfit || t.take_profit || 0,
    entry_time: t.entryTime || t.entry_time || '',
    exit_time: t.exitTime || t.exit_time || null,
    bot_name: 'Synaptic Marshal',
    mode: t.mode || 'paper',
  }));
  const trades = apiTrades.length > 0 ? apiTrades : ssrTradesNormalized;

  // Extract BTC multi-timeframe data for regime card — prefer coin_states over stale state
  const btcState = multi?.coin_states?.['BTCUSDT'] || {};
  const regime = btcState?.regime || botState?.state?.regime || 'WAITING';
  const confidence = btcState?.confidence || botState?.state?.confidence || 0;
  const symbol = btcState?.symbol || botState?.state?.symbol || 'BTCUSDT';
  const macroRegime = btcState?.macro_regime || undefined;
  const trend15m = btcState?.ta_multi?.['15m']?.trend || undefined;

  // Live stats from engine data (overrides stale DB stats)
  const allTrades = trades || [];

  // Detect the current session: most recent sessionId from active trades
  const currentSessionId: string | null = (() => {
    const active = allTrades.find((t: any) => (t.status || '').toUpperCase() === 'ACTIVE' && t.sessionId);
    if (active) return active.sessionId;
    const recent = allTrades.find((t: any) => t.sessionId);
    return recent?.sessionId ?? null;
  })();

  // Apply session scope filter
  const liveTrades = pnlScope === 'session' && currentSessionId
    ? allTrades.filter((t: any) => t.sessionId === currentSessionId)
    : allTrades;

  const liveActiveTrades = liveTrades.filter((t: any) => (t.status || '').toUpperCase() === 'ACTIVE');
  const liveClosedTrades = liveTrades.filter((t: any) => (t.status || '').toUpperCase() === 'CLOSED');
  const liveTotalPnl = liveClosedTrades.reduce((sum: number, t: any) => sum + (t.realized_pnl || t.pnl || t.total_pnl || 0), 0);

  // Compute active PNL from live Binance prices (same formula as tradebook)
  const computePnlFromPrices = (t: any) => {
    const entry = t.entry_price || t.entryPrice || 0;
    const sym = (t.symbol || (t.coin || '') + 'USDT').toUpperCase();
    const current = livePrices[sym] || t.current_price || t.currentPrice || entry;
    const lev = t.leverage || 1;
    const cap = t.capital || t.position_size || 100;
    const pos = (t.side || t.position || '').toUpperCase();
    const isLong = pos === 'BUY' || pos === 'LONG';
    if (entry <= 0) return 0;
    // E2 FIX: For LIVE CoinDCX trades, qty is already leveraged — don't multiply by leverage again
    const isLive = (t.mode || '').toUpperCase().includes('LIVE');
    const effectiveLev = isLive ? 1 : lev;
    return Math.round((isLong ? current - entry : entry - current) / entry * effectiveLev * cap * 10000) / 10000;
  };

  const liveActivePnl = liveActiveTrades.reduce((sum: number, t: any) => sum + computePnlFromPrices(t), 0);

  // Paper vs Live split — BOTH active (unrealized) + closed (realized) trades
  const paperActiveTrades = liveActiveTrades.filter((t: any) => (t.mode || 'paper').toUpperCase() === 'PAPER');
  const paperClosedTrades = liveClosedTrades.filter((t: any) => (t.mode || 'paper').toUpperCase() === 'PAPER');
  const liveModeTrades = liveActiveTrades.filter((t: any) => (t.mode || '').toUpperCase().includes('LIVE'));
  const liveClosedModeTrades = liveClosedTrades.filter((t: any) => (t.mode || '').toUpperCase().includes('LIVE'));

  // Unrealized PnL from active trades (via live prices)
  const paperUnrealizedPnl = paperActiveTrades.reduce((sum: number, t: any) => sum + computePnlFromPrices(t), 0);
  const liveUnrealizedPnl = liveModeTrades.reduce((sum: number, t: any) => sum + computePnlFromPrices(t), 0);

  // Realized PnL from closed trades
  const paperRealizedPnl = paperClosedTrades.reduce((sum: number, t: any) => sum + (t.realized_pnl || t.pnl || t.total_pnl || 0), 0);
  const liveRealizedPnl = liveClosedModeTrades.reduce((sum: number, t: any) => sum + (t.realized_pnl || t.pnl || t.total_pnl || 0), 0);

  // Total = realized + unrealized
  const paperTotalPnl = paperRealizedPnl + paperUnrealizedPnl;
  const liveTotalModePnl = liveRealizedPnl + liveUnrealizedPnl;

  // Derive MAX_CAPITAL and CAPITAL_PER_TRADE from bot configs (not hardcoded)
  const activeBotConfig = bots.find((b: any) => b?.isActive)?.config;
  const CAPITAL_PER_TRADE: number = activeBotConfig?.capitalPerTrade || (bots[0]?.config?.capitalPerTrade) || 100;
  const MAX_CAPITAL: number = bots.reduce((sum: number, b: any) => {
    const maxT: number = b?.config?.maxTrades ?? 0;
    const capT: number = b?.config?.capitalPerTrade ?? 0;
    return sum + maxT * capT;
  }, 0) || (bots.length > 0 ? 0 : 0);

  // Split max capital by bot mode (paper vs live)
  const paperMaxCapital: number = bots.reduce((sum: number, b: any) => {
    const mode = (b?.config?.mode || 'paper').toLowerCase();
    if (mode.includes('live')) return sum;
    const maxT: number = b?.config?.maxTrades ?? 0;
    const capT: number = b?.config?.capitalPerTrade ?? 0;
    return sum + maxT * capT;
  }, 0);
  const liveMaxCapital: number = bots.reduce((sum: number, b: any) => {
    const mode = (b?.config?.mode || 'paper').toLowerCase();
    if (!mode.includes('live')) return sum;
    const maxT: number = b?.config?.maxTrades ?? 0;
    const capT: number = b?.config?.capitalPerTrade ?? 0;
    return sum + maxT * capT;
  }, 0);

  const paperCapital = paperMaxCapital;
  const liveCapital = liveMaxCapital;
  const paperPnlPct = paperCapital > 0 ? (paperTotalPnl / paperCapital * 100) : 0;
  const livePnlPct = liveCapital > 0 ? (liveTotalModePnl / liveCapital * 100) : 0;

  const usedCapital = liveActiveTrades.length * CAPITAL_PER_TRADE;

  // Capital deployed: paper + live (active trades only)
  const paperCapitalDeployed = paperActiveTrades.length * CAPITAL_PER_TRADE;
  const liveCapitalDeployed = liveModeTrades.length * CAPITAL_PER_TRADE;
  const totalCapitalDeployed = paperCapitalDeployed + liveCapitalDeployed;

  // Detect trading mode — live if any active bot is live or live-mode trades exist
  const activeBotMode: 'live' | 'paper' =
    (bots.find((b: any) => b?.isActive)?.config?.mode === 'live' || liveModeTrades.length > 0)
      ? 'live' : 'paper';

  const liveStats = {
    activeBots: stats?.activeBots ?? (bots?.filter((b: any) => b?.isActive)?.length ?? 0),
    activeTrades: liveActiveTrades.length || stats?.activeTrades || 0,
    totalPnl: liveTotalPnl + liveActivePnl,
    paperTotalPnl,
    paperPnlPct,
    liveTotalPnl: liveTotalModePnl,
    livePnlPct,
    usedCapital,
    paperCapitalDeployed,
    liveCapitalDeployed,
    totalCapitalDeployed,
    paperMaxCapital,
    liveMaxCapital,
  };

  return (
    <div className="min-h-screen">
      <Header />

      <main className="pt-24 pb-12 px-4">
        <div className="max-w-7xl mx-auto">
          {/* Welcome + Status Bar */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6"
          >
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold mb-1">
                  Welcome back, <span className="text-gradient">{user?.name ?? 'Trader'}</span>
                </h1>
                <p className="text-[var(--color-text-secondary)] text-sm">
                  AI Trading Command Center — Monitor your bots and market signals
                </p>
              </div>
              {/* PnL Scope Toggle + Mode Badge — top right */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {/* LIVE / PAPER badge */}
                {liveStats.activeBots > 0 && (
                  <span style={{
                    padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px',
                    background: activeBotMode === 'live' ? 'rgba(239,68,68,0.15)' : 'rgba(6,182,212,0.1)',
                    color: activeBotMode === 'live' ? '#EF4444' : '#06B6D4',
                    border: `1px solid ${activeBotMode === 'live' ? 'rgba(239,68,68,0.3)' : 'rgba(6,182,212,0.2)'}`,
                  }}>
                    {activeBotMode === 'live' ? '⬤ LIVE' : 'PAPER'}
                  </span>
                )}
                <span style={{ fontSize: '11px', color: '#6B7280', fontWeight: 500 }}>PnL Scope:</span>
                <div style={{
                  display: 'inline-flex', borderRadius: '8px', overflow: 'hidden',
                  border: '1px solid rgba(6,182,212,0.2)', background: 'rgba(17,24,39,0.6)',
                }}>
                  {(['session', 'all'] as const).map((scope) => (
                    <button
                      key={scope}
                      onClick={() => setPnlScope(scope)}
                      style={{
                        padding: '4px 12px', fontSize: '11px', fontWeight: 600,
                        border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                        background: pnlScope === scope ? 'rgba(6,182,212,0.2)' : 'transparent',
                        color: pnlScope === scope ? '#06B6D4' : '#6B7280',
                        borderRight: scope === 'session' ? '1px solid rgba(6,182,212,0.15)' : 'none',
                      }}
                    >
                      {scope === 'session' ? 'This Session' : 'All Time'}
                    </button>
                  ))}
                </div>
                {pnlScope === 'session' && !currentSessionId && (
                  <span style={{ fontSize: '10px', color: '#F59E0B' }}>No active session</span>
                )}
              </div>
            </div>
          </motion.div>

          {/* ═══ Row 1: Regime + P&L ═══ */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mb-8"
          >
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1.4fr 0.5fr 1.4fr',
              gap: '20px',
            }}>
              <RegimeCard regime={regime} confidence={confidence} symbol={symbol} macroRegime={macroRegime} trend15m={trend15m} coinStates={multi?.coin_states} />

              {/* ═══ Synaptic Core Brain — Engine Status ═══ */}
              {(() => {
                const engineTs = botState?.multi?.timestamp || botState?.state?.timestamp;
                const cycle = botState?.multi?.cycle || 0;
                const coinsScanned = botState?.multi?.coins_scanned || 0;
                const isOn = engineTs && (Date.now() - new Date(engineTs).getTime()) < 600000;
                const bc = '#F0B90B'; // Binance yellow

                return (
                  <div style={{
                    background: 'transparent',
                    borderRadius: '20px', padding: '4px 20px',
                    display: 'flex', flexDirection: 'column' as const, alignItems: 'center',
                    justifyContent: 'center', minHeight: '150px',
                    position: 'relative' as const,
                  }}>
                    {/* Title on top */}
                    <div style={{ fontSize: '10px', fontWeight: 800, letterSpacing: '3px', textTransform: 'uppercase' as const, color: bc, marginBottom: '2px' }}>
                      Synaptic Core Brain
                    </div>
                    {isOn && (
                      <div style={{ fontSize: '10px', color: '#6B7280', marginBottom: '2px', fontFamily: 'monospace' }}>
                        Cycle #{cycle} Completed
                      </div>
                    )}
                    {/* SVG Wireframe Brain */}
                    <svg viewBox="0 0 200 180" style={{ width: '240px', height: '160px' }}>
                      <defs>
                        <filter id="brainGlow2">
                          <feGaussianBlur stdDeviation="3" result="blur" />
                          <feComposite in="SourceGraphic" in2="blur" operator="over" />
                        </filter>
                        <filter id="outerGlow">
                          <feGaussianBlur stdDeviation="6" result="blur" />
                          <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                          </feMerge>
                        </filter>
                        <radialGradient id="bgGlow2" cx="50%" cy="50%">
                          <stop offset="0%" stopColor={bc} stopOpacity="0.12" />
                          <stop offset="70%" stopColor={bc} stopOpacity="0.03" />
                          <stop offset="100%" stopColor={bc} stopOpacity="0" />
                        </radialGradient>
                      </defs>

                      {/* Radial background glow */}
                      <circle cx="100" cy="80" r="80" fill="url(#bgGlow2)">
                        {isOn && <animate attributeName="r" values="70;85;70" dur="3s" repeatCount="indefinite" />}
                      </circle>

                      {/* Brain outline — side profile */}
                      <g filter="url(#outerGlow)" opacity={isOn ? 1 : 0.3}>
                        {isOn && <animate attributeName="opacity" values="0.5;1;0.5" dur="1.5s" repeatCount="indefinite" />}
                        {/* Left hemisphere outline */}
                        <path d="M100,30 C65,30 40,50 38,75 C36,95 45,110 55,120 C60,125 62,132 65,140 L75,140 C72,130 68,120 60,115 C50,108 44,95 45,80 C46,60 65,42 95,40"
                          fill="none" stroke={bc} strokeWidth="1.5" strokeLinecap="round" />
                        {/* Right hemisphere outline */}
                        <path d="M100,30 C135,30 160,50 162,75 C164,95 155,110 145,120 C140,125 138,132 135,140 L125,140 C128,130 132,120 140,115 C150,108 156,95 155,80 C154,60 135,42 105,40"
                          fill="none" stroke={bc} strokeWidth="1.5" strokeLinecap="round" />
                        {/* Top curve */}
                        <path d="M72,38 C80,28 90,25 100,25 C110,25 120,28 128,38"
                          fill="none" stroke={bc} strokeWidth="1.2" strokeLinecap="round" />
                        {/* Brain folds — left */}
                        <path d="M55,65 C65,60 80,62 90,58" fill="none" stroke={bc} strokeWidth="0.8" opacity="0.6" />
                        <path d="M50,80 C62,75 78,78 92,72" fill="none" stroke={bc} strokeWidth="0.8" opacity="0.6" />
                        <path d="M52,95 C64,90 76,93 88,88" fill="none" stroke={bc} strokeWidth="0.8" opacity="0.5" />
                        {/* Brain folds — right */}
                        <path d="M145,65 C135,60 120,62 110,58" fill="none" stroke={bc} strokeWidth="0.8" opacity="0.6" />
                        <path d="M150,80 C138,75 122,78 108,72" fill="none" stroke={bc} strokeWidth="0.8" opacity="0.6" />
                        <path d="M148,95 C136,90 124,93 112,88" fill="none" stroke={bc} strokeWidth="0.8" opacity="0.5" />
                        {/* Central fissure */}
                        <path d="M100,30 L100,105" fill="none" stroke={bc} strokeWidth="0.6" opacity="0.4" strokeDasharray="4,3" />
                        {/* Brain stem */}
                        <path d="M92,120 C95,130 98,138 100,145 C102,138 105,130 108,120"
                          fill="none" stroke={bc} strokeWidth="1.2" opacity="0.7" />
                      </g>

                      {/* Neural network dots — scattered across brain */}
                      {isOn && [
                        [60, 55], [75, 45], [85, 65], [70, 85], [58, 100],
                        [140, 55], [125, 45], [115, 65], [130, 85], [142, 100],
                        [100, 50], [95, 75], [105, 75], [100, 95], [80, 105], [120, 105],
                      ].map(([x, y], i) => (
                        <circle key={i} cx={x} cy={y} r="1.5" fill={bc} opacity="0">
                          <animate attributeName="opacity" values="0;0.8;0" dur={`${1.5 + (i % 5) * 0.4}s`} begin={`${i * 0.2}s`} repeatCount="indefinite" />
                          <animate attributeName="r" values="1;2.5;1" dur={`${1.5 + (i % 5) * 0.4}s`} begin={`${i * 0.2}s`} repeatCount="indefinite" />
                        </circle>
                      ))}

                      {/* Connection lines between neural dots */}
                      {isOn && [
                        [60, 55, 85, 65], [75, 45, 100, 50], [85, 65, 100, 95],
                        [140, 55, 115, 65], [125, 45, 100, 50], [115, 65, 100, 95],
                        [70, 85, 95, 75], [130, 85, 105, 75], [80, 105, 100, 95], [120, 105, 100, 95],
                      ].map(([x1, y1, x2, y2], i) => (
                        <line key={`l${i}`} x1={x1} y1={y1} x2={x2} y2={y2}
                          stroke={bc} strokeWidth="0.4" opacity="0">
                          <animate attributeName="opacity" values="0;0.3;0" dur={`${2 + i * 0.3}s`} begin={`${i * 0.15}s`} repeatCount="indefinite" />
                        </line>
                      ))}
                    </svg>
                  </div>
                );
              })()}

              <PnlCard trades={trades} binanceBalance={walletBalance.binance} coinDcxBalance={walletBalance.coindcx} />
            </div>
          </motion.div>



          {/* ═══ Row 2: Quick SaaS Stats ═══ */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-6 mb-8"
          >
            <StatsCard
              title="Active Bots"
              value={liveStats.activeBots}
              animated
            />
            <StatsCard
              title="Active Trades"
              value={`${liveStats.activeTrades} · $${liveStats.usedCapital}${MAX_CAPITAL > 0 ? ` of $${MAX_CAPITAL}` : ''}`}
              animated
            />
            {/* Capital Deployed — wider card with paper/live emphasized */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="card-gradient rounded-xl p-5 glow-hover hover-lift lg:col-span-2"
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                <h3 className="text-sm text-[var(--color-text-secondary)]">Capital Deployed</h3>
                <span style={{ fontSize: '11px', color: '#6B7280', fontFamily: 'monospace' }}>
                  ${liveStats.totalCapitalDeployed}{MAX_CAPITAL > 0 ? ` / $${MAX_CAPITAL}` : ''}
                </span>
              </div>
              {/* Paper / Live split — used/max format */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '12px' }}>🟢</span>
                  <span style={{ fontSize: '12px', color: '#9CA3AF' }}>Paper</span>
                  <span style={{ fontSize: '16px', fontWeight: 700, color: '#22C55E', fontFamily: 'monospace' }}>
                    ${liveStats.paperCapitalDeployed}
                    {liveStats.paperMaxCapital > 0 && <span style={{ color: '#6B7280', fontWeight: 400, fontSize: '12px' }}>/{liveStats.paperMaxCapital}</span>}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '16px', fontWeight: 700, color: '#EF4444', fontFamily: 'monospace' }}>
                    ${liveStats.liveCapitalDeployed}
                    {liveStats.liveMaxCapital > 0 && <span style={{ color: '#6B7280', fontWeight: 400, fontSize: '12px' }}>/{liveStats.liveMaxCapital}</span>}
                  </span>
                  <span style={{ fontSize: '12px', color: '#9CA3AF' }}>Live</span>
                  <span style={{ fontSize: '12px' }}>🔴</span>
                </div>
              </div>
            </motion.div>
            <StatsCard
              title="Total Paper PnL"
              value={formatCurrency(liveStats.paperTotalPnl)}
              trend={liveStats.paperTotalPnl >= 0 ? 'up' : 'down'}
              trendValue={`${liveStats.paperPnlPct >= 0 ? '+' : ''}${liveStats.paperPnlPct.toFixed(1)}%`}
            />
            <StatsCard
              title="Total Live PnL"
              value={formatCurrency(liveStats.liveTotalPnl)}
              trend={liveStats.liveTotalPnl >= 0 ? 'up' : 'down'}
              trendValue={`${liveStats.livePnlPct >= 0 ? '+' : ''}${liveStats.livePnlPct.toFixed(1)}%`}
            />
          </motion.div>

          {/* ═══ Row 3: Bots Section ═══ */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="mb-12"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-cyan-400">Synaptic AI Bots Deployment · <span style={{ fontSize: '14px', color: '#9CA3AF' }}>${liveStats.totalCapitalDeployed}<span style={{ color: '#4B5563' }}>/{MAX_CAPITAL > 0 ? `$${MAX_CAPITAL}` : '—'}</span> active</span></h2>
              <Link
                href="/bots"
                className="px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg hover:bg-[var(--color-primary-dark)] transition-colors"
              >
                Manage Bots
              </Link>
            </div>

            {bots && bots.length > 0 ? (
              <div className="flex flex-col gap-3">
                {bots.map((bot) => {
                  // Filter trades for this specific bot
                  const botNameLower = (bot?.name || '').toLowerCase();
                  const botTrades = trades.filter((t: any) => {
                    // Direct botId match
                    if (t.bot_id && bot?.id && t.bot_id === bot.id) return true;
                    if (t.botId && bot?.id && t.botId === bot.id) return true;
                    // Bot name matching — extract model keyword for matching
                    const tradeBotName = (t.bot_name || t.botName || '').toLowerCase();
                    if (!tradeBotName) return false;
                    // Check if the model keyword (adaptive/standard/conservative) appears in both
                    const modelKeywords = ['adaptive', 'standard', 'conservative', 'aggressive'];
                    const tradeModel = modelKeywords.find(k => tradeBotName.includes(k));
                    const botModel = modelKeywords.find(k => botNameLower.includes(k));
                    if (tradeModel && botModel) return tradeModel === botModel;
                    // Fallback: direct name inclusion
                    return botNameLower.includes(tradeBotName) || tradeBotName.includes(botNameLower);
                  });
                  // If no trades matched, fall back to all trades only if there's exactly 1 bot
                  const displayTrades = botTrades.length > 0 ? botTrades : (bots.length === 1 ? trades : []);
                  return (
                    <BotCard key={bot?.id} bot={bot} onToggle={handleBotToggle} liveTradeCount={liveActiveTrades.length} trades={displayTrades} />
                  );
                })}
              </div>
            ) : (
              <div className="card-gradient p-12 rounded-xl text-center">
                <Bot className="w-16 h-16 text-[var(--color-primary)] mx-auto mb-4" />
                <h3 className="text-xl font-semibold mb-2">No Bots Yet</h3>
                <p className="text-[var(--color-text-secondary)] mb-4">
                  Deploy your first trading bot to get started
                </p>
                <Link
                  href="/bots"
                  className="inline-block px-6 py-3 bg-[var(--color-primary)] text-white rounded-lg hover:bg-[var(--color-primary-dark)] transition-colors"
                >
                  Deploy Bot
                </Link>
              </div>
            )}
          </motion.div>

          {/* ═══ Row 5: Recent Trades ═══ */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
          >
            <div style={{
              background: 'rgba(17, 24, 39, 0.85)',
              backdropFilter: 'blur(16px)',
              border: '1px solid rgba(6, 182, 212, 0.15)',
              borderRadius: '16px',
              overflow: 'hidden',
            }}>
              {/* Header bar */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '16px 24px',
                background: 'linear-gradient(135deg, rgba(6,182,212,0.08) 0%, rgba(139,92,246,0.06) 100%)',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    width: '8px', height: '8px', borderRadius: '50%',
                    background: liveTrades.length > 0 ? '#22C55E' : '#6B7280',
                    boxShadow: liveTrades.length > 0 ? '0 0 8px rgba(34,197,94,0.5)' : 'none',
                  }} />
                  <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#06B6D4', margin: 0 }}>
                    Recent Trades
                  </h2>
                  <span style={{
                    fontSize: '11px', padding: '2px 8px', borderRadius: '10px',
                    background: 'rgba(6,182,212,0.15)', color: '#06B6D4', fontWeight: 600
                  }}>
                    {liveTrades.length} total
                  </span>
                </div>
                <Link href="/trades" style={{
                  fontSize: '13px', color: '#06B6D4', fontWeight: 500,
                  textDecoration: 'none', padding: '4px 12px', borderRadius: '8px',
                  background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.2)',
                }}>
                  View All →
                </Link>
              </div>

              {liveTrades.length > 0 ? (
                <div style={{ overflowX: 'auto', maxHeight: '480px', overflowY: 'auto', padding: '0' }}>
                  <table style={{ width: '100%', minWidth: '1200px', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        {['Bot', 'Coin', 'Side', 'Entry', 'SL Price', 'Target', 'Status', 'PNL $', 'PNL %'].map(h => (
                          <th key={h} style={{
                            textAlign: 'left', padding: '12px 14px',
                            fontSize: '10px', fontWeight: 600, textTransform: 'uppercase',
                            letterSpacing: '0.8px', color: '#6B7280',
                            background: 'rgba(255,255,255,0.02)',
                            position: 'sticky', top: 0, zIndex: 1,
                          }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...liveTrades]
                        .sort((a: any, b: any) => {
                          const ta = a.entry_time || a.entryTime || a.timestamp || '';
                          const tb = b.entry_time || b.entryTime || b.timestamp || '';
                          return tb.localeCompare(ta); // latest first
                        })
                        .slice(0, 10)
                        .map((trade: any, i: number) => {
                          const sym = (trade.symbol || trade.coin || '').replace('USDT', '');
                          const side = (trade.side || trade.position || '').toUpperCase();
                          const entry = trade.entry_price || trade.entryPrice || 0;
                          const sl = trade.stop_loss || trade.stopLoss || 0;
                          const tp = trade.take_profit || trade.takeProfit || 0;
                          const status = (trade.status || '').toUpperCase();
                          const isLong = side === 'BUY' || side === 'LONG';
                          // Compute PNL from prices (avoids stale engine values)
                          const pnl = status === 'ACTIVE' ? computePnlFromPrices(trade) : (trade.realized_pnl || trade.pnl || 0);
                          const cap = trade.capital || trade.position_size || 100;
                          const pnlPct = cap > 0 ? (pnl / cap * 100) : 0;
                          const rowBg = status === 'ACTIVE'
                            ? pnl >= 0
                              ? 'rgba(34,197,94,0.04)'
                              : 'rgba(239,68,68,0.04)'
                            : 'transparent';
                          return (
                            <tr key={trade.trade_id || i} style={{
                              borderBottom: '1px solid rgba(255,255,255,0.04)',
                              background: rowBg,
                              transition: 'background 0.2s',
                            }}
                              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(6,182,212,0.06)')}
                              onMouseLeave={(e) => (e.currentTarget.style.background = rowBg)}
                            >
                              <td style={{ padding: '10px 14px', color: '#0891B2', fontWeight: 600, fontSize: '11px' }}>
                                {trade.bot_name || trade.profile_id || 'Synaptic Adaptive'}
                              </td>
                              <td style={{ padding: '10px 14px', fontWeight: 700, color: '#F0F4F8' }}>{sym}</td>
                              <td style={{ padding: '10px 14px' }}>
                                <span style={{
                                  padding: '3px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 700,
                                  background: isLong ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                                  color: isLong ? '#22C55E' : '#EF4444',
                                  border: `1px solid ${isLong ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                                }}>
                                  {side}
                                </span>
                              </td>
                              <td style={{ padding: '10px 14px', fontFamily: 'monospace', color: '#D1D5DB' }}>
                                ${Number(entry).toFixed(4)}
                              </td>
                              <td style={{ padding: '10px 14px', fontFamily: 'monospace', color: '#EF4444' }}>
                                ${Number(sl).toFixed(4)}
                              </td>
                              <td style={{ padding: '10px 14px', fontFamily: 'monospace', color: '#22C55E' }}>
                                ${Number(tp).toFixed(4)}
                              </td>
                              <td style={{ padding: '10px 14px' }}>
                                <span style={{
                                  padding: '3px 10px', borderRadius: '10px', fontSize: '10px', fontWeight: 700,
                                  background: status === 'ACTIVE' ? 'rgba(34,197,94,0.15)' : 'rgba(107,114,128,0.15)',
                                  color: status === 'ACTIVE' ? '#22C55E' : '#9CA3AF',
                                  boxShadow: status === 'ACTIVE' ? '0 0 6px rgba(34,197,94,0.2)' : 'none',
                                }}>
                                  ● {status}
                                </span>
                              </td>
                              <td style={{
                                padding: '10px 14px', fontWeight: 700, fontFamily: 'monospace',
                                color: pnl >= 0 ? '#22C55E' : '#EF4444',
                              }}>
                                {pnl >= 0 ? '+' : ''}${Number(pnl).toFixed(2)}
                              </td>
                              <td style={{
                                padding: '10px 14px', fontWeight: 700, fontFamily: 'monospace',
                                color: pnlPct >= 0 ? '#22C55E' : '#EF4444',
                              }}>
                                {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ padding: '48px 24px', textAlign: 'center' }}>
                  <Activity className="w-12 h-12 mx-auto mb-3" style={{ color: '#06B6D4', opacity: 0.5 }} />
                  <p style={{ color: '#6B7280', fontSize: '14px' }}>
                    No trades yet. Start the engine to begin trading.
                  </p>
                </div>
              )}
            </div>
          </motion.div>

          {/* ═══ Row 5: Signal Summary Table ═══ */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 }}
            className="mt-8"
          >
            <SignalSummaryTable coinStates={multi?.coin_states || {}} multi={multi} />
          </motion.div>
        </div>
      </main>

      {/* ═══ Admin: Data Feed Health ═══ */}
      {(user as any)?.role === 'admin' && (
        <div className="max-w-7xl mx-auto px-4 pb-12">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
            <div style={{
              background: 'rgba(17, 24, 39, 0.85)', backdropFilter: 'blur(16px)',
              border: '1px solid rgba(245,158,11,0.2)', borderRadius: '16px', overflow: 'hidden',
            }}>
              <div style={{
                padding: '16px 24px',
                background: 'linear-gradient(135deg, rgba(245,158,11,0.08) 0%, rgba(239,68,68,0.04) 100%)',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
              }}>
                <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#F59E0B', margin: 0 }}>🛡️ Data Feed Health</h2>
                <p style={{ fontSize: '12px', color: '#6B7280', marginTop: '2px' }}>Admin-only monitoring of external data sources</p>
              </div>
              <div style={{ padding: '20px 24px', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '16px' }}>
                {[
                  {
                    name: 'Engine Cycle',
                    status: botState?.multi?.cycle ? 'ok' : 'waiting',
                    detail: botState?.multi?.cycle ? `Cycle #${botState.multi.cycle}` : 'No cycles yet',
                    sub: botState?.multi?.timestamp ? `Last: ${new Date(botState.multi.timestamp).toLocaleTimeString()}` : 'Waiting…',
                  },
                  {
                    name: 'Binance API',
                    status: feedHealth?.liveMarket || 'checking',
                    detail: feedHealth?.liveMarket === 'ok' ? 'Connected' : 'Error',
                    sub: 'Funding rates & prices',
                  },
                  {
                    name: 'Fear & Greed',
                    status: feedHealth?.fearGreed || 'checking',
                    detail: feedHealth?.fearGreed === 'ok' ? 'Connected' : 'Error',
                    sub: 'alternative.me API',
                  },
                  {
                    name: 'Coin Scanner',
                    status: (botState?.multi?.coins_scanned || 0) > 0 ? 'ok' : 'waiting',
                    detail: `${botState?.multi?.coins_scanned || 0} coins`,
                    sub: `${botState?.multi?.eligible_count || 0} eligible`,
                  },
                  {
                    name: 'Tradebook',
                    status: (botState?.tradebook?.trades?.length || 0) > 0 ? 'ok' : 'waiting',
                    detail: `${botState?.tradebook?.trades?.length || 0} trades`,
                    sub: 'tradebook.json',
                  },
                ].map(feed => {
                  const color = feed.status === 'ok' ? '#22C55E' : feed.status === 'error' ? '#EF4444' : '#F59E0B';
                  return (
                    <div key={feed.name} style={{
                      background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
                      borderRadius: '12px', padding: '16px', textAlign: 'center',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginBottom: '8px' }}>
                        <div style={{
                          width: '8px', height: '8px', borderRadius: '50%', background: color,
                          boxShadow: `0 0 8px ${color}44`,
                        }} />
                        <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#9CA3AF' }}>{feed.name}</span>
                      </div>
                      <div style={{ fontSize: '16px', fontWeight: 700, color }}>{feed.detail}</div>
                      <div style={{ fontSize: '10px', color: '#6B7280', marginTop: '4px' }}>{feed.sub}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* ═══ Admin: Engine Console (live logs) ═══ */}
      {(user as any)?.role === 'admin' && (
        <div className="max-w-7xl mx-auto px-4 pb-12">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}>
            <EngineConsole />
          </motion.div>
        </div>
      )}
    </div>
  );
}
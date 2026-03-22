import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/prisma';
import { getEngineUrl, type EngineMode } from '@/lib/engine-url';

export const dynamic = 'force-dynamic';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RawEngineTrade {
  trade_id?: string;
  symbol?: string;
  coin?: string;
  side?: string;
  position?: string;
  mode?: string;
  leverage?: number;
  capital?: number;
  entry_price?: number;
  current_price?: number;
  exit_price?: number;
  stop_loss?: number;
  take_profit?: number;
  status?: string;
  unrealized_pnl?: number;
  unrealized_pnl_pct?: number;
  realized_pnl?: number;
  pnl?: number;
  pnl_pct?: number;
  exit_reason?: string;
  entry_time?: string;
  entry_timestamp?: string;
  exit_time?: string;
  exit_timestamp?: string;
  bot_id?: string;
  bot_name?: string;
  user_id?: string;
  regime?: string;
  confidence?: number;
  all_bot_ids?: string[];
  trailing_sl?: number;
  trailing_active?: boolean;
  stepped_lock_level?: number;
  trail_sl_count?: number;
  exit_guard_active?: boolean;
  exit_check_at?: string;
  exit_check_price?: number;
  fill_latency_ms?: number;
  slippage?: number;
  exchange_fee?: number;
  exchange_order_id?: string;
}

// ─── Fetch engine trades ──────────────────────────────────────────────────────

async function fetchEngineTradesForMode(mode: EngineMode): Promise<RawEngineTrade[]> {
  const url = getEngineUrl(mode);
  if (!url) return [];
  try {
    const res = await fetch(`${url}/api/all`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = await res.json();
      return (data?.tradebook?.trades || []) as RawEngineTrade[];
    }
  } catch { /* engine unavailable */ }
  return [];
}

// ─── Metrics computation ──────────────────────────────────────────────────────

function computeMetrics(prismaClosedTrades: any[], engineActiveTrades: RawEngineTrade[]) {
  const activePnl = engineActiveTrades.reduce((s, t) => s + (t.unrealized_pnl || 0), 0);
  const closedPnl = prismaClosedTrades.reduce((s, t) => s + (t.totalPnl || 0), 0);
  const wins = prismaClosedTrades.filter(t => (t.totalPnl || 0) > 0);
  const losses = prismaClosedTrades.filter(t => (t.totalPnl || 0) <= 0);
  const winRate = prismaClosedTrades.length > 0 ? wins.length / prismaClosedTrades.length : 0;
  const grossProfit = wins.reduce((s, t) => s + (t.totalPnl || 0), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.totalPnl || 0), 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;
  const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 1;
  const avgRR = avgLoss > 0 ? avgWin / avgLoss : 0;
  const expectancy = (winRate * avgWin) - ((1 - winRate) * avgLoss);

  // Max drawdown from cumulative closed PnL
  const sorted = [...prismaClosedTrades].sort((a, b) =>
    new Date(a.entryTime || 0).getTime() - new Date(b.entryTime || 0).getTime()
  );
  let peak = 0, trough = 0, cumPnl = 0, maxDD = 0;
  sorted.forEach(t => {
    cumPnl += t.totalPnl || 0;
    if (cumPnl > peak) peak = cumPnl;
    trough = peak - cumPnl;
    if (trough > maxDD) maxDD = trough;
  });
  const maxDrawdownPct = peak > 0 ? (maxDD / peak) * 100 : 0;

  // Daily PnL for heatmap
  const dailyMap: Record<string, number> = {};
  prismaClosedTrades.forEach(t => {
    if (!t.exitTime) return;
    const day = new Date(t.exitTime).toISOString().slice(0, 10);
    dailyMap[day] = (dailyMap[day] || 0) + (t.totalPnl || 0);
  });
  const dailyPnl = Object.entries(dailyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, pnl]) => ({ date, pnl: Math.round(pnl * 100) / 100 }));

  // Equity curve — 25 evenly sampled points from closed trade history
  const equityPoints: { ts: string; value: number }[] = [];
  let cum = 0;
  const step = Math.max(1, Math.floor(sorted.length / 25));
  sorted.forEach((t, i) => {
    cum += t.totalPnl || 0;
    if (i % step === 0 || i === sorted.length - 1) {
      equityPoints.push({ ts: t.exitTime || t.entryTime, value: Math.round(cum * 100) / 100 });
    }
  });
  // Clamp to 25 points
  const equityCurve = equityPoints.slice(-25);

  // Sharpe estimate from daily PnL series (need ≥ 5 days)
  let sharpeEstimate = 0;
  if (dailyPnl.length >= 5) {
    const vals = dailyPnl.map(d => d.pnl);
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const variance = vals.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / vals.length;
    const std = Math.sqrt(variance);
    sharpeEstimate = std > 0 ? Math.round((mean / std) * Math.sqrt(365) * 100) / 100 : 0;
  }

  // Execution metrics for live trades
  const avgFillLatencyMs = (() => {
    const lats = prismaClosedTrades.filter(t => t.fillLatencyMs).map(t => t.fillLatencyMs as number);
    return lats.length > 0 ? Math.round(lats.reduce((s, v) => s + v, 0) / lats.length) : null;
  })();
  const avgSlippage = (() => {
    const slips = prismaClosedTrades.filter(t => t.slippage != null && t.slippage !== 0).map(t => t.slippage as number);
    return slips.length > 0 ? Math.round(slips.reduce((s, v) => s + v, 0) / slips.length * 10000) / 10000 : null;
  })();

  return {
    totalTrades: prismaClosedTrades.length + engineActiveTrades.length,
    activeTrades: engineActiveTrades.length,
    closedTrades: prismaClosedTrades.length,
    winRate: Math.round(winRate * 1000) / 10,
    profitFactor: Math.round(profitFactor * 100) / 100,
    expectancy: Math.round(expectancy * 100) / 100,
    avgRR: Math.round(avgRR * 100) / 100,
    totalPnl: Math.round((closedPnl + activePnl) * 100) / 100,
    realizedPnl: Math.round(closedPnl * 100) / 100,
    unrealizedPnl: Math.round(activePnl * 100) / 100,
    maxDrawdownPct: Math.round(maxDrawdownPct * 100) / 100,
    sharpeEstimate,
    equityCurve,
    dailyPnl,
    avgFillLatencyMs,
    avgSlippage,
  };
}

// ─── Map engine trade to response shape ──────────────────────────────────────

function mapEngineTrade(t: RawEngineTrade, source: 'engine' | 'prisma' = 'engine') {
  const sym = t.symbol || t.coin || '';
  const isActive = (t.status || '').toLowerCase() === 'active';
  return {
    id: t.trade_id || `eng-${sym}-${Date.now()}`,
    coin: sym.replace('USDT', ''),
    symbol: sym,
    side: (t.side || t.position || '').toLowerCase(),
    mode: ((t.mode || 'paper').toLowerCase().includes('live') ? 'live' : 'paper') as 'paper' | 'live',
    leverage: t.leverage || 1,
    capital: t.capital || 0,
    entryPrice: t.entry_price || 0,
    currentPrice: t.current_price || null,
    exitPrice: t.exit_price || null,
    stopLoss: t.stop_loss || 0,
    takeProfit: t.take_profit || 0,
    status: isActive ? 'active' : 'closed',
    activePnl: t.unrealized_pnl || 0,
    activePnlPct: t.unrealized_pnl_pct || 0,
    totalPnl: t.realized_pnl || t.pnl || 0,
    totalPnlPct: t.pnl_pct || 0,
    exitReason: t.exit_reason || null,
    entryTime: t.entry_time || t.entry_timestamp || new Date().toISOString(),
    exitTime: t.exit_time || t.exit_timestamp || null,
    botId: t.bot_id || null,
    botName: t.bot_name || 'Bot',
    regime: t.regime || '',
    confidence: t.confidence || 0,
    trailingSl: t.trailing_sl || null,
    trailingActive: t.trailing_active || false,
    steppedLockLevel: t.stepped_lock_level ?? -1,
    trailSlCount: t.trail_sl_count || 0,
    exitGuardActive: t.exit_guard_active ?? true,
    exitCheckAt: t.exit_check_at || null,
    exitCheckPrice: t.exit_check_price || null,
    fillLatencyMs: t.fill_latency_ms || null,
    slippage: t.slippage || null,
    exchangeFee: t.exchange_fee || null,
    source,
  };
}

function mapPrismaTrade(t: any) {
  return {
    id: t.id,
    coin: (t.coin || '').replace('USDT', ''),
    symbol: t.coin || '',
    side: (t.position || '').toLowerCase(),
    mode: (t.mode || 'paper') as 'paper' | 'live',
    leverage: t.leverage || 1,
    capital: t.capital || 0,
    entryPrice: t.entryPrice || 0,
    currentPrice: t.currentPrice || null,
    exitPrice: t.exitPrice || null,
    stopLoss: t.stopLoss || 0,
    takeProfit: t.takeProfit || 0,
    status: (t.status || 'closed').toLowerCase(),
    activePnl: t.activePnl || 0,
    activePnlPct: t.activePnlPercent || 0,
    totalPnl: t.totalPnl || 0,
    totalPnlPct: t.totalPnlPercent || 0,
    exitReason: t.exitReason || null,
    entryTime: t.entryTime?.toISOString() || new Date().toISOString(),
    exitTime: t.exitTime?.toISOString() || null,
    botId: t.botId || null,
    botName: t.bot?.name || 'Bot',
    regime: t.regime || '',
    confidence: t.confidence || 0,
    trailingSl: t.trailingSl || null,
    trailingActive: t.trailingActive || false,
    steppedLockLevel: t.steppedLockLevel ?? -1,
    trailSlCount: t.trailSlCount || 0,
    exitGuardActive: t.exitGuardActive ?? true,
    exitCheckAt: t.exitCheckAt?.toISOString() || null,
    exitCheckPrice: t.exitCheckPrice || null,
    fillLatencyMs: null,
    slippage: null,
    exchangeFee: null,
    source: 'prisma' as const,
  };
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const userId = (session.user as any).id;
    const { searchParams } = new URL(req.url);
    const mode = (searchParams.get('mode') || 'paper') as 'paper' | 'live' | 'all';
    const statusFilter = searchParams.get('status') || 'all';

    // Fetch user bots (needed to scope Prisma query and engine bot IDs)
    const userBots = await prisma.bot.findMany({
      where: { userId },
      include: { config: true },
      orderBy: { updatedAt: 'desc' },
    });
    const userBotIds = userBots.map(b => b.id);

    if (userBotIds.length === 0) {
      return NextResponse.json({ trades: [], metrics: computeMetrics([], []), bots: [] });
    }

    // Determine which engine modes to fetch
    const modesToFetch: EngineMode[] = mode === 'all' ? ['paper', 'live'] : [mode as EngineMode];

    // Fetch engine trades for each mode (cached per mode)
    const engineTradesByMode: Record<string, RawEngineTrade[]> = {};
    await Promise.all(modesToFetch.map(async (m) => {
      engineTradesByMode[m] = await fetchEngineTradesForMode(m);
    }));

    // Filter engine trades to only this user's bots
    const allEngineTrades = modesToFetch.flatMap(m => engineTradesByMode[m]);
    const userEngineActiveTrades = allEngineTrades.filter(t => {
      if (!t.bot_id) return false;
      if (!userBotIds.includes(t.bot_id)) return false;
      const isActive = (t.status || '').toLowerCase() === 'active';
      return isActive;
    });

    // Fetch closed trades from Prisma
    const whereClause: any = { botId: { in: userBotIds }, status: 'closed' };
    if (mode !== 'all') whereClause.mode = mode;
    const prismaClosedTrades = await prisma.trade.findMany({
      where: whereClause,
      include: { bot: { select: { name: true } } },
      orderBy: { entryTime: 'desc' },
      take: 500,
    });

    // Also fetch active Prisma trades (for bots not currently in engine)
    const prismaActiveTrades = await prisma.trade.findMany({
      where: { botId: { in: userBotIds }, status: 'active', ...(mode !== 'all' ? { mode } : {}) },
      include: { bot: { select: { name: true } } },
      orderBy: { entryTime: 'desc' },
    });

    // Merge: engine active trades take priority; Prisma active as fallback
    const engineActiveIds = new Set(userEngineActiveTrades.map(t => t.trade_id).filter(Boolean));
    const prismaActiveFallback = prismaActiveTrades.filter(t => {
      // Only include if not already represented in engine trades
      const matchedInEngine = userEngineActiveTrades.some(et =>
        et.symbol === t.coin && et.bot_id === t.botId
      );
      return !matchedInEngine;
    });

    // Build final trades list
    const activeTrades = [
      ...userEngineActiveTrades.map(t => mapEngineTrade(t, 'engine')),
      ...prismaActiveFallback.map(t => mapPrismaTrade(t)),
    ];
    const closedTrades = prismaClosedTrades.map(t => mapPrismaTrade(t));

    let allTrades = [...activeTrades, ...closedTrades];
    if (statusFilter === 'active') allTrades = activeTrades;
    if (statusFilter === 'closed') allTrades = closedTrades;

    // Compute metrics
    const metrics = computeMetrics(prismaClosedTrades, userEngineActiveTrades);

    // Bot summary
    const bots = userBots.map(b => ({
      id: b.id,
      name: b.name,
      mode: (b.config as any)?.mode || 'paper',
      status: b.status,
      isActive: b.isActive,
    }));

    return NextResponse.json({ trades: allTrades, metrics, bots });
  } catch (err: any) {
    console.error('[/api/journal] Error:', err);
    return NextResponse.json({ error: 'Failed to fetch journal data', detail: String(err) }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

function computeHealthScore(metrics: {
  sharpeEstimate: number;
  winRate: number;
  profitFactor: number;
  maxDrawdownPct: number;
}): number {
  const sharpeScore = Math.min(1, Math.max(0, metrics.sharpeEstimate / 2)) * 25;
  const winRateScore = Math.min(1, Math.max(0, metrics.winRate / 100)) * 25;
  const pfScore = metrics.profitFactor >= 999
    ? 25
    : Math.min(1, Math.max(0, (metrics.profitFactor - 1) / 2)) * 25;
  const ddScore = Math.min(1, Math.max(0, 1 - metrics.maxDrawdownPct / 50)) * 25;
  return Math.round(sharpeScore + winRateScore + pfScore + ddScore);
}

function computeBotMetrics(trades: any[]) {
  const closed = trades.filter(t => (t.status || '').toLowerCase() !== 'active');
  const active = trades.filter(t => (t.status || '').toLowerCase() === 'active');
  const wins = closed.filter(t => (t.totalPnl || 0) > 0);
  const losses = closed.filter(t => (t.totalPnl || 0) <= 0);
  const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;
  const grossProfit = wins.reduce((s, t) => s + (t.totalPnl || 0), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.totalPnl || 0), 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;
  const totalPnl = closed.reduce((s, t) => s + (t.totalPnl || 0), 0);

  // Max drawdown
  let peak = 0, cumPnl = 0, maxDD = 0;
  [...closed].sort((a, b) =>
    new Date(a.entryTime || 0).getTime() - new Date(b.entryTime || 0).getTime()
  ).forEach(t => {
    cumPnl += t.totalPnl || 0;
    if (cumPnl > peak) peak = cumPnl;
    const dd = peak - cumPnl;
    if (dd > maxDD) maxDD = dd;
  });
  const maxDrawdownPct = peak > 0 ? (maxDD / peak) * 100 : 0;

  // Sharpe from daily PnL
  const dailyMap: Record<string, number> = {};
  closed.forEach(t => {
    if (!t.exitTime) return;
    const day = new Date(t.exitTime).toISOString().slice(0, 10);
    dailyMap[day] = (dailyMap[day] || 0) + (t.totalPnl || 0);
  });
  const dailyVals = Object.values(dailyMap);
  let sharpeEstimate = 0;
  if (dailyVals.length >= 5) {
    const mean = dailyVals.reduce((s, v) => s + v, 0) / dailyVals.length;
    const std = Math.sqrt(dailyVals.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / dailyVals.length);
    sharpeEstimate = std > 0 ? Math.round((mean / std) * Math.sqrt(365) * 100) / 100 : 0;
  }

  // 25-point equity sparkline
  const sortedClosed = [...closed].sort((a, b) =>
    new Date(a.entryTime || 0).getTime() - new Date(b.entryTime || 0).getTime()
  );
  let cum = 0;
  const step = Math.max(1, Math.floor(sortedClosed.length / 25));
  const rawSparkline: number[] = [];
  sortedClosed.forEach((t, i) => {
    cum += t.totalPnl || 0;
    if (i % step === 0 || i === sortedClosed.length - 1) rawSparkline.push(Math.round(cum * 100) / 100);
  });
  const sparkline = rawSparkline.slice(-25);

  const healthScore = computeHealthScore({ sharpeEstimate, winRate, profitFactor, maxDrawdownPct });

  return {
    totalTrades: trades.length,
    activeTrades: active.length,
    closedTrades: closed.length,
    winRate: Math.round(winRate * 10) / 10,
    profitFactor: Math.round(profitFactor * 100) / 100,
    totalPnl: Math.round(totalPnl * 100) / 100,
    maxDrawdownPct: Math.round(maxDrawdownPct * 100) / 100,
    sharpeEstimate,
    healthScore,
    sparkline,
  };
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const userId = (session.user as any).id;

    // Fetch all user bots with their trades
    const bots = await prisma.bot.findMany({
      where: { userId },
      include: {
        config: true,
        trades: {
          orderBy: { entryTime: 'asc' },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (bots.length === 0) {
      return NextResponse.json({ bots: [] });
    }

    // Compute metrics per bot and rank
    const botsWithMetrics = bots.map(b => {
      const metrics = computeBotMetrics(b.trades);
      return {
        id: b.id,
        name: b.name,
        mode: (b.config as any)?.mode || 'paper',
        status: b.status,
        isActive: b.isActive,
        exchange: b.exchange,
        segment: (b.config as any)?.segment || 'ALL',
        createdAt: b.createdAt.toISOString(),
        metrics: {
          totalTrades: metrics.totalTrades,
          activeTrades: metrics.activeTrades,
          closedTrades: metrics.closedTrades,
          winRate: metrics.winRate,
          profitFactor: metrics.profitFactor,
          totalPnl: metrics.totalPnl,
          maxDrawdownPct: metrics.maxDrawdownPct,
          sharpeEstimate: metrics.sharpeEstimate,
          healthScore: metrics.healthScore,
        },
        sparkline: metrics.sparkline,
        rank: 0, // assigned after sort
      };
    });

    // Sort by healthScore desc, assign rank
    botsWithMetrics.sort((a, b) => b.metrics.healthScore - a.metrics.healthScore);
    botsWithMetrics.forEach((b, i) => { b.rank = i + 1; });

    return NextResponse.json({ bots: botsWithMetrics });
  } catch (err: any) {
    console.error('[/api/journal/fleet] Error:', err);
    return NextResponse.json({ error: 'Fleet data failed', detail: String(err) }, { status: 500 });
  }
}

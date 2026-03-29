import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';
import { DashboardClient } from './dashboard-client';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  // ── Auth & user fetch OUTSIDE try/catch so redirect() always fires ──────
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/login');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      subscription: true,
      bots: {
        where: { status: { not: 'retired' } }, // exclude retired — lives in Segment Panel
        include: {
          config: { select: { mode: true, maxOpenTrades: true, capitalPerTrade: true } },
          _count: { select: { trades: true } },
        },
      },
    },
  });

  if (!user) redirect('/login');

  // ── Data queries — wrap in try/catch for non-critical errors only ────────
  try {
    const [activeTrades, totalTrades, trades] = await Promise.all([
      // Exclude trades from retired bots — their data lives in Segment Performance panel
      prisma.trade.count({ where: { bot: { userId: user.id, status: { not: 'retired' } }, status: 'active' } }),
      prisma.trade.count({ where: { bot: { userId: user.id, status: { not: 'retired' } } } }),
      prisma.trade.findMany({
        where: { bot: { userId: user.id, status: { not: 'retired' } } },
        orderBy: { entryTime: 'desc' },
        take: 10,
      }),
    ]);

    const totalPnl = trades.reduce((sum, trade) => sum + (trade?.totalPnl ?? 0), 0);
    const activePnl = trades
      .filter((t) => t?.status === 'active')
      .reduce((sum, trade) => sum + (trade?.activePnl ?? 0), 0);

    // Fetch segment performance (retired bots only) for the panel
    let segmentPerf: any[] = [];
    try {
      const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
      const segRes = await fetch(`${baseUrl}/api/performance/segment`, {
        cache: 'no-store',
        headers: { Cookie: '' },
      });
      if (segRes.ok) { const sd = await segRes.json(); segmentPerf = sd.segments || []; }
    } catch { /* silent — non-critical */ }

    return (
      <DashboardClient
        user={{
          id: user.id,
          name: user?.name ?? '',
          email: user.email,
          subscription: user?.subscription ?? null,
          role: (user as any)?.role ?? null,
        }}
        stats={{
          activeBots: user.bots.filter((b) => b?.isActive ?? false).length,
          totalBots: user.bots.length,
          activeTrades,
          totalTrades,
          totalPnl,
          activePnl,
        }}
        bots={user.bots.map((bot) => ({
          id: bot.id,
          name: bot.name,
          exchange: bot.exchange,
          status: bot.status,
          isActive: bot?.isActive ?? false,
          startedAt: bot?.startedAt ?? null,
          config: bot?.config ? {
            mode: bot.config.mode,
            maxTrades: bot.config.maxOpenTrades,
            capitalPerTrade: bot.config.capitalPerTrade,
          } : null,
          _count: { trades: bot?._count?.trades ?? 0 },
        }))}
        segmentPerf={segmentPerf}
        recentTrades={trades.map((trade) => ({
          id: trade.id,
          coin: trade.coin,
          position: trade.position,
          regime: trade.regime,
          confidence: trade.confidence,
          leverage: trade.leverage,
          capital: trade.capital,
          entryPrice: trade.entryPrice,
          currentPrice: trade?.currentPrice ?? null,
          exitPrice: trade?.exitPrice ?? null,
          stopLoss: trade.stopLoss,
          takeProfit: trade.takeProfit,
          status: trade.status,
          activePnl: trade.activePnl,
          activePnlPercent: trade.activePnlPercent,
          totalPnl: trade.totalPnl,
          totalPnlPercent: trade.totalPnlPercent,
          exitPercent: trade?.exitPercent ?? null,
          entryTime: trade.entryTime.toISOString(),
          exitTime: trade?.exitTime?.toISOString?.() ?? null,
        }))}
      />
    );
  } catch (error) {
    console.error('Dashboard data error:', error);
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)]">
        <div className="text-center space-y-4">
          <h2 className="text-2xl font-bold text-[var(--color-danger)]">Error Loading Dashboard</h2>
          <p className="text-[var(--color-text-secondary)]">Please try refreshing the page</p>
          <a
            href="/api/auth/signout?callbackUrl=/login"
            className="inline-block mt-4 px-4 py-2 bg-red-500/20 border border-red-400/40 text-red-300 rounded-lg text-sm hover:bg-red-500/30 transition-colors"
          >
            🚪 Sign Out &amp; Re-login
          </a>
        </div>
      </div>
    );
  }
}
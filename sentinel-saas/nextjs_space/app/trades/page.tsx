import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth-options';
import { TradesClient } from './trades-client';
import { prisma } from '@/lib/prisma';
import { syncEngineTrades, getUserTrades } from '@/lib/sync-engine-trades';
import { getEngineUrl, type EngineMode } from '@/lib/engine-url';

export const dynamic = 'force-dynamic';

async function fetchEngineTradesAll(mode: EngineMode = 'paper'): Promise<any[]> {
  const url = getEngineUrl(mode);
  if (!url) return [];
  try {
    const res = await fetch(`${url}/api/all`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = await res.json();
      return data?.tradebook?.trades || [];
    }
  } catch { /* engine unavailable */ }
  return [];
}

function mapTrade(t: any) {
  const rawStatus = (t.status || '').toLowerCase().trim();
  const hasExit = !!(t.exit_time || t.exit_timestamp || t.exitTime || t.exit_price || t.exitPrice);
  const hasExitReason = !!(t.exit_reason || t.exitReason);
  const status = (rawStatus === 'active' && !hasExit && !hasExitReason) ? 'active' : 'closed';
  const baseId = t.trade_id || t.id || `T-${Math.random().toString(36).slice(2, 8)}`;
  const sym = t.symbol || t.coin || '';
  return {
    id: `${baseId}-${sym}`,
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
    stopLoss: t.stop_loss || t.stopLoss || 0,
    takeProfit: t.take_profit || t.takeProfit || 0,
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
    botName: t.bot_name || t.botName || 'Unknown Bot',
    botId: t.bot_id || t.botId || null,
    sessionId: t.sessionId ?? null,
    fee: t.exchange_fee || t.commission || t.fee || 0,
  };
}

export default async function TradesPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect('/login');

  const userId = (session.user as any)?.id;

  // MULTI-BOT + ISOLATION FIX: sync each bot from its OWN engine
  const userBots = await prisma.bot.findMany({
    where: { userId },
    include: { config: true },
    orderBy: { updatedAt: 'desc' },
  });

  // Sync each bot from its own engine (paper or live)
  const engineTradeCache: Record<string, any[]> = {};
  for (const ub of userBots) {
    // Use startedAt as the filter date; fall back to epoch so newly-created bots
    // (startedAt=null) still sync all available engine trades rather than being skipped.
    const syncFrom = ub.startedAt ?? new Date(0);
    const botMode: EngineMode = ((ub.config as any)?.mode || 'paper').toLowerCase().includes('live') ? 'live' : 'paper';
    try {
      if (!engineTradeCache[botMode]) {
        engineTradeCache[botMode] = await fetchEngineTradesAll(botMode);
      }
      if (engineTradeCache[botMode].length > 0) {
        await syncEngineTrades(engineTradeCache[botMode], ub.id, syncFrom);
      }
    } catch (err) {
      console.error(`[trades-page] Sync failed for bot ${ub.id} (${botMode}):`, err);
    }
  }

  const prismaTrades = await getUserTrades(userId);
  const trades = prismaTrades.map(mapTrade);

  return <TradesClient trades={trades} />;
}

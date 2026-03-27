import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getUserTrades } from '@/lib/sync-engine-trades';

export const dynamic = 'force-dynamic';

/**
 * GET /api/live-trades
 * Returns all active LIVE mode trades for the authenticated user.
 */
export async function GET(_req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = (session.user as any).id;

    // Reuse the same getUserTrades helper used in /api/trades.
    // Filter: ACTIVE status, live mode — returns normalized trade objects.
    const allTrades = await getUserTrades(userId, 'active', undefined, 'live');

    const trades = allTrades.map((t: any) => ({
      id: t.id || t.trade_id,
      trade_id: t.trade_id,
      symbol: t.symbol || t.coin || '',
      side: t.side || t.position || '',
      mode: t.mode || 'live',
      leverage: t.leverage || 1,
      capital: t.capital || t.position_size || 100,
      entry_price: t.entry_price || t.entryPrice || 0,
      current_price: t.current_price || t.currentPrice || null,
      stop_loss: t.stop_loss || t.stopLoss || 0,
      take_profit: t.take_profit || t.takeProfit || 0,
      status: t.status || 'ACTIVE',
      unrealized_pnl: t.unrealized_pnl || t.activePnl || 0,
      entry_time: t.entry_time || t.entryTime || new Date().toISOString(),
      bot_name: t.bot_name || 'Unknown Bot',
      bot_id: t.bot_id || null,
      session_id: t.sessionId || null,
    }));

    return NextResponse.json({ trades, total: trades.length });
  } catch (err: any) {
    console.error('[live-trades] error:', err);
    return NextResponse.json({ error: 'Internal error', detail: err?.message }, { status: 500 });
  }
}

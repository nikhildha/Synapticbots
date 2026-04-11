import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';
import { getEngineUrl } from '@/lib/engine-url';
import { buildCloseData } from '@/lib/trade-utils';

export const dynamic = 'force-dynamic';

/** POST /api/admin/reset-all-bots
 *  Admin-only: stops all bots across ALL users, closes all active trades,
 *  and signals the paper engine to reload its bot list.
 */
export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only admins
    const user = await prisma.user.findUnique({ where: { id: session.user.id } });
    if ((user as any)?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    }

    const engineUrl = getEngineUrl('paper');

    // 1. Fetch all active bots across all users
    const allActiveBots = await prisma.bot.findMany({
      where: { isActive: true },
      select: { id: true, userId: true },
    });

    let closedTrades = 0;
    for (const bot of allActiveBots) {
      // Remove from engine
      if (engineUrl) {
        try {
          await fetch(`${engineUrl}/api/remove-bot-id`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bot_id: bot.id }),
            signal: AbortSignal.timeout(3000),
          });
        } catch { /* engine may be offline */ }
      }

      // Close all active trades for this bot
      const activeTrades = await prisma.trade.findMany({
        where: { botId: bot.id, status: { in: ['active', 'ACTIVE'] } },
      });
      for (const trade of activeTrades) {
        try {
          await prisma.trade.update({
            where: { id: trade.id },
            data: buildCloseData(trade, 'ADMIN_RESET'),
          });
          closedTrades++;
        } catch { /* skip */ }
      }
    }

    // 2. Stop all bots
    const { count: botCount } = await prisma.bot.updateMany({
      where: { isActive: true },
      data: { isActive: false, status: 'stopped', stoppedAt: new Date() },
    });

    // 3. Signal engine to clear and reload
    if (engineUrl) {
      try {
        await fetch(`${engineUrl}/api/reload-bots`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'clear_all' }),
          signal: AbortSignal.timeout(5000),
        });
      } catch { /* engine may be offline — bots will reload on next DB sync */ }
    }

    console.log(`[admin/reset-all-bots] Stopped ${botCount} bots, closed ${closedTrades} trades (admin: ${session.user.id})`);
    return NextResponse.json({ success: true, botsStopped: botCount, tradesClosed: closedTrades });
  } catch (error: any) {
    console.error('[admin/reset-all-bots] error:', error);
    return NextResponse.json({ error: 'Failed to reset all bots' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';
import { getEngineUrl } from '@/lib/engine-url';
import { closeBotSession } from '@/lib/bot-session';
import { buildCloseData } from '@/lib/trade-utils';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const runningBots = await prisma.bot.findMany({
      where: { userId: session.user.id, isActive: true },
      include: { config: true },
    });

    if (runningBots.length === 0) {
      return NextResponse.json({ success: true, count: 0 });
    }

    const paperEngineUrl = getEngineUrl('paper');

    for (const bot of runningBots) {
      // Close bot session
      try { await closeBotSession(bot.id); } catch { /* silent */ }

      // Remove from engine active bots list
      if (paperEngineUrl) {
        try {
          await fetch(`${paperEngineUrl}/api/remove-bot-id`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bot_id: bot.id }),
            signal: AbortSignal.timeout(5000),
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
            data: buildCloseData(trade, 'STOP_ALL'),
          });
        } catch { /* skip — bot stop should not fail due to a single trade */ }
      }
    }

    // Bulk update all to stopped
    await prisma.bot.updateMany({
      where: { userId: session.user.id, isActive: true },
      data: { isActive: false, status: 'stopped', stoppedAt: new Date() },
    });

    console.log(`[stop-all] Stopped ${runningBots.length} bots for user ${session.user.id}`);
    return NextResponse.json({ success: true, count: runningBots.length });
  } catch (error: any) {
    console.error('stop-all error:', error);
    return NextResponse.json({ error: 'Failed to stop all bots' }, { status: 500 });
  }
}

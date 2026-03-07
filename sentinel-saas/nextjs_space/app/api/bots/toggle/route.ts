import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';
import { checkSubscription } from '@/lib/subscription';
import { createBotSession, closeBotSession } from '@/lib/bot-session';

export const dynamic = 'force-dynamic';

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:5000';

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { botId, isActive } = await request.json();

    if (!botId) {
      return NextResponse.json({ error: 'botId required' }, { status: 400 });
    }

    // ─── Block starting bots if subscription expired (stopping is always OK) ──
    if (isActive) {
      const subStatus = await checkSubscription(session.user.id);
      if (!subStatus.isActive) {
        return NextResponse.json(
          { error: subStatus.message, expired: true },
          { status: 403 }
        );
      }
    }

    // Verify ownership (include config for mode)
    const bot = await prisma.bot.findFirst({
      where: { id: botId, userId: session.user.id },
      include: { config: true },
    });

    if (!bot) {
      return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
    }

    // ─── Session lifecycle ────────────────────────────────────────────────────
    if (isActive) {
      // Starting: open a new session
      try {
        await createBotSession(botId, bot.config?.mode ?? 'paper');
      } catch (err) {
        console.error('[toggle] createBotSession failed:', err);
      }
    } else {
      // Stopping: close active session + exit ALL active trades + signal engine
      try {
        await closeBotSession(botId);
      } catch (err) {
        console.error('[toggle] closeBotSession failed:', err);
      }

      // Exit all active trades for this bot
      try {
        const activeTrades = await prisma.trade.findMany({
          where: { botId, status: { in: ['active', 'ACTIVE', 'Active'] } },
        });
        for (const trade of activeTrades) {
          const currentPrice = trade.currentPrice || trade.entryPrice;
          const isLong = trade.position === 'long';
          const priceDiff = isLong ? (currentPrice - trade.entryPrice) : (trade.entryPrice - currentPrice);
          const rawPnl = priceDiff / trade.entryPrice * trade.leverage * trade.capital;
          const leveragedPnl = Math.round(rawPnl * 10000) / 10000;
          const pnlPct = trade.capital > 0 ? Math.round(leveragedPnl / trade.capital * 100 * 100) / 100 : 0;
          await prisma.trade.update({
            where: { id: trade.id },
            data: {
              status: 'closed',
              exitPrice: currentPrice,
              exitTime: new Date(),
              exitReason: 'BOT_STOPPED',
              totalPnl: leveragedPnl,
              totalPnlPercent: pnlPct,
              activePnl: 0,
              activePnlPercent: 0,
            },
          });
        }
        if (activeTrades.length > 0) {
          console.log(`[toggle] Exited ${activeTrades.length} active trades for bot ${botId}`);
        }
      } catch (err) {
        console.error('[toggle] Exit trades on stop failed:', err);
      }
    }

    // Call the Python orchestrator to start/stop the engine worker
    const orchEndpoint = isActive ? 'start' : 'stop';
    try {
      const orchResponse = await fetch(`${ORCHESTRATOR_URL}/api/bots/${orchEndpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId }),
      });

      if (!orchResponse.ok) {
        const err = await orchResponse.json().catch(() => ({}));
        console.error('Orchestrator error:', err);
      }
    } catch (orchError) {
      console.error('Orchestrator unreachable:', orchError);
    }

    // Update bot status in database
    await prisma.bot.update({
      where: { id: botId },
      data: {
        isActive,
        status: isActive ? 'running' : 'stopped',
        ...(isActive ? { startedAt: new Date() } : { stoppedAt: new Date() }),
      },
    });

    return NextResponse.json({ success: true, isActive });
  } catch (error: any) {
    console.error('Bot toggle error:', error);
    return NextResponse.json({ error: 'Failed to toggle bot' }, { status: 500 });
  }
}
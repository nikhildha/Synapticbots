import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';
import { checkSubscription } from '@/lib/subscription';
import { createBotSession } from '@/lib/bot-session';
import { getEngineUrl } from '@/lib/engine-url';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Block if subscription expired
    const subStatus = await checkSubscription(session.user.id);
    if (!subStatus.isActive) {
      return NextResponse.json({ error: subStatus.message, expired: true }, { status: 403 });
    }

    // Find all stopped (not active) bots for this user
    const stoppedBots = await prisma.bot.findMany({
      where: { userId: session.user.id, isActive: false, status: { not: 'retired' } },
      include: { config: true },
    });

    if (stoppedBots.length === 0) {
      return NextResponse.json({ success: true, count: 0, message: 'No stopped bots found' });
    }

    const paperEngineUrl = getEngineUrl('paper');
    let started = 0;
    const errors: string[] = [];

    for (const bot of stoppedBots) {
      try {
        // 1. Create a new session
        try { await createBotSession(bot.id, bot.config?.mode ?? 'paper'); } catch { /* non-fatal */ }

        // 2. Push bot identity to engine
        if (paperEngineUrl) {
          try {
            await fetch(`${paperEngineUrl}/api/set-bot-id`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                bot_id: bot.id,
                bot_name: bot.name,
                user_id: session.user.id,
                brain_type: (bot.config as any)?.brainType || 'adaptive',
                segment_filter: (bot.config as any)?.segment || 'ALL',
                capital_per_trade: (bot.config as any)?.capitalPerTrade ?? 100,
                max_loss_pct: (bot.config as any)?.maxLossPct ?? -15,
              }),
              signal: AbortSignal.timeout(5000),
            });
          } catch { /* engine may be offline — non-fatal */ }

          // 3. Push per-bot risk config
          try {
            await fetch(`${paperEngineUrl}/api/set-config`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                max_loss_pct: bot.config?.maxLossPct ?? -15,
                capital_per_trade: bot.config?.capitalPerTrade ?? 100,
                max_open_trades: bot.config?.maxOpenTrades ?? 25,
              }),
              signal: AbortSignal.timeout(5000),
            });
          } catch { /* non-fatal */ }
        }

        // 4. Mark as active in DB
        await prisma.bot.update({
          where: { id: bot.id },
          data: {
            isActive: true,
            status: 'running',
            ...(!bot.startedAt ? { startedAt: new Date() } : {}),
          },
        });

        started++;
      } catch (err: any) {
        errors.push(`${bot.name}: ${err.message}`);
      }
    }

    console.log(`[start-all] Started ${started}/${stoppedBots.length} bots for user ${session.user.id}`);
    return NextResponse.json({ success: true, count: started, errors });
  } catch (error: any) {
    console.error('start-all error:', error);
    return NextResponse.json({ error: 'Failed to start all bots' }, { status: 500 });
  }
}

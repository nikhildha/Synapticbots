import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';
import { closeBotSession } from '@/lib/bot-session';
import { getEngineUrl } from '@/lib/engine-url';
import { buildCloseData } from '@/lib/trade-utils';

export const dynamic = 'force-dynamic';

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:5000';

/**
 * 8.8 — Bot Kill Switch
 * POST /api/bots/kill  { botId }
 * Stops bot via orchestrator + force-closes all active trades
 */

export async function POST(request: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { botId } = await request.json();
        if (!botId) {
            return NextResponse.json({ error: 'botId required' }, { status: 400 });
        }

        // Verify ownership
        const bot = await prisma.bot.findFirst({
            where: { id: botId, userId: session.user.id },
        });
        if (!bot) {
            return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
        }

        // 1. Stop bot via orchestrator (best effort)
        try {
            await fetch(`${ORCHESTRATOR_URL}/bots/${botId}/stop`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: AbortSignal.timeout(5000),
            });
        } catch {
            // Orchestrator might be offline — continue with DB cleanup
        }

        // K1 FIX: For live bots, close CoinDCX positions via engine BEFORE closing Prisma trades.
        // Without this, kill switch would mark trades closed in DB while exchange positions remain open.
        const botConfig = await prisma.botConfig.findUnique({ where: { botId }, select: { mode: true } });
        const botMode = (botConfig?.mode ?? 'paper').toLowerCase();
        if (botMode.startsWith('live')) {
            const liveEngineUrl = getEngineUrl('live');
            if (liveEngineUrl) {
                try {
                    const exitRes = await fetch(`${liveEngineUrl}/api/exit-all-live`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        signal: AbortSignal.timeout(15000),
                    });
                    const exitData = await exitRes.json();
                    console.log(`[kill] exit-all-live: ${exitData.closed_exchange?.length ?? 0} exchange positions closed`);
                    if (exitData.errors?.length > 0) {
                        console.warn('[kill] exit-all-live errors:', exitData.errors);
                    }
                } catch (err) {
                    console.error('[kill] exit-all-live failed (continuing with DB close):', err);
                }
            }
        }

        // 2. Close all active trades for this bot
        const activeTrades = await prisma.trade.findMany({
            where: { botId, status: { in: ['active', 'ACTIVE', 'Active'] } },
        });

        const closeTime = new Date();
        for (const trade of activeTrades) {
            await prisma.trade.update({
                where: { id: trade.id },
                data: { ...buildCloseData(trade, 'KILL_SWITCH'), exitTime: closeTime },
            });
        }

        // 3. Close active session + compute metrics (trades already closed above)
        try {
            await closeBotSession(botId);
        } catch (err) {
            console.error('[kill] closeBotSession failed:', err);
        }

        // 4. Update bot status
        await prisma.bot.update({
            where: { id: botId },
            data: {
                status: 'stopped',
                isActive: false,
                stoppedAt: closeTime,
            },
        });

        // 5. Update bot state
        await prisma.botState.upsert({
            where: { botId },
            update: { engineStatus: 'killed', errorMessage: 'Kill switch activated' },
            create: { botId, engineStatus: 'killed', errorMessage: 'Kill switch activated' },
        });

        return NextResponse.json({
            success: true,
            message: `Bot stopped, ${activeTrades.length} trade(s) closed`,
            tradesClosed: activeTrades.length,
        });
    } catch (error: any) {
        console.error('Kill switch error:', error);
        return NextResponse.json({ error: 'Kill switch failed' }, { status: 500 });
    }
}

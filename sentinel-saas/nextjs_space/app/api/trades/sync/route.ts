import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getEngineUrl, type EngineMode } from '@/lib/engine-url';
import { prisma } from '@/lib/prisma';
import { syncEngineTrades } from '@/lib/sync-engine-trades';

export const dynamic = 'force-dynamic';

/**
 * POST /api/trades/sync
 * Triggers bidirectional sync between engine tradebook and CoinDCX exchange.
 *
 * Flow:
 * 1. Calls engine /api/sync-exchange → reconciles tradebook with CoinDCX
 * 2. Fetches updated tradebook from engine
 * 3. Syncs engine tradebook → Prisma DB
 * 4. Returns reconciliation report
 */
export async function POST(request: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const userId = (session.user as any)?.id;

        // MULTI-BOT FIX: fetch all bots
        const userBots = await prisma.bot.findMany({
            where: { userId },
            orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
            include: { config: true },
        });

        // Check if any active bot is live (for exchange sync)
        const hasLiveBot = userBots.some((b: any) =>
            b.isActive && ((b.config as any)?.mode || '').toLowerCase().includes('live')
        );

        // Step 1: Call engine sync-exchange (live only)
        let syncResult: any = { message: 'Paper mode — no exchange sync needed' };
        if (hasLiveBot) {
            const liveEngineUrl = getEngineUrl('live');
            if (liveEngineUrl) {
                try {
                    const syncRes = await fetch(`${liveEngineUrl}/api/sync-exchange`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        signal: AbortSignal.timeout(20000),
                    });
                    syncResult = await syncRes.json();
                    console.log('[trades/sync] Engine sync result:', JSON.stringify(syncResult));
                } catch (err) {
                    console.error('[trades/sync] Engine sync failed:', err);
                    return NextResponse.json({ error: 'Engine sync-exchange call failed' }, { status: 502 });
                }
            }
        }

        // Step 2: ISOLATION FIX — sync each bot from its OWN engine
        // Paper bots get paper trades, live bots get live trades
        let tradesSynced = 0;
        const engineTradeCache: Record<string, any[]> = {};
        for (const ub of userBots) {
            if (!ub.startedAt) continue;
            const botMode: EngineMode = ((ub.config as any)?.mode || 'paper').toLowerCase().includes('live') ? 'live' : 'paper';
            try {
                if (!engineTradeCache[botMode]) {
                    const url = getEngineUrl(botMode);
                    if (url) {
                        const allRes = await fetch(`${url}/api/all`, {
                            cache: 'no-store',
                            signal: AbortSignal.timeout(8000),
                        });
                        if (allRes.ok) {
                            const engineData = await allRes.json();
                            engineTradeCache[botMode] = engineData?.tradebook?.trades || [];
                        } else {
                            engineTradeCache[botMode] = [];
                        }
                    } else {
                        engineTradeCache[botMode] = [];
                    }
                }
                if (engineTradeCache[botMode].length > 0) {
                    const botSegment = (ub.config as any)?.segment || 'ALL';
                    const count = await syncEngineTrades(engineTradeCache[botMode], ub.id, ub.startedAt, userId, botSegment);
                    tradesSynced += count;
                }
            } catch (err) {
                console.error(`[trades/sync] Sync failed for bot ${ub.id} (${botMode}):`, err);
            }
        }

        return NextResponse.json({
            success: true,
            engineModes: Object.keys(engineTradeCache),
            syncResult,
            tradesSynced,
        });
    } catch (error: any) {
        console.error('[trades/sync] Error:', error);
        return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
    }
}

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

        // Determine engine mode from user's bot config
        // F3 FIX: include config relation — without this, userBot.config is undefined (always paper)
        let engineMode: EngineMode = 'paper';
        const userBot = await prisma.bot.findFirst({
            where: { userId },
            orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
            include: { config: true },
        });
        if (userBot) {
            const botMode = (userBot.config as any)?.mode || 'paper';
            engineMode = botMode.toLowerCase().includes('live') ? 'live' : 'paper';
        }

        const engineUrl = getEngineUrl(engineMode);
        if (!engineUrl) {
            return NextResponse.json({ error: 'Engine not configured' }, { status: 503 });
        }

        // Step 1: Call engine sync-exchange
        let syncResult: any = { message: 'Paper mode — no exchange sync needed' };
        if (engineMode === 'live') {
            try {
                const syncRes = await fetch(`${engineUrl}/api/sync-exchange`, {
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

        // Step 2: Fetch updated tradebook from engine and sync to DB
        let tradesSynced = 0;
        try {
            const allRes = await fetch(`${engineUrl}/api/all`, {
                cache: 'no-store',
                signal: AbortSignal.timeout(8000),
            });
            if (allRes.ok) {
                const engineData = await allRes.json();
                const engineTrades = engineData?.tradebook?.trades || [];

                if (userBot && userBot.startedAt && engineTrades.length > 0) {
                    // F4 FIX: capture actual synced count (throttled/skipped trades return 0)
                    tradesSynced = await syncEngineTrades(engineTrades, userBot.id, userBot.startedAt);
                }
            }
        } catch (err) {
            console.error('[trades/sync] Tradebook re-sync failed:', err);
        }

        return NextResponse.json({
            success: true,
            engineMode,
            syncResult,
            tradesSynced,
        });
    } catch (error: any) {
        console.error('[trades/sync] Error:', error);
        return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
    }
}

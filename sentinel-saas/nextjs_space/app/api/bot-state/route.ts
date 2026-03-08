import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/prisma';
import { syncEngineTrades, getUserTrades } from '@/lib/sync-engine-trades';
import { getEngineUrl, type EngineMode } from '@/lib/engine-url';

export const dynamic = 'force-dynamic';

async function fetchEngineData(mode: EngineMode = 'live') {
    const url = getEngineUrl(mode);
    if (!url) return null;
    try {
        const res = await fetch(`${url}/api/all`, {
            cache: 'no-store',
            signal: AbortSignal.timeout(8000),
        });
        if (res.ok) return await res.json();
    } catch (err) {
        console.error(`[bot-state] Engine API (${mode}) fetch failed:`, err);
    }
    return null;
}

export async function GET() {
    try {
        // Get session to filter trades by user
        const session = await getServerSession(authOptions);
        const userId = (session?.user as any)?.id;

        // Determine which engine to call based on user's active bot mode
        // C1 FIX: default to 'paper' for safety (not 'live')
        let engineMode: EngineMode = 'paper';
        let userBot: any = null;
        if (userId) {
            // C2 FIX: single bot query used for BOTH engine routing AND trade sync
            userBot = await prisma.bot.findFirst({
                where: { userId },
                orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
            });
            if (userBot) {
                const botMode = (userBot.config as any)?.mode || 'paper';
                engineMode = botMode.toLowerCase().includes('live') ? 'live' : 'paper';
            }
        }

        // Fetch from the correct engine
        const engineData = await fetchEngineData(engineMode);

        const multi = engineData?.multi || { coin_states: {}, last_analysis_time: null, deployed_count: 0 };
        const engineTradebook = engineData?.tradebook || { trades: [], summary: {} };
        const engineState = engineData?.engine || { status: getEngineUrl(engineMode) ? 'unknown' : 'not_configured' };

        // Build the engine state part of the response (shared — not per-user)
        const coinStates = multi.coin_states || {};
        const engineTradesRaw = engineTradebook.trades || [];

        // ─── Per-User Trade Isolation ────────────────────────────────
        let trades: any[] = [];

        if (session && userId) {
            // C2 FIX: reuse the same userBot from above
            if (userBot && userBot.startedAt && engineTradesRaw.length > 0) {
                try {
                    await syncEngineTrades(engineTradesRaw, userBot.id, userBot.startedAt);
                } catch (err) {
                    console.error('[bot-state] Trade sync failed:', err);
                }
            }

            try {
                trades = await getUserTrades(userId);
            } catch (err) {
                console.error('[bot-state] getUserTrades failed:', err);
                trades = [];
            }
        }

        const activeTrades = trades.filter((t: any) => (t.status || '').toUpperCase() === 'ACTIVE');

        return NextResponse.json({
            state: {
                regime: multi.macro_regime || coinStates?.BTCUSDT?.regime || 'WAITING',
                confidence: coinStates?.BTCUSDT?.confidence || 0,
                symbol: 'BTCUSDT',
                btc_price: coinStates?.BTCUSDT?.price || null,
                timestamp: multi.last_analysis_time || multi.timestamp || null,
            },
            multi: {
                ...multi,
                coins_scanned: Object.keys(coinStates).length,
                eligible_count: Object.values(coinStates).filter((c: any) => (c.action || '').includes('ELIGIBLE')).length,
                deployed_count: multi.deployed_count || 0,
                total_trades: trades.length,
                active_positions: Object.fromEntries(
                    activeTrades.map((t: any) => [t.symbol, t])
                ),
                coin_states: coinStates,
                cycle: multi.cycle || 0,
                timestamp: multi.last_analysis_time || multi.timestamp || null,
            },
            scanner: { coins: Object.keys(coinStates) },
            tradebook: {
                trades,
                // F2 FIX: compute per-user summary from user's trades, not engine-wide
                summary: {
                    total_trades: trades.length,
                    active_trades: activeTrades.length,
                    closed_trades: trades.filter((t: any) => (t.status || '').toLowerCase() === 'closed').length,
                    total_pnl: trades
                        .filter((t: any) => (t.status || '').toLowerCase() === 'closed')
                        .reduce((sum: number, t: any) => sum + (t.totalPnl || t.realized_pnl || 0), 0),
                },
            },
            engine: engineState,
        });
    } catch (err) {
        return NextResponse.json({
            state: { regime: 'WAITING', confidence: 0, symbol: 'BTCUSDT', timestamp: null },
            multi: { coins_scanned: 0, eligible_count: 0, deployed_count: 0, total_trades: 0, active_positions: {}, coin_states: {}, cycle: 0, timestamp: null },
            scanner: { coins: [] },
            tradebook: { trades: [], summary: {} },
            error: String(err),
        });
    }
}

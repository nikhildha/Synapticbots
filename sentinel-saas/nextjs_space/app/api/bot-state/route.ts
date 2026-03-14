import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/prisma';
import { syncEngineTrades, getUserTrades } from '@/lib/sync-engine-trades';
import { getEngineUrl, type EngineMode } from '@/lib/engine-url';

export const dynamic = 'force-dynamic';

async function fetchEngineData(mode: EngineMode = 'live') {
    const url = getEngineUrl(mode);
    console.log(`[bot-state] fetchEngineData(${mode}) → url=${url || '<EMPTY>'}`);
    if (!url) return null;
    try {
        const res = await fetch(`${url}/api/all`, {
            cache: 'no-store',
            signal: AbortSignal.timeout(8000),
        });
        console.log(`[bot-state] Engine ${mode} response: ${res.status} ${res.statusText}`);
        if (res.ok) return await res.json();
        console.error(`[bot-state] Engine ${mode} non-OK: ${res.status}`);
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
        let userBots: any[] = [];
        if (userId) {
            // MULTI-BOT FIX: fetch ALL user bots for broadcast sync
            userBots = await prisma.bot.findMany({
                where: { userId },
                include: { config: true },
                orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
            });
            // Use live engine for DASHBOARD display if ANY active bot is live
            const hasLiveBot = userBots.some((b: any) =>
                b.isActive && (b.config?.mode || '').toLowerCase().includes('live')
            );
            if (hasLiveBot) engineMode = 'live';
        }

        // Fetch engine data for DASHBOARD UI (coin states, engine status, etc.)
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
            // ISOLATION FIX: sync each bot from its OWN engine (not one engine for all)
            // This prevents paper bots from getting live trades and vice versa.
            const engineTradeCache: Record<string, any[]> = {};
            for (const ub of userBots) {
                if (!ub.startedAt) continue;
                const botMode: EngineMode = ((ub.config as any)?.mode || 'paper').toLowerCase().includes('live') ? 'live' : 'paper';
                try {
                    // Cache engine trades per mode to avoid duplicate fetches
                    if (!engineTradeCache[botMode]) {
                        const data = await fetchEngineData(botMode);
                        engineTradeCache[botMode] = data?.tradebook?.trades || [];
                    }
                    const botTrades = engineTradeCache[botMode];
                    if (botTrades.length > 0) {
                        await syncEngineTrades(botTrades, ub.id, ub.startedAt);
                    }
                } catch (err) {
                    console.error(`[bot-state] Trade sync failed for bot ${ub.id}:`, err);
                }
            }

            try {
                trades = await getUserTrades(userId);
            } catch (err) {
                console.error('[bot-state] getUserTrades failed:', err);
                trades = [];
            }

            // Enrich Prisma trades with live engine data (not stored in Prisma)
            if (engineTradesRaw.length > 0 && trades.length > 0) {
                const engineMap = new Map<string, any>();
                for (const et of engineTradesRaw) {
                    const eid = et.trade_id || et.id;
                    if (eid) engineMap.set(eid, et);
                }
                trades = trades.map((t: any) => {
                    const engineTrade = engineMap.get(t.trade_id);
                    if (engineTrade) {
                        return { ...t };
                    }
                    return t;
                });
            }
        }

        const activeTrades = trades.filter((t: any) => (t.status || '').toUpperCase() === 'ACTIVE');

        // ─── Timing fields: fallback computation when engine doesn't provide them ──
        // Engine writes timestamps as datetime.now(IST).replace(tzinfo=None) — IST with no TZ marker.
        // The dashboard's formatIST() appends 'Z' if no TZ is found, causing double-offset.
        // Fix: tag bare timestamps with +05:30 so they're correctly interpreted as IST.
        const normalizeTs = (ts: any): string | null => {
            if (!ts) return null;
            const s = String(ts);
            // Already has Z or ±HH:MM → leave as-is
            if (/Z$|[+-]\d{2}:\d{2}$/.test(s)) return s;
            // Bare timestamp from engine → it's IST, tag it
            return s + '+05:30';
        };

        const lastAnalysis = normalizeTs(multi.last_analysis_time) || normalizeTs(multi.timestamp) || null;
        const intervalSec = multi.analysis_interval_seconds || 300; // default 5min
        let nextAnalysis = normalizeTs(multi.next_analysis_time) || null;
        if (!nextAnalysis && lastAnalysis && intervalSec) {
            try {
                const lastMs = new Date(lastAnalysis).getTime();
                if (!isNaN(lastMs)) {
                    nextAnalysis = new Date(lastMs + intervalSec * 1000).toISOString();
                }
            } catch { /* silent */ }
        }

        // ─── Per-Bot Stats for bot cards ────────────────────────────
        const perBot: Record<string, { activeTrades: number; totalTrades: number; activePnl: number; totalPnl: number; capital: number }> = {};
        for (const t of trades) {
            const bid = t.bot_id || t.botId || 'unknown';
            if (!perBot[bid]) perBot[bid] = { activeTrades: 0, totalTrades: 0, activePnl: 0, totalPnl: 0, capital: 0 };
            perBot[bid].totalTrades++;
            const isActive = (t.status || '').toUpperCase() === 'ACTIVE';
            if (isActive) {
                perBot[bid].activeTrades++;
                perBot[bid].activePnl += t.activePnl || t.unrealized_pnl || 0;
                perBot[bid].capital += t.capital || 100;
            } else {
                perBot[bid].totalPnl += t.totalPnl || t.realized_pnl || 0;
            }
        }

        return NextResponse.json({
            state: {
                regime: multi.macro_regime || coinStates?.BTCUSDT?.regime || 'WAITING',
                confidence: coinStates?.BTCUSDT?.confidence || 0,
                symbol: 'BTCUSDT',
                btc_price: coinStates?.BTCUSDT?.price || null,
                timestamp: lastAnalysis,
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
                // Engine health signals for frontend status detection
                status: engineState?.status || 'unknown',
                uptime_seconds: engineState?.uptime_seconds || 0,
                // Timing fields — always populated
                last_analysis_time: lastAnalysis,
                next_analysis_time: nextAnalysis,
                analysis_interval_seconds: intervalSec,
                timestamp: lastAnalysis,
            },
            scanner: { coins: Object.keys(coinStates) },
            heatmap: engineData?.heatmap || null,
            athena: engineData?.athena || { enabled: true, recent_decisions: [], model: 'gemini-2.5-flash' },
            perBot,

            tradebook: {
                trades,
                // Pending engine orders (LIMIT / VIRTUAL_LIMIT awaiting fill — not yet in DB)
                pending_orders: engineTradesRaw.filter((t: any) =>
                    (t.status || '').toUpperCase() === 'OPEN' &&
                    (t.order_type || '').toUpperCase().includes('LIMIT')
                ),
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
            _debug: {
                engineMode,
                liveUrl: getEngineUrl('live') ? '✓ set' : '✗ empty',
                paperUrl: getEngineUrl('paper') ? '✓ set' : '✗ empty',
                engineDataOk: !!engineData,
                altEngineDataOk: false,
                totalBots: userBots.length,
                activeBots: userBots.filter((b: any) => b.isActive).length,
            },
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

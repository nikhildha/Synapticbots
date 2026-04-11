import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/prisma';
import { syncEngineTrades, getUserTrades, syncAthenaDecisions } from '@/lib/sync-engine-trades';
import { getEngineUrl } from '@/lib/engine-url';

export const dynamic = 'force-dynamic';

async function fetchEngineData(url: string) {
    if (!url) return null;
    const secret = process.env.ENGINE_API_SECRET;
    const headers: Record<string, string> = secret ? { Authorization: `Bearer ${secret}` } : {};
    try {
        const res = await fetch(`${url}/api/all`, {
            cache: 'no-store',
            signal: AbortSignal.timeout(8000),
            headers,
        });
        if (res.ok) return await res.json();
        console.error(`[bot-state] Engine non-OK: ${res.status} ${url}`);
    } catch (err) {
        console.error(`[bot-state] Engine fetch failed (${url}):`, err);
    }
    return null;
}

export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        const userId = (session?.user as any)?.id;

        // ── Signals: always from primary engine — same for ALL users ──
        // HMM + Athena analysis is shared. Paper vs live is execution-only, not signal-only.
        // Live engine is primary; fall back to paper if live URL not configured.
        const primaryUrl = getEngineUrl('live') || getEngineUrl('paper');
        const secondaryUrl = getEngineUrl('paper');

        const [engineData, paperDataRaw] = await Promise.all([
            fetchEngineData(primaryUrl),
            primaryUrl && secondaryUrl && primaryUrl !== secondaryUrl ? fetchEngineData(secondaryUrl) : Promise.resolve(null)
        ]);
        
        const paperEngineData = (primaryUrl === secondaryUrl) ? engineData : paperDataRaw;

        // Merge Athena decisions from both environments
        const liveAthena = engineData?.athena?.recent_decisions || [];
        const paperAthena = paperEngineData?.athena?.recent_decisions || [];
        const allAthena = [...liveAthena, ...paperAthena];
        
        const uniqueAthenaMap = new Map();
        for (const d of allAthena) {
            // Deduplicate across engines by symbol + timestamp
            const key = `${d.symbol}-${d.time}`; 
            uniqueAthenaMap.set(key, d);
        }
        
        const mergedDecisions = Array.from(uniqueAthenaMap.values()).sort((a: any, b: any) => {
            return new Date(b.time).getTime() - new Date(a.time).getTime();
        }).slice(0, 10);

        const mergedAthena = {
            enabled: engineData?.athena?.enabled || paperEngineData?.athena?.enabled || false,
            model: engineData?.athena?.model || 'gemini-2.5-flash',
            recent_decisions: mergedDecisions,
        };

        const multi = engineData?.multi || { coin_states: {}, last_analysis_time: null, deployed_count: 0 };
        const engineState = engineData?.engine || { status: primaryUrl ? 'unknown' : 'not_configured' };
        const coinStates = multi.coin_states || {};
        const engineTrades: any[] = engineData?.tradebook?.trades || [];

        // ── Per-User Trades: each bot syncs from its own engine ──
        // Paper bot → paper engine, live bot → live engine.
        let trades: any[] = [];
        let userBots: any[] = [];

        if (session && userId) {
            userBots = await prisma.bot.findMany({
                where: { userId },
                include: { config: true },
                orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
            });

            // ── MERGED ENGINE SYNC ────────────────────────────────────────────────
            // PROBLEM: live engine (sentinelbot-engine-live-production) deploys paper trades
            // into its own tradebook, but the dashboard was only syncing paper bots from
            // ENGINE_API_URL_PAPER (paper-production) = a DIFFERENT empty tradebook.
            //
            // FIX: Collect trades from ALL engines, then sync each user bot against the
            // full merged pool. allBotIds matching inside syncEngineTrades provides isolation
            // (each trade is stamped with the bot_id of the deploying bot, so no cross-contamination).
            const allEngineTrades: any[] = [
                ...(engineData?.tradebook?.trades || []),
                // Only add paper engine trades if it's a separate service (avoid duplicates)
                ...(primaryUrl !== secondaryUrl && paperEngineData?.tradebook?.trades
                    ? paperEngineData.tradebook.trades
                    : []),
            ];

            for (const ub of userBots) {
                if (allEngineTrades.length === 0) continue;
                try {
                    // Fall back to epoch so newly-created bots (startedAt=null) sync all trades
                    const syncFrom = ub.startedAt ?? new Date(0);
                    const rawSeg = (ub.config as any)?.segment || 'ALL';
                    // Only use segment if it's a real market category; strategy names → ALL
                    const realSegments = new Set(['L1','L2','DeFi','AI','Meme','RWA','Gaming','DePIN','Modular','Oracles']);
                    const botSegment = realSegments.has(rawSeg) ? rawSeg : 'ALL';
                    await syncEngineTrades(allEngineTrades, ub.id, syncFrom, userId, botSegment);
                } catch (err) {
                    console.error(`[bot-state] Trade sync failed for bot ${ub.id}:`, err);
                }
            }


            try {
                trades = await getUserTrades(userId);
            } catch (err) {
                console.error('[bot-state] getUserTrades failed:', err);
            }

            // Sync Athena decisions to DB (fire-and-forget, throttled to 60s)
            const cycle = multi.cycle || 0;
            if (cycle > 0 && Object.keys(coinStates).length > 0) {
                syncAthenaDecisions(coinStates, cycle).catch(err =>
                    console.error('[bot-state] Athena decision sync failed:', err)
                );
            }
        }

        const activeTrades = trades.filter((t: any) => (t.status || '').toUpperCase() === 'ACTIVE');

        // ─── Timing fields ────────────────────────────────────────────────────────
        // Engine writes bare IST timestamps (no TZ marker). Tag them so the dashboard
        // doesn't double-offset by appending 'Z'.
        const normalizeTs = (ts: any): string | null => {
            if (!ts) return null;
            const s = String(ts);
            if (/Z$|[+-]\d{2}:\d{2}$/.test(s)) return s;
            return s + '+05:30';
        };

        const lastAnalysis = normalizeTs(multi.last_analysis_time) || normalizeTs(multi.timestamp) || null;
        const intervalSec = multi.analysis_interval_seconds || 300;
        let nextAnalysis = normalizeTs(multi.next_analysis_time) || null;
        if (!nextAnalysis && lastAnalysis && intervalSec) {
            try {
                const lastMs = new Date(lastAnalysis).getTime();
                if (!isNaN(lastMs)) nextAnalysis = new Date(lastMs + intervalSec * 1000).toISOString();
            } catch { /* silent */ }
        }

        // ─── Per-Bot Stats for bot cards ─────────────────────────────────────────
        const perBot: Record<string, { activeTrades: number; totalTrades: number; activePnl: number; totalPnl: number; capital: number }> = {};
        for (const t of trades) {
            const bid = t.bot_id || t.botId || 'unknown';
            if (!perBot[bid]) perBot[bid] = { activeTrades: 0, totalTrades: 0, activePnl: 0, totalPnl: 0, capital: 0 };
            perBot[bid].totalTrades++;
            if ((t.status || '').toUpperCase() === 'ACTIVE') {
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
                confidence: (() => {
                    const btc = coinStates?.BTCUSDT;
                    const regimeStr: string = btc?.regime || '';
                    const matches = regimeStr.match(/\(([\d.]+)\)/g);
                    if (matches?.length) {
                        const values = matches
                            .map((m: string) => parseFloat(m.replace(/[()]/g, '')))
                            .filter((v: number) => !isNaN(v) && v > 0 && v <= 1);
                        if (values.length > 0)
                            return Math.round(values.reduce((a: number, b: number) => a + b, 0) / values.length * 100);
                    }
                    const conviction = btc?.conviction;
                    if (conviction != null && conviction > 0) return conviction;
                    const margin = btc?.confidence;
                    if (margin != null && margin > 0.05) return Math.round(margin * 100);
                    return 0;
                })(),
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
                active_positions: Object.fromEntries(activeTrades.map((t: any) => [t.symbol, t])),
                coin_states: coinStates,
                cycle: multi.cycle || 0,
                status: engineState?.status || 'unknown',
                uptime_seconds: engineState?.uptime_seconds || 0,
                last_analysis_time: lastAnalysis,
                next_analysis_time: nextAnalysis,
                analysis_interval_seconds: intervalSec,
                timestamp: lastAnalysis,
            },
            scanner: { coins: Object.keys(coinStates) },
            heatmap: engineData?.heatmap || null,
            athena: mergedAthena,
            perBot,

            // Per-bot trade lists — keyed by botId. Clients must use this
            // instead of the flat `trades` array to avoid cross-segment display.
            tradesByBot: Object.fromEntries(
                userBots.map((ub: any) => [
                    ub.id,
                    trades.filter((t: any) => (t.bot_id || t.botId) === ub.id),
                ])
            ),

            tradebook: {
                trades,
                // RAW FALLBACK: direct engine trades for instant display (no Prisma round-trip needed)
                // Dashboard uses these when Prisma is empty (e.g. after engine restart before first sync)
                // engineData is from primaryUrl (which may be the paper engine if PAPER_URL not set)
                // paperEngineData may be null if secondary URL not configured
                rawTrades: (() => {
                    // Only show engine trades belonging to THIS user's bots.
                    // rawTrades is a fallback for instant display before Prisma syncs,
                    // but must never leak other users' trades.
                    const userBotIds = new Set(userBots.map((b: any) => b.id));
                    if (userBotIds.size === 0) return []; // user has no bots → no raw trades
                    const allRaw = [
                        ...(engineData?.tradebook?.trades || []),
                        ...((primaryUrl !== secondaryUrl && paperEngineData) ? (paperEngineData?.tradebook?.trades || []) : []),
                    ];
                    return allRaw.filter((t: any) =>
                        (t.status || 'active').toLowerCase() === 'active' &&
                        userBotIds.has(t.bot_id || t.botId)
                    );
                })(),
                pending_orders: engineTrades.filter((t: any) =>
                    (t.status || '').toUpperCase() === 'OPEN' &&
                    (t.order_type || '').toUpperCase().includes('LIMIT')
                ),
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
                primaryUrl: primaryUrl ? '✓' : '✗ not configured',
                engineDataOk: !!engineData,
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

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
        // Always fetch both engines when URLs are configured so we have per-engine
        // registered_bot_ids for correct re-registration and full pending order lists.
        const hasMixedModes = userBots.some((b: any) =>
            b.isActive && (b.config?.mode || '').toLowerCase().includes('live')
        ) && userBots.some((b: any) =>
            b.isActive && !(b.config?.mode || '').toLowerCase().includes('live')
        );

        const [engineData, altEngineData] = await Promise.all([
            fetchEngineData(engineMode),
            // Fetch the opposite engine when user has bots on both engines
            hasMixedModes ? fetchEngineData(engineMode === 'live' ? 'paper' : 'live') : Promise.resolve(null),
        ]);

        // Track which engine modes responded (null = engine unreachable, not just empty)
        const engineDataByMode: Record<string, any> = {
            [engineMode]: engineData,
            ...(altEngineData ? { [engineMode === 'live' ? 'paper' : 'live']: altEngineData } : {}),
        };

        // Build per-engine registered_bot_ids maps for correct re-registration checks
        const registeredByMode: Record<string, Set<string>> = {
            live: new Set(
                (engineMode === 'live' ? engineData : altEngineData)?.registered_bot_ids || []
            ),
            paper: new Set(
                (engineMode === 'paper' ? engineData : altEngineData)?.registered_bot_ids || []
            ),
        };

        // ─── Auto-Re-Registration: re-push ALL BOTS if engine restarted ─────
        // Engine restart clears ENGINE_ACTIVE_BOTS in memory. If ANY bot is missing,
        // we proactively fetch all active bots from the DB and push them back.
        // This ensures non-admin bots are not orphaned when an admin connects first!
        if (userId && userBots.length > 0) {
            const activeUserBots = userBots.filter((b: any) => b.isActive);
            let needsSync = false;
            
            for (const ub of activeUserBots) {
                const botMode = ((ub.config as any)?.mode || 'paper').toLowerCase();
                const modeKey = botMode.startsWith('live') ? 'live' : 'paper';
                if (engineDataByMode[modeKey] !== null && engineDataByMode[modeKey] !== undefined && !registeredByMode[modeKey].has(ub.id)) {
                    needsSync = true;
                    break;
                }
            }

            if (needsSync) {
                console.log(`[bot-state] Engine missing bots. Re-registering ALL active bots for ALL users.`);
                const allActiveBots = await prisma.bot.findMany({ where: { isActive: true } });
                for (const ubRaw of allActiveBots) {
                    const ub: any = ubRaw;
                    const botMode = (ub.config?.mode || 'paper').toLowerCase();
                    const modeKey = botMode.startsWith('live') ? 'live' : 'paper';
                    const reRegUrl = getEngineUrl(modeKey as EngineMode);
                    if (!reRegUrl) continue;
                    if (engineDataByMode[modeKey] === undefined) continue;
                    if (engineDataByMode[modeKey] === null) continue;
                    
                    if (!registeredByMode[modeKey].has(ub.id)) {
                        console.log(`[bot-state] Restoring orphaned bot ${ub.id} (${ub.name}) for user ${ub.userId} to ${modeKey} engine.`);
                        try {
                            const apiSecret = process.env.ENGINE_API_SECRET || '';
                            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                            if (apiSecret) headers['Authorization'] = `Bearer ${apiSecret}`;
                            
                            await fetch(`${reRegUrl}/api/set-bot-id`, {
                                method: 'POST',
                                headers,
                                body: JSON.stringify({
                                    bot_id: ub.id,
                                    bot_name: ub.name,
                                    user_id: ub.userId,
                                    brain_type: ub.config?.brainType || 'adaptive',
                                    segment_filter: ub.config?.segment || 'ALL',
                                    capital_per_trade: (ub.config as any)?.capitalPerTrade ?? 100,
                                    max_loss_pct: (ub.config as any)?.maxLossPct ?? -15,
                                }),
                                signal: AbortSignal.timeout(5000),
                            });
                            await fetch(`${reRegUrl}/api/set-config`, {
                                method: 'POST',
                                headers,
                                body: JSON.stringify({
                                    capital_per_trade: ub.config?.capitalPerTrade ?? 100,
                                    max_loss_pct:      ub.config?.maxLossPct ?? -15,
                                }),
                                signal: AbortSignal.timeout(5000),
                            });
                            // Mark as registered so we don't duplicate logic
                            registeredByMode[modeKey].add(ub.id);
                        } catch (e) {
                            console.warn(`[bot-state] Re-registration failed for bot ${ub.id}:`, e);
                        }
                    }
                }
            }
        }

        const multi = engineData?.multi || { coin_states: {}, last_analysis_time: null, deployed_count: 0 };
        const engineTradebook = engineData?.tradebook || { trades: [], summary: {} };
        const engineState = engineData?.engine || { status: getEngineUrl(engineMode) ? 'unknown' : 'not_configured' };

        // Build the engine state part of the response (shared — not per-user)
        const coinStates = multi.coin_states || {};
        // Merge trades from both engines so pending_orders enrichment covers all modes
        const altTrades: any[] = altEngineData?.tradebook?.trades || [];
        const engineTradesRaw = [...(engineTradebook.trades || []), ...altTrades];

        // Pre-build engine trade cache from already-fetched data (avoids duplicate HTTP calls below)
        const prefetchedEngineCache: Record<string, any[]> = {
            [engineMode]: engineTradebook.trades || [],
            ...(altEngineData ? { [engineMode === 'live' ? 'paper' : 'live']: altTrades } : {}),
        };

        // ─── Per-User Trade Isolation ────────────────────────────────
        let trades: any[] = [];

        if (session && userId) {
            // ISOLATION FIX: sync each bot from its OWN engine (not one engine for all)
            // This prevents paper bots from getting live trades and vice versa.
            const engineTradeCache: Record<string, any[]> = { ...prefetchedEngineCache };
            for (const ub of userBots) {
                if (!ub.startedAt) continue;
                const botMode: EngineMode = ((ub.config as any)?.mode || 'paper').toLowerCase().includes('live') ? 'live' : 'paper';
                try {
                    // Use pre-fetched engine data if available; only fetch if not already cached
                    if (!engineTradeCache[botMode]) {
                        const data = await fetchEngineData(botMode);
                        engineTradeCache[botMode] = data?.tradebook?.trades || [];
                    }
                    const botTrades = engineTradeCache[botMode];
                    if (botTrades.length > 0) {
                        await syncEngineTrades(botTrades, ub.id, ub.startedAt, userId);
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
                // FIX: BTC is a macro-only coin — conviction is never set for it.
                // The raw HMM margin (conf) is near-zero for CHOP/HIGH_VOLATILITY.
                // Real signal: parse the per-TF margins from the regime string like
                //   "1d=HIGH_VOL(0.92) | 1h=BEARISH(0.76) | 15m=BEARISH(0.84)"
                // Average those bracket values → meaningful 0-100 display confidence.
                confidence: (() => {
                    const btc = coinStates?.BTCUSDT;
                    const regimeStr: string = btc?.regime || '';

                    // Parse all (x.xx) margin values from the regime string
                    const matches = regimeStr.match(/\(([\d.]+)\)/g);
                    if (matches && matches.length > 0) {
                        const values = matches
                            .map((m: string) => parseFloat(m.replace(/[()]/g, '')))
                            .filter((v: number) => !isNaN(v) && v > 0 && v <= 1);
                        if (values.length > 0) {
                            const avg = values.reduce((a: number, b: number) => a + b, 0) / values.length;
                            return Math.round(avg * 100); // convert 0.84 → 84
                        }
                    }

                    // Fallbacks: conviction (unlikely for BTC), then raw margin
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
                hasMixedModes,
                liveUrl: getEngineUrl('live') ? '✓ set' : '✗ empty',
                paperUrl: getEngineUrl('paper') ? '✓ set' : '✗ empty',
                engineDataOk: !!engineData,
                altEngineDataOk: !!altEngineData,
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

import { prisma } from '@/lib/prisma';
import { getActiveBotSession } from '@/lib/bot-session';

// D1 FIX: Throttle sync to prevent DB hammering (max once per 30s per bot)
const _lastSyncTime: Record<string, number> = {};
const SYNC_THROTTLE_MS = 5_000;   // 5s throttle — safe at 25+ users (200 bots). 1s would cause ~200 upserts/sec on Railway.

// ── Static coin exclusion list — mirrors config.py COIN_EXCLUDE ──────────────
// Trades for these symbols are NEVER synced into Prisma, even if the engine
// still has them in its in-memory tradebook from before the exclusion was added.
const COIN_EXCLUDE = new Set([
    'EURUSDT', 'WBTCUSDT', 'USDCUSDT', 'TUSDUSDT', 'BUSDUSDT',
    'USTUSDT', 'DAIUSDT', 'FDUSDUSDT', 'CVCUSDT', 'USD1USDT',
    'POLYXUSDT', 'TRUUSDT', 'QNTUSDT',
]);

// Used to prevent cross-segment trade pollution (e.g. BTC trade written to Gaming bot).
// When BotConfig.segment === 'ALL' (or unknown), all coins are allowed.
const SEGMENT_POOLS: Record<string, string[]> = {
    L1:      ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','AVAXUSDT','SUIUSDT','XRPUSDT','APTUSDT','ETCUSDT','ADAUSDT','DOTUSDT','NEARUSDT','TRXUSDT','BCHUSDT','TONUSDT','ICPUSDT'],
    L2:      ['ARBUSDT','OPUSDT','POLUSDT','STRKUSDT','IMXUSDT','RONINUSDT','ZKUSDT','MANTAUSDT','METISUSDT','AXLUSDT'],
    DeFi:    ['UNIUSDT','AAVEUSDT','CRVUSDT','JUPUSDT','RUNEUSDT','PENDLEUSDT','LINKUSDT','LDOUSDT','GMXUSDT','ENAUSDT','SUSHIUSDT','COMPUSDT','SNXUSDT','CAKEUSDT','GRTUSDT'],
    AI:      ['TAOUSDT','FETUSDT','INJUSDT','WLDUSDT','AKTUSDT','RENDERUSDT','ARKMUSDT'],
    Meme:    ['DOGEUSDT','SHIBUSDT','PEPEUSDT','WIFUSDT','BONKUSDT','NOTUSDT','MANAUSDT'],
    RWA:     ['ONDOUSDT','POLYXUSDT','TRUUSDT','RSRUSDT'],
    Gaming:  ['AXSUSDT','SANDUSDT','PIXELUSDT','IOTXUSDT','GALAUSDT','ENJUSDT','YGGUSDT','GLMUSDT'],
    DePIN:   ['FILUSDT','ARUSDT','IOUSDT','JTOUSDT'],
    Modular: ['TIAUSDT','DYMUSDT','STXUSDT','QNTUSDT','ALTUSDT','EIGENUSDT'],
    Oracles: ['PYTHUSDT','TRBUSDT','API3USDT','HBARUSDT','BANDUSDT','DIAUSDT'],
};

/**
 * Sync engine trades into Prisma, scoped to a specific bot.
 * Only syncs trades whose entry_time >= bot.startedAt.
 * Uses engine trade_id as unique key to upsert (avoid duplicates).
 * D1 FIX: Throttled to max once per 30 seconds per bot.
 *
 * @param engineTrades - Raw trades array from engine (tradebook.json or /api/all)
 * @param botId - Prisma Bot ID to associate trades with
 * @param botStartedAt - When the bot was started (only sync trades after this)
 */
export async function syncEngineTrades(
    engineTrades: any[],
    botId: string,
    botStartedAt: Date | null,
    userId?: string,
    botSegment?: string           // e.g. 'L1', 'Gaming', 'ALL' — from BotConfig.segment
): Promise<number> {
    if (!engineTrades || engineTrades.length === 0) return 0;

    // D1 FIX: Throttle — skip if synced within last 30s for this bot
    const now = Date.now();
    if (_lastSyncTime[botId] && (now - _lastSyncTime[botId]) < SYNC_THROTTLE_MS) {
        return 0; // skip, too soon
    }
    _lastSyncTime[botId] = now;

    // Note: We no longer purge pre-start trades on every sync (BUG-16).
    // Historical trades are preserved. Only the entryTime filter below
    // prevents new pre-start trades from being synced.

    // BROADCAST FIX: No longer need to look up userId for bot_id ownership check.
    // User isolation is handled by getUserTrades(userId) at query time.

    // Look up active session once per sync call (not per trade)
    const activeSession = await getActiveBotSession(botId);
    
    // Look up the bot's mode so we never sync paper trades to a live bot (and vice versa)
    const bot = await prisma.bot.findUnique({ where: { id: botId }, include: { config: true } });
    if (!bot) return 0;
    const expectedMode = (bot.config?.mode || 'paper').toLowerCase().startsWith('live') ? 'live' : 'paper';

    let synced = 0;

    await Promise.all(engineTrades.map(async (t) => {
        try {
            // Parse entry time — engine uses "entry_timestamp", fallback to other names
            const rawTime = t.entry_timestamp || t.entry_time || t.entryTime || t.timestamp || '';
            const sanitized = String(rawTime).replace(/(\.\d{3})\d+/, '$1');
            const entryTime = rawTime ? new Date(sanitized) : new Date();
            if (isNaN(entryTime.getTime())) return;

            // Only sync trades after bot was started
            if (botStartedAt && entryTime < botStartedAt) return;

            const engineTradeId = t.trade_id || t.id;
            if (!engineTradeId) return;

            // ── Excluded coin guard ──────────────────────────────────────────
            const tradeCoinRaw = (t.symbol || t.coin || '').toUpperCase();
            if (COIN_EXCLUDE.has(tradeCoinRaw)) return;

            const status = (t.status || 'active').toLowerCase();
            const side = (t.side || t.position || '').toLowerCase();

            // Parse exit time — engine uses "exit_timestamp", fallback to other names
            let exitTime: Date | null = null;
            const rawExit = t.exit_timestamp || t.exit_time || t.exitTime || null;
            if (rawExit) {
                const sanitizedExit = String(rawExit).replace(/(\.\d{3})\d+/, '$1');
                const d = new Date(sanitizedExit);
                if (!isNaN(d.getTime())) exitTime = d;
            }

            // ── MODE ISOLATION FILTER ───────────────────────────────────────────
            const tradeMode = (t.mode || 'paper').toLowerCase().startsWith('live') ? 'live' : 'paper';
            if (tradeMode !== expectedMode) return;

            // ── PRIMARY FILTER: bot_id ownership ─────────────────────────────────
            const tradeBotId = (t.bot_id || t.botId || '').trim();
            if (tradeBotId) {
                if (tradeBotId !== botId) return;   // belongs to a different bot — skip
            } else {
                // ── FALLBACK: segment filter for legacy trades without bot_id ─────
                if (botSegment && botSegment !== 'ALL') {
                    const pool = SEGMENT_POOLS[botSegment] || [];
                    const tradeCoin = (t.symbol || t.coin || '').toUpperCase();
                    if (pool.length > 0 && !pool.includes(tradeCoin)) return;
                }
            }

            // ── SL/TP Sanity Check (fixes engine-side cross-contamination bug) ──
            const entryPrice = t.entry_price || t.entryPrice || 0;
            const leverage = t.leverage || 1;
            const isLong = side === 'buy' || side === 'long';
            let recalcSl = t.stop_loss || t.stopLoss || 0;
            let recalcTp = t.take_profit || t.takeProfit || 0;

            if (entryPrice > 0) {
                // Percentage-based defaults per leverage tier
                let slPct: number, tpPct: number;
                if (leverage >= 50) { slPct = 0.01; tpPct = 0.02; }
                else if (leverage >= 10) { slPct = 0.025; tpPct = 0.05; }
                else if (leverage >= 5) { slPct = 0.04; tpPct = 0.08; }
                else { slPct = 0.06; tpPct = 0.12; }

                const slDist = Math.abs(entryPrice - recalcSl);
                const maxSaneDist = entryPrice * 0.20;

                const slGarbage = recalcSl <= 0 || slDist > maxSaneDist ||
                    (isLong && recalcSl > entryPrice * 1.01) ||
                    (!isLong && recalcSl < entryPrice * 0.99);
                const tpGarbage = recalcTp <= 0 || Math.abs(recalcTp - entryPrice) > maxSaneDist ||
                    (isLong && recalcTp < entryPrice * 0.99) ||
                    (!isLong && recalcTp > entryPrice * 1.01);

                if (slGarbage) {
                    recalcSl = isLong
                        ? Math.round((entryPrice * (1 - slPct)) * 1e6) / 1e6
                        : Math.round((entryPrice * (1 + slPct)) * 1e6) / 1e6;
                }
                if (tpGarbage) {
                    recalcTp = isLong
                        ? Math.round((entryPrice * (1 + tpPct)) * 1e6) / 1e6
                        : Math.round((entryPrice * (1 - tpPct)) * 1e6) / 1e6;
                }
            }

            const rawTrailingSl: number | null = t.trailing_sl ?? null;

            // Upsert: create if not exists, update PNL/status if exists
            await prisma.trade.upsert({
                where: {
                    id: `engine_${engineTradeId}_${botId}`,
                },
                create: {
                    id: `engine_${engineTradeId}_${botId}`,
                    botId: botId,
                    coin: t.symbol || t.coin || '',
                    position: side === 'buy' || side === 'long' ? 'long' : 'short',
                    regime: t.regime || '',
                    confidence: t.confidence || 0,
                    mode: (t.mode || 'paper').toLowerCase().startsWith('live') ? 'live' : 'paper',
                    leverage: t.leverage || 1,
                    capital: t.capital || t.position_size || 100,
                    quantity: t.quantity || 0,
                    entryPrice: t.entry_price || t.entryPrice || 0,
                    currentPrice: t.current_price || t.currentPrice || null,
                    exitPrice: t.exit_price || t.exitPrice || null,
                    stopLoss: recalcSl,
                    takeProfit: recalcTp,
                    slType: t.sl_type || t.slType || 'fixed',
                    status,
                    activePnl: t.unrealized_pnl || t.active_pnl || 0,
                    activePnlPercent: t.unrealized_pnl_pct || t.activePnlPercent || 0,
                    totalPnl: status === 'closed'
                        ? (t.realized_pnl || t.pnl || t.total_pnl || 0)
                        : 0,
                    totalPnlPercent: status === 'closed' ? (t.realized_pnl_pct || t.pnl_pct || 0) : 0,
                    exitReason: t.exit_reason || t.exitReason || null,
                    exitPercent: t.exit_percent || null,
                    exchangeOrderId: String(engineTradeId),
                    entryTime,
                    exitTime,
                    t1Price: t.t1_price || null,
                    t2Price: t.t2_price || null,
                    t3Price: t.t3_price || null,
                    t1Hit: t.t1_hit || false,
                    t2Hit: t.t2_hit || false,
                    trailingSl: rawTrailingSl,
                    trailingActive: t.trailing_active ?? false,
                    trailSlCount: t.trail_sl_count ?? 0,
                    steppedLockLevel: t.stepped_lock_level ?? -1,
                    exitGuardActive: t.exit_guard_active ?? true,
                    exitCheckAt:     t.exit_check_at ? new Date(t.exit_check_at) : null,
                    exitCheckPrice:  t.exit_check_price ?? null,
                    sessionId: activeSession?.id ?? null,
                },
                update: {
                    ...(status === 'closed' ? { status: 'closed' } : {}),
                    currentPrice: t.current_price || t.currentPrice || null,
                    exitPrice: t.exit_price || t.exitPrice || null,
                    activePnl: t.unrealized_pnl || t.active_pnl || 0,
                    activePnlPercent: t.unrealized_pnl_pct || t.activePnlPercent || 0,
                    ...(status === 'closed' ? {
                        totalPnl: t.realized_pnl || t.pnl || t.total_pnl || 0,
                        totalPnlPercent: t.realized_pnl_pct || t.pnl_pct || 0,
                    } : {}),
                    exitReason: t.exit_reason || t.exitReason || null,
                    exitTime,
                    stopLoss: recalcSl,
                    takeProfit: recalcTp,
                    slType: t.sl_type || t.slType || 'fixed',
                    t1Hit: t.t1_hit || false,
                    t2Hit: t.t2_hit || false,
                    trailingSl: rawTrailingSl,
                    trailingActive: t.trailing_active ?? false,
                    trailSlCount: t.trail_sl_count ?? 0,
                    steppedLockLevel: t.stepped_lock_level ?? -1,
                    exitGuardActive: t.exit_guard_active ?? true,
                    exitCheckAt:     t.exit_check_at ? new Date(t.exit_check_at) : null,
                    exitCheckPrice:  t.exit_check_price ?? null,
                },
            });

            synced++;
        } catch (err) {
            console.error(`[sync] Failed to sync trade ${t.trade_id}:`, err);
        }
    }));

    return synced;
}

/**
 * Fetch user's trades from Prisma, scoped to their bots.
 */
export async function getUserTrades(userId: string, statusFilter?: string, botId?: string, modeFilter?: string) {
    const trades = await prisma.trade.findMany({
        where: {
            // Exclude trades from retired bots — retired data lives in Segment Performance panel only
            bot: { userId, status: { not: 'retired' } },
            ...(botId ? { botId } : {}),
            ...(statusFilter ? { status: statusFilter.toLowerCase() } : {}),
            ...(modeFilter ? { mode: modeFilter.toLowerCase() } : {}),
        },
        orderBy: { entryTime: 'desc' },
        include: {
            bot: { select: { name: true, exchange: true } },
        },
    });

    return trades
        .filter((t: any) => !COIN_EXCLUDE.has((t.coin || '').toUpperCase()))
        // PnL sanity: active trades with |unrealizedPnl%| > 999 have garbage quantity data
        .filter((t: any) => {
            if (t.status !== 'active') return true; // always show closed trades
            const pct = Math.abs(t.activePnlPercent || 0);
            return pct <= 999;
        })
        .map(t => ({
        id: t.id,
        trade_id: t.exchangeOrderId || t.id,
        symbol: t.coin,
        side: t.position === 'long' ? 'BUY' : 'SELL',
        position: t.position,
        regime: t.regime,
        confidence: t.confidence,
        mode: t.mode,
        leverage: t.leverage,
        capital: t.capital,
        quantity: t.quantity,
        entry_price: t.entryPrice,
        current_price: t.currentPrice,
        exit_price: t.exitPrice,
        stop_loss: t.stopLoss,
        take_profit: t.takeProfit,
        sl_type: t.slType,
        t1Hit: t.t1Hit,
        t2Hit: t.t2Hit,
        trailing_sl: t.trailingSl,
        trailing_active: t.trailingActive,
        trail_sl_count: t.trailSlCount,
        stepped_lock_level: t.steppedLockLevel,
        // Exit guard fields
        exit_guard_active: t.exitGuardActive,
        exit_check_at:     t.exitCheckAt?.toISOString() ?? null,
        exit_check_price:  t.exitCheckPrice ?? null,
        status: t.status.toUpperCase(),
        unrealized_pnl: t.activePnl,
        unrealized_pnl_pct: t.activePnlPercent,
        pnl: t.totalPnl,
        pnl_pct: t.totalPnlPercent,
        exit_reason: t.exitReason,
        exit_percent: t.exitPercent,
        entry_time: t.entryTime.toISOString(),
        exit_time: t.exitTime ? t.exitTime.toISOString() : null,
        exchange: t.bot?.exchange || 'binance_testnet',
        bot_name: t.bot?.name || 'Unknown Bot',
        bot_id: t.botId,
        // Backward compat fields
        realized_pnl: t.status === 'closed' ? t.totalPnl : 0,
        active_pnl: t.activePnl,
        total_pnl: t.totalPnl,
        // Session tracking
        sessionId: t.sessionId ?? null,
    }));
}

/**
 * Delete all trades for a specific user (for "clear trades" button).
 */
export async function clearUserTrades(userId: string): Promise<number> {
    // Only delete CLOSED/CANCELLED trades — active trades must be exited first.
    // Active trades deleted here would just come back on the next engine sync.
    const result = await prisma.trade.deleteMany({
        where: {
            bot: { userId },
            status: { in: ['closed', 'cancelled', 'CLOSED', 'CANCELLED'] },
        },
    });
    return result.count;
}

// ─── Athena Decision Log Sync ───────────────────────────────────────────────

// Throttle: max once per 60s globally (decisions don't change mid-cycle)
let _lastAthenaSync = 0;
const ATHENA_SYNC_THROTTLE_MS = 60_000;

/**
 * Sync Athena decisions from engine coin_states into AthenaDecisionLog.
 * Called from bot-state GET poll. Deduplicates by cycle+symbol.
 */
export async function syncAthenaDecisions(
    coinStates: Record<string, any>,
    cycle: number,
    engineTrades?: any[]
): Promise<number> {
    if (!coinStates || typeof coinStates !== 'object') return 0;

    const now = Date.now();
    if (now - _lastAthenaSync < ATHENA_SYNC_THROTTLE_MS) return 0;
    _lastAthenaSync = now;

    let synced = 0;

    await Promise.all(Object.entries(coinStates).map(async ([symbol, state]) => {
        const athena = state?.athena_state;
        if (!athena || !athena.action) return;

        // Derive segment from bot_deploy_statuses or pool_status
        const segment = state?.segment || state?.pool_segment || null;
        const regime = (state?.regime || '').replace(/\(.*\)/, '').trim() || null;
        const conviction = state?.conviction ?? state?.confidence ?? null;
        const price = state?.price ?? null;

        // Check deployment status
        const deployStatuses = state?.bot_deploy_statuses || {};
        const deployValues = Object.values(deployStatuses);
        const deployed = deployValues.some((v: any) => String(v).includes('DEPLOYED'));
        const deployReason = deployed
            ? null
            : deployValues.find((v: any) => String(v).includes('FILTERED') || String(v).includes('SKIP'))
                ? String(deployValues.find((v: any) => String(v).includes('FILTERED') || String(v).includes('SKIP')))
                : athena.action === 'VETO' ? 'Athena VETO' : null;

        try {
            // Upsert: unique by cycle + symbol
            const existing = await prisma.athenaDecisionLog.findFirst({
                where: { cycle, symbol },
            });

            if (existing) {
                // Only update if data has changed (e.g., deployment status)
                if (existing.deployed !== deployed || (!existing.tradeId && deployed)) {
                    await prisma.athenaDecisionLog.update({
                        where: { id: existing.id },
                        data: {
                            deployed,
                            deployReason: deployReason || existing.deployReason,
                        },
                    });
                }
            } else {
                await prisma.athenaDecisionLog.create({
                    data: {
                        cycle,
                        symbol,
                        segment,
                        regime,
                        conviction: conviction != null ? Number(conviction) : null,
                        action: athena.action,
                        side: athena.side || athena.athena_direction || null,
                        confidence: athena.confidence != null ? Number(athena.confidence) : null,
                        reasoning: athena.reasoning || null,
                        riskFlags: Array.isArray(athena.risk_flags) ? JSON.stringify(athena.risk_flags) : null,
                        model: athena.model || null,
                        latencyMs: athena.latency_ms != null ? Number(athena.latency_ms) : null,
                        suggestedSl: athena.suggested_sl && Number(athena.suggested_sl) > 0 ? Number(athena.suggested_sl) : null,
                        suggestedTp: athena.suggested_tp && Number(athena.suggested_tp) > 0 ? Number(athena.suggested_tp) : null,
                        entryPrice: price != null ? Number(price) : null,
                        deployed,
                        deployReason,
                    },
                });
                synced++;
            }
        } catch (err) {
            console.error(`[athena-sync] Failed for ${symbol} cycle ${cycle}:`, err);
        }
    }));

    // ── Backfill P&L from closed trades ──
    try {
        const unlinked = await prisma.athenaDecisionLog.findMany({
            where: {
                deployed: true,
                tradeStatus: { not: 'CLOSED' },
            },
            take: 50,
            orderBy: { timestamp: 'desc' },
        });

        for (const log of unlinked) {
            // Find matching trade by symbol and approximate time
            const trade = await prisma.trade.findFirst({
                where: {
                    coin: log.symbol,
                    entryTime: { gte: new Date(log.timestamp.getTime() - 300000) }, // within 5 min
                    ...(log.tradeId ? { id: log.tradeId } : {}),
                },
                orderBy: { entryTime: 'desc' },
            });

            if (!trade) continue;

            const update: any = {};
            if (!log.tradeId) update.tradeId = trade.id;

            if (trade.status === 'closed') {
                update.tradeStatus = 'CLOSED';
                update.pnl = trade.totalPnl || 0;
                update.pnlPct = trade.totalPnlPercent || 0;
                update.exitPrice = trade.exitPrice || null;
                update.closedAt = trade.exitTime || new Date();
            } else if (!log.tradeStatus) {
                update.tradeStatus = 'ACTIVE';
            }

            if (Object.keys(update).length > 0) {
                await prisma.athenaDecisionLog.update({
                    where: { id: log.id },
                    data: update,
                });
            }
        }
    } catch (err) {
        console.error('[athena-sync] P&L backfill error:', err);
    }

    return synced;
}

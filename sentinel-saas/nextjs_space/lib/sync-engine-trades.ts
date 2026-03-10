import { prisma } from '@/lib/prisma';
import { getActiveBotSession } from '@/lib/bot-session';

// D1 FIX: Throttle sync to prevent DB hammering (max once per 30s per bot)
const _lastSyncTime: Record<string, number> = {};
const SYNC_THROTTLE_MS = 30_000;

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
    botStartedAt: Date | null
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

    let synced = 0;

    for (const t of engineTrades) {
        try {
            // Parse entry time — engine uses "entry_timestamp", fallback to other names
            const rawTime = t.entry_timestamp || t.entry_time || t.entryTime || t.timestamp || '';
            const sanitized = String(rawTime).replace(/(\.\d{3})\d+/, '$1');
            const entryTime = rawTime ? new Date(sanitized) : new Date();
            if (isNaN(entryTime.getTime())) continue;

            // Only sync trades after bot was started
            if (botStartedAt && entryTime < botStartedAt) continue;

            const engineTradeId = t.trade_id || t.id;
            if (!engineTradeId) continue;

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

            // BOT ISOLATION: Only sync engine trades that belong to THIS bot.
            // The engine stamps every trade with bot_id (from config.ENGINE_BOT_ID).
            // Trades with matching bot_id go to this bot; unmatched trades are skipped.
            // Legacy trades with no bot_id are synced to this bot for backward compat.
            const engineBotId = t.bot_id || t.botId || null;
            if (engineBotId && engineBotId !== botId) continue; // belongs to a different bot
            const resolvedBotId = botId;

            // Upsert: create if not exists, update PNL/status if exists
            await prisma.trade.upsert({
                where: {
                    id: `engine_${engineTradeId}_${resolvedBotId}`,
                },
                create: {
                    id: `engine_${engineTradeId}_${resolvedBotId}`,
                    botId: resolvedBotId,
                    coin: t.symbol || t.coin || '',
                    position: side === 'buy' || side === 'long' ? 'long' : 'short',
                    regime: t.regime || '',
                    confidence: t.confidence || 0,
                    // S9 FIX: normalize mode — strip exchange suffix (LIVE-COINDCX → live)
                    mode: (t.mode || 'paper').toLowerCase().startsWith('live') ? 'live' : 'paper',
                    leverage: t.leverage || 1,
                    capital: t.capital || t.position_size || 100,
                    quantity: t.quantity || 0,
                    entryPrice: t.entry_price || t.entryPrice || 0,
                    currentPrice: t.current_price || t.currentPrice || null,
                    exitPrice: t.exit_price || t.exitPrice || null,
                    stopLoss: t.stop_loss || t.stopLoss || 0,
                    takeProfit: t.take_profit || t.takeProfit || 0,
                    slType: t.sl_type || t.slType || 'fixed',
                    status,
                    activePnl: t.unrealized_pnl || t.active_pnl || 0,
                    activePnlPercent: t.unrealized_pnl_pct || t.activePnlPercent || 0,
                    totalPnl: status === 'closed'
                        ? (t.pnl || t.realized_pnl || t.total_pnl || 0)
                        : 0,  // BUG-13: active trades have no realized PnL yet
                    totalPnlPercent: t.pnl_pct || t.totalPnlPercent || 0,
                    exitReason: t.exit_reason || t.exitReason || null,
                    exitPercent: t.exit_percent || null,
                    exchangeOrderId: String(engineTradeId),
                    entryTime,
                    exitTime,
                    // Multi-target fields
                    t1Price: t.targets?.t1 || null,
                    t2Price: t.targets?.t2 || null,
                    t3Price: t.targets?.t3 || null,
                    t1Hit: t.t1_hit || false,
                    t2Hit: t.t2_hit || false,
                    trailingSl: t.trailing_sl || null,
                    trailingActive: t.trailing_active || false,
                    sessionId: activeSession?.id ?? null,
                },
                update: {
                    // Only overwrite status when engine says 'closed'.
                    // If engine says 'active', leave DB status alone — preserves MANUAL_CLOSE / BOT_STOPPED.
                    ...(status === 'closed' ? { status: 'closed' } : {}),
                    currentPrice: t.current_price || t.currentPrice || null,
                    exitPrice: t.exit_price || t.exitPrice || null,
                    activePnl: t.unrealized_pnl || t.active_pnl || 0,
                    activePnlPercent: t.unrealized_pnl_pct || t.activePnlPercent || 0,
                    totalPnl: status === 'closed'
                        ? (t.pnl || t.realized_pnl || t.total_pnl || 0)
                        : 0,  // BUG-13: active trades have no realized PnL yet
                    totalPnlPercent: t.pnl_pct || t.totalPnlPercent || 0,
                    exitReason: t.exit_reason || t.exitReason || null,
                    exitTime,
                    stopLoss: t.stop_loss || t.stopLoss || 0,
                    takeProfit: t.take_profit || t.takeProfit || 0,
                    slType: t.sl_type || t.slType || 'fixed',
                    t1Hit: t.t1_hit || false,
                    t2Hit: t.t2_hit || false,
                    trailingSl: t.trailing_sl || null,
                    trailingActive: t.trailing_active || false,
                },
            });

            synced++;
        } catch (err) {
            // Log but don't fail the sync for one bad trade
            console.error(`[sync] Failed to sync trade ${t.trade_id}:`, err);
        }
    }

    return synced;
}

/**
 * Fetch user's trades from Prisma, scoped to their bots.
 */
export async function getUserTrades(userId: string, statusFilter?: string, botId?: string, modeFilter?: string) {
    const trades = await prisma.trade.findMany({
        where: {
            bot: { userId },
            ...(botId ? { botId } : {}),
            ...(statusFilter ? { status: statusFilter.toLowerCase() } : {}),
            ...(modeFilter ? { mode: modeFilter.toLowerCase() } : {}),
        },
        orderBy: { entryTime: 'desc' },
        include: {
            bot: { select: { name: true, exchange: true } },
        },
    });

    return trades.map(t => ({
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

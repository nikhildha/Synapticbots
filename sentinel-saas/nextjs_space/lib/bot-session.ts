/**
 * Bot Session Helpers
 * Manage start-to-stop run records (BotSession) for each bot.
 * Each session captures performance metrics: PnL, ROI, win rate, etc.
 */
import { prisma } from '@/lib/prisma';

import { getEngineUrl } from '@/lib/engine-url';

// ─── Create ───────────────────────────────────────────────────────────────────

/**
 * Called when a bot starts. Creates a new active BotSession.
 */
export async function createBotSession(botId: string, mode: string): Promise<string> {
    const count = await prisma.botSession.count({ where: { botId } });
    const session = await prisma.botSession.create({
        data: {
            botId,
            mode,
            sessionIndex: count + 1,
            startedAt: new Date(),
            status: 'active',
        },
    });
    return session.id;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Returns the currently active session for a bot, or null.
 */
export async function getActiveBotSession(botId: string) {
    return prisma.botSession.findFirst({
        where: { botId, status: 'active' },
        orderBy: { startedAt: 'desc' },
    });
}

// ─── Close ────────────────────────────────────────────────────────────────────

/**
 * Called when a bot stops.
 * - Closes active paper trades in Prisma (exitReason: BOT_STOPPED)
 * - Sends CLOSE_ALL to Python engine for live trades (best effort)
 * - Computes session metrics and closes the BotSession record
 */
export async function closeBotSession(botId: string): Promise<void> {
    const activeSession = await getActiveBotSession(botId);
    if (!activeSession) return;

    const now = new Date();

    // B1 FIX: Use case-insensitive mode matching (engine writes PAPER/LIVE uppercase)
    const activePaperTrades = await prisma.trade.findMany({
        where: { botId, status: { in: ['active', 'ACTIVE', 'Active'] }, mode: { in: ['paper', 'PAPER', 'Paper'] } },
    });
    if (activePaperTrades.length > 0) {
        await Promise.all(activePaperTrades.map(t =>
            prisma.trade.update({
                where: { id: t.id },
                data: {
                    status: 'closed',
                    exitReason: 'BOT_STOPPED',
                    exitPrice: t.currentPrice || t.entryPrice,
                    exitTime: now,
                    totalPnl: t.activePnl,
                    totalPnlPercent: t.activePnlPercent,
                },
            })
        ));
    }

    // 2. Signal engine to close live positions (best effort — don't block on this)
    const activeLiveTrades = await prisma.trade.findMany({
        where: { botId, status: { in: ['active', 'ACTIVE', 'Active'] }, mode: { in: ['live', 'LIVE', 'Live'] } },
    });
    // C3 FIX: Use getEngineUrl() instead of hardcoded env var
    const liveEngineUrl = getEngineUrl('live');
    if (activeLiveTrades.length > 0 && liveEngineUrl) {
        try {
            await fetch(`${liveEngineUrl}/api/close-all`, {
                method: 'POST',
                signal: AbortSignal.timeout(5000),
            });
        } catch {
            console.warn('[bot-session] Engine CLOSE_ALL unreachable; live positions will close via exchange SL/TP');
        }
    }

    // 3. Compute metrics from all trades in this session
    const sessionTrades = await prisma.trade.findMany({
        where: { sessionId: activeSession.id },
    });

    const closed = sessionTrades.filter(t => t.status === 'closed');
    const wins = closed.filter(t => t.totalPnl > 0);
    const totalPnl = closed.reduce((s, t) => s + t.totalPnl, 0);
    const totalCapital = sessionTrades.reduce((s, t) => s + t.capital, 0);
    const pnls = closed.map(t => t.totalPnl);
    const bestTrade = pnls.length > 0 ? Math.max(...pnls) : 0;
    const worstTrade = pnls.length > 0 ? Math.min(...pnls) : 0;
    const roi = totalCapital > 0 ? (totalPnl / totalCapital) * 100 : 0;
    const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0;

    // 4. Close the session record
    await prisma.botSession.update({
        where: { id: activeSession.id },
        data: {
            status: 'closed',
            endedAt: now,
            totalTrades: sessionTrades.length,
            closedTrades: closed.length,
            winTrades: wins.length,
            totalPnl,
            totalCapital,
            roi,
            winRate,
            bestTrade,
            worstTrade,
            maxDrawdown: worstTrade, // proxy: worst single trade loss
        },
    });
}

// ─── Backfill ─────────────────────────────────────────────────────────────────

/**
 * Backfills a "Session 0 (Legacy)" for a bot's trades that have no sessionId.
 * Call once per bot after migration via /api/sessions/backfill.
 */
export async function backfillLegacySession(botId: string, mode: string): Promise<boolean> {
    const untagged = await prisma.trade.findMany({
        where: { botId, sessionId: null },
        orderBy: { entryTime: 'asc' },
    });
    if (untagged.length === 0) return false;

    const startedAt = untagged[0].entryTime;
    const exitTimes = untagged.map(t => t.exitTime).filter(Boolean) as Date[];
    const endedAt = exitTimes.length > 0
        ? new Date(Math.max(...exitTimes.map(d => d.getTime())))
        : new Date();

    // Check if Session 0 already exists for this bot
    const existing = await prisma.botSession.findFirst({
        where: { botId, sessionIndex: 0 },
    });
    if (existing) return false;

    const session = await prisma.botSession.create({
        data: {
            botId,
            mode,
            sessionIndex: 0,
            startedAt,
            endedAt,
            status: 'closed',
        },
    });

    // Tag all untagged trades with this session
    await prisma.trade.updateMany({
        where: { botId, sessionId: null },
        data: { sessionId: session.id },
    });

    // Compute and save metrics
    const closed = untagged.filter(t => t.status === 'closed');
    const wins = closed.filter(t => t.totalPnl > 0);
    const totalPnl = closed.reduce((s, t) => s + t.totalPnl, 0);
    const totalCapital = untagged.reduce((s, t) => s + t.capital, 0);
    const pnls = closed.map(t => t.totalPnl);

    await prisma.botSession.update({
        where: { id: session.id },
        data: {
            totalTrades: untagged.length,
            closedTrades: closed.length,
            winTrades: wins.length,
            totalPnl,
            totalCapital,
            roi: totalCapital > 0 ? (totalPnl / totalCapital) * 100 : 0,
            winRate: closed.length > 0 ? (wins.length / closed.length) * 100 : 0,
            bestTrade: pnls.length > 0 ? Math.max(...pnls) : 0,
            worstTrade: pnls.length > 0 ? Math.min(...pnls) : 0,
            maxDrawdown: pnls.length > 0 ? Math.min(...pnls) : 0,
        },
    });

    return true;
}

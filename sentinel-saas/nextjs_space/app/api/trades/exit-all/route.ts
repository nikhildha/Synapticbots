import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/prisma';
import { getEngineUrl } from '@/lib/engine-url';

export const dynamic = 'force-dynamic';

/**
 * POST /api/trades/exit-all
 * Exits ALL active trades for the current user.
 * Optionally filter by mode: { mode: 'live' | 'paper' | 'all' }
 * Closes in Prisma DB + best-effort on Engine.
 */
export async function POST(request: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const userId = (session.user as any)?.id;
        const isAdmin = (session.user as any)?.role === 'admin';
        const body = await request.json().catch(() => ({}));
        const modeFilter = body.mode || 'all'; // 'live', 'paper', or 'all'

        // ─── Find all active trades (always scoped to current user) ────
        const activeStatuses = ['active', 'ACTIVE', 'Active'];
        const whereClause: any = {
            status: { in: activeStatuses },
            bot: { userId },
            ...(modeFilter !== 'all' ? { mode: modeFilter } : {}),
        };

        const activeTrades = await prisma.trade.findMany({
            where: whereClause,
            include: { bot: true },
        });

        if (activeTrades.length === 0) {
            return NextResponse.json({ success: true, closed: [], message: 'No active trades to close' });
        }

        const results: any[] = [];
        const errors: any[] = [];

        // ─── Close each trade ────────────────────────────────────────────
        for (const trade of activeTrades) {
            try {
                const currentPrice = trade.currentPrice || trade.entryPrice;
                const entry = trade.entryPrice;
                const capital = trade.capital;
                const lev = trade.leverage;
                const isLong = trade.position === 'long';

                const priceDiff = isLong ? (currentPrice - entry) : (entry - currentPrice);
                const rawPnl = priceDiff / entry * lev * capital;
                const leveragedPnl = Math.round(rawPnl * 10000) / 10000;
                const pnlPct = capital > 0 ? Math.round(leveragedPnl / capital * 100 * 100) / 100 : 0;

                // Update in Prisma
                await prisma.trade.update({
                    where: { id: trade.id },
                    data: {
                        status: 'closed',
                        exitPrice: currentPrice,
                        exitTime: new Date(),
                        exitReason: 'EXIT_ALL',
                        totalPnl: leveragedPnl,
                        totalPnlPercent: pnlPct,
                        activePnl: 0,
                        activePnlPercent: 0,
                    },
                });

                results.push({
                    trade_id: trade.exchangeOrderId || trade.id,
                    symbol: trade.coin,
                    mode: trade.mode,
                    pnl: leveragedPnl,
                    pnl_pct: pnlPct,
                });

                // Best-effort close on correct engine (paper or live) based on trade mode
                const engineUrl = getEngineUrl(trade.mode === 'live' ? 'live' : 'paper');
                if (engineUrl) {
                    try {
                        const engineTradeId = trade.exchangeOrderId || trade.id;
                        await fetch(`${engineUrl}/api/close-trade`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                trade_id: engineTradeId,
                                symbol: trade.coin,
                                reason: 'EXIT_ALL',
                            }),
                            signal: AbortSignal.timeout(5000),
                        });
                    } catch {
                        // Engine close is best-effort
                    }
                }
            } catch (err: any) {
                errors.push({ trade_id: trade.id, symbol: trade.coin, error: err.message });
            }
        }

        return NextResponse.json({
            success: true,
            totalClosed: results.length,
            totalErrors: errors.length,
            closed: results,
            errors: errors.length > 0 ? errors : undefined,
            totalPnl: results.reduce((s, r) => s + (r.pnl || 0), 0),
        });
    } catch (error: any) {
        console.error('[exit-all] Error:', error);
        return NextResponse.json({ error: 'Failed to exit all trades' }, { status: 500 });
    }
}

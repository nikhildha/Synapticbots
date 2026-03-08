import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/prisma';
import { getEngineUrl } from '@/lib/engine-url';

export const dynamic = 'force-dynamic';

/**
 * POST /api/trades/exit-all
 * Exits ALL active trades for the current user.
 * For LIVE trades: calls engine /api/exit-all-live FIRST to close CoinDCX positions.
 * For PAPER trades: closes in Prisma DB + best-effort engine close.
 */
export async function POST(request: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const userId = (session.user as any)?.id;
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

        // ─── LIVE TRADES: Close CoinDCX positions FIRST via engine ────────
        const hasLiveTrades = activeTrades.some(t =>
            (t.mode || '').toLowerCase().startsWith('live')
        );

        if (hasLiveTrades) {
            const liveEngineUrl = getEngineUrl('live');
            if (liveEngineUrl) {
                try {
                    // Call engine exit-all-live — closes ALL CoinDCX positions + tradebook
                    const exitRes = await fetch(`${liveEngineUrl}/api/exit-all-live`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        signal: AbortSignal.timeout(15000),
                    });
                    const exitData = await exitRes.json();
                    console.log('[exit-all] Engine exit-all-live result:', JSON.stringify(exitData));

                    if (exitData.errors?.length > 0) {
                        errors.push(...exitData.errors.map((e: string) => ({ source: 'engine', error: e })));
                    }
                } catch (err) {
                    console.error('[exit-all] Engine exit-all-live failed:', err);
                    // F1 FIX: Abort — do NOT close Prisma trades if CoinDCX positions could not be closed.
                    // Silently marking DB as closed while exchange still holds the position is
                    // operationally dangerous (hidden live risk with no UI visibility).
                    return NextResponse.json({
                        success: false,
                        error: 'Could not reach engine to close CoinDCX live positions. ' +
                               'No trades were closed. Please retry or close positions manually on CoinDCX.',
                        liveTradesAffected: activeTrades
                            .filter(t => (t.mode || '').toLowerCase().startsWith('live'))
                            .map(t => ({ id: t.id, coin: t.coin })),
                    }, { status: 502 });
                }
            } else {
                // F1 FIX: Engine URL not configured — cannot safely close live positions
                return NextResponse.json({
                    success: false,
                    error: 'Live engine URL not configured. Cannot close CoinDCX positions safely.',
                }, { status: 503 });
            }
        }

        // ─── Close each trade in Prisma DB ────────────────────────────────
        for (const trade of activeTrades) {
            try {
                const currentPrice = trade.currentPrice || trade.entryPrice;
                const entry = trade.entryPrice;
                const capital = trade.capital;
                const lev = trade.leverage;
                const isLong = trade.position === 'long';

                const priceDiff = isLong ? (currentPrice - entry) : (entry - currentPrice);
                // PnL FIX: use quantity (already leveraged) — don't multiply by lev again
                const quantity = (trade as any).quantity || (capital * lev / entry);
                const rawPnl = priceDiff * quantity;
                const netPnl = Math.round(rawPnl * 10000) / 10000;
                const pnlPct = capital > 0 ? Math.round(netPnl / capital * 100 * 100) / 100 : 0;

                // Update in Prisma
                await prisma.trade.update({
                    where: { id: trade.id },
                    data: {
                        status: 'closed',
                        exitPrice: currentPrice,
                        exitTime: new Date(),
                        exitReason: 'EXIT_ALL',
                        totalPnl: netPnl,
                        totalPnlPercent: pnlPct,
                        activePnl: 0,
                        activePnlPercent: 0,
                    },
                });

                results.push({
                    trade_id: trade.exchangeOrderId || trade.id,
                    symbol: trade.coin,
                    mode: trade.mode,
                    pnl: netPnl,
                    pnl_pct: pnlPct,
                });

                // For paper trades: best-effort engine close
                const isLive = (trade.mode || '').toLowerCase().startsWith('live');
                if (!isLive) {
                    const engineUrl = getEngineUrl('paper');
                    if (engineUrl) {
                        try {
                            await fetch(`${engineUrl}/api/close-trade`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    trade_id: trade.exchangeOrderId || trade.id,
                                    symbol: trade.coin,
                                    reason: 'EXIT_ALL',
                                }),
                                signal: AbortSignal.timeout(5000),
                            });
                        } catch {
                            // Engine close is best-effort for paper
                        }
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

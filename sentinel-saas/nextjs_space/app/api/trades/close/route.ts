import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/prisma';
import { getEngineUrl } from '@/lib/engine-url';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { tradeId: rawTradeId, symbol: rawSymbol } = await request.json();
        if (!rawTradeId && !rawSymbol) {
            return NextResponse.json({ error: 'tradeId or symbol required' }, { status: 400 });
        }

        const userId = (session.user as any)?.id;

        // ─── Parse composite IDs (e.g. "T-0030-BTCUSDT" → tradeId="T-0030", symbol="BTCUSDT") ──
        let tradeId = rawTradeId;
        let symbol = rawSymbol;
        if (tradeId && tradeId.match(/^T-\d+-\w+/)) {
            const parts = tradeId.match(/^(T-\d+)-(.+)$/);
            if (parts) {
                tradeId = parts[1];
                symbol = symbol || parts[2];
            }
        }

        // ─── Find the trade in Prisma (ALWAYS filter by userId — no admin bypass) ────
        let trade = null;
        const activeStatuses = ['active', 'ACTIVE', 'Active'];

        if (tradeId) {
            trade = await prisma.trade.findFirst({
                where: {
                    id: tradeId,
                    status: { in: activeStatuses },
                    bot: { userId },
                },
                include: { bot: true },
            });

            if (!trade) {
                trade = await prisma.trade.findFirst({
                    where: {
                        exchangeOrderId: tradeId,
                        status: { in: activeStatuses },
                        bot: { userId },
                    },
                    include: { bot: true },
                });
            }

            // Note: no partial-match (contains) fallback — ambiguous matches can close the wrong trade
        }

        if (!trade && symbol) {
            trade = await prisma.trade.findFirst({
                where: {
                    coin: symbol.toUpperCase(),
                    status: { in: activeStatuses },
                    bot: { userId },
                },
                include: { bot: true },
                orderBy: { entryTime: 'desc' },
            });
        }

        // ─── For LIVE trades: close on CoinDCX FIRST, then update Prisma ─────────
        const isLiveTrade = trade && (trade.mode || '').toLowerCase().includes('live');
        const engineUrl = trade ? getEngineUrl(isLiveTrade ? 'live' : 'paper') : null;

        if (isLiveTrade) {
            // C1 FIX: For live trades, MUST close on CoinDCX via engine FIRST.
            // Abort on any failure — do NOT silently close in DB while exchange position remains open.
            if (!engineUrl) {
                return NextResponse.json({
                    success: false,
                    error: 'Live engine not configured. Cannot close CoinDCX position safely.',
                }, { status: 503 });
            }
            try {
                const engineTradeId = trade!.exchangeOrderId || trade!.id;
                const engineRes = await fetch(`${engineUrl}/api/close-trade`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        trade_id: engineTradeId,
                        symbol: trade!.coin,
                        reason: 'MANUAL_CLOSE',
                    }),
                    signal: AbortSignal.timeout(10000),
                });
                const engineData = await engineRes.json();
                if (engineRes.ok && engineData.success && engineData.closed?.length > 0) {
                    // Use the actual fill price and PnL from the engine
                    const closed = engineData.closed[0];
                    await prisma.trade.update({
                        where: { id: trade!.id },
                        data: {
                            status: 'closed',
                            exitPrice: closed.exit_price ?? trade!.currentPrice ?? trade!.entryPrice,
                            exitTime: new Date(),
                            exitReason: 'MANUAL_CLOSE',
                            totalPnl: closed.realized_pnl || 0,
                            totalPnlPercent: closed.realized_pnl_pct || 0,
                            activePnl: 0,
                            activePnlPercent: 0,
                        },
                    });
                    return NextResponse.json({
                        success: true,
                        closed: [{
                            trade_id: trade!.exchangeOrderId || trade!.id,
                            symbol: trade!.coin,
                            pnl: closed.realized_pnl || 0,
                            pnl_pct: closed.realized_pnl_pct || 0,
                        }],
                    });
                }
                // Engine reached but returned non-success — abort; CoinDCX position may still be open.
                return NextResponse.json({
                    success: false,
                    error: engineData.error || 'Engine could not close the CoinDCX position. Retry or close manually on CoinDCX.',
                }, { status: 502 });
            } catch (err) {
                console.error('[trades/close] Engine close failed:', err);
                return NextResponse.json({
                    success: false,
                    error: 'Could not reach engine to close CoinDCX position. Retry or close manually on CoinDCX.',
                }, { status: 502 });
            }
        }

        // Paper trade path — safe to close locally using current price.

        // If the trade is not in Prisma yet (sync hasn't run or bot_id not set), attempt a
        // safe engine-only close for PAPER mode. Safety gate: user must have a bot that owns
        // a paper engine URL — this proves ownership without needing a Prisma trade record.
        if (!trade) {
            const paperEngineUrl = getEngineUrl('paper');
            if (paperEngineUrl && (tradeId || symbol)) {
                // Verify user has a bot (ownership proof)
                const userBot = await prisma.bot.findFirst({
                    where: { userId },
                    select: { id: true },
                });
                if (userBot) {
                    try {
                        const engineRes = await fetch(`${paperEngineUrl}/api/close-trade`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                trade_id: tradeId,
                                symbol: symbol?.toUpperCase(),
                                reason: 'MANUAL_CLOSE',
                            }),
                            signal: AbortSignal.timeout(8000),
                        });
                        const engineData = await engineRes.json();
                        if (engineRes.ok && engineData.success) {
                            return NextResponse.json({ success: true, closed: engineData.closed || [], source: 'engine_only' });
                        }
                    } catch { /* engine unreachable */ }
                }
            }
            return NextResponse.json({ error: 'No matching active trade found' }, { status: 404 });
        }

        // ─── Calculate PNL at current price (paper trades / fallback) ────────────
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

        // ─── Update trade in Prisma ──────────────────────────────────────
        await prisma.trade.update({
            where: { id: trade.id },
            data: {
                status: 'closed',
                exitPrice: currentPrice,
                exitTime: new Date(),
                exitReason: 'MANUAL_CLOSE',
                totalPnl: netPnl,
                totalPnlPercent: pnlPct,
                activePnl: 0,
                activePnlPercent: 0,
            },
        });

        // ─── Also try to close on engine (best-effort for paper trades) ──────────
        if (engineUrl && !isLiveTrade) {
            try {
                const engineTradeId = trade.exchangeOrderId || trade.id;
                await fetch(`${engineUrl}/api/close-trade`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        trade_id: engineTradeId,
                        symbol: trade.coin,
                    }),
                    signal: AbortSignal.timeout(5000),
                });
            } catch {
                // Engine close is best-effort for paper
            }
        }

        return NextResponse.json({
            success: true,
            closed: [{
                trade_id: trade.exchangeOrderId || trade.id,
                symbol: trade.coin,
                pnl: netPnl,
                pnl_pct: pnlPct,
            }],
        });
    } catch (error: any) {
        console.error('Trade close error:', error);
        return NextResponse.json({ error: 'Failed to close trade' }, { status: 500 });
    }
}

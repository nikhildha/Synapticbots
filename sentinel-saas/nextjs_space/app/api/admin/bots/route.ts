import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// ─── GET: All bots with user info, PnL, trade counts ────────────────────────
export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user || (session.user as any).role !== 'admin') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
        }

        const bots = await prisma.bot.findMany({
            select: {
                id: true,
                name: true,
                isActive: true,
                status: true,
                exchange: true,
                startedAt: true,
                stoppedAt: true,
                createdAt: true,
                config: { select: { mode: true, capitalPerTrade: true, maxLossPct: true } },
                user: { select: { id: true, email: true, name: true } },
                trades: {
                    select: {
                        id: true,
                        coin: true,
                        position: true,
                        status: true,
                        entryPrice: true,
                        exitPrice: true,
                        currentPrice: true,
                        leverage: true,
                        capital: true,
                        totalPnl: true,
                        totalPnlPercent: true,
                        activePnl: true,
                        activePnlPercent: true,
                        entryTime: true,
                        exitTime: true,
                        exitReason: true,
                        mode: true,
                    },
                    orderBy: { entryTime: 'desc' },
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        // Compute aggregates per bot
        const enriched = bots.map((bot: any) => {
            const trades = bot.trades || [];
            const activeTrades = trades.filter((t: any) => (t.status || '').toLowerCase() === 'active');
            const closedTrades = trades.filter((t: any) => (t.status || '').toLowerCase() === 'closed');

            const totalPnl = closedTrades.reduce((sum: number, t: any) => sum + (t.totalPnl || 0), 0);
            const wins = closedTrades.filter((t: any) => (t.totalPnl || 0) > 0).length;
            const winRate = closedTrades.length > 0 ? Math.round(wins / closedTrades.length * 100) : 0;

            // Active PnL from active trades
            const activePnl = activeTrades.reduce((sum: number, t: any) => sum + (t.activePnl || 0), 0);

            return {
                id: bot.id,
                name: bot.name,
                isActive: bot.isActive,
                status: bot.status,
                exchange: bot.exchange,
                startedAt: bot.startedAt,
                stoppedAt: bot.stoppedAt,
                createdAt: bot.createdAt,
                mode: bot.config?.mode || 'paper',
                capitalPerTrade: bot.config?.capitalPerTrade,
                maxLossPct: bot.config?.maxLossPct,
                user: bot.user,
                stats: {
                    activeTradeCount: activeTrades.length,
                    closedTradeCount: closedTrades.length,
                    totalTradeCount: trades.length,
                    totalPnl: Math.round(totalPnl * 100) / 100,
                    activePnl: Math.round(activePnl * 100) / 100,
                    winRate,
                },
                // Last 10 trades for expandable view
                recentTrades: trades.slice(0, 10).map((t: any) => ({
                    id: t.id,
                    symbol: t.coin,
                    position: t.position,
                    status: t.status,
                    entryPrice: t.entryPrice,
                    exitPrice: t.exitPrice,
                    currentPrice: t.currentPrice,
                    leverage: t.leverage,
                    capital: t.capital,
                    pnl: t.totalPnl || t.activePnl || 0,
                    pnlPct: t.totalPnlPercent || t.activePnlPercent || 0,
                    entryTime: t.entryTime,
                    exitTime: t.exitTime,
                    exitReason: t.exitReason,
                    mode: t.mode,
                })),
            };
        });

        return NextResponse.json(enriched);
    } catch (error: any) {
        console.error('Admin bots error:', error);
        return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
}

// ─── POST: Admin stop a bot ─────────────────────────────────────────────────
export async function POST(request: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user || (session.user as any).role !== 'admin') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
        }

        const { botId, action } = await request.json();
        if (!botId || !action) {
            return NextResponse.json({ error: 'botId and action required' }, { status: 400 });
        }

        const bot = await prisma.bot.findUnique({ where: { id: botId } });
        if (!bot) {
            return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
        }

        if (action === 'stop') {
            // Close all active trades for this bot
            const activeTrades = await prisma.trade.findMany({
                where: { botId, status: { in: ['active', 'ACTIVE', 'Active'] } },
            });

            for (const trade of activeTrades) {
                const currentPrice = trade.currentPrice || trade.entryPrice;
                const isLong = trade.position === 'long' || trade.position === 'LONG';
                const priceDiff = isLong ? (currentPrice - trade.entryPrice) : (trade.entryPrice - currentPrice);
                const rawPnl = priceDiff / trade.entryPrice * trade.leverage * trade.capital;
                const leveragedPnl = Math.round(rawPnl * 10000) / 10000;
                const pnlPct = trade.capital > 0 ? Math.round(leveragedPnl / trade.capital * 100 * 100) / 100 : 0;

                await prisma.trade.update({
                    where: { id: trade.id },
                    data: {
                        status: 'closed',
                        exitPrice: currentPrice,
                        exitTime: new Date(),
                        exitReason: 'ADMIN_STOPPED',
                        totalPnl: leveragedPnl,
                        totalPnlPercent: pnlPct,
                        activePnl: 0,
                        activePnlPercent: 0,
                    },
                });
            }

            await prisma.bot.update({
                where: { id: botId },
                data: { isActive: false, status: 'stopped', stoppedAt: new Date() },
            });

            return NextResponse.json({ success: true, action: 'stopped', tradesClosed: activeTrades.length });
        }

        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    } catch (error: any) {
        console.error('Admin bot action error:', error);
        return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
}

// ─── DELETE: Admin delete a bot ─────────────────────────────────────────────
export async function DELETE(request: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user || (session.user as any).role !== 'admin') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
        }

        const { botId } = await request.json();
        if (!botId) {
            return NextResponse.json({ error: 'botId required' }, { status: 400 });
        }

        const bot = await prisma.bot.findUnique({ where: { id: botId } });
        if (!bot) {
            return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
        }

        if (bot.isActive) {
            return NextResponse.json(
                { error: 'Stop the bot before deleting. Active bots may have open exchange positions.' },
                { status: 409 }
            );
        }

        // Delete related records first
        await prisma.trade.deleteMany({ where: { botId } });
        await prisma.botSession.deleteMany({ where: { botId } });
        await prisma.botConfig.deleteMany({ where: { botId } });
        await prisma.bot.delete({ where: { id: botId } });

        return NextResponse.json({ success: true, action: 'deleted' });
    } catch (error: any) {
        console.error('Admin bot delete error:', error);
        return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
}

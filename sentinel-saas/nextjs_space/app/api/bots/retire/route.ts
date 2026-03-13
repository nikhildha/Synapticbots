import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * POST /api/bots/retire
 * Retires a bot: sets status='retired', isActive=false.
 * Closes the active session with final PnL computed from trades.
 * Retired bots disappear from Bot Management but remain in Performance Analytics.
 */
export async function POST(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { botId } = await req.json();
        if (!botId) {
            return NextResponse.json({ error: 'botId is required' }, { status: 400 });
        }

        const userId = (session.user as any)?.id;

        // Verify bot belongs to user
        const bot = await prisma.bot.findFirst({
            where: { id: botId, userId },
        });
        if (!bot) {
            return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
        }

        if (bot.status === 'retired') {
            return NextResponse.json({ error: 'Bot is already retired' }, { status: 400 });
        }

        // Close any active session with final PnL from trades
        const activeSession = await prisma.botSession.findFirst({
            where: { botId, status: 'active' },
        });

        if (activeSession) {
            // Compute final PnL from actual trades in this session
            const sessionTrades = await prisma.trade.findMany({
                where: { sessionId: activeSession.id },
                select: { status: true, totalPnl: true, activePnl: true, capital: true },
            });

            const closedPnl = sessionTrades
                .filter(t => (t.status || '').toLowerCase() === 'closed')
                .reduce((sum, t) => sum + (t.totalPnl || 0), 0);
            const activePnl = sessionTrades
                .filter(t => (t.status || '').toLowerCase() === 'active')
                .reduce((sum, t) => sum + (t.activePnl || 0), 0);
            const totalCapital = sessionTrades.reduce((sum, t) => sum + (t.capital || 0), 0);
            const finalPnl = closedPnl + activePnl;

            await prisma.botSession.update({
                where: { id: activeSession.id },
                data: {
                    status: 'closed',
                    endedAt: new Date(),
                    totalPnl: finalPnl,
                    totalCapital: totalCapital || activeSession.totalCapital,
                    roi: totalCapital > 0 ? (finalPnl / totalCapital) * 100 : 0,
                },
            });
        }

        // Retire the bot
        await prisma.bot.update({
            where: { id: botId },
            data: {
                status: 'retired',
                isActive: false,
            },
        });

        return NextResponse.json({
            ok: true,
            message: `Bot "${bot.name}" retired successfully. It will appear in Performance Analytics.`,
        });
    } catch (error: any) {
        console.error('[bots/retire] Error:', error);
        return NextResponse.json({ error: 'Failed to retire bot' }, { status: 500 });
    }
}

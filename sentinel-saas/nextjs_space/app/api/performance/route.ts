import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * GET /api/performance
 * Returns all bot sessions + all-time summary for the current user.
 */
export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const userId = (session.user as any)?.id;

        // Get all bots for this user
        const userBots = await prisma.bot.findMany({
            where: { userId },
            select: { id: true, name: true },
        });
        const botIds = userBots.map(b => b.id);

        if (botIds.length === 0) {
            return NextResponse.json({
                sessions: [],
                summary: { totalSessions: 0, allTimePnl: 0, allTimeTrades: 0, allTimeRoi: 0, bestSessionPnl: 0 },
            });
        }

        // Fetch all sessions
        const sessions = await prisma.botSession.findMany({
            where: { botId: { in: botIds } },
            orderBy: { startedAt: 'desc' },
            include: { bot: { select: { name: true, exchange: true } } },
        });

        // Enrich active sessions with live open-trade PnL
        const enriched = await Promise.all(sessions.map(async (s) => {
            if (s.status !== 'active') return { ...s, livePnl: s.totalPnl, liveRoi: s.roi, openTrades: 0 };

            const openTrades = await prisma.trade.findMany({
                where: { sessionId: s.id, status: 'active' },
                select: { activePnl: true, capital: true },
            });
            const activePnl = openTrades.reduce((sum, t) => sum + t.activePnl, 0);
            const activeCapital = openTrades.reduce((sum, t) => sum + t.capital, 0);
            const livePnl = s.totalPnl + activePnl;
            const totalCap = s.totalCapital + activeCapital;
            return {
                ...s,
                livePnl,
                liveRoi: totalCap > 0 ? (livePnl / totalCap) * 100 : 0,
                openTrades: openTrades.length,
            };
        }));

        // All-time summary
        const allTimePnl = enriched.reduce((s, ses) => s + (ses.livePnl || 0), 0);
        const allTimeTrades = enriched.reduce((s, ses) => s + ses.totalTrades, 0);
        const allTimeCapital = enriched.reduce((s, ses) => s + ses.totalCapital, 0);
        const allTimeRoi = allTimeCapital > 0 ? (allTimePnl / allTimeCapital) * 100 : 0;
        const bestSession = enriched.reduce(
            (best, ses) => (ses.livePnl || 0) > ((best as any)?.livePnl ?? -Infinity) ? ses : best,
            enriched[0] ?? null
        );

        return NextResponse.json({
            sessions: enriched,
            summary: {
                totalSessions: enriched.length,
                allTimePnl,
                allTimeTrades,
                allTimeRoi,
                bestSessionPnl: (bestSession as any)?.livePnl ?? 0,
            },
        });
    } catch (error: any) {
        console.error('[performance API] Error:', error);
        return NextResponse.json({ error: 'Failed to fetch performance data' }, { status: 500 });
    }
}

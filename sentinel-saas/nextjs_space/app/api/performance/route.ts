import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * GET /api/performance
 * Returns all bot sessions + all-time summary for the current user.
 * PnL is computed from actual trades (tradebook = single source of truth),
 * NOT from stale session-level totalPnl.
 * Includes retired bots for historical tracking.
 */
export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const userId = (session.user as any)?.id;

        // Get ALL bots (including retired) for complete performance history
        const userBots = await prisma.bot.findMany({
            where: { userId },
            select: { id: true, name: true, status: true, exchange: true },
        });
        const botIds = userBots.map(b => b.id);

        if (botIds.length === 0) {
            return NextResponse.json({
                sessions: [],
                summary: { totalSessions: 0, allTimePnl: 0, allTimeTrades: 0, allTimeRoi: 0, bestSessionPnl: 0 },
            });
        }

        // Fetch all sessions with bot info (name, exchange, status)
        const sessions = await prisma.botSession.findMany({
            where: { botId: { in: botIds } },
            orderBy: { startedAt: 'desc' },
            include: { bot: { select: { name: true, exchange: true, status: true } } },
        });

        // Compute PnL from actual trades per session (tradebook = single source of truth)
        const enriched = await Promise.all(sessions.map(async (s) => {
            // Fetch all trades for this session to compute accurate PnL
            const sessionTrades = await prisma.trade.findMany({
                where: { sessionId: s.id },
                select: { status: true, totalPnl: true, activePnl: true, capital: true },
            });

            const closedTrades = sessionTrades.filter(t => (t.status || '').toLowerCase() === 'closed');
            const openTrades = sessionTrades.filter(t => (t.status || '').toLowerCase() === 'active');

            // PnL from tradebook: closed = totalPnl (realized), active = activePnl (unrealized)
            const realizedPnl = closedTrades.reduce((sum, t) => sum + (t.totalPnl || 0), 0);
            const unrealizedPnl = openTrades.reduce((sum, t) => sum + (t.activePnl || 0), 0);
            const activeCapital = openTrades.reduce((sum, t) => sum + (t.capital || 0), 0);

            const livePnl = realizedPnl + unrealizedPnl;
            const totalCap = s.totalCapital + activeCapital;

            return {
                ...s,
                // Override session PnL with actual trade PnL when we have trades
                livePnl: sessionTrades.length > 0 ? livePnl : s.totalPnl,
                liveRoi: totalCap > 0 ? (livePnl / totalCap) * 100 : (s.roi || 0),
                openTrades: openTrades.length,
                // Use trade-computed values to also update total for consistency
                totalPnl: sessionTrades.length > 0 ? realizedPnl : s.totalPnl,
            };
        }));

        // All-time summary from enriched sessions
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

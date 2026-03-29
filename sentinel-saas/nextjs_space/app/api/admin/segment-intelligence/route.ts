import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/segment-intelligence
 * Admin-only endpoint. Returns platform-wide segment performance aggregated
 * across ALL users' retired + active bots.
 *
 * Privacy: no usernames, emails, or individual bot names exposed.
 * Only aggregated statistics per segment.
 */

function inferSegment(botName: string, configSegment?: string | null): string {
    if (configSegment && configSegment !== 'ALL') return configSegment;
    const n = (botName || '').toLowerCase();
    if (n.includes('l1') || n.includes('layer1') || n.includes('layer 1')) return 'L1';
    if (n.includes('l2') || n.includes('layer2') || n.includes('layer 2')) return 'L2';
    if (n.includes('defi') || n.includes('de-fi')) return 'DeFi';
    if (n.includes('gaming') || n.includes('game') || n.includes('metaverse')) return 'Gaming';
    if (n.includes('ai') || n.includes('intelligence') || n.includes('neural')) return 'AI';
    if (n.includes('rwa') || n.includes('real world') || n.includes('asset')) return 'RWA';
    if (n.includes('meme')) return 'Meme';
    if (n.includes('depin')) return 'DePIN';
    if (n.includes('modular')) return 'Modular';
    return 'ALL';
}

function computeSharpe(returns: number[]): number {
    if (returns.length < 2) return 0;
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / (returns.length - 1);
    const std = Math.sqrt(variance);
    if (std === 0) return 0;
    return parseFloat(((mean / std) * Math.sqrt(returns.length)).toFixed(2));
}

function computeMaxDrawdown(pnlSeries: number[]): number {
    if (pnlSeries.length === 0) return 0;
    let peak = 0;
    let equity = 0;
    let maxDD = 0;
    for (const pnl of pnlSeries) {
        equity += pnl;
        if (equity > peak) peak = equity;
        const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
        if (dd > maxDD) maxDD = dd;
    }
    return parseFloat(maxDD.toFixed(2));
}

export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Admin-only gate
        const userRole = (session.user as any)?.role;
        if (userRole !== 'admin') {
            return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });
        }

        // Fetch ALL bots across ALL users (no userId filter)
        const allBots = await prisma.bot.findMany({
            select: {
                id: true,
                name: true,
                status: true,
                isActive: true,
                userId: true,
                config: { select: { segment: true } },
            },
        });

        const botIds = allBots.map(b => b.id);
        if (botIds.length === 0) {
            return NextResponse.json({ segments: [], summary: { totalUsers: 0, totalBots: 0, totalTrades: 0 } });
        }

        // Fetch all trades across all bots (closed only for stats)
        const trades = await prisma.trade.findMany({
            where: { botId: { in: botIds }, status: 'closed' },
            select: { botId: true, totalPnl: true, capital: true, entryTime: true },
            orderBy: { entryTime: 'asc' },
        });

        // Count distinct users
        const distinctUsers = new Set(allBots.map(b => b.userId)).size;

        // Build segment map
        const botSegmentMap: Record<string, string> = {};
        for (const bot of allBots) {
            botSegmentMap[bot.id] = inferSegment(bot.name, (bot.config as any)?.segment);
        }

        // Aggregate per segment (across all users)
        interface SegAgg {
            segment: string;
            totalPnl: number;
            totalCapital: number;
            closedTradeCount: number;
            winCount: number;
            pnlSeries: number[];
            returnsPct: number[];
            totalBots: number;
            retiredBots: number;
            activeBots: number;
            userSet: Set<string>;
        }

        const segMap: Record<string, SegAgg> = {};

        const ensureSeg = (seg: string) => {
            if (!segMap[seg]) {
                segMap[seg] = {
                    segment: seg, totalPnl: 0, totalCapital: 0,
                    closedTradeCount: 0, winCount: 0,
                    pnlSeries: [], returnsPct: [],
                    totalBots: 0, retiredBots: 0, activeBots: 0,
                    userSet: new Set(),
                };
            }
        };

        // Count bots per segment
        for (const bot of allBots) {
            const seg = botSegmentMap[bot.id] || 'ALL';
            ensureSeg(seg);
            segMap[seg].totalBots++;
            segMap[seg].userSet.add(bot.userId);
            if (bot.status === 'retired') segMap[seg].retiredBots++;
            else if (bot.isActive ?? false) segMap[seg].activeBots++;
        }

        // Aggregate trade stats
        for (const t of trades) {
            const seg = botSegmentMap[t.botId] || 'ALL';
            ensureSeg(seg);
            const pnl = t.totalPnl || 0;
            const cap = t.capital || 0;
            segMap[seg].totalPnl += pnl;
            segMap[seg].totalCapital += cap;
            segMap[seg].closedTradeCount++;
            if (pnl > 0) segMap[seg].winCount++;
            segMap[seg].pnlSeries.push(pnl);
            if (cap > 0) segMap[seg].returnsPct.push((pnl / cap) * 100);
        }

        const segments = Object.values(segMap).map(agg => ({
            segment: agg.segment,
            totalPnl: parseFloat(agg.totalPnl.toFixed(2)),
            totalCapital: parseFloat(agg.totalCapital.toFixed(2)),
            roi: agg.totalCapital > 0 ? parseFloat(((agg.totalPnl / agg.totalCapital) * 100).toFixed(2)) : 0,
            winRate: agg.closedTradeCount > 0 ? parseFloat(((agg.winCount / agg.closedTradeCount) * 100).toFixed(1)) : 0,
            sharpeRatio: computeSharpe(agg.returnsPct),
            maxDrawdown: computeMaxDrawdown(agg.pnlSeries),
            closedTradeCount: agg.closedTradeCount,
            totalBots: agg.totalBots,
            retiredBots: agg.retiredBots,
            activeBots: agg.activeBots,
            uniqueUsers: agg.userSet.size, // count, not names — privacy preserved
        })).sort((a, b) => b.roi - a.roi);

        return NextResponse.json({
            segments,
            summary: {
                totalUsers: distinctUsers,
                totalBots: allBots.length,
                totalTrades: trades.length,
                totalPlatformPnl: parseFloat(trades.reduce((s, t) => s + (t.totalPnl || 0), 0).toFixed(2)),
            },
        });
    } catch (error: any) {
        console.error('[admin/segment-intelligence] Error:', error);
        return NextResponse.json({ error: 'Failed to compute global intelligence' }, { status: 500 });
    }
}

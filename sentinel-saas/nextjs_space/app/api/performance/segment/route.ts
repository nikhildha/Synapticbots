import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * GET /api/performance/segment
 * Returns per-segment performance stats for the current user's RETIRED bots only.
 * Active/stopped bot data is excluded — it lives in the main PnL cards.
 *
 * Returns:
 *   { segments: SegmentStats[] }
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
    let peak = pnlSeries[0];
    let maxDD = 0;
    let equity = 0;
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

        const userId = (session.user as any)?.id;

        // STRICT ISOLATION: ONLY retired bots for THIS user
        const retiredBots = await prisma.bot.findMany({
            where: { userId, status: 'retired' },
            include: { config: { select: { segment: true } } },
        });

        if (retiredBots.length === 0) {
            return NextResponse.json({ segments: [] });
        }

        const botIds = retiredBots.map(b => b.id);

        // Get all sessions for retired bots (closed sessions contain the history)
        const sessions = await prisma.botSession.findMany({
            where: { botId: { in: botIds } },
            orderBy: { startedAt: 'asc' },
        });

        // Get all trades for retired bots
        const trades = await prisma.trade.findMany({
            where: { botId: { in: botIds } },
            select: {
                botId: true, status: true,
                totalPnl: true, capital: true,
                entryTime: true, exitTime: true,
            },
            orderBy: { entryTime: 'asc' },
        });

        // Build lookup: botId → segment name
        const botSegmentMap: Record<string, string> = {};
        for (const bot of retiredBots) {
            botSegmentMap[bot.id] = inferSegment(bot.name, (bot.config as any)?.segment);
        }

        // Build lookup: botId → bot metadata
        const botMeta: Record<string, { name: string; startedAt?: Date | null; stoppedAt?: Date | null }> = {};
        for (const bot of retiredBots) {
            botMeta[bot.id] = { name: bot.name, startedAt: bot.startedAt, stoppedAt: bot.stoppedAt };
        }

        // Aggregate per segment
        interface SegmentAgg {
            segment: string;
            totalPnl: number;
            totalCapital: number;
            closedTradeCount: number;
            winCount: number;
            pnlSeries: number[];
            returnsPct: number[];
            sessionCount: number;
            botCount: number;
            botNames: string[];
            botPeriods: { name: string; from: string; to: string; pnl: number }[];
        }

        const segMap: Record<string, SegmentAgg> = {};

        // Helper to ensure a segment entry exists
        const ensureSeg = (seg: string) => {
            if (!segMap[seg]) {
                segMap[seg] = {
                    segment: seg, totalPnl: 0, totalCapital: 0,
                    closedTradeCount: 0, winCount: 0,
                    pnlSeries: [], returnsPct: [],
                    sessionCount: 0, botCount: 0, botNames: [], botPeriods: [],
                };
            }
        };

        // Aggregate sessions per segment
        for (const s of sessions) {
            const seg = botSegmentMap[s.botId] || 'ALL';
            ensureSeg(seg);
            segMap[seg].sessionCount++;
        }

        // Aggregate bot metadata per segment
        const processedBots = new Set<string>();
        for (const [botId, seg] of Object.entries(botSegmentMap)) {
            ensureSeg(seg);
            if (!processedBots.has(botId)) {
                processedBots.add(botId);
                segMap[seg].botCount++;
                const meta = botMeta[botId];
                if (meta) {
                    segMap[seg].botNames.push(meta.name);
                    const from = meta.startedAt ? new Date(meta.startedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '?';
                    const to = meta.stoppedAt ? new Date(meta.stoppedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : 'Retired';
                    // Find total PnL for this bot from trades
                    const botPnl = trades.filter(t => t.botId === botId && t.status === 'closed').reduce((s, t) => s + (t.totalPnl || 0), 0);
                    segMap[seg].botPeriods.push({ name: meta.name, from, to, pnl: parseFloat(botPnl.toFixed(2)) });
                }
            }
        }

        // Aggregate trade stats per segment
        for (const t of trades) {
            if (t.status !== 'closed') continue;
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

        // Build final output
        const segments = Object.values(segMap).map(agg => ({
            segment: agg.segment,
            totalPnl: parseFloat(agg.totalPnl.toFixed(2)),
            totalCapital: parseFloat(agg.totalCapital.toFixed(2)),
            roi: agg.totalCapital > 0 ? parseFloat(((agg.totalPnl / agg.totalCapital) * 100).toFixed(2)) : 0,
            winRate: agg.closedTradeCount > 0 ? parseFloat(((agg.winCount / agg.closedTradeCount) * 100).toFixed(1)) : 0,
            sharpeRatio: computeSharpe(agg.returnsPct),
            maxDrawdown: computeMaxDrawdown(agg.pnlSeries),
            closedTradeCount: agg.closedTradeCount,
            sessionCount: agg.sessionCount,
            botCount: agg.botCount,
            botPeriods: agg.botPeriods,
        })).sort((a, b) => b.roi - a.roi);

        return NextResponse.json({ segments });
    } catch (error: any) {
        console.error('[performance/segment] Error:', error);
        return NextResponse.json({ error: 'Failed to compute segment performance' }, { status: 500 });
    }
}

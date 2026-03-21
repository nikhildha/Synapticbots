import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/athena-log/analytics
 *
 * Returns Athena accuracy metrics over a configurable time window.
 * Query params: ?days=7 (default 7)
 */
export async function GET(req: Request) {
    try {
        const url = new URL(req.url);
        const days = Number(url.searchParams.get('days') || 7);
        const since = new Date(Date.now() - days * 86400000);

        // Fetch all decisions in period
        const logs = await prisma.athenaDecisionLog.findMany({
            where: { timestamp: { gte: since } },
            orderBy: { timestamp: 'desc' },
        });

        const total = logs.length;
        const executed = logs.filter(l => ['EXECUTE', 'LONG', 'SHORT'].includes(l.action));
        const vetoed = logs.filter(l => ['VETO', 'SKIP', 'HOLD'].includes(l.action));
        const deployed = logs.filter(l => l.deployed);
        const closedTrades = deployed.filter(l => l.tradeStatus === 'CLOSED' && l.pnl != null);

        // ── Execute Accuracy ──
        const profitable = closedTrades.filter(l => (l.pnl || 0) > 0);
        const executeWinRate = closedTrades.length > 0
            ? Math.round((profitable.length / closedTrades.length) * 100)
            : null;

        // ── P&L stats ──
        const totalPnl = closedTrades.reduce((s, l) => s + (l.pnl || 0), 0);
        const avgPnl = closedTrades.length > 0 ? totalPnl / closedTrades.length : null;
        const bestTrade = closedTrades.length > 0 ? Math.max(...closedTrades.map(l => l.pnl || 0)) : null;
        const worstTrade = closedTrades.length > 0 ? Math.min(...closedTrades.map(l => l.pnl || 0)) : null;

        // ── By Action ──
        const byAction: Record<string, { count: number; deployed: number; closedPnl: number; closedCount: number }> = {};
        for (const l of logs) {
            const a = l.action;
            if (!byAction[a]) byAction[a] = { count: 0, deployed: 0, closedPnl: 0, closedCount: 0 };
            byAction[a].count++;
            if (l.deployed) byAction[a].deployed++;
            if (l.tradeStatus === 'CLOSED' && l.pnl != null) {
                byAction[a].closedPnl += l.pnl;
                byAction[a].closedCount++;
            }
        }

        // ── By Segment ──
        const bySegment: Record<string, { total: number; deployed: number; wins: number; losses: number; pnl: number }> = {};
        for (const l of logs) {
            const seg = l.segment || 'Unknown';
            if (!bySegment[seg]) bySegment[seg] = { total: 0, deployed: 0, wins: 0, losses: 0, pnl: 0 };
            bySegment[seg].total++;
            if (l.deployed) bySegment[seg].deployed++;
            if (l.tradeStatus === 'CLOSED' && l.pnl != null) {
                if (l.pnl > 0) bySegment[seg].wins++;
                else bySegment[seg].losses++;
                bySegment[seg].pnl += l.pnl;
            }
        }

        // ── By Side ──
        const bySide: Record<string, { count: number; wins: number; losses: number; pnl: number }> = {};
        for (const l of deployed.filter(d => d.side)) {
            const s = l.side || 'UNKNOWN';
            if (!bySide[s]) bySide[s] = { count: 0, wins: 0, losses: 0, pnl: 0 };
            bySide[s].count++;
            if (l.tradeStatus === 'CLOSED' && l.pnl != null) {
                if (l.pnl > 0) bySide[s].wins++;
                else bySide[s].losses++;
                bySide[s].pnl += l.pnl;
            }
        }

        // ── Recent decisions (last 20) ──
        const recent = logs.slice(0, 20).map(l => ({
            id: l.id,
            timestamp: l.timestamp,
            cycle: l.cycle,
            symbol: l.symbol,
            segment: l.segment,
            action: l.action,
            side: l.side,
            confidence: l.confidence,
            deployed: l.deployed,
            pnl: l.pnl,
            tradeStatus: l.tradeStatus,
        }));

        return NextResponse.json({
            period: { days, since: since.toISOString(), total },
            accuracy: {
                executeWinRate,        // % of deployed trades that profited
                totalDeployed: deployed.length,
                closedTrades: closedTrades.length,
                profitable: profitable.length,
                vetoCount: vetoed.length,
            },
            pnl: {
                totalPnl: Math.round((totalPnl || 0) * 100) / 100,
                avgPnl: avgPnl != null ? Math.round(avgPnl * 100) / 100 : null,
                bestTrade: bestTrade != null ? Math.round(bestTrade * 100) / 100 : null,
                worstTrade: worstTrade != null ? Math.round(worstTrade * 100) / 100 : null,
            },
            byAction,
            bySegment,
            bySide,
            recent,
        });
    } catch (e: any) {
        console.error('Athena analytics error:', e);
        return NextResponse.json({ error: e.message || 'Internal error' }, { status: 500 });
    }
}

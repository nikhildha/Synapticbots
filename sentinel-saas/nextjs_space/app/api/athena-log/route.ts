import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// ─── POST: Engine writes a new Athena decision log entry ────────────────────
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const {
            cycle, symbol, segment, regime, conviction,
            action, side, confidence, reasoning, riskFlags,
            model, latencyMs, suggestedSl, suggestedTp, entryPrice,
            deployed, deployReason, tradeId,
        } = body;

        if (!symbol || !action || cycle == null) {
            return NextResponse.json({ error: 'Missing required fields: symbol, action, cycle' }, { status: 400 });
        }

        const log = await prisma.athenaDecisionLog.create({
            data: {
                cycle:       Number(cycle),
                symbol,
                segment:     segment || null,
                regime:      regime || null,
                conviction:  conviction != null ? Number(conviction) : null,
                action,
                side:        side || null,
                confidence:  confidence != null ? Number(confidence) : null,
                reasoning:   reasoning || null,
                riskFlags:   riskFlags ? (typeof riskFlags === 'string' ? riskFlags : JSON.stringify(riskFlags)) : null,
                model:       model || null,
                latencyMs:   latencyMs != null ? Number(latencyMs) : null,
                suggestedSl: suggestedSl != null ? Number(suggestedSl) : null,
                suggestedTp: suggestedTp != null ? Number(suggestedTp) : null,
                entryPrice:  entryPrice != null ? Number(entryPrice) : null,
                deployed:    deployed === true,
                deployReason: deployReason || null,
                tradeId:     tradeId || null,
                tradeStatus: deployed ? 'ACTIVE' : null,
            },
        });

        return NextResponse.json({ id: log.id }, { status: 201 });
    } catch (e: any) {
        console.error('Athena log POST error:', e);
        return NextResponse.json({ error: e.message || 'Internal error' }, { status: 500 });
    }
}

// ─── PATCH: Update log entry (trade outcome, deployment status) ─────────────
export async function PATCH(req: Request) {
    try {
        const body = await req.json();
        const { id, tradeId, deployed, deployReason, pnl, pnlPct, exitPrice, tradeStatus, closedAt } = body;

        // Find the record — by id, or by tradeId, or by cycle+symbol
        let where: any;
        if (id) {
            where = { id };
        } else if (tradeId) {
            // Find the most recent log for this tradeId
            const existing = await prisma.athenaDecisionLog.findFirst({
                where: { tradeId },
                orderBy: { timestamp: 'desc' },
            });
            if (!existing) {
                return NextResponse.json({ error: 'No log found for tradeId' }, { status: 404 });
            }
            where = { id: existing.id };
        } else {
            return NextResponse.json({ error: 'Provide id or tradeId' }, { status: 400 });
        }

        const data: any = {};
        if (tradeId !== undefined) data.tradeId = tradeId;
        if (deployed !== undefined) data.deployed = deployed;
        if (deployReason !== undefined) data.deployReason = deployReason;
        if (pnl !== undefined) data.pnl = Number(pnl);
        if (pnlPct !== undefined) data.pnlPct = Number(pnlPct);
        if (exitPrice !== undefined) data.exitPrice = Number(exitPrice);
        if (tradeStatus !== undefined) data.tradeStatus = tradeStatus;
        if (closedAt !== undefined) data.closedAt = new Date(closedAt);

        const updated = await prisma.athenaDecisionLog.update({ where, data });
        return NextResponse.json({ id: updated.id });
    } catch (e: any) {
        console.error('Athena log PATCH error:', e);
        return NextResponse.json({ error: e.message || 'Internal error' }, { status: 500 });
    }
}

// ─── GET: Fetch logs with optional filters ──────────────────────────────────
export async function GET(req: Request) {
    try {
        const url = new URL(req.url);
        const symbol = url.searchParams.get('symbol');
        const action = url.searchParams.get('action');
        const deployed = url.searchParams.get('deployed');
        const limit = Math.min(Number(url.searchParams.get('limit') || 100), 500);
        const days = Number(url.searchParams.get('days') || 7);

        const where: any = {
            timestamp: { gte: new Date(Date.now() - days * 86400000) },
        };
        if (symbol) where.symbol = symbol;
        if (action) where.action = action;
        if (deployed !== null) where.deployed = deployed === 'true';

        const logs = await prisma.athenaDecisionLog.findMany({
            where,
            orderBy: { timestamp: 'desc' },
            take: limit,
        });

        return NextResponse.json({ logs, count: logs.length });
    } catch (e: any) {
        console.error('Athena log GET error:', e);
        return NextResponse.json({ error: e.message || 'Internal error' }, { status: 500 });
    }
}

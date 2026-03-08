/**
 * POST /api/admin/force-sync-user
 *
 * Admin-only. Reconciles a specific user's Prisma active trades against the
 * current engine tradebook + CoinDCX exchange state.
 *
 * Use case: User closed positions manually on CoinDCX but Prisma still shows
 * them as "active". This endpoint:
 *   1. Calls engine /api/sync-exchange → reconciles engine tradebook with CoinDCX
 *   2. Fetches updated tradebook from engine /api/all
 *   3. Marks Prisma active trades as "closed" when engine says closed OR when
 *      they no longer appear in the engine tradebook at all.
 *
 * Body: { email?: string, userId?: string, mode?: "live"|"paper"|"all" }
 * Returns: { closed: N, alreadyClosed: M, notInEngine: K, engineSyncResult, details }
 */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';
import { getEngineUrl, type EngineMode } from '@/lib/engine-url';

export const dynamic = 'force-dynamic';

async function requireAdmin() {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any).role !== 'admin') return null;
    return session;
}

export async function POST(request: Request) {
    try {
        if (!await requireAdmin()) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const body = await request.json().catch(() => ({}));
        const { email, userId: bodyUserId, mode: modeFilter = 'all' } = body;

        if (!email && !bodyUserId) {
            return NextResponse.json({ error: 'Provide email or userId' }, { status: 400 });
        }

        // ─── Resolve userId from email if needed ──────────────────────────
        let userId = bodyUserId as string | undefined;
        if (!userId && email) {
            const user = await prisma.user.findUnique({
                where: { email: String(email) },
                select: { id: true, email: true },
            });
            if (!user) {
                return NextResponse.json({ error: `User not found: ${email}` }, { status: 404 });
            }
            userId = user.id;
        }

        // ─── Find user's active Prisma trades ─────────────────────────────
        const activeStatuses = ['active', 'ACTIVE', 'Active'];
        const whereClause: any = {
            status: { in: activeStatuses },
            bot: { userId },
        };
        if (modeFilter !== 'all') {
            whereClause.mode = { contains: modeFilter, mode: 'insensitive' };
        }

        const activePrismaTrades = await prisma.trade.findMany({
            where: whereClause,
            include: { bot: { include: { config: true } } },
        });

        if (activePrismaTrades.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'No active trades found for this user.',
                closed: 0,
                notInEngine: 0,
                engineSyncResult: null,
            });
        }

        // ─── Determine engine mode from user's bot config ─────────────────
        const userBot = await prisma.bot.findFirst({
            where: { userId },
            orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
            include: { config: true },
        });
        const botMode = (userBot?.config as any)?.mode || 'paper';
        const engineMode: EngineMode = botMode.toLowerCase().includes('live') ? 'live' : 'paper';
        const engineUrl = getEngineUrl(engineMode);

        if (!engineUrl) {
            return NextResponse.json({ error: 'Engine not configured' }, { status: 503 });
        }

        // ─── Step 1: Trigger engine → CoinDCX reconciliation ─────────────
        let engineSyncResult: any = { message: 'Paper mode — no exchange sync performed' };
        if (engineMode === 'live') {
            try {
                const syncRes = await fetch(`${engineUrl}/api/sync-exchange`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: AbortSignal.timeout(20000),
                });
                engineSyncResult = await syncRes.json();
                console.log('[force-sync-user] Engine sync-exchange result:', JSON.stringify(engineSyncResult));
            } catch (err) {
                console.error('[force-sync-user] Engine sync-exchange failed:', err);
                return NextResponse.json({
                    error: 'Could not reach engine /api/sync-exchange. ' +
                           'Is the engine running and ENGINE_API_URL set correctly?',
                }, { status: 502 });
            }
        }

        // ─── Step 2: Fetch updated tradebook from engine ──────────────────
        let engineTrades: any[] = [];
        try {
            const allRes = await fetch(`${engineUrl}/api/all`, {
                cache: 'no-store',
                signal: AbortSignal.timeout(8000),
            });
            if (allRes.ok) {
                const data = await allRes.json();
                engineTrades = data?.tradebook?.trades || [];
            }
        } catch (err) {
            console.error('[force-sync-user] Engine /api/all fetch failed:', err);
            // Continue — we can still close trades not in engine at all
        }

        // ─── Build lookup maps from engine tradebook ──────────────────────
        // Key: exchangeOrderId (engine trade_id) → engine trade object
        const engineById = new Map<string, any>();
        for (const t of engineTrades) {
            const id = String(t.trade_id || t.id || '');
            if (id) engineById.set(id, t);
        }

        // ─── Step 3: Reconcile Prisma active trades against engine ────────
        const results: any[] = [];
        const notInEngine: any[] = [];
        let closedCount = 0;

        for (const trade of activePrismaTrades) {
            const exchangeId = trade.exchangeOrderId || trade.id;
            const engineTrade = engineById.get(exchangeId);
            const engineStatus = engineTrade ? String(engineTrade.status || '').toLowerCase() : null;

            let closeReason: string | null = null;

            if (!engineTrade) {
                // Not in engine tradebook at all — assumed closed/removed by exchange sync
                closeReason = 'EXCHANGE_SYNC_MISSING';
                notInEngine.push({ id: trade.id, coin: trade.coin, exchangeId });
            } else if (engineStatus === 'closed' || engineStatus === 'cancelled') {
                // Engine tradebook now shows this trade as closed
                closeReason = engineTrade.exit_reason || engineTrade.exitReason || 'EXCHANGE_SYNC';
            }

            if (!closeReason) {
                results.push({
                    trade_id: exchangeId,
                    coin: trade.coin,
                    action: 'kept_active',
                    engine_status: engineStatus,
                });
                continue;
            }

            // Close this trade in Prisma
            const currentPrice = (engineTrade?.exit_price ?? engineTrade?.current_price ?? trade.currentPrice ?? trade.entryPrice) as number;
            const entry = trade.entryPrice as number;
            const capital = trade.capital as number;
            const lev = trade.leverage as number;
            const isLong = trade.position === 'long';

            // Use engine PnL if available, else calculate from current price
            const enginePnl = engineTrade?.pnl ?? engineTrade?.realized_pnl ?? null;
            const enginePnlPct = engineTrade?.pnl_pct ?? null;

            let netPnl: number;
            let pnlPct: number;
            if (enginePnl !== null) {
                netPnl = enginePnl;
                pnlPct = enginePnlPct ?? 0;
            } else {
                const priceDiff = isLong ? (currentPrice - entry) : (entry - currentPrice);
                const quantity = (trade as any).quantity || (capital * lev / entry);
                const rawPnl = priceDiff * quantity;
                netPnl = Math.round(rawPnl * 10000) / 10000;
                pnlPct = capital > 0 ? Math.round(netPnl / capital * 100 * 100) / 100 : 0;
            }

            await prisma.trade.update({
                where: { id: trade.id },
                data: {
                    status: 'closed',
                    exitPrice: currentPrice,
                    exitTime: new Date(),
                    exitReason: closeReason,
                    totalPnl: netPnl,
                    totalPnlPercent: pnlPct,
                    activePnl: 0,
                    activePnlPercent: 0,
                },
            });

            closedCount++;
            results.push({
                trade_id: exchangeId,
                coin: trade.coin,
                action: 'closed',
                reason: closeReason,
                pnl: netPnl,
                pnl_pct: pnlPct,
            });
        }

        return NextResponse.json({
            success: true,
            userId,
            engineMode,
            engineSyncResult,
            totalActiveBefore: activePrismaTrades.length,
            closed: closedCount,
            notInEngine: notInEngine.length,
            stillActive: activePrismaTrades.length - closedCount,
            details: results,
        });

    } catch (error: any) {
        console.error('[force-sync-user] Error:', error);
        return NextResponse.json({ error: 'Force sync failed', detail: String(error) }, { status: 500 });
    }
}

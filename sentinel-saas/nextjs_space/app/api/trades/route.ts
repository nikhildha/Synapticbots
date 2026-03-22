import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/prisma';
import { syncEngineTrades, getUserTrades } from '@/lib/sync-engine-trades';
import { getEngineUrl, type EngineMode } from '@/lib/engine-url';

export const dynamic = 'force-dynamic';

async function fetchEngineTrades(mode: EngineMode = 'paper'): Promise<any[]> {
    const url = getEngineUrl(mode);
    if (!url) return [];
    try {
        const res = await fetch(`${url}/api/all`, {
            cache: 'no-store',
            signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
            const data = await res.json();
            return data?.tradebook?.trades || [];
        }
    } catch (err) {
        console.error(`[trades] Engine API (${mode}) fetch failed:`, err);
    }
    return [];
}

/**
 * Tradebook API — syncs from engine then reads from Prisma (per-user isolated)
 * GET /api/trades?status=active&coin=BTC&page=1&limit=50
 */
export async function GET(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const userId = (session.user as any).id;
        const { searchParams } = new URL(request.url);
        const statusFilter = searchParams.get('status') || undefined;
        const coinFilter = searchParams.get('coin');
        const botIdFilter = searchParams.get('botId') || undefined;
        const modeFilter = searchParams.get('mode') || undefined;  // 'paper' or 'live'
        const page = parseInt(searchParams.get('page') || '1');
        const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100);

        // Sync engine trades into Prisma for this user's bots before reading
        // MULTI-BOT FIX: fetch ALL bots and sync each one
        const userBots = await prisma.bot.findMany({
            where: { userId },
            include: { config: true },  // F5 FIX: include config so mode is available
            orderBy: { updatedAt: 'desc' },
        });

        // ISOLATION FIX: sync each bot from its OWN engine
        // Paper bots get paper trades, live bots get live trades — no cross-contamination
        const engineTradeCache: Record<string, any[]> = {};
        for (const ub of userBots) {
            const botMode: EngineMode = ((ub.config as any)?.mode || 'paper').toLowerCase().includes('live') ? 'live' : 'paper';
            try {
                if (!engineTradeCache[botMode]) {
                    engineTradeCache[botMode] = await fetchEngineTrades(botMode);
                }
                if (engineTradeCache[botMode].length > 0) {
                    // Epoch fallback: if startedAt is null, sync ALL trades (entryTime filter skipped)
                    const syncFrom = ub.startedAt ?? new Date(0);
                    await syncEngineTrades(engineTradeCache[botMode], ub.id, syncFrom, userId);
                }
            } catch (err) {
                console.error(`[trades] Sync failed for bot ${ub.id} (${botMode}):`, err);
            }
        }

        // Read from Prisma — user-isolated, optionally filtered by botId and mode
        let trades = await getUserTrades(userId, statusFilter, botIdFilter, modeFilter);

        // Apply coin filter
        if (coinFilter) {
            const cf = coinFilter.toUpperCase();
            trades = trades.filter((t: any) => (t.symbol || t.coin || '').toUpperCase().includes(cf));
        }

        // Sort by entry time descending (already sorted from Prisma, but ensure)
        trades.sort((a: any, b: any) => {
            const ta = a.entry_time || '';
            const tb = b.entry_time || '';
            return tb.localeCompare(ta);
        });

        const total = trades.length;
        const skip = (page - 1) * limit;
        const paged = trades.slice(skip, skip + limit);

        return NextResponse.json({
            trades: paged.map((t: any) => ({
                id: t.trade_id || `T-${Math.random().toString(36).slice(2, 8)}`,
                coin: (t.symbol || t.coin || '').replace('USDT', ''),
                symbol: t.symbol || t.coin || '',
                position: (t.side || t.position || '').toLowerCase(),
                side: t.side || t.position || '',
                regime: t.regime || '',
                confidence: t.confidence || 0,
                leverage: t.leverage || 1,
                capital: t.capital || t.position_size || 0,
                entryPrice: t.entry_price || t.entryPrice || 0,
                currentPrice: t.current_price || t.currentPrice || null,
                exitPrice: t.exit_price || t.exitPrice || null,
                stopLoss: t.stop_loss || t.stopLoss || 0,
                takeProfit: t.take_profit || t.takeProfit || 0,
                status: (t.status || '').toLowerCase(),
                // Trailing SL fields — stored in tradebook per trade
                trailingSl: t.trailing_sl ?? t.stop_loss ?? t.stopLoss ?? 0,
                steppedLockLevel: t.stepped_lock_level ?? -1,
                trailSlCount: t.trail_sl_count ?? 0,
                trailingActive: t.trailing_active ?? false,
                // Exit guard state — stamped every heartbeat
                exitGuardActive: t.exit_guard_active ?? true,
                exitCheckAt: t.exit_check_at ?? null,
                exitCheckPrice: t.exit_check_price ?? null,

                activePnl: t.unrealized_pnl || t.active_pnl || t.activePnl || 0,
                activePnlPercent: t.unrealized_pnl_pct || t.activePnlPercent || 0,
                totalPnl: t.realized_pnl || t.pnl || t.total_pnl || t.totalPnl || 0,
                totalPnlPercent: t.realized_pnl_pct || t.pnl_pct || t.totalPnlPercent || 0,
                exitPercent: t.exit_percent || null,
                entryTime: t.entry_time || t.entryTime || t.timestamp || new Date().toISOString(),
                exitTime: t.exit_time || t.exitTime || null,
                botName: t.bot_name || 'Unknown Bot',
                botId: t.bot_id || null,
                exchange: t.exchange || 'binance_testnet',
                mode: ((t.mode || 'paper').toLowerCase().includes('live') ? 'live' : 'paper'),
            })),
            pagination: {
                page, limit, total,
                totalPages: Math.ceil(total / limit),
                hasMore: skip + limit < total,
            },
        });
    } catch (error: any) {
        console.error('Tradebook GET error:', error);
        return NextResponse.json({ error: 'Failed to fetch trades', detail: String(error) }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        // For now, trades from JSON are read-only
        return NextResponse.json({ error: 'Use /api/reset-trades to clear your trades' }, { status: 400 });
    } catch (error: any) {
        console.error('Tradebook DELETE error:', error);
        return NextResponse.json({ error: 'Failed to delete trade' }, { status: 500 });
    }
}

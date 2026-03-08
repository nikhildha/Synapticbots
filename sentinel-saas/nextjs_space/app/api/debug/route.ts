import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/prisma';
import { getEngineUrl } from '@/lib/engine-url';

export const dynamic = 'force-dynamic';

/**
 * GET /api/debug
 * Returns sync diagnostics for the CURRENT user only.
 * Admin no longer has access to other users' data.
 */
export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
        return NextResponse.json({ error: 'Not logged in' }, { status: 401 });
    }

    const userId = (session.user as any)?.id;
    const email = session.user.email;

    // ─── 1. Engine data (shared telemetry, no user-specific trades) ──────────
    let engineTradeCount = 0;
    let engineError: string | null = null;
    const ENGINE_API_URL = getEngineUrl('live');
    try {
        if (ENGINE_API_URL) {
            const res = await fetch(`${ENGINE_API_URL}/api/all`, {
                cache: 'no-store',
                signal: AbortSignal.timeout(8000),
            });
            if (res.ok) {
                const data = await res.json();
                engineTradeCount = (data?.tradebook?.trades || []).length;
            } else {
                engineError = `Engine returned ${res.status}`;
            }
        } else {
            engineError = 'ENGINE_API_URL not configured';
        }
    } catch (err) {
        engineError = String(err);
    }

    // ─── 2. Current user's own data only ────────────────────────────────────
    const userBots = await prisma.bot.findMany({
        where: { userId },
        select: {
            id: true, name: true, exchange: true, status: true,
            isActive: true, startedAt: true, stoppedAt: true,
            updatedAt: true,
        },
    });

    const dbTradeCount = await prisma.trade.count({
        where: { bot: { userId } },
    });

    const dbTrades = await prisma.trade.findMany({
        where: { bot: { userId } },
        select: {
            id: true, coin: true, status: true, entryTime: true,
            botId: true, exchangeOrderId: true,
        },
        orderBy: { entryTime: 'desc' },
        take: 10,
    });

    return NextResponse.json({
        engine: {
            url: ENGINE_API_URL || null,
            totalTradeCount: engineTradeCount,
            error: engineError,
        },
        user: {
            email,
            bots: userBots,
            dbTradeCount,
            dbTrades,
        },
    });
}

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/prisma';
import { getEngineUrl } from '@/lib/engine-url';

export const dynamic = 'force-dynamic';

const ENGINE_API_URL = getEngineUrl('live');

/**
 * GET /api/debug
 * Admin-only: returns full sync diagnostics for a given user email.
 * Usage: /api/debug?email=nikhildha@gmail.com
 */
export async function GET(request: Request) {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
        return NextResponse.json({ error: 'Not logged in' }, { status: 401 });
    }
    const isAdmin = (session?.user as any)?.role === 'admin';

    const { searchParams } = new URL(request.url);
    // Admin can look up any email; regular user always sees their own data
    const email = isAdmin
        ? (searchParams.get('email') || session.user.email)
        : session.user.email;

    // ─── 1. Engine data ───────────────────────────────────────────────────────
    let engineTrades: any[] = [];
    let engineError: string | null = null;
    try {
        if (ENGINE_API_URL) {
            const res = await fetch(`${ENGINE_API_URL}/api/all`, {
                cache: 'no-store',
                signal: AbortSignal.timeout(8000),
            });
            if (res.ok) {
                const data = await res.json();
                engineTrades = data?.tradebook?.trades || [];
            } else {
                engineError = `Engine returned ${res.status}`;
            }
        } else {
            engineError = 'ENGINE_API_URL not configured';
        }
    } catch (err) {
        engineError = String(err);
    }

    // ─── 2. Target user ───────────────────────────────────────────────────────
    let targetUser: any = null;
    let userBots: any[] = [];
    let dbTradeCount = 0;
    let dbTrades: any[] = [];

    if (email) {
        targetUser = await prisma.user.findUnique({
            where: { email },
            select: { id: true, email: true, name: true, role: true },
        });

        if (targetUser) {
            userBots = await prisma.bot.findMany({
                where: { userId: targetUser.id },
                select: {
                    id: true, name: true, exchange: true, status: true,
                    isActive: true, startedAt: true, stoppedAt: true,
                    updatedAt: true,
                },
            });

            dbTradeCount = await prisma.trade.count({
                where: { bot: { userId: targetUser.id } },
            });

            dbTrades = await prisma.trade.findMany({
                where: { bot: { userId: targetUser.id } },
                select: {
                    id: true, coin: true, status: true, entryTime: true,
                    botId: true, exchangeOrderId: true,
                },
                orderBy: { entryTime: 'desc' },
                take: 10,
            });
        }
    }

    // ─── 3. Engine trade sample ───────────────────────────────────────────────
    const engineSample = engineTrades.slice(0, 3).map((t: any) => ({
        trade_id: t.trade_id || t.id,
        symbol: t.symbol || t.coin,
        status: t.status,
        entry_time: t.entry_time || t.entryTime,
        regime: t.regime,
    }));

    return NextResponse.json({
        engine: {
            url: ENGINE_API_URL || null,
            tradeCount: engineTrades.length,
            error: engineError,
            sample: engineSample,
        },
        user: targetUser
            ? {
                  ...targetUser,
                  bots: userBots,
                  dbTradeCount,
                  dbTrades,
              }
            : { error: email ? `User not found: ${email}` : 'No email param provided' },
        instructions: 'Add ?email=user@example.com to check a specific user',
    });
}

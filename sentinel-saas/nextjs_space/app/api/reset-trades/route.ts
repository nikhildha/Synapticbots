import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { clearUserTrades } from '@/lib/sync-engine-trades';
// G3: Engine URL imports removed — no longer resetting engine tradebook
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function POST() {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const userId = (session.user as any)?.id;
        const isAdmin = (session.user as any)?.role === 'admin';

        // Non-admin: clear only their own Prisma trades (isolated)
        if (!isAdmin) {
            const deletedCount = await clearUserTrades(userId);
            return NextResponse.json({
                success: true,
                message: `Cleared ${deletedCount} closed trades`,
                deletedCount,
            });
        }

        // Admin: clear only their own closed trades (same as regular users) + reset engine
        const deletedCount = await clearUserTrades(userId);
        console.log(`[reset-trades] Admin cleared ${deletedCount} of their own closed trades`);

        // G3 FIX: Do NOT reset engine in-memory tradebook — that clears ALL users' trades.
        // Admin can only clear their own Prisma DB trades. Engine trades will naturally
        // expire or be managed by the engine itself.

        return NextResponse.json({
            success: true,
            message: `Cleared ${deletedCount} trades from database`,
            deletedCount,
        });
    } catch (error) {
        console.error('[reset-trades] Error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

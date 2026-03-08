import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { clearUserTrades } from '@/lib/sync-engine-trades';
import { getAllEngineUrls } from '@/lib/engine-url';
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

        // 2. Reset BOTH engine in-memory trades (paper + live, best-effort)
        const { live: liveUrl, paper: paperUrl } = getAllEngineUrls();
        const engineResets: Promise<any>[] = [];
        if (liveUrl) engineResets.push(
            fetch(`${liveUrl}/api/reset-trades`, { method: 'POST', signal: AbortSignal.timeout(5000) })
                .then(() => console.log('[reset-trades] Live engine reset'))
                .catch(err => console.error('[reset-trades] Live engine reset failed:', err))
        );
        if (paperUrl && paperUrl !== liveUrl) engineResets.push(
            fetch(`${paperUrl}/api/reset-trades`, { method: 'POST', signal: AbortSignal.timeout(5000) })
                .then(() => console.log('[reset-trades] Paper engine reset'))
                .catch(err => console.error('[reset-trades] Paper engine reset failed:', err))
        );
        await Promise.allSettled(engineResets);

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

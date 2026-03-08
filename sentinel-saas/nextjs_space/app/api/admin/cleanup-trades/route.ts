import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/cleanup-trades
 * Admin-only: delete only the ADMIN's own closed trades.
 * Does NOT touch other users' data.
 */
export async function POST() {
    try {
        const session = await getServerSession(authOptions);
        const role = (session?.user as any)?.role;
        if (!session?.user || role !== 'admin') {
            return NextResponse.json({ error: 'Admin only' }, { status: 403 });
        }

        const userId = (session.user as any)?.id;

        // Only delete admin's own closed trades — NEVER touch other users
        const adminBots = await prisma.bot.findMany({
            where: { userId },
            select: { id: true, name: true },
        });
        const botIds = adminBots.map(b => b.id);

        if (botIds.length === 0) {
            return NextResponse.json({ success: true, deletedCount: 0, message: 'No bots found' });
        }

        const before = await prisma.trade.count({
            where: { botId: { in: botIds } },
        });

        const result = await prisma.trade.deleteMany({
            where: { botId: { in: botIds }, status: 'closed' },
        });

        return NextResponse.json({
            success: true,
            deletedCount: result.count,
            beforeCount: before,
            message: `Deleted ${result.count} of your closed trades. Active trades preserved.`,
        });
    } catch (err) {
        console.error('[cleanup-trades]', err);
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}

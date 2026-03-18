import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getEngineUrl } from '@/lib/engine-url';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * GET /api/bots/broadcast-log?n=100&mode=live|paper
 * Proxies /api/broadcast-log from the correct engine, filtered to this user's bot IDs only.
 * Prevents cross-user Athena cards from appearing on other users' dashboards.
 */
export async function GET(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const userId = (session.user as any)?.id;
        const { searchParams } = new URL(request.url);
        const n = Math.min(parseInt(searchParams.get('n') || '100'), 500);

        // Fetch user's bot IDs and determine mode
        let mode: 'live' | 'paper' = searchParams.get('mode') === 'live' ? 'live' : 'paper';
        let botIds: string[] = [];

        if (userId) {
            const userBots = await prisma.bot.findMany({
                where: { userId },
                select: { id: true, isActive: true, config: true },
            });
            botIds = userBots.map((b: any) => b.id);
            const hasLiveBot = userBots.some(
                (b: any) => b.isActive && (b.config?.mode || '').toLowerCase().includes('live')
            );
            if (hasLiveBot) mode = 'live';
        }

        const engineUrl = getEngineUrl(mode);
        if (!engineUrl) {
            return NextResponse.json({ error: 'Engine URL not configured', lines: [] });
        }

        const secret = process.env.ENGINE_API_SECRET || '';
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (secret) headers['Authorization'] = `Bearer ${secret}`;

        // Pass bot_ids as comma-separated filter — engine only returns events for these bots
        const botIdsParam = botIds.length > 0 ? `&bot_ids=${encodeURIComponent(botIds.join(','))}` : '';
        const res = await fetch(`${engineUrl}/api/broadcast-log?n=${n}${botIdsParam}`, {
            headers,
            signal: AbortSignal.timeout(5000),
        });

        if (!res.ok) {
            return NextResponse.json({ error: `Engine returned ${res.status}`, lines: [] });
        }

        const data = await res.json();
        return NextResponse.json(data);
    } catch (error: any) {
        console.error('[broadcast-log] error:', error);
        return NextResponse.json({ error: error.message || 'Failed to fetch broadcast log', lines: [] }, { status: 500 });
    }
}

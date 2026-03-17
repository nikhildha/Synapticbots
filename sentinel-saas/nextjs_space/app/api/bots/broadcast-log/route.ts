import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getEngineUrl } from '@/lib/engine-url';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * GET /api/bots/broadcast-log?n=100&mode=live|paper
 * Proxies /api/broadcast-log from the correct engine based on user's active bot mode.
 * Returns last N signal broadcast events parsed into structured JSON.
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

        // Determine which engine to query based on caller's active bots
        let mode: 'live' | 'paper' = searchParams.get('mode') === 'live' ? 'live' : 'paper';
        if (userId) {
            const userBots = await prisma.bot.findMany({
                where: { userId, isActive: true },
                select: { config: true },
            });
            const hasLiveBot = userBots.some(
                (b: any) => (b.config?.mode || '').toLowerCase().includes('live')
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

        const res = await fetch(`${engineUrl}/api/broadcast-log?n=${n}`, {
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

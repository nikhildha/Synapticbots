import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getEngineUrl } from '@/lib/engine-url';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any)?.role !== 'admin') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { trade_id, symbol, mode = 'paper', email } = await request.json().catch(() => ({}));

    if (!trade_id && !symbol) {
        return NextResponse.json({ error: 'trade_id or symbol required' }, { status: 400 });
    }

    // Ownership guard: verify trade_id belongs to the specified user (or admin) before closing.
    // Prevents accidentally closing another user's trade when engine recycles trade IDs.
    if (trade_id && email) {
        const owner = await prisma.trade.findFirst({
            where: {
                exchangeOrderId: String(trade_id),
                bot: { user: { email: String(email) } },
                status: { in: ['active', 'ACTIVE', 'Active'] },
            },
            select: { id: true, coin: true },
        });
        if (!owner) {
            return NextResponse.json({
                error: `trade_id=${trade_id} not found as an active trade for ${email}. ` +
                       `Refusing to close — engine trade IDs may have been recycled.`,
            }, { status: 409 });
        }
    }

    const engineUrl = getEngineUrl(mode === 'live' ? 'live' : 'paper');
    if (!engineUrl) {
        return NextResponse.json({ error: `No engine URL configured for mode: ${mode}` }, { status: 400 });
    }

    const res = await fetch(`${engineUrl}/api/close-trade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trade_id, symbol, reason: 'ADMIN_CLOSE' }),
        signal: AbortSignal.timeout(10000),
    });

    const data = await res.json().catch(() => ({}));
    return NextResponse.json({ success: res.ok, mode, engine: data });
}

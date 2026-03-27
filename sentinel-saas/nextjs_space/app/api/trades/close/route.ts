import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getEngineUrl } from '@/lib/engine-url';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const data = await request.json();
        const { tradeId, symbol, mode } = data;

        if (!tradeId && !symbol) {
            return NextResponse.json({ error: 'tradeId or symbol required' }, { status: 400 });
        }

        const engineMode = (mode || 'paper').toLowerCase().includes('live') ? 'live' : 'paper';
        const url = getEngineUrl(engineMode);

        if (!url) {
            return NextResponse.json({ error: 'Engine URL not found' }, { status: 500 });
        }

        const res = await fetch(`${url}/api/close-trade`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                trade_id: tradeId,
                symbol: symbol,
                reason: 'MANUAL_CLOSE'
            }),
            cache: 'no-store',
            signal: AbortSignal.timeout(10000),
        });

        if (!res.ok) {
            const errBody = await res.text();
            throw new Error(`Engine returned ${res.status}: ${errBody}`);
        }

        const result = await res.json();
        return NextResponse.json(result);

    } catch (error: any) {
        console.error('[trades/close] Error Proxying Close Trade:', error);
        return NextResponse.json({ error: 'Failed to close trade', detail: String(error) }, { status: 500 });
    }
}

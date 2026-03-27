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
        const { mode } = data;

        const engineMode = (mode || 'paper').toLowerCase().includes('live') ? 'live' : 'paper';
        const url = getEngineUrl(engineMode);

        if (!url) {
            return NextResponse.json({ error: 'Engine URL not found' }, { status: 500 });
        }

        const res = await fetch(`${url}/api/exit-all-live`, {
            method: 'POST',
            cache: 'no-store',
            signal: AbortSignal.timeout(15000), // longer timeout for closing multiple positions
        });

        if (!res.ok) {
            const errBody = await res.text();
            throw new Error(`Engine returned ${res.status}: ${errBody}`);
        }

        const result = await res.json();
        return NextResponse.json(result);

    } catch (error: any) {
        console.error('[trades/close-all] Error Proxying Close All:', error);
        return NextResponse.json({ error: 'Failed to close all trades', detail: String(error) }, { status: 500 });
    }
}

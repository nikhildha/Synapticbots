import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

// Retrieve Orchestrator URL identically to bot-state
const getEngineUrl = (mode: 'paper' | 'live' = 'live'): string => {
    if (mode === 'live' && process.env.LIVE_ORCHESTRATOR_URL) {
        return process.env.LIVE_ORCHESTRATOR_URL;
    }
    // Strict fallback directly pushing to Live Port 3001 to dodge paper mappings on local
    return 'http://127.0.0.1:3001';
};

export async function GET(req: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const engineUrl = getEngineUrl('live');
        const url = `${engineUrl.replace(/\/$/, '')}/api/exchange-positions`;

        const response = await fetch(url, {
            // NextJS 14 cache control bypass for pure real-time fetches
            cache: 'no-store',
            headers: { 'Accept': 'application/json' },
            signal: AbortSignal.timeout(5000)
        });

        if (!response.ok) {
            throw new Error(`Engine returned ${response.status}`);
        }

        const data = await response.json();
        return NextResponse.json(data);

    } catch (error: any) {
        console.error('[API] /exchange-positions proxy error:', error);
        return NextResponse.json(
            { error: 'Failed to fetch native exchange routing', details: error.message },
            { status: 500 }
        );
    }
}

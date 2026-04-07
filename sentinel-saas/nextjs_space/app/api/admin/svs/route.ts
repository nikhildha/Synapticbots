import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getEngineUrl } from '@/lib/engine-url';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user || (session.user as any).role !== 'admin') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
        }

        const ENGINE_API_URL = getEngineUrl('live');
        if (!ENGINE_API_URL) {
            return NextResponse.json({ error: 'Engine URL not configured' }, { status: 500 });
        }

        // Fetch both report and signals from the engine
        const engineRes = await fetch(`${ENGINE_API_URL}/api/signal-validation?report=1&signals=1`, {
            cache: 'no-store',
            signal: AbortSignal.timeout(5000), // 5s timeout
        });

        if (!engineRes.ok) {
            console.error(`SVS engine fetch failed with status ${engineRes.status}`);
            return NextResponse.json({ error: 'Engine fetch failed' }, { status: engineRes.status });
        }

        const data = await engineRes.json();
        return NextResponse.json(data);
    } catch (error: any) {
        console.error('SVS fetch error:', error);
        return NextResponse.json({ error: error.message || 'Internal logic error' }, { status: 500 });
    }
}

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getEngineUrl, type EngineMode } from '@/lib/engine-url';

export const dynamic = 'force-dynamic';

/**
 * GET /api/engine-logs — Admin-only proxy to engine /api/logs.
 * Returns live engine log lines from the in-memory ring buffer.
 */
export async function GET(req: Request) {
    const session = await getServerSession(authOptions);
    const role = (session?.user as any)?.role;
    if (!session?.user || role !== 'admin') {
        return NextResponse.json({ error: 'Admin only' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const n = searchParams.get('n') || '200';
    const mode = (searchParams.get('mode') || 'live') as EngineMode;
    const engineUrl = getEngineUrl(mode);

    try {
        const res = await fetch(`${engineUrl}/api/logs?n=${n}`, {
            cache: 'no-store',
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) {
            return NextResponse.json({ error: `Engine returned ${res.status}` }, { status: 502 });
        }
        const data = await res.json();
        return NextResponse.json(data);
    } catch (err) {
        return NextResponse.json({ error: 'Engine unreachable', lines: [] }, { status: 502 });
    }
}

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

export const dynamic = 'force-dynamic';

const ENGINE_URL = process.env.ENGINE_API_URL || process.env.PYTHON_ENGINE_URL || 'http://localhost:3001';

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

    try {
        const res = await fetch(`${ENGINE_URL}/api/logs?n=${n}`, {
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

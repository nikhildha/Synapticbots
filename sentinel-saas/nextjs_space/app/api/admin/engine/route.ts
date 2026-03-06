import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

export const dynamic = 'force-dynamic';

const ENGINE_API_URL = process.env.ENGINE_API_URL;

// ─── GET: Engine status ─────────────────────────────────────────────────────

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any)?.role !== 'admin') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Production: query the remote engine
    if (ENGINE_API_URL) {
        try {
            const res = await fetch(`${ENGINE_API_URL}/api/health`, {
                cache: 'no-store',
                signal: AbortSignal.timeout(5000),
            });
            if (res.ok) {
                const data = await res.json();
                return NextResponse.json({
                    status: data.status || 'running',
                    remote: true,
                    uptime: data.uptime_human || null,
                    logs: [],
                });
            }
        } catch { /* engine unreachable */ }
    }

    return NextResponse.json({
        status: ENGINE_API_URL ? 'unreachable' : 'not_configured',
        remote: true,
        uptime: null,
        logs: [],
    });
}

// ─── POST: Start / Stop engine ──────────────────────────────────────────────
// On Railway the engine runs as a separate service — start/stop is not
// supported from the dashboard. Return a helpful message.

export async function POST(request: Request) {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any)?.role !== 'admin') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { action } = await request.json();

    if (ENGINE_API_URL) {
        return NextResponse.json({
            status: 'running',
            remote: true,
            message: `Engine runs as a remote service. ${action === 'stop' ? 'Stop it from Railway dashboard.' : 'It is already running.'}`,
        });
    }

    return NextResponse.json({
        status: 'not_configured',
        message: 'ENGINE_API_URL is not set. Configure in Railway variables.',
    });
}

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getEngineUrl } from '@/lib/engine-url';

export const dynamic = 'force-dynamic';

const ENGINE_API_URL = getEngineUrl('live');

/**
 * Proxy to the remote engine's /api/health endpoint.
 * Returns engine status, uptime, cycle count, config info.
 * Admin-only.
 */
export async function GET() {
    // S10 FIX: Admin-only — was missing auth check entirely
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any)?.role !== 'admin') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    // Production: proxy to remote engine API
    if (ENGINE_API_URL) {
        try {
            const res = await fetch(`${ENGINE_API_URL}/api/health`, {
                signal: AbortSignal.timeout(5000),
                cache: 'no-store',
            });
            if (res.ok) {
                const data = await res.json();
                return NextResponse.json({ ...data, source: 'remote' });
            }
            return NextResponse.json({
                status: 'unreachable',
                source: 'remote',
                error: `Engine returned ${res.status}`,
            });
        } catch (e: any) {
            return NextResponse.json({
                status: 'unreachable',
                source: 'remote',
                error: e.message || 'Connection failed',
            });
        }
    }

    // Local: no remote engine, return unknown
    return NextResponse.json({
        status: 'no_remote',
        source: 'local',
        message: 'ENGINE_API_URL not set — engine runs locally',
    });
}

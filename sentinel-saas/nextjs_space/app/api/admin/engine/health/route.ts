import { NextResponse } from 'next/server';
import { getEngineUrl } from '@/lib/engine-url';

export const dynamic = 'force-dynamic';

const ENGINE_API_URL = getEngineUrl('live');

/**
 * Proxy to the remote engine's /api/health endpoint.
 * Returns engine status, uptime, cycle count, config info.
 * Falls back to local engine status if ENGINE_API_URL is not set.
 */
export async function GET() {
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

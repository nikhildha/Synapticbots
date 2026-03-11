import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';

/**
 * GET /api/engine-log
 * Returns engine activity log by fetching the /status endpoint of the Python engine.
 * Also stores a rolling in-memory log of the last 50 engine pings so the frontend
 * can see when the engine was last alive, what cycle it completed, and any errors.
 */

interface LogEntry {
    ts: string;        // ISO timestamp
    status: 'alive' | 'dead' | 'error';
    cycle?: number;
    coinsScanned?: number;
    regime?: string;
    error?: string;
    latencyMs?: number;
}

// In-memory rolling log (resets on server restart — acceptable for diagnostics)
const LOG: LogEntry[] = [];
const MAX_LOG = 50;

function addLog(entry: LogEntry) {
    LOG.unshift(entry);
    if (LOG.length > MAX_LOG) LOG.splice(MAX_LOG);
}

// Probe the engine and record the result
async function probeEngine(): Promise<LogEntry> {
    const engineUrl = process.env.ENGINE_API_URL || process.env.NEXT_PUBLIC_ENGINE_URL;
    if (!engineUrl) {
        const entry: LogEntry = { ts: new Date().toISOString(), status: 'error', error: 'ENGINE_API_URL not set' };
        addLog(entry);
        return entry;
    }

    const start = Date.now();
    try {
        const res = await fetch(`${engineUrl}/status`, { signal: AbortSignal.timeout(5000) });
        const latencyMs = Date.now() - start;
        if (!res.ok) {
            const entry: LogEntry = { ts: new Date().toISOString(), status: 'dead', latencyMs, error: `HTTP ${res.status}` };
            addLog(entry);
            return entry;
        }
        const data = await res.json();
        const entry: LogEntry = {
            ts: new Date().toISOString(),
            status: 'alive',
            latencyMs,
            cycle: data.cycle || data.cycle_count,
            coinsScanned: data.coins_scanned || data.coinsScanned,
            regime: data.macro_regime || data.regime,
        };
        addLog(entry);
        return entry;
    } catch (e: any) {
        const entry: LogEntry = {
            ts: new Date().toISOString(),
            status: 'error',
            latencyMs: Date.now() - start,
            error: e?.message || 'Connection refused',
        };
        addLog(entry);
        return entry;
    }
}

export async function GET(req: Request) {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const probe = searchParams.get('probe') === '1';

    // Optionally probe the engine right now
    let latest: LogEntry | null = null;
    if (probe || LOG.length === 0) {
        latest = await probeEngine();
    } else {
        latest = LOG[0] || null;
    }

    return NextResponse.json({
        latest,
        log: LOG,
        engineUrl: process.env.ENGINE_API_URL ? '✅ configured' : '❌ not set',
    });
}

// Allow a POST to manually record a log entry (called by the engine on each cycle)
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const entry: LogEntry = {
            ts: new Date().toISOString(),
            status: body.status || 'alive',
            cycle: body.cycle,
            coinsScanned: body.coins_scanned,
            regime: body.regime,
            error: body.error,
        };
        addLog(entry);
        return NextResponse.json({ ok: true });
    } catch {
        return NextResponse.json({ error: 'bad body' }, { status: 400 });
    }
}

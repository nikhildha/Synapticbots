/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  ALPHA MODULE — API ROUTE                                           ║
 * ║  GET /api/alpha                                                     ║
 * ║                                                                     ║
 * ║  DATA SOURCE (hybrid):                                              ║
 * ║    Railway (prod):  calls ALPHA_ENGINE_URL/alpha/data via HTTP      ║
 * ║                     secured with ALPHA_INTERNAL_KEY header          ║
 * ║    Local (dev):     reads alpha/data/*.json from filesystem         ║
 * ║                     (ALPHA_ENGINE_URL not set)                      ║
 * ║                                                                     ║
 * ║  ISOLATION: never touches main Prisma DB or root engine files.     ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { NextResponse }     from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions }      from '@/lib/auth-options';
import fs                   from 'fs';
import path                 from 'path';

export const dynamic = 'force-dynamic';

// ── Config ────────────────────────────────────────────────────────────────────
const ALPHA_ENGINE_URL   = (process.env.ALPHA_ENGINE_URL  ?? '').trim();
const ALPHA_INTERNAL_KEY = (process.env.ALPHA_INTERNAL_KEY ?? '').trim();

// Local fallback paths (used when ALPHA_ENGINE_URL is not set)
const ALPHA_DATA_DIR = path.join(process.cwd(), '../../alpha/data');
const TRADEBOOK_FILE = path.join(ALPHA_DATA_DIR, 'tradebook.json');
const STATE_FILE     = path.join(ALPHA_DATA_DIR, 'state.json');


// ── Helpers ───────────────────────────────────────────────────────────────────

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function buildLocalPayload(): object {
  /** Read alpha/data/*.json from local filesystem (dev mode). */
  const tradebook = readJson<{ open: Record<string, any>; closed: Record<string, any> }>(
    TRADEBOOK_FILE,
    { open: {}, closed: {} },
  );
  const state = readJson<{
    cycle?: number; last_run?: string; paper_mode?: boolean;
    hmm_states?: Record<string, any>; last_result?: any;
  }>(STATE_FILE, {});

  const openTrades   = Object.values(tradebook.open);
  const allClosed    = Object.values(tradebook.closed);
  const closedTrades = [...allClosed]
    .sort((a: any, b: any) => (b.closed_at || '').localeCompare(a.closed_at || ''))
    .slice(0, 50);

  const netPnls  = allClosed.map((t: any) => Number(t.net_pnl ?? 0));
  const wins     = netPnls.filter(p => p > 0).length;
  const totalPnl = netPnls.reduce((a, b) => a + b, 0);
  const allFees  = [...openTrades, ...allClosed].reduce(
    (s: number, t: any) => s + Number(t.fee_open_usdt ?? 0) + Number(t.fee_close_usdt ?? 0), 0,
  );

  return {
    ok:           true,
    cycle:        state.cycle ?? 0,
    lastRun:      state.last_run ?? null,
    paperMode:    state.paper_mode ?? true,
    hmmStates:    state.hmm_states ?? {},
    regimeMap:    state.last_result?.regime_map ?? {},
    openTrades,
    closedTrades,
    portfolio: {
      openCount:   openTrades.length,
      closedCount: allClosed.length,
      winCount:    wins,
      lossCount:   allClosed.length - wins,
      winRate:     allClosed.length > 0 ? Number(((wins / allClosed.length) * 100).toFixed(1)) : 0,
      totalNetPnl: Number(totalPnl.toFixed(2)),
      totalFees:   Number(allFees.toFixed(4)),
    },
    _source: 'local_files',
  };
}

async function fetchRemotePayload(): Promise<object> {
  /** Fetch from Alpha Python service via HTTP (Railway mode). */
  const url = `${ALPHA_ENGINE_URL.replace(/\/$/, '')}/alpha/data`;
  const res = await fetch(url, {
    headers: {
      'X-Alpha-Key': ALPHA_INTERNAL_KEY,
      'Content-Type': 'application/json',
    },
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    throw new Error(`Alpha engine responded ${res.status} from ${url}`);
  }
  const data = await res.json();
  return { ...data, _source: 'alpha_engine_api' };
}


// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const payload = ALPHA_ENGINE_URL
      ? await fetchRemotePayload()   // Railway: call Alpha service HTTP API
      : buildLocalPayload();         // Local dev: read JSON files directly

    return NextResponse.json(payload);
  } catch (err: any) {
    console.error('[/api/alpha] error:', err?.message);
    return NextResponse.json(
      { error: 'Failed to load Alpha data', detail: err?.message ?? 'unknown' },
      { status: 503 },
    );
  }
}

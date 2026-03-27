import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * GET /api/market-structure
 * Reads the market_structure.json file written by the Python engine
 * and returns it as JSON to the frontend.
 */
export async function GET(_req: NextRequest) {
  try {
    // Engine writes to: /data/market_structure.json relative to its Python base dir
    // In Railway, the engine and Next.js share the same volume at /app/data
    const candidates = [
      process.env.MARKET_STRUCTURE_PATH, // override via env
      // Railway shared volume
      '/app/data/market_structure.json',
      // Local dev: repo root /data/
      path.join(process.cwd(), '..', 'data', 'market_structure.json'),
      path.join(process.cwd(), 'data', 'market_structure.json'),
    ].filter(Boolean) as string[];

    let data: any = null;
    for (const p of candidates) {
      try {
        data = JSON.parse(readFileSync(p, 'utf-8'));
        break;
      } catch { /* try next */ }
    }

    if (!data) {
      // Return empty skeleton so frontend doesn't crash
      return NextResponse.json({
        timestamp: null,
        tickers: [],
        llm_summary: null,
        timeframe: '15m',
      });
    }

    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (err: any) {
    return NextResponse.json({ error: 'Failed to read market structure data', detail: err?.message }, { status: 500 });
  }
}

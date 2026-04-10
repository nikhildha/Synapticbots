import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// Internal engine-to-dashboard secret (set ENGINE_INTERNAL_SECRET in Railway env)
const INTERNAL_SECRET = process.env.ENGINE_INTERNAL_SECRET || '';

export async function POST(req: NextRequest) {
    // Lightweight auth: shared secret header
    const authHeader = req.headers.get('x-engine-secret');
    if (authHeader !== INTERNAL_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: any;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    try {
        const {
            cycle_number,
            mode = 'paper',
            engine_bot_id,
            scanned_at,
            duration_ms,
            btc_regime,
            btc_confidence,
            btc_price,
            macro_action,
            coins_scanned = 0,
            eligible_count = 0,
            deployed_count = 0,
            filtered_count = 0,
            coin_results = [],   // array of per-coin scan data
            heatmap = [],        // array of per-segment scores
        } = body;

        // Parse timestamp — engine sends IST naive datetime, we store as UTC
        const scannedAtDate = scanned_at
            ? new Date(String(scanned_at).endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(String(scanned_at))
                ? scanned_at
                : scanned_at + '+05:30')
            : new Date();

        // Create CycleSnapshot + nested rows in one transaction
        const snapshot = await prisma.cycleSnapshot.create({
            data: {
                cycleNumber:   cycle_number ?? 0,
                mode,
                engineBotId:   engine_bot_id ?? null,
                scannedAt:     scannedAtDate,
                durationMs:    duration_ms ?? null,
                btcRegime:     btc_regime ?? null,
                btcConfidence: btc_confidence != null ? Number(btc_confidence) : null,
                btcPrice:      btc_price != null ? Number(btc_price) : null,
                macroAction:   macro_action ?? null,
                coinsScanned:  coins_scanned,
                eligibleCount: eligible_count,
                deployedCount: deployed_count,
                filteredCount: filtered_count,

                // Per-coin results
                coinResults: {
                    create: (coin_results as any[]).map((c: any) => ({
                        symbol:        c.symbol,
                        regime:        c.regime ?? null,
                        regimeFull:    c.regime_full ?? null,
                        action:        c.action ?? null,
                        side:          c.side ?? null,
                        confidence:    c.confidence != null ? Number(c.confidence) : null,
                        conviction:    c.conviction != null ? Number(c.conviction) : null,
                        tfAgreement:   c.tf_agreement != null ? Number(c.tf_agreement) : null,
                        atr:           c.atr != null ? Number(c.atr) : null,
                        price:         c.price != null ? Number(c.price) : null,
                        deployStatus:  c.deploy_status ?? null,
                        wasDeployed:   c.was_deployed === true,
                        athenaDecision: c.athena_decision ?? null,
                    })),
                },

                // Segment heatmap entries
                heatmapEntries: {
                    create: (heatmap as any[]).map((s: any, idx: number) => ({
                        segment:        s.segment,
                        compositeScore: s.composite_score != null ? Number(s.composite_score) : null,
                        vwRr:           s.vw_rr != null ? Number(s.vw_rr) : null,
                        btcAlpha:       s.btc_alpha != null ? Number(s.btc_alpha) : null,
                        breadthPct:     s.breadth_pct != null ? Number(s.breadth_pct) : null,
                        isSelected:     s.is_selected === true,
                        rank:           s.rank != null ? Number(s.rank) : idx + 1,
                    })),
                },
            },
        });

        return NextResponse.json({ ok: true, snapshotId: snapshot.id });
    } catch (err) {
        console.error('[cycle-snapshot] DB write failed:', err);
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}

// GET: retrieve recent cycle snapshots for analysis UI
export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
    const mode = searchParams.get('mode') || undefined;
    const symbol = searchParams.get('symbol') || undefined;

    try {
        const snapshots = await prisma.cycleSnapshot.findMany({
            where: { ...(mode ? { mode } : {}) },
            orderBy: { scannedAt: 'desc' },
            take: limit,
            include: {
                heatmapEntries: { orderBy: { rank: 'asc' } },
                // Include coin results only if filtering by symbol
                coinResults: symbol
                    ? { where: { symbol }, orderBy: { createdAt: 'desc' } }
                    : false,
            },
        });

        return NextResponse.json({ snapshots });
    } catch (err) {
        return NextResponse.json({ error: String(err) }, { status: 500 });
    }
}

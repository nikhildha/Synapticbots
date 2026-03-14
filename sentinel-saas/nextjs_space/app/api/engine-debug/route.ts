import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getEngineUrl, getAllEngineUrls } from '@/lib/engine-url';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user || (session.user as any)?.role !== 'admin') {
            return NextResponse.json({ error: 'Admin only' }, { status: 403 });
        }

        const urls = getAllEngineUrls();
        const results: Record<string, any> = {
            engine_urls: {
                live: urls.live ? `✓ ${urls.live}` : '✗ NOT SET (ENGINE_API_URL env var missing)',
                paper: urls.paper ? `✓ ${urls.paper}` : '✗ NOT SET (ENGINE_API_URL_PAPER env var missing)',
            },
        };

        // Try to fetch from each engine
        for (const mode of ['live', 'paper'] as const) {
            const url = getEngineUrl(mode);
            if (!url) {
                results[`${mode}_engine`] = { status: 'NOT_CONFIGURED', url: null };
                continue;
            }
            try {
                const res = await fetch(`${url}/api/all`, {
                    cache: 'no-store',
                    signal: AbortSignal.timeout(8000),
                });
                if (!res.ok) {
                    results[`${mode}_engine`] = { status: `HTTP_ERROR_${res.status}`, url };
                    continue;
                }
                const data = await res.json();
                const coinStates = data?.multi?.coin_states || {};
                const btcState = coinStates?.BTCUSDT || {};
                const heatmap = data?.heatmap || null;
                const registeredBots = data?.registered_bot_ids || [];

                results[`${mode}_engine`] = {
                    status: 'CONNECTED',
                    url,
                    cycle: data?.multi?.cycle || 0,
                    coins_scanned: Object.keys(coinStates).length,
                    registered_bot_ids: registeredBots,
                    btc: {
                        regime: btcState?.regime,
                        confidence: btcState?.confidence,
                        conviction: btcState?.conviction,
                        price: btcState?.price,
                        deploy_status: btcState?.deploy_status,
                    },
                    heatmap_segments: heatmap?.segments?.length ?? 'null (heatmap not present)',
                    heatmap_timestamp: heatmap?.timestamp ?? null,
                    sample_coin_states: Object.fromEntries(
                        Object.entries(coinStates).slice(0, 3).map(([sym, state]: [string, any]) => [
                            sym,
                            {
                                regime: state?.regime,
                                confidence: state?.confidence,
                                conviction: state?.conviction,
                                action: state?.action,
                                deploy_status: state?.deploy_status,
                            }
                        ])
                    ),
                    last_analysis_time: data?.multi?.last_analysis_time,
                };
            } catch (err: any) {
                results[`${mode}_engine`] = { status: 'FETCH_FAILED', url, error: err.message };
            }
        }

        return NextResponse.json(results, { status: 200 });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Fetches live funding rates, taker buy/sell ratio, and long/short ratio
 * from Binance Futures for all USDT perpetual symbols tracked by the engine.
 */
export async function GET() {
    try {
        // Fetch from Binance Futures API in parallel
        const [fundingRes, takerRes, lsRes] = await Promise.all([
            fetch('https://fapi.binance.com/fapi/v1/premiumIndex'),
            fetch('https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=BTCUSDT&period=1h&limit=1'),
            fetch('https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=1h&limit=1'),
        ]);

        // Parse funding rates for all symbols
        const fundingAll = fundingRes.ok ? await fundingRes.json() : [];
        const fundingMap: Record<string, any> = {};
        for (const item of fundingAll) {
            if (item.symbol?.endsWith('USDT')) {
                fundingMap[item.symbol] = {
                    funding_rate: parseFloat(item.lastFundingRate) || 0,
                    mark_price: parseFloat(item.markPrice) || 0,
                    index_price: parseFloat(item.indexPrice) || 0,
                    next_funding_time: item.nextFundingTime,
                };
            }
        }

        // Taker buy/sell and long/short for BTC (as reference)
        let takerBtc = null;
        if (takerRes.ok) {
            const d = await takerRes.json();
            if (d?.[0]) {
                takerBtc = {
                    buy_sell_ratio: parseFloat(d[0].buyVol) / (parseFloat(d[0].sellVol) || 1),
                    buy_vol: parseFloat(d[0].buyVol),
                    sell_vol: parseFloat(d[0].sellVol),
                };
            }
        }

        let lsBtc = null;
        if (lsRes.ok) {
            const d = await lsRes.json();
            if (d?.[0]) {
                lsBtc = {
                    long_short_ratio: parseFloat(d[0].longShortRatio),
                    long_account: parseFloat(d[0].longAccount),
                    short_account: parseFloat(d[0].shortAccount),
                };
            }
        }

        return NextResponse.json({
            funding: fundingMap,
            taker_btc: takerBtc,
            long_short_btc: lsBtc,
            timestamp: new Date().toISOString(),
        });
    } catch (err) {
        return NextResponse.json({ funding: {}, error: String(err) }, { status: 500 });
    }
}

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/prisma';
import { decryptApiKeys } from '@/lib/encryption';
import { getEngineUrl } from '@/lib/engine-url';

export const dynamic = 'force-dynamic';

const ENGINE_API_URL = getEngineUrl('live');

async function fetchBinanceBalance(apiKey: string, apiSecret: string): Promise<number | null> {
    try {
        const crypto = await import('crypto');
        const timestamp = Date.now();
        const queryString = `timestamp=${timestamp}`;
        const signature = crypto.default
            .createHmac('sha256', apiSecret)
            .update(queryString)
            .digest('hex');

        const res = await fetch(
            `https://fapi.binance.com/fapi/v2/account?${queryString}&signature=${signature}`,
            {
                headers: { 'X-MBX-APIKEY': apiKey },
                signal: AbortSignal.timeout(8000),
            }
        );
        if (res.ok) {
            const data = await res.json();
            return parseFloat(data.totalWalletBalance || '0');
        }
    } catch { /* silent */ }
    return null;
}

async function fetchCoinDCXBalance(apiKey: string, apiSecret: string): Promise<number | null> {
    try {
        const crypto = await import('crypto');
        const https = await import('https');

        // CoinDCX Futures wallet: GET with signed JSON body.
        // Node.js native fetch rejects body on GET, so we use https.request directly
        // (same as Python requests.get(url, data=body) which CoinDCX expects).
        const body = JSON.stringify({ timestamp: Date.now() });
        const signature = crypto.default
            .createHmac('sha256', apiSecret)
            .update(body)
            .digest('hex');

        const data = await new Promise<any>((resolve, reject) => {
            const req = https.default.request({
                hostname: 'api.coindcx.com',
                path: '/exchange/v1/derivatives/futures/wallets',
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                    'X-AUTH-APIKEY': apiKey,
                    'X-AUTH-SIGNATURE': signature,
                },
                timeout: 8000,
            }, (res) => {
                let raw = '';
                res.on('data', (chunk: Buffer) => { raw += chunk; });
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        try { resolve(JSON.parse(raw)); } catch { reject(new Error('Parse error')); }
                    } else {
                        reject(new Error(`HTTP ${res.statusCode}: ${raw}`));
                    }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(new Error('Timeout')); });
            req.write(body);
            req.end();
        });

        // Futures wallet uses currency_short_name (not currency)
        const usdt = Array.isArray(data)
            ? data.find((b: any) => b.currency_short_name === 'USDT')
            : null;
        return usdt ? parseFloat(usdt.balance || '0') : 0;
    } catch { /* silent */ }
    return null;
}

/**
 * Fallback: fetch balance from engine API (uses Railway env var keys).
 * Used when user hasn't saved API keys in SaaS settings.
 */
async function fetchEngineBalance(exchange: string): Promise<number | null> {
    if (!ENGINE_API_URL) return null;
    try {
        const res = await fetch(
            `${ENGINE_API_URL}/api/validate-exchange?exchange=${encodeURIComponent(exchange)}`,
            { signal: AbortSignal.timeout(8000), cache: 'no-store' }
        );
        if (res.ok) {
            const data = await res.json();
            if (data.valid && data.balance != null) {
                return parseFloat(data.balance);
            }
        }
    } catch { /* silent */ }
    return null;
}

export async function GET() {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const userId = (session.user as any)?.id;

        // Fetch stored exchange API keys for this user
        const keys = await prisma.exchangeApiKey.findMany({
            where: { userId, isActive: true },
            select: { exchange: true, apiKey: true, apiSecret: true, encryptionIv: true },
        });

        const binanceKey = keys.find(k => k.exchange === 'binance');
        const coindcxKey = keys.find(k => k.exchange === 'coindcx');

        let binanceBalance: number | null = null;
        let coindcxBalance: number | null = null;

        if (binanceKey?.encryptionIv) {
            try {
                const { apiKey, apiSecret } = decryptApiKeys(
                    binanceKey.apiKey, binanceKey.apiSecret, binanceKey.encryptionIv
                );
                binanceBalance = await fetchBinanceBalance(apiKey, apiSecret);
            } catch { /* decryption failed */ }
        }

        if (coindcxKey?.encryptionIv) {
            try {
                const { apiKey, apiSecret } = decryptApiKeys(
                    coindcxKey.apiKey, coindcxKey.apiSecret, coindcxKey.encryptionIv
                );
                coindcxBalance = await fetchCoinDCXBalance(apiKey, apiSecret);
            } catch { /* decryption failed */ }
        }

        // Fallback: if user keys returned null, try fetching from engine API
        // ONLY for admin — regular users should see "not connected" (BUG-21)
        const isAdmin = (session.user as any)?.role === 'admin';
        if (isAdmin) {
            if (binanceBalance === null) {
                binanceBalance = await fetchEngineBalance('binance');
            }
            if (coindcxBalance === null) {
                coindcxBalance = await fetchEngineBalance('coindcx');
            }
        }

        return NextResponse.json({
            binance: binanceBalance,      // null = not connected
            coindcx: coindcxBalance,      // null = not connected
            binanceConnected: !!(binanceKey || binanceBalance !== null),
            coindcxConnected: !!(coindcxKey || coindcxBalance !== null),
        });
    } catch (err) {
        console.error('[wallet-balance]', err);
        return NextResponse.json({ binance: null, coindcx: null, binanceConnected: false, coindcxConnected: false });
    }
}


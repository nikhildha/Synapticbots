import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/prisma';
import { decryptApiKeys } from '@/lib/encryption';

export const dynamic = 'force-dynamic';

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
        // CoinDCX Futures wallet: GET with signed JSON body (same HMAC pattern as POST)
        const body = JSON.stringify({ timestamp: Date.now() });
        const signature = crypto.default
            .createHmac('sha256', apiSecret)
            .update(body)
            .digest('hex');

        const res = await fetch('https://api.coindcx.com/exchange/v1/derivatives/futures/wallets', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-AUTH-APIKEY': apiKey,
                'X-AUTH-SIGNATURE': signature,
            },
            body,
            signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
            const data = await res.json();
            // Futures wallet uses currency_short_name (not currency)
            const usdt = Array.isArray(data)
                ? data.find((b: any) => b.currency_short_name === 'USDT')
                : null;
            return usdt ? parseFloat(usdt.balance || '0') : 0;
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

        return NextResponse.json({
            binance: binanceBalance,      // null = not connected
            coindcx: coindcxBalance,      // null = not connected
            binanceConnected: !!binanceKey,
            coindcxConnected: !!coindcxKey,
        });
    } catch (err) {
        console.error('[wallet-balance]', err);
        return NextResponse.json({ binance: null, coindcx: null, binanceConnected: false, coindcxConnected: false });
    }
}

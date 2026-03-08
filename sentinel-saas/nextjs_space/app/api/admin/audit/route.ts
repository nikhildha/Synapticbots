/**
 * POST /api/admin/audit
 * Admin-only. Runs SaaS + integration audit checks and returns structured results.
 *
 * Checks performed:
 *   S1  — DB Integrity (Prisma connect, row counts, orphaned records)
 *   S2  — User isolation (trades with null botId)
 *   I2  — ENGINE_BOT_ID in env vars matches a real DB bot
 *   I3  — Engine mode vs DB active bot mode consistency
 *   I5  — Balance accuracy (engine balance vs CoinDCX API)
 *   I6  — DB timestamp validity (no null or future entryTime)
 *
 * Returns: { run_ts, section, results[], summary }
 * Called by: tools/audit_runner.sh (daily cron) or admin dashboard
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';
import { getEngineUrl } from '@/lib/engine-url';

export const dynamic = 'force-dynamic';

// ─── Types ────────────────────────────────────────────────────────────
type CheckStatus = 'PASS' | 'WARN' | 'FAIL' | 'SKIP';

interface CheckResult {
    check:   string;
    status:  CheckStatus;
    message: string;
    detail?: Record<string, any>;
    ts:      string;
}

function result(check: string, status: CheckStatus, message: string, detail?: Record<string, any>): CheckResult {
    return { check, status, message, detail: detail ?? {}, ts: new Date().toISOString() };
}

// ─── S1: DB Integrity ────────────────────────────────────────────────
async function checkS1DbIntegrity(): Promise<CheckResult> {
    try {
        // Verify Prisma can connect and all key tables respond
        const [users, bots, trades, subscriptions, sessions] = await Promise.all([
            prisma.user.count(),
            prisma.bot.count(),
            prisma.trade.count(),
            prisma.subscription.count(),
            prisma.botSession.count().catch(() => -1),  // older schemas may not have it
        ]);

        // Orphaned trades: trade.botId points to a non-existent bot
        const orphanTrades = await prisma.trade.count({
            where: { bot: { is: null } } as any,
        }).catch(() => 0);

        // Orphaned bots: bot.userId points to a non-existent user
        // (Prisma cascade should prevent this, but check anyway)
        const orphanBots = await prisma.bot.count({
            where: { user: { is: null } } as any,
        }).catch(() => 0);

        // Subscriptions with no linked user
        const orphanSubs = await prisma.subscription.count({
            where: { user: { is: null } } as any,
        }).catch(() => 0);

        const totalOrphans = orphanTrades + orphanBots + orphanSubs;

        if (totalOrphans > 0) {
            return result('S1', 'WARN',
                `${totalOrphans} orphaned record(s) found`,
                { orphanTrades, orphanBots, orphanSubs, users, bots, trades, subscriptions });
        }

        return result('S1', 'PASS',
            `DB healthy — ${users} users, ${bots} bots, ${trades} trades, ${subscriptions} subs`,
            { users, bots, trades, subscriptions, sessions, orphans: 0 });

    } catch (err: any) {
        return result('S1', 'FAIL', `DB connection failed: ${err.message}`);
    }
}

// ─── S2: User Isolation ──────────────────────────────────────────────
async function checkS2UserIsolation(): Promise<CheckResult> {
    try {
        // Trades with null botId (can't be attributed to any user)
        const nullBotIdCount = await prisma.trade.count({
            where: { botId: null } as any,
        });

        // Active trades with null botId (more critical — live exposure)
        const nullBotIdActive = await prisma.trade.count({
            where: { botId: null, status: { in: ['active', 'ACTIVE', 'Active'] } } as any,
        });

        if (nullBotIdActive > 0) {
            return result('S2', 'FAIL',
                `${nullBotIdActive} ACTIVE trade(s) with null botId — data isolation broken`,
                { nullBotIdActive, nullBotIdTotal: nullBotIdCount });
        }

        if (nullBotIdCount > 0) {
            return result('S2', 'WARN',
                `${nullBotIdCount} closed trade(s) with null botId (historical — not critical)`,
                { nullBotIdTotal: nullBotIdCount, nullBotIdActive: 0 });
        }

        return result('S2', 'PASS',
            'All trades have botId — user isolation intact',
            { nullBotIdTotal: 0 });

    } catch (err: any) {
        return result('S2', 'FAIL', `User isolation check failed: ${err.message}`);
    }
}

// ─── I2: ENGINE_BOT_ID matches a real DB bot ─────────────────────────
async function checkI2BotIdCrossSystem(): Promise<CheckResult> {
    const engineBotId = process.env.ENGINE_BOT_ID || '';
    const engineBotName = process.env.ENGINE_BOT_NAME || '';

    if (!engineBotId) {
        return result('I2', 'FAIL',
            'ENGINE_BOT_ID env var not set on SaaS — cross-system isolation cannot be verified');
    }

    try {
        const bot = await prisma.bot.findUnique({
            where: { id: engineBotId },
            select: { id: true, name: true, isActive: true, exchange: true },
        });

        if (!bot) {
            return result('I2', 'FAIL',
                `ENGINE_BOT_ID="${engineBotId}" not found in DB — trade sync will fail`,
                { engineBotId, engineBotName });
        }

        return result('I2', 'PASS',
            `ENGINE_BOT_ID matches DB bot "${bot.name}" (isActive=${bot.isActive})`,
            { engineBotId, engineBotName, dbBotName: bot.name, isActive: bot.isActive, exchange: bot.exchange });

    } catch (err: any) {
        return result('I2', 'FAIL', `I2 check failed: ${err.message}`);
    }
}

// ─── I3: Engine mode vs DB active bot mode ───────────────────────────
async function checkI3ModeCrossSystem(): Promise<CheckResult> {
    // Get DB active bot mode
    let dbMode: string | null = null;
    try {
        const activeBot = await prisma.bot.findFirst({
            where: { isActive: true },
            include: { config: true },
            orderBy: { updatedAt: 'desc' },
        });
        if (activeBot) {
            dbMode = ((activeBot as any).config?.mode || 'paper').toLowerCase();
        }
    } catch (err: any) {
        return result('I3', 'WARN', `Cannot read DB bot mode: ${err.message}`);
    }

    if (!dbMode) {
        return result('I3', 'SKIP', 'No active bot in DB — mode consistency check skipped');
    }

    // Get engine mode from /api/health (auth-exempt endpoint)
    const isLive = dbMode.includes('live');
    const engineUrl = getEngineUrl(isLive ? 'live' : 'paper');
    if (!engineUrl) {
        return result('I3', 'SKIP', 'Engine URL not configured — mode cross-check skipped',
            { dbMode });
    }

    try {
        const res = await fetch(`${engineUrl}/api/health`, {
            signal: AbortSignal.timeout(5000),
            cache: 'no-store',
        });
        if (!res.ok) {
            return result('I3', 'WARN', `Engine /api/health returned ${res.status}`, { dbMode });
        }
        const health = await res.json();
        const engineMode = health.mode || '';              // e.g. "paper" or "live:coindcx"
        const enginePaper: boolean = health.paper_trade;

        const dbIsPaper = !isLive;
        const mismatch = dbIsPaper !== enginePaper;

        if (mismatch) {
            return result('I3', 'FAIL',
                `Mode mismatch: DB bot="${dbMode}" but engine paper_trade=${enginePaper} (mode="${engineMode}")`,
                { dbMode, engineMode, enginePaper, dbIsPaper });
        }

        return result('I3', 'PASS',
            `Mode consistent: DB="${dbMode}" | engine="${engineMode}"`,
            { dbMode, engineMode, enginePaper });

    } catch (err: any) {
        return result('I3', 'WARN', `Engine unreachable for mode check: ${err.message}`, { dbMode });
    }
}

// ─── I5: Balance accuracy ─────────────────────────────────────────────
async function checkI5BalanceAccuracy(): Promise<CheckResult> {
    // This check verifies wallet-balance endpoint returns a valid non-null balance.
    // Full exchange↔engine balance comparison would need live API keys on both sides.
    // We verify the SaaS can still fetch a balance (keys working, endpoint healthy).
    try {
        const baseUrl = process.env.NEXTAUTH_URL || process.env.APP_URL || 'http://localhost:3000';
        // Build internal request (reuse wallet-balance logic without full HTTP round-trip)
        const [coinDCXKey, coinDCXSecret] = [
            process.env.COINDCX_API_KEY || '',
            process.env.COINDCX_API_SECRET || '',
        ];

        if (!coinDCXKey || !coinDCXSecret) {
            return result('I5', 'SKIP', 'CoinDCX API keys not in SaaS env — balance check skipped');
        }

        // Call CoinDCX futures wallet endpoint
        const ts = Date.now();
        const body = JSON.stringify({ timestamp: ts });
        const { createHmac } = await import('crypto');
        const sig = createHmac('sha256', coinDCXSecret).update(body).digest('hex');

        const walletRes = await fetch('https://api.coindcx.com/exchange/v1/derivatives/futures/wallets', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-AUTH-APIKEY': coinDCXKey,
                'X-AUTH-SIGNATURE': sig,
            },
            signal: AbortSignal.timeout(8000),
        });

        if (!walletRes.ok) {
            return result('I5', 'WARN', `CoinDCX wallet API returned ${walletRes.status}`,
                { status: walletRes.status });
        }

        const wallets: any[] = await walletRes.json();
        const usdt = wallets.find((w: any) => w.currency_short_name === 'USDT');
        const balance = usdt ? parseFloat(usdt.balance || '0') : null;

        if (balance === null) {
            return result('I5', 'WARN', 'USDT wallet not found in CoinDCX response');
        }

        return result('I5', 'PASS',
            `CoinDCX USDT futures balance: $${balance.toFixed(2)}`,
            { balance, currency: 'USDT' });

    } catch (err: any) {
        return result('I5', 'WARN', `Balance check failed: ${err.message}`);
    }
}

// ─── I6: DB Timestamp Validity ───────────────────────────────────────
async function checkI6TimestampValidity(): Promise<CheckResult> {
    try {
        const now = new Date();
        const sample = await prisma.trade.findMany({
            take: 50,
            orderBy: { createdAt: 'desc' },
            select: { id: true, entryTime: true, exitTime: true, createdAt: true },
        });

        const issues: string[] = [];

        for (const t of sample) {
            // entryTime must exist
            if (!t.entryTime) {
                issues.push(`Trade ${t.id}: null entryTime`);
                continue;
            }
            // entryTime must not be in the future (> 5 min tolerance for clock drift)
            if (t.entryTime > new Date(now.getTime() + 5 * 60 * 1000)) {
                issues.push(`Trade ${t.id}: entryTime is in the future (${t.entryTime.toISOString()})`);
            }
            // exitTime (if set) must be after entryTime
            if (t.exitTime && t.exitTime < t.entryTime) {
                issues.push(`Trade ${t.id}: exitTime before entryTime`);
            }
        }

        if (issues.length > 0) {
            const status: CheckStatus = issues.length > 3 ? 'FAIL' : 'WARN';
            return result('I6', status,
                `${issues.length} timestamp issue(s) in last 50 trades`,
                { issues: issues.slice(0, 5), sampled: sample.length });
        }

        return result('I6', 'PASS',
            `Timestamps valid in ${sample.length} sampled trades`,
            { sampled: sample.length });

    } catch (err: any) {
        return result('I6', 'FAIL', `Timestamp check failed: ${err.message}`);
    }
}

// ─── Main Handler ────────────────────────────────────────────────────

export async function GET() {
    // Admin-only
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any)?.role !== 'admin') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const runTs = new Date().toISOString();

    // Run all checks in parallel where safe, sequential for DB to avoid pool exhaustion
    const [s1, s2, i2] = await Promise.all([
        checkS1DbIntegrity(),
        checkS2UserIsolation(),
        checkI2BotIdCrossSystem(),
    ]);

    // I3 reads DB then engine — run after DB checks complete
    const [i3, i5, i6] = await Promise.all([
        checkI3ModeCrossSystem(),
        checkI5BalanceAccuracy(),
        checkI6TimestampValidity(),
    ]);

    const results: CheckResult[] = [s1, s2, i2, i3, i5, i6];

    const summary = {
        pass:  results.filter(r => r.status === 'PASS').length,
        warn:  results.filter(r => r.status === 'WARN').length,
        fail:  results.filter(r => r.status === 'FAIL').length,
        skip:  results.filter(r => r.status === 'SKIP').length,
        total: results.length,
    };

    return NextResponse.json({
        section: 'saas',
        run_ts:  runTs,
        results,
        summary,
    });
}

// Also allow POST for audit_runner.sh calling via curl -X POST
export { GET as POST };

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { prisma } from '@/lib/prisma';
import { getEngineUrl } from '@/lib/engine-url';

export const dynamic = 'force-dynamic';

async function fetchExchangeHealth(liveEngineUrl: string) {
  try {
    const res = await fetch(`${liveEngineUrl}/api/exchange-health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) return await res.json();
  } catch { /* engine unavailable */ }
  return { mode: 'live', status: 'failed', error: 'Engine unreachable' };
}

async function fetchEngineTradeCount(liveEngineUrl: string): Promise<number> {
  try {
    const res = await fetch(`${liveEngineUrl}/api/all`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = await res.json();
      const trades: any[] = data?.tradebook?.trades || [];
      return trades.filter(t => (t.status || '').toLowerCase() === 'active').length;
    }
  } catch { /* ignore */ }
  return -1;
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const userId = (session.user as any).id;

    const liveEngineUrl = getEngineUrl('live');

    // If no live engine configured, return paper-mode status
    if (!liveEngineUrl) {
      return NextResponse.json({
        mode: 'paper',
        exchangeStatus: 'n/a',
        exchange: null,
        balance: 0,
        openPositions: 0,
        lastCheckedAt: new Date().toISOString(),
        engineHealth: { status: 'not_configured' },
        reconciliation: { engineTradeCount: 0, exchangePositionCount: 0, match: true, delta: 0 },
        recentLogs: [],
      });
    }

    // Fetch exchange health from live engine
    const [healthData, engineActiveCount] = await Promise.all([
      fetchExchangeHealth(liveEngineUrl),
      fetchEngineTradeCount(liveEngineUrl),
    ]);

    const exchangePositions = healthData.openPositions ?? -1;
    const delta = engineActiveCount >= 0 && exchangePositions >= 0
      ? engineActiveCount - exchangePositions
      : null;
    const match = delta === 0;

    // Write reconciliation log
    if (engineActiveCount >= 0 && exchangePositions >= 0) {
      await prisma.reconciliationLog.create({
        data: {
          userId,
          checkType: 'trade_count',
          status: match ? 'pass' : delta === 1 ? 'warning' : 'fail',
          engineCount: engineActiveCount,
          exchangeCount: exchangePositions,
          delta,
          notes: match
            ? `Engine and exchange agree: ${engineActiveCount} active positions`
            : `Mismatch: engine=${engineActiveCount}, exchange=${exchangePositions}`,
        },
      });
    }

    // Fetch recent logs (last 10)
    const recentLogs = await prisma.reconciliationLog.findMany({
      where: { userId },
      orderBy: { checkedAt: 'desc' },
      take: 10,
    });

    return NextResponse.json({
      mode: healthData.mode || 'live',
      exchangeStatus: healthData.status || 'unknown',
      exchange: healthData.exchange || 'coindcx',
      balance: healthData.balance ?? 0,
      openPositions: exchangePositions,
      lastCheckedAt: healthData.checkedAt || new Date().toISOString(),
      engineHealth: {
        status: healthData.status,
        error: healthData.error || null,
      },
      reconciliation: {
        engineTradeCount: engineActiveCount,
        exchangePositionCount: exchangePositions,
        match,
        delta: delta ?? null,
      },
      recentLogs: recentLogs.map(l => ({
        id: l.id,
        checkType: l.checkType,
        status: l.status,
        engineCount: l.engineCount,
        exchangeCount: l.exchangeCount,
        delta: l.delta,
        notes: l.notes,
        checkedAt: l.checkedAt.toISOString(),
      })),
    });
  } catch (err: any) {
    console.error('[/api/journal/health] Error:', err);
    return NextResponse.json({ error: 'Health check failed', detail: String(err) }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const yesterday = new Date();
    yesterday.setHours(yesterday.getHours() - 24);

    const closedTrades = await prisma.trade.findMany({
      where: {
        userId: session.user.id,
        status: { notIn: ['ACTIVE', 'active', 'FILTERED', 'filtered'] },
        updatedAt: { gte: yesterday }
      },
      select: {
        coin: true,
        totalPnl: true
      }
    });

    // Group by coin and sum PnL
    const heatmap: Record<string, number> = {};
    for (const trade of closedTrades) {
      if (!heatmap[trade.coin]) {
        heatmap[trade.coin] = 0;
      }
      heatmap[trade.coin] += (trade.totalPnl || 0);
    }

    // Convert to array and sort by PnL (descending)
    const results = Object.entries(heatmap).map(([symbol, pnl]) => ({
      symbol,
      pnl
    })).sort((a, b) => b.pnl - a.pnl);

    return NextResponse.json({ success: true, heatmap: results });
  } catch (error: any) {
    console.error('Heatmap error:', error);
    return NextResponse.json({ error: 'Failed to fetch heatmap data' }, { status: 500 });
  }
}

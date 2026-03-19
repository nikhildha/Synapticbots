import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';

/**
 * DELETE /api/trades/delete
 * Deletes a single closed trade from Prisma by ID.
 * Only allows deleting CLOSED trades (safety guard against deleting active positions).
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { tradeId } = await req.json();
    if (!tradeId) {
      return NextResponse.json({ error: 'tradeId is required' }, { status: 400 });
    }

    // Fetch the trade first to verify ownership and status
    const trade = await prisma.trade.findFirst({
      where: {
        id: tradeId,
        bot: { userId: session.user.id },   // user-scoped safety
      },
      select: { id: true, status: true, coin: true },
    });

    if (!trade) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    }

    // Safety: only allow deleting closed trades
    const status = (trade.status || '').toLowerCase();
    if (status === 'active' || status === 'open') {
      return NextResponse.json(
        { error: 'Cannot delete an active trade. Close it first.' },
        { status: 400 }
      );
    }

    await prisma.trade.delete({ where: { id: tradeId } });

    return NextResponse.json({ success: true, deleted: tradeId, coin: trade.coin });
  } catch (err: any) {
    console.error('[/api/trades/delete] Error:', err);
    return NextResponse.json({ error: err.message || 'Failed to delete trade' }, { status: 500 });
  }
}

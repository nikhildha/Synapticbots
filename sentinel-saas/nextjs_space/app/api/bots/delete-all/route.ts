import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const bots = await prisma.bot.findMany({
      where: { userId: session.user.id },
      select: { id: true, isActive: true },
    });

    if (bots.length === 0) {
      return NextResponse.json({ success: true, count: 0 });
    }

    const botIds = bots.map(b => b.id);

    // Stop all active bots
    await prisma.bot.updateMany({
      where: { userId: session.user.id, isActive: true },
      data: { isActive: false, status: 'stopped', stoppedAt: new Date() },
    });

    // Close all active trades
    const activeTrades = await prisma.trade.findMany({
      where: { botId: { in: botIds }, status: { in: ['active', 'ACTIVE'] } },
    });
    for (const trade of activeTrades) {
      await prisma.trade.update({
        where: { id: trade.id },
        data: { status: 'CLOSED' },
      });
    }

    // Delete sessions then bots
    await prisma.botSession.deleteMany({ where: { botId: { in: botIds } } });
    await prisma.bot.deleteMany({ where: { userId: session.user.id } });

    console.log(`[delete-all] Deleted ${botIds.length} bots for user ${session.user.id}`);
    return NextResponse.json({ success: true, count: botIds.length });
  } catch (error: any) {
    console.error('delete-all error:', error);
    return NextResponse.json({ error: 'Failed to delete all bots' }, { status: 500 });
  }
}

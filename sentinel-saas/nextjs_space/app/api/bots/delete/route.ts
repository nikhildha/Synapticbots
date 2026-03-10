import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { botId } = await request.json();

    const bot = await prisma.bot.findUnique({
      where: { id: botId },
    });

    if (!bot || bot.userId !== session.user.id) {
      return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
    }

    // Auto-stop the bot before deletion (instead of blocking)
    if (bot.isActive) {
      await prisma.bot.update({
        where: { id: botId },
        data: { isActive: false, stoppedAt: new Date() },
      });
      console.log(`[delete] Auto-stopped bot ${botId} before deletion`);
    }

    // Delete all related sessions first (to avoid potential FK issues)
    await prisma.botSession.deleteMany({ where: { botId } });

    await prisma.bot.delete({
      where: { id: botId },
    });

    console.log(`[delete] Successfully deleted bot ${botId}`);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Bot deletion error:', error);
    return NextResponse.json({ error: 'Failed to delete bot: ' + (error?.message || 'Unknown error') }, { status: 500 });
  }
}
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// One-shot endpoint — deletes ALL trades (active + closed) for the session user.
export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const result = await prisma.trade.deleteMany({
    where: { bot: { userId: session.user.id } },
  });

  console.log(`[purge-trades] Deleted ${result.count} trades for user ${session.user.id}`);
  return NextResponse.json({ success: true, deleted: result.count });
}

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any)?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const bots = await prisma.bot.findMany({
    select: {
      id: true,
      name: true,
      isActive: true,
      exchange: true,
      startedAt: true,
      config: { select: { mode: true } },
      user: { select: { email: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });

  return NextResponse.json(bots);
}

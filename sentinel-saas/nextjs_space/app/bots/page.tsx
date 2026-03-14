import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';
import { BotsClient } from './bots-client';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Cockpit — Synaptic',
  description: 'Deploy and manage your automated HMM trading bots',
};

export default async function BotsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect('/login');
  }

  try {
    const bots = await prisma.bot.findMany({
      where: { userId: session.user.id },
      include: {
        config: true,  // full config to get brainType
        _count: {
          select: { trades: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

  return (
    <BotsClient
      bots={bots.map((bot) => ({
        id: bot.id,
        name: bot.name,
        exchange: bot.exchange,
        status: bot.status,
        isActive: bot?.isActive ?? false,
        startedAt: bot?.startedAt ?? null,
        config: bot?.config ? {
          mode: bot.config.mode,
          maxTrades: bot.config.maxOpenTrades,
          capitalPerTrade: bot.config.capitalPerTrade,
          brainType: (bot.config as any)?.brainType ?? 'adaptive',
        } : null,
        _count: {
          trades: bot?._count?.trades ?? 0,
        },
      }))}
      />
    );
  } catch (error) {
    console.error('Cockpit data error:', error);
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg)]">
        <div className="text-center space-y-4">
          <h2 className="text-2xl font-bold text-[var(--color-danger)]">Error Loading Cockpit</h2>
          <p className="text-[var(--color-text-secondary)]">Please try refreshing the page</p>
          <a
            href="/api/auth/signout?callbackUrl=/login"
            className="inline-block mt-4 px-4 py-2 bg-red-500/20 border border-red-400/40 text-red-300 rounded-lg text-sm hover:bg-red-500/30 transition-colors"
          >
            🚪 Sign Out &amp; Re-login
          </a>
        </div>
      </div>
    );
  }
}
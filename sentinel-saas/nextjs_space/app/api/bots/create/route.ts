import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';
import { checkSubscription, TIER_LIMITS, Tier } from '@/lib/subscription';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // ─── Subscription & Trial Check ───────────────────────────
    const subStatus = await checkSubscription(session.user.id);
    if (!subStatus.isActive) {
      return NextResponse.json(
        { error: subStatus.message, expired: true },
        { status: 403 }
      );
    }

    const { name, exchange, mode, maxTrades, capitalPerTrade, deployments = [] } = await request.json();

    // Determine basic validation
    if (!exchange) {
      return NextResponse.json({ error: 'Missing required fields: exchange is required.' }, { status: 400 });
    }

    // Use frontend deployments or fallback to single engine
    const finalDeployments = deployments.length > 0 ? deployments : [{
      name: name || 'Synaptic Engine',
      segment: 'ALL',
      coinList: []
    }];

    // Check bot count limits for the user's tier
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      include: { subscription: true, bots: true },
    });

    const limits = TIER_LIMITS[subStatus.tier];
    const maxBots = limits.maxBots;
    
    // Hard check: Ensure not exceeding limits
    if (user && (user.bots.length + finalDeployments.length) > maxBots) {
      return NextResponse.json(
        { error: `Bot limit reached. Max allowed is ${maxBots}.` },
        { status: 403 }
      );
    }

    // Determine coin scan limit from subscription
    const coinScansLimit = user?.subscription?.coinScans || 5;

    const botMode = mode || 'paper';
    const botMaxTrades = maxTrades || 25;
    const botCapitalPerTrade = capitalPerTrade || 100;

    // Use Prisma transaction to create all requested bots safely
    const createdBots = await prisma.$transaction(
      finalDeployments.map((dep: any) => {
        // Enforce the coin scans limit if a custom list is provided, otherwise default to top 5
        const defaultCoins = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'DOGEUSDT'];
        const _coins = dep.coinList && Array.isArray(dep.coinList) && dep.coinList.length > 0
          ? dep.coinList
          : defaultCoins;
        const finalizedCoins = _coins.slice(0, coinScansLimit);

        return prisma.bot.create({
          data: {
            userId: session.user.id,
            name: dep.name || name || `Bot - ${dep.segment}`,
            exchange,
            status: 'stopped',
            isActive: false,
            startedAt: new Date(),  // Set on creation so Tradebook sync never skips this bot
            config: {
              create: {
                mode: botMode,
                capitalPerTrade: botCapitalPerTrade,
                maxOpenTrades: botMaxTrades,
                slMultiplier: 0.8,
                tpMultiplier: 1.0,
                maxLossPct: -15,
                multiTargetEnabled: true,
                t1Multiplier: 0.5,
                t2Multiplier: 1.0,
                t3Multiplier: 1.5,
                t1BookPct: 0.25,
                t2BookPct: 0.50,
                brainType: dep.segment === 'ALL' ? 'adaptive' : 'specialist',
                segment: dep.segment || 'ALL',
                coinList: finalizedCoins,
              },
            },
            state: {
              create: {
                engineStatus: 'idle',
              },
            },
          },
          include: {
            config: true,
            state: true,
          },
        });
      })
    );

    return NextResponse.json({ success: true, count: createdBots.length, bots: createdBots });
  } catch (error: any) {
    console.error('Bot creation error:', error);
    return NextResponse.json({ error: 'Failed to create bot' }, { status: 500 });
  }
}
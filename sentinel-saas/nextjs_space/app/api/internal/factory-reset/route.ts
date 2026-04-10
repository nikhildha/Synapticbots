import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        // Enforce a hardcoded API key for extreme safety so no one accidentally hits this in prod
        const { searchParams } = new URL(request.url);
        if (searchParams.get('key') !== 'synaptic-terminal-reset-999') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log("🔥 [FACTORY RESET] Initiating remote DB wipe...");

        await prisma.partialBooking.deleteMany({});
        await prisma.trade.deleteMany({});
        await prisma.botState.deleteMany({});
        await prisma.botConfig.deleteMany({});
        await prisma.botSession.deleteMany({});
        await prisma.bot.deleteMany({});

        const users = await prisma.user.findMany();
        let botsCreated = 0;

        const templates = [
            { name: "Sentinel Titan (Slow)" },
            { name: "Sentinel Vanguard (Moderate)" },
            { name: "Sentinel Rogue (Aggressive)" },
        ];

        for (const user of users) {
            for (const t of templates) {
                const bot = await prisma.bot.create({
                    data: {
                        userId: user.id,
                        name: t.name,
                        exchange: "binance", // Defaulting to binance
                        status: "stopped",
                        isActive: true, // Mark active so engine picks it up
                    }
                });

                await prisma.botConfig.create({
                    data: {
                        botId: bot.id,
                        mode: "paper",
                        capitalPerTrade: 1000,
                        maxOpenTrades: 5,
                        slMultiplier: 0.8,
                        tpMultiplier: 1.0,
                        maxLossPct: -15,
                        brainType: "adaptive",
                        segment: "ALL",
                        coinList: "[]"
                    }
                });

                await prisma.botState.create({
                    data: {
                        botId: bot.id,
                        engineStatus: "idle",
                        cycleCount: 0
                    }
                });
                botsCreated++;
            }
        }

        return NextResponse.json({
            success: true,
            message: `Wiped all trade histories. Created ${botsCreated} new risk-tier bots for ${users.length} users.`,
        });
    } catch (error: any) {
        console.error('[FACTORY RESET] Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

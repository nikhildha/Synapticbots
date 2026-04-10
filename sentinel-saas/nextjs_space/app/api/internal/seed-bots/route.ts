import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        if (searchParams.get('key') !== 'synaptic-seed-bots-999') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const users = await prisma.user.findMany();
        let botsCreated = 0;
        let botsSkipped = 0;

        const templates = [
            { name: "Titan (Slow)" },
            { name: "Vanguard (Moderate)" },
            { name: "Rogue (Aggressive)" },
        ];

        for (const user of users) {
            for (const t of templates) {
                // Check if this bot already exists for this user — NEVER duplicate
                const existing = await prisma.bot.findFirst({
                    where: { userId: user.id, name: t.name }
                });

                if (existing) {
                    botsSkipped++;
                    continue;
                }

                // Create Bot
                const bot = await prisma.bot.create({
                    data: {
                        userId: user.id,
                        name: t.name,
                        exchange: "coindcx",
                        status: "stopped",
                        isActive: true,
                    }
                });

                // Create BotConfig
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

                // Create BotState
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
            message: `Done! Created ${botsCreated} new bots. Skipped ${botsSkipped} that already existed.`,
            users: users.length,
            botsCreated,
            botsSkipped
        });
    } catch (error: any) {
        console.error('[SEED BOTS] Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

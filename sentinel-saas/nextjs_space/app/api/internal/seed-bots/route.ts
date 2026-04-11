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
            // ── Track A: HMM Tier Bots ──────────────────────────────────────
            { name: "Titan (Slow)",          mode: "paper", maxTrades: 5,  capital: 100, segment: "ALL" },
            { name: "Vanguard (Moderate)",   mode: "paper", maxTrades: 5,  capital: 100, segment: "ALL" },
            { name: "Rogue (Aggressive)",    mode: "paper", maxTrades: 5,  capital: 100, segment: "ALL" },

            // ── Track B: Independent Strategy Bots (paper + live) ───────────
            { name: "Pyxis (Systematic) Paper", mode: "paper", maxTrades: 3, capital: 100, segment: "ALL" },
            { name: "Pyxis (Systematic) Live",  mode: "live",  maxTrades: 3, capital: 100, segment: "ALL" },
            { name: "Axiom (Momentum) Paper",   mode: "paper", maxTrades: 5, capital: 100, segment: "ALL" },
            { name: "Axiom (Momentum) Live",    mode: "live",  maxTrades: 5, capital: 100, segment: "ALL" },
            { name: "Ratio (Stat Arb) Paper",   mode: "paper", maxTrades: 4, capital: 100, segment: "ALL" },
            { name: "Ratio (Stat Arb) Live",    mode: "live",  maxTrades: 4, capital: 100, segment: "ALL" },
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

                // Create BotConfig — use per-template settings
                await prisma.botConfig.create({
                    data: {
                        botId: bot.id,
                        mode: (t as any).mode ?? "paper",
                        capitalPerTrade: (t as any).capital ?? 100,
                        maxOpenTrades: (t as any).maxTrades ?? 5,
                        slMultiplier: 0.8,
                        tpMultiplier: 1.0,
                        maxLossPct: -15,
                        brainType: "adaptive",
                        segment: (t as any).segment ?? "ALL",
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

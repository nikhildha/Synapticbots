import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const mode = searchParams.get('mode') || 'paper'; // 'paper' or 'live'
        
        // Ensure secret matches
        const auth = request.headers.get('Authorization');
        const secret = process.env.ENGINE_API_SECRET;
        
        if (secret && auth !== `Bearer ${secret}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Find all active bots for all users
        const activeBots = await prisma.bot.findMany({
            where: {
                isActive: true,
            },
        });

        // Filter by mode
        const botsForMode = activeBots.filter((bot: any) => {
            const config = typeof bot.config === 'object' && bot.config !== null ? bot.config : {};
            const botMode = (config as any).mode?.toLowerCase() || 'paper';
            return mode === 'live' ? botMode.includes('live') : botMode.includes('paper');
        });

        // Format for Python engine
        const engineBots = botsForMode.map((bot: any) => {
            const config = typeof bot.config === 'object' && bot.config !== null ? bot.config : {};
            return {
                bot_id: bot.id,
                user_id: bot.userId,
                bot_name: bot.name,
                brain_type: (config as any).brainType || 'adaptive',
                segment_filter: (config as any).segment || 'ALL',
                capital_per_trade: (config as any).capitalPerTrade ?? 100,
                max_loss_pct: (config as any).maxLossPct ?? -15,
            };
        });

        return NextResponse.json({ bots: engineBots });
    } catch (error) {
        console.error('[internal/active-bots] GET Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

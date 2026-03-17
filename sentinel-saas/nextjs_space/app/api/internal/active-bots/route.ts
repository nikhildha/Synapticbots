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

        // Find all active bots for all users — include config for segment/capital/mode
        const activeBots = await prisma.bot.findMany({
            where: { isActive: true },
            include: { config: true },
        });

        // Filter by mode
        const botsForMode = activeBots.filter((bot: any) => {
            const botMode = (bot.config?.mode || '').toLowerCase();
            return mode === 'live' ? botMode.includes('live') : !botMode.includes('live');
        });

        // Format for Python engine deploy loop
        const engineBots = botsForMode.map((bot: any) => ({
            bot_id: bot.id,
            user_id: bot.userId,
            bot_name: bot.name,
            mode: (bot.config?.mode || 'paper').toLowerCase().includes('live') ? 'live' : 'paper',
            brain_type: bot.config?.brainType || 'adaptive',
            segment_filter: bot.config?.segment || 'ALL',
            capital_per_trade: bot.config?.capitalPerTrade ?? 100,
            max_loss_pct: bot.config?.maxLossPct ?? -15,
        }));

        return NextResponse.json({ bots: engineBots });
    } catch (error) {
        console.error('[internal/active-bots] GET Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

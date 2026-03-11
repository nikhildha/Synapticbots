import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';

export interface Notification {
    id: string;
    type: 'trade_open' | 'trade_close' | 'bot_start' | 'bot_stop' | 'sl_hit' | 'tp_hit' | 'engine_alert';
    title: string;
    body: string;
    time: string;
    read: boolean;
    meta?: Record<string, any>;
}

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return NextResponse.json({ notifications: [] });

    const userId = session.user.id;

    try {
        // Pull bots for this user
        const bots = await prisma.bot.findMany({
            where: { userId },
            orderBy: { updatedAt: 'desc' },
            take: 10,
            select: { id: true, name: true, status: true, updatedAt: true },
        });

        const botIds = bots.map(b => b.id);

        // Pull latest trades via bot relation
        const trades = await prisma.trade.findMany({
            where: { botId: { in: botIds } },
            orderBy: { createdAt: 'desc' },
            take: 30,
            select: {
                id: true,
                coin: true,
                position: true,
                status: true,
                entryPrice: true,
                exitPrice: true,
                totalPnl: true,
                totalPnlPercent: true,
                createdAt: true,
                updatedAt: true,
                mode: true,
            },
        });

        const notifications: Notification[] = [];

        for (const t of trades) {
            const mode = t.mode === 'PAPER' ? '📄' : '💰';
            const dir = (t.position || '').toUpperCase();
            const sym = (t.coin || '').replace('USDT', '');
            const status = (t.status || '').toUpperCase();

            if (status === 'OPEN') {
                notifications.push({
                    id: `open-${t.id}`,
                    type: 'trade_open',
                    title: `${mode} Trade Opened · ${sym}`,
                    body: `${dir} @ $${Number(t.entryPrice || 0).toFixed(2)}`,
                    time: t.createdAt.toISOString(),
                    read: false,
                    meta: { coin: t.coin, position: t.position },
                });
            } else if (status === 'CLOSED') {
                const pnl = Number(t.totalPnl || 0);
                const pct = Number(t.totalPnlPercent || 0).toFixed(1);
                const pnlStr = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
                notifications.push({
                    id: `close-${t.id}`,
                    type: pnl >= 0 ? 'tp_hit' : 'sl_hit',
                    title: `${pnl >= 0 ? '✅' : '🔴'} Trade Closed · ${sym}`,
                    body: `${dir} closed @ $${Number(t.exitPrice || 0).toFixed(2)} · PnL ${pnlStr} (${pct}%)`,
                    time: t.updatedAt.toISOString(),
                    read: false,
                    meta: { pnl, coin: t.coin },
                });
            }
        }

        // Bot status notifications
        for (const b of bots) {
            const isRunning = (b.status || '').toUpperCase() === 'RUNNING';
            notifications.push({
                id: `bot-${b.id}`,
                type: isRunning ? 'bot_start' : 'bot_stop',
                title: `${isRunning ? '🟢' : '⚫'} ${b.name}`,
                body: isRunning ? 'Bot is active and scanning markets' : 'Bot is stopped',
                time: b.updatedAt.toISOString(),
                read: false,
            });
        }

        // Sort newest first
        notifications.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

        return NextResponse.json({ notifications: notifications.slice(0, 20) });
    } catch (e) {
        console.error('[notifications]', e);
        return NextResponse.json({ notifications: [] });
    }
}

import { NextResponse, NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

async function requireAdmin() {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any).role !== 'admin') return null;
    return session;
}

export async function GET() {
    try {
        if (!await requireAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

        const users = await prisma.user.findMany({
            select: {
                id: true, email: true, name: true, role: true, phone: true, referralCode: true, createdAt: true,
                subscription: { select: { tier: true, status: true, coinScans: true } },
            },
            orderBy: { createdAt: 'desc' },
        });

        const usersWithCounts = await Promise.all(
            users.map(async (user: any) => {
                const botCount = await prisma.bot.count({ where: { userId: user.id } });
                const tradeCount = await prisma.trade.count({ where: { bot: { userId: user.id } } });
                return { ...user, _count: { bots: botCount, trades: tradeCount } };
            })
        );

        return NextResponse.json(usersWithCounts);
    } catch (error: any) {
        return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
}

export async function PUT(req: NextRequest) {
    try {
        if (!await requireAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

        const { userId, name, role, tier, status, coinScans } = await req.json();
        if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

        // Update user fields
        const updateData: any = {};
        if (name !== undefined) updateData.name = name;
        // M3 FIX: validate role against allowlist
        if (role !== undefined) {
            const VALID_ROLES = ['user', 'admin'];
            if (!VALID_ROLES.includes(role)) {
                return NextResponse.json({ error: `Invalid role: ${role}. Must be one of: ${VALID_ROLES.join(', ')}` }, { status: 400 });
            }
            updateData.role = role;
        }

        await prisma.user.update({ where: { id: userId }, data: updateData });

        // Update subscription if tier/status/coinScans provided
        if (tier !== undefined || status !== undefined || coinScans !== undefined) {
            const subData: any = {};
            if (tier !== undefined) subData.tier = tier;
            if (status !== undefined) subData.status = status;
            if (coinScans !== undefined) subData.coinScans = coinScans;

            await prisma.subscription.upsert({
                where: { userId },
                update: subData,
                create: { userId, tier: tier || 'free', status: status || 'trial', coinScans: coinScans || 0, ...subData },
            });
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest) {
    try {
        if (!await requireAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

        const { userId } = await req.json();
        if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

        // Don't allow deleting yourself
        const session = await getServerSession(authOptions);
        if ((session?.user as any)?.id === userId) {
            return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 });
        }

        // Cascade delete: subscription, bots, trades, api keys, sessions, accounts
        await prisma.user.delete({ where: { id: userId } });

        return NextResponse.json({ success: true });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

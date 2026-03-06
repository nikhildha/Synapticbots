import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { clearUserTrades } from '@/lib/sync-engine-trades';
import * as fs from 'fs';
import * as path from 'path';

export const dynamic = 'force-dynamic';

const ENGINE_API_URL = process.env.ENGINE_API_URL;
const DATA_DIR = path.resolve(process.cwd(), '..', '..', 'data');

export async function POST() {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const userId = (session.user as any)?.id;
        const isAdmin = (session.user as any)?.role === 'admin';

        // Non-admin: clear only their own Prisma trades (isolated)
        if (!isAdmin) {
            const deletedCount = await clearUserTrades(userId);
            return NextResponse.json({
                success: true,
                message: `Cleared ${deletedCount} trades`,
                deletedCount,
            });
        }

        // Admin: clear global engine tradebook.json + engine API
        let deletedCount = 0;

        const tbPath = path.join(DATA_DIR, 'tradebook.json');
        if (fs.existsSync(tbPath)) {
            try {
                const tbData = JSON.parse(fs.readFileSync(tbPath, 'utf-8'));
                deletedCount = (tbData.trades || []).length;
                const emptyBook = {
                    trades: [],
                    summary: {
                        total_trades: 0,
                        active_trades: 0,
                        closed_trades: 0,
                        total_pnl: 0,
                        win_rate: 0,
                        best_trade: 0,
                        worst_trade: 0,
                    },
                };
                fs.writeFileSync(tbPath, JSON.stringify(emptyBook, null, 2));
            } catch (err) {
                console.error('[reset-trades] Error clearing tradebook.json:', err);
            }
        }

        if (ENGINE_API_URL) {
            try {
                await fetch(`${ENGINE_API_URL}/api/reset-trades`, {
                    method: 'POST',
                    signal: AbortSignal.timeout(5000),
                });
            } catch { /* best effort */ }
        }

        return NextResponse.json({
            success: true,
            message: `Cleared ${deletedCount} trades`,
            deletedCount,
        });
    } catch (error) {
        console.error('[reset-trades] Error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

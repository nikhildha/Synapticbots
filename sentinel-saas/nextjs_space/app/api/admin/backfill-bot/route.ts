/**
 * POST /api/admin/backfill-bot
 *
 * Admin-only endpoint. Re-links historical DB trades to the correct Bot record
 * using the `bot_id` field now stamped by the Python engine on every trade.
 *
 * Run once after deploying ENGINE_BOT_ID to Railway.
 *
 * Returns: { backfilled: N, skipped: M, errors: K }
 */
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';
import { getEngineUrl } from '@/lib/engine-url';

export const dynamic = 'force-dynamic';

const ENGINE_API_URL = getEngineUrl('live');

async function fetchEngineTrades(): Promise<any[]> {
    if (!ENGINE_API_URL) return [];
    try {
        const res = await fetch(`${ENGINE_API_URL}/api/all`, {
            cache: 'no-store',
            signal: AbortSignal.timeout(15000),
        });
        if (res.ok) {
            const data = await res.json();
            return data?.tradebook?.trades || [];
        }
    } catch (err) {
        console.error('[backfill-bot] Engine fetch failed:', err);
    }
    return [];
}

async function requireAdmin() {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any).role !== 'admin') return null;
    return session;
}

export async function POST() {
    try {
        if (!await requireAdmin()) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }

        const engineTrades = await fetchEngineTrades();
        if (engineTrades.length === 0) {
            return NextResponse.json({
                message: 'No engine trades found — is ENGINE_API_URL set and is the engine running?',
                backfilled: 0,
                skipped: 0,
                errors: 0,
            });
        }

        let backfilled = 0;
        let skipped = 0;
        let errors = 0;

        for (const t of engineTrades) {
            // Only process trades that have the new bot_id field
            if (!t.bot_id || !t.trade_id) {
                skipped++;
                continue;
            }

            const correctBotId = String(t.bot_id);
            const tradeId = String(t.trade_id);
            const newKey = `engine_${tradeId}_${correctBotId}`;

            try {
                // Find any existing DB record for this engine trade that has the WRONG botId
                const existing = await prisma.trade.findFirst({
                    where: {
                        exchangeOrderId: tradeId,
                        NOT: { botId: correctBotId },
                    },
                });

                if (!existing) {
                    // Either already correct, or this trade isn't in DB yet
                    skipped++;
                    continue;
                }

                // Verify the target bot exists before re-linking
                const targetBot = await prisma.bot.findUnique({
                    where: { id: correctBotId },
                    select: { id: true },
                });

                if (!targetBot) {
                    console.warn(`[backfill-bot] Bot ${correctBotId} not found in DB — skipping trade ${tradeId}`);
                    skipped++;
                    continue;
                }

                // Re-link: delete old record (wrong botId), create new with correct botId.
                // Must be a transaction to avoid leaving DB in inconsistent state.
                await prisma.$transaction(async (tx) => {
                    const { id: _oldId, ...data } = existing;
                    await tx.trade.delete({ where: { id: existing.id } });
                    await tx.trade.create({
                        data: {
                            ...data,
                            id: newKey,
                            botId: correctBotId,
                        },
                    });
                });

                backfilled++;
                console.log(`[backfill-bot] Re-linked trade ${tradeId}: ${existing.botId} → ${correctBotId}`);

            } catch (err) {
                console.error(`[backfill-bot] Error processing trade ${tradeId}:`, err);
                errors++;
            }
        }

        return NextResponse.json({
            message: `Backfill complete.`,
            backfilled,
            skipped,
            errors,
            total_engine_trades: engineTrades.length,
        });

    } catch (error: any) {
        console.error('[backfill-bot] Fatal error:', error);
        return NextResponse.json({ error: 'Backfill failed', detail: String(error) }, { status: 500 });
    }
}

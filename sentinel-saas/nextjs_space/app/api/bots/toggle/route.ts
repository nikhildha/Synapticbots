import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';
import { checkSubscription, hasFeature } from '@/lib/subscription';
import { createBotSession, closeBotSession } from '@/lib/bot-session';
import { getEngineUrl } from '@/lib/engine-url';

export const dynamic = 'force-dynamic';

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:5000';

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { botId, isActive } = await request.json();

    if (!botId) {
      return NextResponse.json({ error: 'botId required' }, { status: 400 });
    }

    // ─── Block starting bots if subscription expired (stopping is always OK) ──
    if (isActive) {
      const subStatus = await checkSubscription(session.user.id);
      if (!subStatus.isActive) {
        return NextResponse.json(
          { error: subStatus.message, expired: true },
          { status: 403 }
        );
      }
    }

    // C5 FIX: Block free-tier users from starting LIVE bots
    if (isActive) {
      const bot = await prisma.bot.findFirst({
        where: { id: botId, userId: session.user.id },
        include: { config: true },
      });
      const requestedMode = (bot?.config?.mode ?? 'paper').toLowerCase();
      if (requestedMode === 'live') {
        const canTradeLive = await hasFeature(session.user.id, 'liveTrading');
        if (!canTradeLive) {
          return NextResponse.json(
            { error: 'Live trading requires a Pro or Ultra subscription. Upgrade to continue.' },
            { status: 403 }
          );
        }
      }
    }

    // Verify ownership (include config for mode)
    const bot = await prisma.bot.findFirst({
      where: { id: botId, userId: session.user.id },
      include: { config: true },
    });

    if (!bot) {
      return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
    }

    // ─── Session lifecycle ────────────────────────────────────────────────────
    if (isActive) {
      // Starting: open a new session
      try {
        await createBotSession(botId, bot.config?.mode ?? 'paper');
      } catch (err) {
        console.error('[toggle] createBotSession failed:', err);
      }
    } else {
      // Stopping: close active session
      try {
        await closeBotSession(botId);
      } catch (err) {
        console.error('[toggle] closeBotSession failed:', err);
      }

      // ─── LIVE MODE STOP: close CoinDCX positions FIRST ────────────
      // C4 FIX: case-insensitive mode check for live exit (also handles 'live-coindcx')
      const botMode = (bot.config?.mode ?? 'paper').toLowerCase();
      const engineUrl = getEngineUrl(botMode.startsWith('live') ? 'live' : 'paper');

      // T2 FIX: Track whether live exchange close succeeded before closing Prisma trades.
      // If CoinDCX positions couldn't be closed, leave Prisma trades ACTIVE so they remain
      // visible in UI. User must close manually on CoinDCX, then run /api/trades/sync.
      let liveExitOk = !botMode.startsWith('live'); // true for paper (no exchange close needed)

      if (botMode.startsWith('live') && engineUrl) {
        try {
          const exitRes = await fetch(`${engineUrl}/api/exit-all-live`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(15000),
          });
          const exitData = await exitRes.json();
          console.log(
            `[toggle] exit-all-live: ${exitData.closed_exchange?.length ?? 0} exchange positions closed, ` +
            `${exitData.closed_tradebook?.length ?? 0} tradebook entries closed`
          );
          if (exitData.errors?.length > 0) {
            console.warn('[toggle] exit-all-live partial errors — Prisma trades will NOT be auto-closed:', exitData.errors);
          } else {
            liveExitOk = true;
          }
        } catch (err) {
          console.error('[toggle] exit-all-live failed — Prisma trades will NOT be auto-closed:', err);
        }
      }

      // THEN close Prisma trades — only if exchange close succeeded (or paper mode)
      try {
        const activeTrades = await prisma.trade.findMany({
          where: { botId, status: { in: ['active', 'ACTIVE', 'Active'] } },
        });
        if (!liveExitOk && activeTrades.length > 0) {
          // T2 FIX: Leave DB trades active — user must close CoinDCX positions manually
          // then use /api/trades/sync to reconcile.
          console.warn(
            `[toggle] T2 WARN: ${activeTrades.length} Prisma trade(s) left ACTIVE — ` +
            `CoinDCX close failed. Close manually on exchange, then sync.`
          );
        } else {
          for (const trade of activeTrades) {
            const currentPrice = trade.currentPrice || trade.entryPrice;
            const isLong = trade.position === 'long';
            const priceDiff = isLong ? (currentPrice - trade.entryPrice) : (trade.entryPrice - currentPrice);
            const rawPnl = priceDiff / trade.entryPrice * trade.leverage * trade.capital;
            const leveragedPnl = Math.round(rawPnl * 10000) / 10000;
            const pnlPct = trade.capital > 0 ? Math.round(leveragedPnl / trade.capital * 100 * 100) / 100 : 0;
            await prisma.trade.update({
              where: { id: trade.id },
              data: {
                status: 'closed',
                exitPrice: currentPrice,
                exitTime: new Date(),
                exitReason: 'BOT_STOPPED',
                totalPnl: leveragedPnl,
                totalPnlPercent: pnlPct,
                activePnl: 0,
                activePnlPercent: 0,
              },
            });
          }
          if (activeTrades.length > 0) {
            console.log(`[toggle] Exited ${activeTrades.length} active trades for bot ${botId}`);
          }
        }
      } catch (err) {
        console.error('[toggle] Exit trades on stop failed:', err);
      }

      // Revert engine to paper mode (best-effort, don't block)
      if (engineUrl) {
        fetch(`${engineUrl}/api/set-mode`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'paper', exchange: '' }),
          signal: AbortSignal.timeout(3000),
        }).catch(() => { });
      }
    }

    // ─── Live mode: switch engine mode + validate exchange pre-flight ────────
    // C4 FIX: case-insensitive mode check for engine routing
    const botMode = (bot.config?.mode ?? 'paper').toLowerCase();
    // T4 FIX: startsWith('live') handles 'live-coindcx' and other live variants
    const engineUrl = getEngineUrl(botMode.startsWith('live') ? 'live' : 'paper');
    if (engineUrl && isActive) {
      // ──── CRITICAL: Push bot_id to engine for data isolation ────────────
      // This ensures ALL trades opened by the engine are stamped with
      // this user's botId — preventing cross-user data leakage.
      try {
        await fetch(`${engineUrl}/api/set-bot-id`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bot_id: botId,
            user_id: session.user.id,
          }),
          signal: AbortSignal.timeout(5000),
        });
        console.log(`[toggle] set-bot-id: pushed botId=${botId} to engine`);
      } catch (e) {
        console.warn('[toggle] set-bot-id failed (continuing):', e);
      }

      // ──── Push per-bot risk config (maxLossPct, capitalPerTrade) to engine ──
      try {
        await fetch(`${engineUrl}/api/set-config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            max_loss_pct: bot.config?.maxLossPct ?? -15,
            capital_per_trade: bot.config?.capitalPerTrade ?? 100,
          }),
          signal: AbortSignal.timeout(5000),
        });
        console.log(`[toggle] set-config: maxLossPct=${bot.config?.maxLossPct ?? -15}, capitalPerTrade=${bot.config?.capitalPerTrade ?? 100}`);
      } catch (e) {
        console.warn('[toggle] set-config failed (continuing):', e);
      }

      if (botMode.startsWith('live')) {
        const exchange = bot.exchange || 'coindcx';
        // Switch engine to live mode
        await fetch(`${engineUrl}/api/set-mode`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'live', exchange }),
          signal: AbortSignal.timeout(5000),
        }).catch(e => console.warn('[toggle] set-mode failed:', e));

        // Validate exchange connectivity — block start if keys are broken
        try {
          const vRes = await fetch(
            `${engineUrl}/api/validate-exchange?exchange=${encodeURIComponent(exchange)}`,
            { signal: AbortSignal.timeout(10000) }
          );
          const vData = await vRes.json();
          if (!vData.valid) {
            return NextResponse.json(
              { error: `${exchange} connection failed — check API keys in Railway env vars`, detail: vData.error },
              { status: 400 }
            );
          }
          console.log(`[toggle] ${exchange} validated — balance: ${vData.balance} ${vData.currency ?? ''}`);
        } catch (err) {
          console.warn('[toggle] validate-exchange failed (continuing):', err);
        }
      }
    }

    // Call the Python orchestrator to start/stop the engine worker
    const orchEndpoint = isActive ? 'start' : 'stop';
    try {
      const orchResponse = await fetch(`${ORCHESTRATOR_URL}/api/bots/${orchEndpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId }),
      });

      if (!orchResponse.ok) {
        const err = await orchResponse.json().catch(() => ({}));
        console.error('Orchestrator error:', err);
      }
    } catch (orchError) {
      console.error('Orchestrator unreachable:', orchError);
    }

    // Update bot status in database
    // BUG-18: Don't reset startedAt on restart — only set on first start
    await prisma.bot.update({
      where: { id: botId },
      data: {
        isActive,
        status: isActive ? 'running' : 'stopped',
        ...(isActive && !bot.startedAt ? { startedAt: new Date() } : {}),
        ...(!isActive ? { stoppedAt: new Date() } : {}),
      },
    });

    return NextResponse.json({ success: true, isActive });
  } catch (error: any) {
    console.error('Bot toggle error:', error);
    return NextResponse.json({ error: 'Failed to toggle bot' }, { status: 500 });
  }
}
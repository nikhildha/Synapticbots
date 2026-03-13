/**
 * trade-utils.ts
 * Shared trade PnL calculation logic — extracted from toggle/kill/admin-bots/exit-all.
 * Single source of truth to prevent calculation drift across routes.
 */

export interface TradePnlInput {
  position: string;          // 'long' | 'short'
  entryPrice: number;
  currentPrice: number | null;
  capital: number;
  leverage: number;
  quantity?: number | null;
}

export interface TradePnlResult {
  pnl: number;       // net realized PnL in USDT (rounded to 4 dp)
  pnlPct: number;    // PnL as % of capital (rounded to 2 dp)
  closePrice: number;
}

/**
 * Compute closing PnL for a trade that is being force-closed at currentPrice.
 * Uses quantity-based formula (matches how the engine records fills):
 *   pnl = priceDiff × quantity
 * Quantity defaults to (capital × leverage / entryPrice) if not stored.
 */
export function computeClosePnl(trade: TradePnlInput): TradePnlResult {
  const closePrice = trade.currentPrice ?? trade.entryPrice;
  const isLong = trade.position === 'long' || trade.position === 'LONG';
  const priceDiff = isLong ? (closePrice - trade.entryPrice) : (trade.entryPrice - closePrice);

  // Use stored quantity if available, otherwise derive from capital × leverage / entry
  const qty = trade.quantity && trade.quantity > 0
    ? trade.quantity
    : (trade.capital * trade.leverage) / trade.entryPrice;

  const rawPnl = priceDiff * qty;
  const pnl = Math.round(rawPnl * 10000) / 10000;
  const pnlPct = trade.capital > 0
    ? Math.round((pnl / trade.capital) * 100 * 100) / 100
    : 0;

  return { pnl, pnlPct, closePrice };
}

/**
 * Build the Prisma update data for closing a trade at current price.
 */
export function buildCloseData(trade: TradePnlInput, exitReason: string) {
  const { pnl, pnlPct, closePrice } = computeClosePnl(trade);
  return {
    status: 'closed' as const,
    exitPrice: closePrice,
    exitTime: new Date(),
    exitReason,
    totalPnl: pnl,
    totalPnlPercent: pnlPct,
    activePnl: 0,
    activePnlPercent: 0,
  };
}

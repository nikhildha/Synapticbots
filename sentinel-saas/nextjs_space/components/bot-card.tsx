'use client';

import { Bot, Play, Square, TrendingUp, TrendingDown } from 'lucide-react';
import { motion } from 'framer-motion';

interface BotCardProps {
  bot: {
    id: string;
    name: string;
    exchange: string;
    status: string;
    isActive: boolean;
    startedAt?: Date | null;
    _count?: {
      trades: number;
    };
  };
  onToggle: (botId: string, currentStatus: boolean) => void;
  liveTradeCount?: number;
  trades?: any[];
}

export function BotCard({ bot, onToggle, liveTradeCount, trades = [] }: BotCardProps) {
  const isRunning = bot?.isActive ?? false;

  // Calculate ROI from trades
  const totalPnl = trades.reduce((sum: number, t: any) => sum + (parseFloat(t.pnl) || 0), 0);
  const totalCapital = trades.reduce((sum: number, t: any) => sum + (parseFloat(t.capital) || parseFloat(t.entry_price) * parseFloat(t.quantity) || 0), 0);
  const roiPct = totalCapital > 0 ? (totalPnl / totalCapital) * 100 : 0;

  const pnlColor = totalPnl >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
  const pnlSign = totalPnl >= 0 ? '+' : '';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="card-gradient rounded-xl p-4 glow-hover"
    >
      <div className="flex items-center justify-between gap-4">
        {/* Left: Icon + Name + Exchange */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2.5 bg-[var(--color-primary)]/20 rounded-lg flex-shrink-0">
            <Bot className="w-5 h-5 text-[var(--color-primary)]" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-semibold truncate">{bot?.name ?? 'Bot'}</h3>
            <p className="text-xs text-[var(--color-text-secondary)]">
              {bot?.exchange ?? 'Unknown'}
            </p>
          </div>
        </div>

        {/* Middle: Status + Active Trades */}
        <div className="flex items-center gap-6">
          <div className="text-center">
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${isRunning
                ? 'bg-[var(--color-success)]/20 text-[var(--color-success)]'
                : 'bg-[var(--color-text-secondary)]/20 text-[var(--color-text-secondary)]'
                }`}
            >
              {isRunning ? 'Running' : 'Stopped'}
            </span>
          </div>
          <div className="text-center">
            <div className="text-sm font-semibold">{liveTradeCount ?? bot?._count?.trades ?? 0}</div>
            <div className="text-[10px] text-[var(--color-text-secondary)]">Trades</div>
          </div>
        </div>

        {/* Right: ROI + PnL + Toggle */}
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="flex items-baseline gap-1.5 justify-end">
              <span className="font-bold text-base" style={{ color: pnlColor }}>
                {pnlSign}${Math.abs(totalPnl).toFixed(2)}
              </span>
              <span className="text-xs font-medium" style={{ color: pnlColor }}>
                {pnlSign}{roiPct.toFixed(1)}%
              </span>
            </div>
            <div className="text-[10px] text-[var(--color-text-secondary)]">ROI</div>
          </div>
          <button
            onClick={() => onToggle(bot?.id ?? '', isRunning)}
            className={`p-2 rounded-lg transition-colors flex-shrink-0 ${isRunning
              ? 'bg-[var(--color-danger)] hover:opacity-80'
              : 'bg-[var(--color-success)] hover:opacity-80'
              }`}
          >
            {isRunning ? (
              <Square className="w-4 h-4 text-white" />
            ) : (
              <Play className="w-4 h-4 text-white" />
            )}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
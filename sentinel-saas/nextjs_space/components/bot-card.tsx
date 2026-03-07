'use client';

import { Bot, Play, Square, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';

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
  onDelete?: (botId: string) => void;
  liveTradeCount?: number;
  trades?: any[];
}

export function BotCard({ bot, onToggle, onDelete, liveTradeCount, trades = [] }: BotCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = bot?.isActive ?? false;

  // Separate active/closed trades
  const activeTrades = trades.filter((t: any) => (t.status || '').toLowerCase() === 'active');
  const closedTrades = trades.filter((t: any) => (t.status || '').toLowerCase() !== 'active');
  const totalTrades = trades.length;

  // PnL calculations — use totalPnl/total_pnl/realized_pnl fields
  const activePnl = activeTrades.reduce((sum: number, t: any) => sum + (parseFloat(t.pnl) || parseFloat(t.activePnl) || 0), 0);
  const totalPnl = trades.reduce((sum: number, t: any) => sum + (parseFloat(t.pnl) || parseFloat(t.totalPnl) || parseFloat(t.realized_pnl) || parseFloat(t.total_pnl) || 0), 0);

  // ROI: PnL / total capital deployed (trades × $100 each)
  const CAPITAL_PER_TRADE = 100;
  const totalCapitalDeployed = totalTrades * CAPITAL_PER_TRADE;
  const roiPct = totalCapitalDeployed > 0 ? (totalPnl / totalCapitalDeployed * 100) : 0;

  const pnlColor = (v: number) => v >= 0 ? '#22C55E' : '#EF4444';
  const sign = (v: number) => v >= 0 ? '+' : '';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="card-gradient rounded-xl glow-hover overflow-hidden"
    >
      {/* Main row */}
      <div
        className="flex items-center justify-between gap-4 p-4 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
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

        {/* Middle: Status + Trades count + Active PnL + Total PnL */}
        <div className="flex items-center gap-6">
          <span
            className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${isRunning
              ? 'bg-[var(--color-success)]/20 text-[var(--color-success)]'
              : 'bg-[var(--color-text-secondary)]/20 text-[var(--color-text-secondary)]'
              }`}
          >
            {isRunning ? 'Running' : 'Stopped'}
          </span>
          <div className="text-center">
            <div className="text-sm font-semibold">{totalTrades}</div>
            <div className="text-[10px] text-[var(--color-text-secondary)]">Trades</div>
          </div>
          <div className="text-center">
            <div className="text-sm font-bold" style={{ color: pnlColor(activePnl) }}>
              {sign(activePnl)}${Math.abs(activePnl).toFixed(2)}
            </div>
            <div className="text-[10px] text-[var(--color-text-secondary)]">Active PnL</div>
          </div>
          <div className="text-center">
            <div className="text-sm font-bold" style={{ color: pnlColor(totalPnl) }}>
              {sign(totalPnl)}${Math.abs(totalPnl).toFixed(2)}
            </div>
            <div className="text-[10px] text-[var(--color-text-secondary)]">Total PnL</div>
          </div>
        </div>

        {/* Right: ROI + Toggle + Delete + Expand */}
        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="text-sm font-bold" style={{ color: pnlColor(roiPct) }}>
              {sign(roiPct)}{roiPct.toFixed(1)}% ROI
            </span>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(bot?.id ?? '', isRunning); }}
            className={`p-2 rounded-lg transition-colors flex-shrink-0 ${isRunning
              ? 'bg-[var(--color-danger)] hover:opacity-80'
              : 'bg-[var(--color-success)] hover:opacity-80'
              }`}
          >
            {isRunning ? <Square className="w-4 h-4 text-white" /> : <Play className="w-4 h-4 text-white" />}
          </button>
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(bot?.id ?? ''); }}
              title="Delete bot"
              className="p-2 rounded-lg transition-colors flex-shrink-0 hover:bg-red-500/20"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}
            >
              <Trash2 className="w-4 h-4 text-red-400" />
            </button>
          )}
          <div className="text-[var(--color-text-secondary)]">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </div>
      </div>

      {/* Expandable nested trades */}
      <AnimatePresence>
        {expanded && trades.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{
              borderTop: '1px solid rgba(255,255,255,0.06)',
              padding: '0 16px 12px',
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ color: '#6B7280', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <th style={{ padding: '8px 4px', textAlign: 'left', fontWeight: 600 }}>Coin</th>
                    <th style={{ padding: '8px 4px', textAlign: 'left', fontWeight: 600 }}>Side</th>
                    <th style={{ padding: '8px 4px', textAlign: 'right', fontWeight: 600 }}>Entry</th>
                    <th style={{ padding: '8px 4px', textAlign: 'right', fontWeight: 600 }}>Current</th>
                    <th style={{ padding: '8px 4px', textAlign: 'right', fontWeight: 600 }}>PnL</th>
                    <th style={{ padding: '8px 4px', textAlign: 'center', fontWeight: 600 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.slice(0, 20).map((t: any, idx: number) => {
                    const pnl = parseFloat(t.pnl) || parseFloat(t.totalPnl) || parseFloat(t.realized_pnl) || parseFloat(t.total_pnl) || 0;
                    const isActive = (t.status || '').toLowerCase() === 'active';
                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                        <td style={{ padding: '6px 4px', fontWeight: 600, color: '#E5E7EB' }}>
                          {(t.symbol || t.coin || '').replace('USDT', '')}
                        </td>
                        <td style={{ padding: '6px 4px', color: t.side === 'LONG' ? '#22C55E' : '#EF4444' }}>
                          {t.side || '-'}
                        </td>
                        <td style={{ padding: '6px 4px', textAlign: 'right', fontFamily: 'monospace', color: '#9CA3AF' }}>
                          ${parseFloat(t.entry_price || 0).toFixed(4)}
                        </td>
                        <td style={{ padding: '6px 4px', textAlign: 'right', fontFamily: 'monospace', color: '#9CA3AF' }}>
                          {t.current_price ? `$${parseFloat(t.current_price).toFixed(4)}` : '-'}
                        </td>
                        <td style={{ padding: '6px 4px', textAlign: 'right', fontWeight: 700, fontFamily: 'monospace', color: pnlColor(pnl) }}>
                          {sign(pnl)}${Math.abs(pnl).toFixed(2)}
                        </td>
                        <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                          <span style={{
                            fontSize: '10px', fontWeight: 600,
                            padding: '2px 8px', borderRadius: '4px',
                            background: isActive ? 'rgba(34,197,94,0.15)' : 'rgba(107,114,128,0.15)',
                            color: isActive ? '#22C55E' : '#9CA3AF',
                          }}>
                            {t.status || 'closed'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {trades.length > 20 && (
                <div style={{ textAlign: 'center', fontSize: '11px', color: '#6B7280', paddingTop: '8px' }}>
                  Showing 20 of {trades.length} trades
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
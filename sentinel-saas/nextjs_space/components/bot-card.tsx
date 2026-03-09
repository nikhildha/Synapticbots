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
    config?: { mode?: string; maxTrades?: number; capitalPerTrade?: number } | null;
    _count?: {
      trades: number;
    };
  };
  onToggle: (botId: string, currentStatus: boolean) => void;
  onDelete?: (botId: string) => void;
  liveTradeCount?: number;
  trades?: any[];
  sessions?: any[];
}

export function BotCard({ bot, onToggle, onDelete, liveTradeCount, trades = [], sessions = [] }: BotCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<'trades' | 'sessions'>('trades');
  const isRunning = bot?.isActive ?? false;

  // Separate active/closed trades
  const activeTrades = trades.filter((t: any) => (t.status || '').toLowerCase() === 'active');
  const totalTrades = trades.length;

  // PnL calculations
  const activePnl = isRunning
    ? activeTrades.reduce((sum: number, t: any) => sum + (parseFloat(t.pnl) || parseFloat(t.activePnl) || 0), 0)
    : 0;
  const totalPnl = trades.reduce((sum: number, t: any) => sum + (parseFloat(t.pnl) || parseFloat(t.totalPnl) || parseFloat(t.realized_pnl) || parseFloat(t.total_pnl) || 0), 0);

  const botMode = bot?.config?.mode || 'paper';
  const capitalPerTrade = bot?.config?.capitalPerTrade || 100;
  const maxTrades = bot?.config?.maxTrades || 25;
  const maxCapital = maxTrades * capitalPerTrade;
  const capitalDeployed = activeTrades.length * capitalPerTrade;
  const roiPct = maxCapital > 0 ? (totalPnl / maxCapital * 100) : 0;

  const pnlColor = (v: number) => v >= 0 ? '#22C55E' : '#EF4444';
  const sign = (v: number) => v >= 0 ? '+' : '';
  const fmt = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2);
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
  const duration = (start: string, end: string | null) => {
    const ms = (end ? new Date(end) : new Date()).getTime() - new Date(start).getTime();
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
  };

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

        {/* Middle: Status + Mode + Trades + Active PnL + Total PnL */}
        <div className="flex items-center gap-6">
          <span
            className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${isRunning
              ? 'bg-[var(--color-success)]/20 text-[var(--color-success)]'
              : 'bg-[var(--color-text-secondary)]/20 text-[var(--color-text-secondary)]'
              }`}
          >
            {isRunning ? 'Running' : 'Stopped'}
          </span>
          <span style={{
            fontSize: '10px', fontWeight: 600,
            padding: '2px 8px', borderRadius: '4px',
            background: botMode === 'live' ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)',
            color: botMode === 'live' ? '#EF4444' : '#22C55E',
          }}>
            {botMode === 'live' ? '🔴 Live' : '🟢 Paper'}
          </span>
          <div className="text-center">
            <div className="text-sm font-semibold">{activeTrades.length}</div>
            <div className="text-[10px] text-[var(--color-text-secondary)]">Active</div>
          </div>
          <div className="text-center">
            <div className="text-sm font-semibold">{totalTrades}</div>
            <div className="text-[10px] text-[var(--color-text-secondary)]">Total</div>
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

        {/* Right: Capital + ROI + Toggle + Delete + Expand */}
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-sm font-bold" style={{ color: '#06B6D4', fontFamily: 'monospace' }}>
              ${capitalDeployed}<span style={{ color: '#4B5563', fontWeight: 400 }}>/${maxCapital}</span>
            </div>
            <div className="text-[10px]" style={{ color: pnlColor(roiPct) }}>
              {sign(roiPct)}{roiPct.toFixed(1)}% ROI
            </div>
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

      {/* Expandable content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              {/* Tab bar */}
              <div style={{ display: 'flex', gap: '0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                {(['trades', 'sessions'] as const).map(t => (
                  <button key={t} onClick={() => setTab(t)} style={{
                    flex: 1, padding: '8px 0', fontSize: '12px', fontWeight: 600,
                    color: tab === t ? '#06B6D4' : '#6B7280',
                    borderBottom: tab === t ? '2px solid #06B6D4' : '2px solid transparent',
                    background: 'transparent', border: 'none', borderBottomStyle: 'solid',
                    cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.5px',
                    transition: 'all 0.2s',
                  }}>
                    {t === 'trades' ? `Trades (${trades.length})` : `Sessions (${sessions.length})`}
                  </button>
                ))}
              </div>

              {/* Trades tab */}
              {tab === 'trades' && trades.length > 0 && (
                <div style={{ padding: '0 16px 12px' }}>
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
              )}
              {tab === 'trades' && trades.length === 0 && (
                <div style={{ padding: '24px', textAlign: 'center', color: '#6B7280', fontSize: '12px' }}>No trades yet</div>
              )}

              {/* Sessions tab */}
              {tab === 'sessions' && sessions.length > 0 && (
                <div style={{ padding: '8px 16px 12px' }}>
                  {sessions.map((s: any) => (
                    <div key={s.id} style={{
                      display: 'grid', gridTemplateColumns: '1fr 80px 60px 80px 80px',
                      gap: '8px', alignItems: 'center', padding: '8px 0',
                      borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '12px',
                    }}>
                      <div>
                        <span style={{
                          fontSize: '10px', fontWeight: 600,
                          padding: '1px 6px', borderRadius: '3px',
                          ...(s.status === 'active'
                            ? { background: 'rgba(34,197,94,0.15)', color: '#22C55E' }
                            : { background: 'rgba(107,114,128,0.15)', color: '#9CA3AF' }),
                        }}>
                          {s.status === 'active' ? '● Live' : `Run #${s.sessionIndex}`}
                        </span>
                        <span style={{ fontSize: '11px', color: '#9CA3AF', marginLeft: '6px' }}>
                          {fmtDate(s.startedAt)} · {duration(s.startedAt, s.endedAt)}
                        </span>
                      </div>
                      <span style={{ textAlign: 'right', fontSize: '11px' }}>
                        {s.totalTrades} trades
                      </span>
                      <span style={{
                        textAlign: 'right', fontFamily: 'monospace', fontSize: '11px',
                        color: (s.winRate || 0) >= 50 ? '#22C55E' : '#9CA3AF',
                      }}>
                        {s.closedTrades > 0 ? `${(s.winRate || 0).toFixed(0)}%` : '—'}
                      </span>
                      <span style={{
                        textAlign: 'right', fontFamily: 'monospace', fontWeight: 600,
                        color: pnlColor(s.livePnl ?? s.totalPnl ?? 0),
                      }}>
                        {fmt(s.livePnl ?? s.totalPnl ?? 0)}
                      </span>
                      <span style={{
                        textAlign: 'right', fontFamily: 'monospace', fontSize: '11px',
                        color: pnlColor(s.liveRoi ?? s.roi ?? 0),
                      }}>
                        {fmt(s.liveRoi ?? s.roi ?? 0)}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {tab === 'sessions' && sessions.length === 0 && (
                <div style={{ padding: '24px', textAlign: 'center', color: '#6B7280', fontSize: '12px' }}>No sessions yet — start the bot to begin tracking</div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
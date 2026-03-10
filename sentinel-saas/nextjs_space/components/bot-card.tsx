'use client';

import { Bot, Play, Square, ChevronDown, ChevronUp, Trash2, Settings, Zap, Brain } from 'lucide-react';
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
    config?: { mode?: string; maxTrades?: number; capitalPerTrade?: number; brainType?: string } | null;
    _count?: { trades: number };
  };
  onToggle: (botId: string, currentStatus: boolean) => void;
  onDelete?: (botId: string) => void;
  liveTradeCount?: number;
  trades?: any[];
  sessions?: any[];
}

/* ── helpers ── */
const pnlColor = (v: number) => v >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
const sign = (v: number) => v >= 0 ? '+' : '';
const fmt = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2);
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
const fmtDuration = (start: string, end: string | null) => {
  const ms = (end ? new Date(end) : new Date()).getTime() - new Date(start).getTime();
  const days = Math.floor(ms / 86400000);
  const hrs = Math.floor((ms % 86400000) / 3600000);
  return days > 0 ? `${days}d ${hrs}h` : `${hrs}h`;
};

const BRAIN_META: Record<string, { label: string; color: string; icon: string; glow: string }> = {
  adaptive: { label: 'Synaptic Adaptive', color: '#22C55E', icon: '🧠', glow: 'rgba(34,197,94,0.18)' },
  athena: { label: 'Athena AI', color: '#A78BFA', icon: '🏛️', glow: 'rgba(167,139,250,0.18)' },
};
const getBrain = (name = '', brainType = '') => {
  if (brainType && BRAIN_META[brainType]) return BRAIN_META[brainType];
  if (name?.toLowerCase().includes('athena')) return BRAIN_META.athena;
  return BRAIN_META.adaptive;
};

export function BotCard({ bot, onToggle, onDelete, liveTradeCount, trades = [], sessions = [] }: BotCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<'trades' | 'sessions'>('trades');
  const [showSettings, setShowSettings] = useState(false);
  const [settingsMode, setSettingsMode] = useState(bot?.config?.mode || 'paper');
  const [settingsCPT, setSettingsCPT] = useState(bot?.config?.capitalPerTrade || 100);
  const [settingsMaxTrades, setSettingsMaxTrades] = useState(bot?.config?.maxTrades || 25);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const isRunning = bot?.isActive ?? false;
  const brainType = (bot?.config as any)?.brainType || 'adaptive';
  const brain = getBrain(bot?.name, brainType);
  const botMode = bot?.config?.mode || 'paper';
  const capitalPerTrade = bot?.config?.capitalPerTrade || 100;
  const maxTrades = bot?.config?.maxTrades || 25;
  const maxCapital = maxTrades * capitalPerTrade;

  const activeTrades = trades.filter((t: any) => (t.status || '').toLowerCase() === 'active');
  const closedTrades = trades.filter((t: any) => (t.status || '').toLowerCase() !== 'active');
  const totalTrades = trades.length;

  const winCount = closedTrades.filter((t: any) => (parseFloat(t.realized_pnl) || parseFloat(t.totalPnl) || 0) > 0).length;
  const winRate = closedTrades.length > 0 ? (winCount / closedTrades.length * 100) : null;

  const activePnl = isRunning
    ? activeTrades.reduce((s: number, t: any) => s + (parseFloat(t.unrealized_pnl) || parseFloat(t.activePnl) || 0), 0)
    : 0;
  const totalPnl = trades.reduce((s: number, t: any) => {
    const isActive = (t.status || '').toLowerCase() === 'active';
    return s + (isActive
      ? (parseFloat(t.unrealized_pnl) || parseFloat(t.activePnl) || 0)
      : (parseFloat(t.realized_pnl) || parseFloat(t.totalPnl) || parseFloat(t.pnl) || 0));
  }, 0);

  const capitalDeployed = activeTrades.length * capitalPerTrade;
  const deployedPct = maxCapital > 0 ? Math.min(100, (capitalDeployed / maxCapital) * 100) : 0;
  const roiPct = maxCapital > 0 ? (totalPnl / maxCapital * 100) : 0;

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/bots/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId: bot?.id, mode: settingsMode, capitalPerTrade: settingsCPT, maxOpenTrades: settingsMaxTrades }),
      });
      if (res.ok) { setShowSettings(false); window.location.reload(); }
    } catch (e) { console.error('Settings save error:', e); }
    setSaving(false);
  };

  const handleDeleteClick = () => {
    if (!deleteConfirm) { setDeleteConfirm(true); return; }
    onDelete?.(bot?.id ?? '');
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        background: 'linear-gradient(145deg, var(--color-surface-2) 0%, var(--color-surface-3) 100%)',
        border: `1px solid ${isRunning ? brain.color + '28' : 'var(--color-border)'}`,
        borderRadius: 'var(--radius-lg)',
        boxShadow: isRunning ? `0 0 24px ${brain.glow}, var(--shadow-card)` : 'var(--shadow-card)',
        overflow: 'hidden',
        transition: 'border-color 0.3s, box-shadow 0.3s',
        position: 'relative',
      }}
    >
      {/* ── Vertical accent bar ── */}
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
        background: isRunning
          ? `linear-gradient(to bottom, ${brain.color}, ${brain.color}88)`
          : 'rgba(107,114,128,0.3)',
        borderRadius: '3px 0 0 3px',
        transition: 'background 0.3s',
      }} />

      {/* ════ MAIN ROW ════ */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '16px 20px 16px 24px', cursor: 'pointer' }}
      >
        {/* Left: Bot identity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, flex: '0 0 260px' }}>
          {/* Brain icon */}
          <div style={{
            width: 46, height: 46, borderRadius: 'var(--radius-md)', flexShrink: 0,
            background: `linear-gradient(135deg, ${brain.color}20, ${brain.color}10)`,
            border: `1px solid ${brain.color}30`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20,
          }}>
            {brain.icon}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--color-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {bot?.name ?? 'Bot'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
              {/* Running status */}
              {isRunning && <span className="live-dot" />}
              <span style={{ fontSize: 'var(--text-xs)', color: isRunning ? brain.color : 'var(--color-text-muted)', fontWeight: 600 }}>
                {isRunning ? 'Running' : 'Stopped'}
              </span>
              <span style={{
                fontSize: 'var(--text-xs)', fontWeight: 600, padding: '1px 7px', borderRadius: 20,
                background: botMode === 'live' ? 'var(--color-danger-bg)' : 'var(--color-info-bg)',
                color: botMode === 'live' ? 'var(--color-danger)' : 'var(--color-info)',
              }}>
                {botMode === 'live' ? 'Live' : 'Paper'}
              </span>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                {bot?.exchange}
              </span>
            </div>
          </div>
        </div>

        {/* Middle: 4-metric chip grid */}
        <div style={{ display: 'flex', gap: 24, flex: 1, alignItems: 'center' }}>
          {/* Active Trades */}
          <div style={{ textAlign: 'center', minWidth: 52 }}>
            <div style={{ fontSize: 'var(--text-lg)', fontWeight: 800, color: activeTrades.length > 0 ? 'var(--color-info)' : 'var(--color-text)' }}>
              {activeTrades.length}
            </div>
            <div className="stat-label">Active</div>
          </div>
          <div style={{ width: 1, height: 32, background: 'var(--color-border-subtle)' }} />
          {/* Total PnL */}
          <div style={{ textAlign: 'center', minWidth: 80 }}>
            <div style={{ fontSize: 'var(--text-md)', fontWeight: 800, fontFamily: 'monospace', color: pnlColor(totalPnl) }}>
              {sign(totalPnl)}${Math.abs(totalPnl).toFixed(2)}
            </div>
            <div className="stat-label">Total PnL</div>
          </div>
          <div style={{ width: 1, height: 32, background: 'var(--color-border-subtle)' }} />
          {/* Win Rate */}
          <div style={{ textAlign: 'center', minWidth: 56 }}>
            <div style={{ fontSize: 'var(--text-md)', fontWeight: 700, fontFamily: 'monospace', color: winRate !== null && winRate >= 50 ? 'var(--color-success)' : 'var(--color-text-secondary)' }}>
              {winRate !== null ? `${winRate.toFixed(0)}%` : '—'}
            </div>
            <div className="stat-label">Win Rate</div>
          </div>
          <div style={{ width: 1, height: 32, background: 'var(--color-border-subtle)' }} />
          {/* ROI */}
          <div style={{ textAlign: 'center', minWidth: 64 }}>
            <div style={{ fontSize: 'var(--text-md)', fontWeight: 700, fontFamily: 'monospace', color: pnlColor(roiPct) }}>
              {sign(roiPct)}{roiPct.toFixed(1)}%
            </div>
            <div className="stat-label">ROI</div>
          </div>
        </div>

        {/* Capital progress bar */}
        <div style={{ flex: '0 0 140px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
            <span className="stat-label">Capital</span>
            <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, fontFamily: 'monospace', color: 'var(--color-info)' }}>
              ${capitalDeployed}<span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>/${maxCapital}</span>
            </span>
          </div>
          <div style={{
            height: 5, borderRadius: 10, background: 'rgba(255,255,255,0.07)', overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', borderRadius: 10, width: `${deployedPct}%`,
              background: deployedPct > 75
                ? 'linear-gradient(90deg, #F59E0B, #D97706)'
                : 'linear-gradient(90deg, var(--color-primary), var(--color-accent))',
              transition: 'width 0.5s ease',
            }} />
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 4, textAlign: 'right' }}>
            {deployedPct.toFixed(0)}% deployed
          </div>
        </div>

        {/* Right: Action buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {/* Start / Stop */}
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(bot?.id ?? '', isRunning); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 16px', borderRadius: 'var(--radius-md)',
              background: isRunning
                ? 'linear-gradient(135deg, rgba(239,68,68,0.15), rgba(239,68,68,0.08))'
                : `linear-gradient(135deg, ${brain.color}22, ${brain.color}10)`,
              color: isRunning ? 'var(--color-danger)' : brain.color,
              border: `1px solid ${isRunning ? 'rgba(239,68,68,0.3)' : brain.color + '30'}`,
              fontSize: 'var(--text-xs)', fontWeight: 700, cursor: 'pointer',
              transition: 'all 0.2s', whiteSpace: 'nowrap',
            }}
          >
            {isRunning
              ? <><Square style={{ width: 13, height: 13 }} /> Stop</>
              : <><Play style={{ width: 13, height: 13 }} /> Start</>
            }
          </button>

          {/* Settings gear */}
          <button
            onClick={(e) => { e.stopPropagation(); setShowSettings(!showSettings); setDeleteConfirm(false); }}
            title="Settings"
            style={{
              width: 34, height: 34, borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer',
              background: showSettings ? 'rgba(6,182,212,0.2)' : 'rgba(255,255,255,0.05)',
              color: showSettings ? 'var(--color-info)' : 'var(--color-text-secondary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all 0.2s',
            }}
          ><Settings style={{ width: 15, height: 15 }} /></button>

          {/* Delete */}
          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); handleDeleteClick(); }}
              title={deleteConfirm ? 'Click again to confirm' : 'Delete bot'}
              style={{
                height: 34, padding: '0 12px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                background: deleteConfirm ? 'rgba(239,68,68,0.25)' : 'rgba(239,68,68,0.08)',
                color: deleteConfirm ? '#F87171' : 'rgba(239,68,68,0.6)',
                border: `1px solid ${deleteConfirm ? 'rgba(239,68,68,0.4)' : 'rgba(239,68,68,0.15)'}`,
                display: 'flex', alignItems: 'center', gap: 5,
                fontSize: deleteConfirm ? 'var(--text-xs)' : undefined,
                fontWeight: 700, transition: 'all 0.2s', whiteSpace: 'nowrap',
              }}
              onBlur={() => setTimeout(() => setDeleteConfirm(false), 200)}
            >
              <Trash2 style={{ width: 13, height: 13 }} />
              {deleteConfirm && 'Confirm'}
            </button>
          )}

          {/* Expand chevron */}
          <div style={{ color: 'var(--color-text-muted)', paddingLeft: 4 }}>
            {expanded
              ? <ChevronUp style={{ width: 16, height: 16 }} />
              : <ChevronDown style={{ width: 16, height: 16 }} />
            }
          </div>
        </div>
      </div>

      {/* ════ SETTINGS PANEL ════ */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{
              borderTop: '1px solid var(--color-border)',
              padding: '16px 24px',
              background: 'rgba(6,182,212,0.03)',
            }}>
              <div className="section-title" style={{ marginBottom: 12, color: 'var(--color-info)' }}>
                ⚙️ Bot Configuration
              </div>
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <label style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginBottom: 5, fontWeight: 600 }}>
                    Trading Mode
                  </label>
                  <select value={settingsMode} onChange={(e) => setSettingsMode(e.target.value)} className="input-field" style={{ fontSize: 'var(--text-sm)' }}>
                    <option value="paper">🟢 Paper</option>
                    <option value="live">🔴 Live</option>
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <label style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginBottom: 5, fontWeight: 600 }}>
                    Capital Per Trade ($)
                  </label>
                  <input type="number" value={settingsCPT}
                    onChange={(e) => setSettingsCPT(Number(e.target.value))}
                    className="input-field" style={{ fontSize: 'var(--text-sm)', fontFamily: 'monospace' }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 120 }}>
                  <label style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginBottom: 5, fontWeight: 600 }}>
                    Max Open Trades
                  </label>
                  <input type="number" value={settingsMaxTrades}
                    onChange={(e) => setSettingsMaxTrades(Number(e.target.value))}
                    className="input-field" style={{ fontSize: 'var(--text-sm)', fontFamily: 'monospace' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={handleSaveSettings} disabled={saving}
                    style={{
                      padding: '9px 20px', borderRadius: 'var(--radius-md)', border: '1px solid rgba(6,182,212,0.35)',
                      background: 'rgba(6,182,212,0.12)', color: 'var(--color-info)',
                      fontSize: 'var(--text-sm)', fontWeight: 700, cursor: saving ? 'wait' : 'pointer',
                      opacity: saving ? 0.7 : 1,
                    }}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => setShowSettings(false)} className="btn-ghost" style={{ padding: '9px 16px' }}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ════ EXPANDABLE DETAILS ════ */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ borderTop: '1px solid var(--color-border)' }}>
              {/* Tab bar */}
              <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border-subtle)' }}>
                {(['trades', 'sessions'] as const).map(t => (
                  <button key={t} onClick={() => setTab(t)} style={{
                    flex: 1, padding: '10px 0', fontSize: 'var(--text-xs)', fontWeight: 700,
                    color: tab === t ? 'var(--color-info)' : 'var(--color-text-muted)',
                    borderBottom: `2px solid ${tab === t ? 'var(--color-info)' : 'transparent'}`,
                    background: 'transparent', border: 'none', borderBottomStyle: 'solid',
                    cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.8px',
                    transition: 'all 0.2s',
                  }}>
                    {t === 'trades' ? `Trades (${trades.length})` : `Sessions (${sessions.length})`}
                  </button>
                ))}
              </div>

              {/* Trades tab */}
              {tab === 'trades' && trades.length > 0 && (
                <div style={{ padding: '4px 20px 16px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
                    <thead>
                      <tr>
                        {['Coin', 'Side', 'Entry', 'Current', 'PnL', 'Lev', 'Status'].map(h => (
                          <th key={h} style={{
                            padding: '10px 6px', textAlign: h === 'Coin' || h === 'Side' ? 'left' : 'right',
                            fontWeight: 600, color: 'var(--color-text-muted)',
                            fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.6px',
                            borderBottom: '1px solid var(--color-border-subtle)',
                            ...(h === 'Status' ? { textAlign: 'center' } : {}),
                          }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {trades.slice(0, 20).map((t: any, idx: number) => {
                        const isActiveTrade = (t.status || '').toLowerCase() === 'active';
                        const pnl = isActiveTrade
                          ? (parseFloat(t.unrealized_pnl) || parseFloat(t.pnl) || 0)
                          : (parseFloat(t.total_pnl) || parseFloat(t.realized_pnl) || parseFloat(t.pnl) || 0);
                        const side = t.side || '-';
                        const isLong = side === 'LONG' || side === 'BUY';
                        return (
                          <tr key={idx} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                            <td style={{ padding: '8px 6px', fontWeight: 700, color: 'var(--color-text)' }}>
                              {(t.symbol || t.coin || '').replace('USDT', '')}
                            </td>
                            <td style={{ padding: '8px 6px' }}>
                              <span style={{
                                fontSize: 'var(--text-xs)', fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                                background: isLong ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
                                color: isLong ? 'var(--color-success)' : 'var(--color-danger)',
                              }}>{isLong ? 'LONG' : 'SHORT'}</span>
                            </td>
                            <td style={{ padding: '8px 6px', textAlign: 'right', fontFamily: 'monospace', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                              ${parseFloat(t.entry_price || 0).toFixed(4)}
                            </td>
                            <td style={{ padding: '8px 6px', textAlign: 'right', fontFamily: 'monospace', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                              {t.current_price ? `$${parseFloat(t.current_price).toFixed(4)}` : '—'}
                            </td>
                            <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 800, fontFamily: 'monospace', color: pnlColor(pnl) }}>
                              {sign(pnl)}${Math.abs(pnl).toFixed(2)}
                            </td>
                            <td style={{ padding: '8px 6px', textAlign: 'right', fontFamily: 'monospace', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                              {t.leverage ? `${t.leverage}×` : '—'}
                            </td>
                            <td style={{ padding: '8px 6px', textAlign: 'center' }}>
                              <span style={{
                                fontSize: 'var(--text-xs)', fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                                background: isActiveTrade ? 'var(--color-success-bg)' : 'rgba(107,114,128,0.12)',
                                color: isActiveTrade ? 'var(--color-success)' : 'var(--color-text-muted)',
                              }}>
                                {isActiveTrade ? '● Active' : 'Closed'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {trades.length > 20 && (
                    <div style={{ textAlign: 'center', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', paddingTop: 10 }}>
                      Showing 20 of {trades.length} trades
                    </div>
                  )}
                </div>
              )}
              {tab === 'trades' && trades.length === 0 && (
                <div style={{ padding: '28px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
                  No trades yet — start the bot to begin trading
                </div>
              )}

              {/* Sessions tab */}
              {tab === 'sessions' && sessions.length > 0 && (
                <div style={{ padding: '4px 20px 16px' }}>
                  {/* Header */}
                  <div style={{
                    display: 'grid', gridTemplateColumns: '1fr 80px 60px 90px 70px',
                    gap: 8, padding: '8px 0', fontSize: 'var(--text-xs)', fontWeight: 700,
                    color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.6px',
                    borderBottom: '1px solid var(--color-border-subtle)',
                  }}>
                    <span>Session</span>
                    <span style={{ textAlign: 'right' }}>Trades</span>
                    <span style={{ textAlign: 'right' }}>Win%</span>
                    <span style={{ textAlign: 'right' }}>PnL</span>
                    <span style={{ textAlign: 'right' }}>ROI</span>
                  </div>
                  {sessions.map((s: any) => (
                    <div key={s.id} style={{
                      display: 'grid', gridTemplateColumns: '1fr 80px 60px 90px 70px',
                      gap: 8, alignItems: 'center', padding: '9px 0',
                      borderBottom: '1px solid var(--color-border-subtle)', fontSize: 'var(--text-sm)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                          fontSize: 'var(--text-xs)', fontWeight: 700, padding: '2px 7px', borderRadius: 4,
                          ...(s.status === 'active'
                            ? { background: 'var(--color-success-bg)', color: 'var(--color-success)' }
                            : { background: 'rgba(107,114,128,0.12)', color: 'var(--color-text-muted)' }),
                        }}>
                          {s.status === 'active' ? '● Live' : `#${s.sessionIndex}`}
                        </span>
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                          {fmtDate(s.startedAt)} · {fmtDuration(s.startedAt, s.endedAt)}
                        </span>
                      </div>
                      <span style={{ textAlign: 'right', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>{s.totalTrades}</span>
                      <span style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 'var(--text-xs)', color: (s.winRate || 0) >= 50 ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                        {s.closedTrades > 0 ? `${(s.winRate || 0).toFixed(0)}%` : '—'}
                      </span>
                      <span style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, color: pnlColor(s.livePnl ?? s.totalPnl ?? 0) }}>
                        {fmt(s.livePnl ?? s.totalPnl ?? 0)}
                      </span>
                      <span style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 'var(--text-xs)', color: pnlColor(s.liveRoi ?? s.roi ?? 0) }}>
                        {fmt(s.liveRoi ?? s.roi ?? 0)}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {tab === 'sessions' && sessions.length === 0 && (
                <div style={{ padding: '28px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
                  No sessions yet — start the bot to begin tracking
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
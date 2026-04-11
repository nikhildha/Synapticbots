'use client';

import { Play, Square, Trash2, Settings, Archive } from 'lucide-react';
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
  onRetire?: (botId: string) => void;
  liveTradeCount?: number;
  trades?: any[];
  sessions?: any[];
  livePrices?: Record<string, number>;
  isToggling?: boolean;
}

/* ── helpers ── */
const pnlColor = (v: number) => Math.abs(v) < 0.01 ? '#9CA3AF' : (v >= 0 ? '#22C55E' : '#EF4444');
const sign = (v: number) => Math.abs(v) < 0.01 ? '' : (v >= 0 ? '+' : '-');

const BRAIN_META: Record<string, { label: string; color: string; glow: string }> = {
  adaptive: { label: 'Synaptic Adaptive', color: '#22C55E', glow: 'rgba(34,197,94,0.18)' },
  athena: { label: 'Athena AI', color: '#A78BFA', glow: 'rgba(167,139,250,0.18)' },
};
const getBrain = (name = '', brainType = '') => {
  if (brainType && BRAIN_META[brainType]) return BRAIN_META[brainType];
  if (name?.toLowerCase().includes('athena')) return BRAIN_META.athena;
  return BRAIN_META.adaptive;
};

export function BotCard({ bot, onToggle, onDelete, onRetire, trades = [], livePrices = {}, isToggling = false }: BotCardProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [settingsMode, setSettingsMode] = useState(bot?.config?.mode || 'paper');
  const [settingsCPT, setSettingsCPT] = useState(bot?.config?.capitalPerTrade || 100);
  const [settingsMaxTrades, setSettingsMaxTrades] = useState(bot?.config?.maxTrades || 25);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [retireConfirm, setRetireConfirm] = useState(false);
  const [retiring, setRetiring] = useState(false);

  const isRunning = bot?.isActive ?? false;
  const brainType = (bot?.config as any)?.brainType || 'adaptive';
  const brain = getBrain(bot?.name, brainType);
  const botMode = bot?.config?.mode || 'paper';
  const capitalPerTrade = bot?.config?.capitalPerTrade || 100;
  // Paper mode: cap at 10 concurrent trades per bot ($100×10=$1000 max exposure per bot)
  const maxTrades = bot?.config?.maxTrades || 10;
  const maxCapital = maxTrades * capitalPerTrade; // $1000 per bot in paper mode

  const activeTrades = trades.filter((t: any) => (t.status || '').toLowerCase() === 'active');
  const closedTrades = trades.filter((t: any) => (t.status || '').toLowerCase() !== 'active');

  const winCount = closedTrades.filter((t: any) => (parseFloat(t.realized_pnl) || parseFloat(t.totalPnl) || 0) > 0).length;
  const winRate = closedTrades.length > 0 ? (winCount / closedTrades.length * 100) : null;

  const totalPnl = (() => {
    const realized = closedTrades.reduce((s: number, t: any) => {
      const p = parseFloat(t.realized_pnl) || parseFloat(t.totalPnl) || parseFloat(t.pnl) || 0;
      return s + (Math.abs(p) > 50000 ? 0 : p); // Filter out garbage test artifacts
    }, 0);
    const unrealized = activeTrades.reduce((s: number, t: any) => {
      const sym = (t.symbol || (t.coin || '') + 'USDT').toUpperCase();
      const cp = livePrices[sym] || t.current_price || t.currentPrice || t.entry_price || t.entryPrice;
      const entry = t.entry_price || t.entryPrice || 0;
      const cap = t.capital || t.position_size || 100;
      const lev = t.leverage || 1;
      if (!cp || !entry || entry === 0 || cap === 0) return s;
      const pos = (t.side || t.position || '').toLowerCase();
      const isLong = pos === 'long' || pos === 'buy';
      const diff = isLong ? (cp - entry) : (entry - cp);
      const rawTradePnl = diff / entry * lev * cap;
      if (Math.abs(rawTradePnl) > 50000) return s; // Filter severe symbol map mismatches (e.g. PEPE vs 1000PEPE)
      return s + Math.round(rawTradePnl * 10000) / 10000;
    }, 0);
    return realized + unrealized;
  })();

  const capitalDeployed = activeTrades.length * capitalPerTrade;
  const deployedPct = maxCapital > 0 ? Math.min(100, (capitalDeployed / maxCapital) * 100) : 0;
  const roiPct = maxCapital > 0 ? (totalPnl / maxCapital * 100) : 0;

  const handleSaveSettings = async () => {
    if (settingsCPT <= 0 || settingsMaxTrades <= 0) { alert('Capital and max trades must be greater than 0.'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/bots/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId: bot?.id, mode: settingsMode, capitalPerTrade: settingsCPT, maxOpenTrades: settingsMaxTrades }),
      });
      if (res.ok) { setShowSettings(false); window.location.reload(); }
      else { const d = await res.json().catch(() => ({})); alert(d.error || 'Failed to save settings'); }
    } catch { alert('Failed to save settings. Please try again.'); }
    finally { setSaving(false); }
  };

  const handleDeleteClick = () => {
    if (!deleteConfirm) { setDeleteConfirm(true); return; }
    onDelete?.(bot?.id ?? '');
  };

  const handleRetireClick = () => {
    if (isRunning) return;
    if (!retireConfirm) {
      setRetireConfirm(true);
      setTimeout(() => setRetireConfirm(false), 4000);
      return;
    }
    setRetiring(true);
    onRetire?.(bot?.id ?? '');
  };

  const barColor = deployedPct > 75
    ? 'linear-gradient(90deg, #F59E0B, #D97706)'
    : 'linear-gradient(90deg, #06B6D4, #22D3EE)';

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      style={{
        background: 'var(--color-surface)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        border: `1px solid ${isRunning ? brain.color + '22' : 'var(--color-border)'}`,
        borderRadius: 14,
        boxShadow: isRunning
          ? `0 0 18px ${brain.glow}, var(--shadow-card)`
          : 'var(--shadow-card)',
        overflow: 'hidden',
        position: 'relative' as const,
      }}
      whileHover={{ boxShadow: `0 0 28px ${brain.glow}, 0 4px 24px rgba(0,0,0,0.5)` }}
    >
      {/* Left accent strip */}
      <div style={{
        position: 'absolute', top: 0, left: 0, bottom: 0, width: 3,
        background: isRunning
          ? `linear-gradient(180deg, ${brain.color}cc, ${brain.color}33)`
          : 'var(--color-border)',
        borderRadius: '14px 0 0 14px',
      }} />

      {/* ── Main horizontal row ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 0,
        padding: '14px 16px 14px 20px',
      }}>

        {/* 1. Bot identity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 220, flexShrink: 0 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            background: `${brain.color}15`,
            border: `1px solid ${brain.color}30`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18,
          }}>
            🧠
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text)', lineHeight: 1.2 }}>
              {bot.name || 'Synaptic Engine'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
              {isRunning && <span className="live-dot" />}
              <span style={{ fontSize: 11, fontWeight: 600, color: isRunning ? brain.color : 'var(--color-text-secondary)' }}>
                {isRunning ? 'Running' : 'Stopped'}
              </span>
              <span style={{
                fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                background: botMode === 'live' ? 'rgba(239,68,68,0.12)' : 'rgba(6,182,212,0.1)',
                color: botMode === 'live' ? '#EF4444' : '#06B6D4',
              }}>
                {botMode === 'live' ? 'Live' : 'Paper'}
              </span>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 40, background: 'var(--color-border)', marginRight: 24, flexShrink: 0 }} />

        {/* 2. Metrics row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 32, flex: 1 }}>

          {/* PnL */}
          <div style={{ minWidth: 90 }}>
            <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'var(--font-mono, monospace)', color: pnlColor(totalPnl), lineHeight: 1 }}>
              {sign(totalPnl)}${Math.abs(totalPnl).toFixed(2)}
            </div>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.8px', textTransform: 'uppercase', marginTop: 2 }}>
              Total P&L
            </div>
          </div>

          {/* Win Rate */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 800, fontFamily: 'monospace', color: winRate !== null && winRate >= 50 ? '#22C55E' : '#9CA3AF' }}>
              {winRate !== null ? `${winRate.toFixed(0)}%` : '—'}
            </div>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.8px', textTransform: 'uppercase', marginTop: 2 }}>Win Rate</div>
          </div>

          {/* Active trades */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 800, fontFamily: 'monospace', color: activeTrades.length > 0 ? '#00E5FF' : '#9CA3AF' }}>
              {activeTrades.length}
            </div>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.8px', textTransform: 'uppercase', marginTop: 2 }}>Active</div>
          </div>

          {/* ROI */}
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 800, fontFamily: 'monospace', color: pnlColor(roiPct) }}>
              {sign(roiPct)}{roiPct.toFixed(1)}%
            </div>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.8px', textTransform: 'uppercase', marginTop: 2 }}>ROI</div>
          </div>

          {/* Capital bar */}
          <div style={{ flex: 1, minWidth: 120, maxWidth: 240 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.8px', textTransform: 'uppercase' }}>Capital</span>
              <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'monospace', color: 'var(--color-text-secondary)' }}>
                ${capitalDeployed}<span style={{ opacity: 0.5 }}>/${maxCapital}</span>
              </span>
            </div>
            <div style={{ height: 5, borderRadius: 4, background: 'var(--color-border)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 4, width: `${deployedPct}%`,
                background: barColor,
                transition: 'width 0.5s ease',
              }} />
            </div>
          </div>
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 40, background: 'var(--color-border)', marginLeft: 24, flexShrink: 0 }} />

        {/* 3. Action buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 16, flexShrink: 0 }}>
          <button
            onClick={(e) => { e.stopPropagation(); if (!isToggling) onToggle(bot?.id ?? '', isRunning); }}
            disabled={isToggling}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 16px', borderRadius: 9,
              background: isRunning ? 'rgba(239,68,68,0.1)' : `${brain.color}15`,
              color: isRunning ? '#EF4444' : brain.color,
              border: `1px solid ${isRunning ? 'rgba(239,68,68,0.25)' : brain.color + '25'}`,
              fontSize: 12, fontWeight: 700,
              cursor: isToggling ? 'wait' : 'pointer',
              opacity: isToggling ? 0.6 : 1,
              transition: 'all 0.2s', whiteSpace: 'nowrap',
            }}
          >
            {isToggling
              ? '…'
              : isRunning
                ? <><Square style={{ width: 11, height: 11 }} /> Stop</>
                : <><Play style={{ width: 11, height: 11 }} /> Start</>
            }
          </button>

          <button
            onClick={(e) => { e.stopPropagation(); setShowSettings(!showSettings); setDeleteConfirm(false); }}
            title="Settings"
            style={{
              width: 34, height: 34, borderRadius: 9, cursor: 'pointer',
              background: showSettings ? 'var(--color-primary-transparent)' : 'var(--color-surface-light)',
              color: showSettings ? 'var(--color-primary)' : 'var(--color-text-secondary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s',
              border: '1px solid var(--color-border)',
            }}
          ><Settings style={{ width: 13, height: 13 }} /></button>

          {!isRunning && onRetire && (
            <button
              onClick={(e) => { e.stopPropagation(); handleRetireClick(); }}
              title={retireConfirm ? 'Click again to confirm retirement' : 'Retire bot (archive)'}
              disabled={isRunning || retiring}
              style={{
                width: 34, height: 34, borderRadius: 9, cursor: isRunning ? 'not-allowed' : retiring ? 'wait' : 'pointer',
                background: retireConfirm ? 'rgba(251,191,36,0.2)' : 'rgba(251,191,36,0.06)',
                color: retireConfirm ? '#FCD34D' : 'rgba(251,191,36,0.5)',
                border: `1px solid ${retireConfirm ? 'rgba(252,211,77,0.4)' : 'rgba(251,191,36,0.15)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s',
                opacity: isRunning || retiring ? 0.4 : 1,
              }}
              onBlur={() => setTimeout(() => setRetireConfirm(false), 200)}
            >
              {retiring ? <span style={{ fontSize: 10 }}>…</span> : <Archive style={{ width: 12, height: 12 }} />}
            </button>
          )}

          {onDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); handleDeleteClick(); }}
              title={deleteConfirm ? 'Click again to confirm' : 'Delete bot'}
              style={{
                width: 34, height: 34, borderRadius: 9, cursor: 'pointer',
                background: deleteConfirm ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.06)',
                color: deleteConfirm ? '#F87171' : 'rgba(239,68,68,0.5)',
                border: `1px solid ${deleteConfirm ? 'rgba(239,68,68,0.3)' : 'rgba(239,68,68,0.1)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s',
              }}
              onBlur={() => setTimeout(() => setDeleteConfirm(false), 200)}
            >
              <Trash2 style={{ width: 12, height: 12 }} />
            </button>
          )}
        </div>
      </div>

      {/* ════ SETTINGS PANEL (expands below) ════ */}
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
              padding: '14px 20px 16px 20px',
              background: 'var(--color-surface-light)',
              display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap',
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-primary)', letterSpacing: '0.8px', textTransform: 'uppercase', flexShrink: 0 }}>
                ⚙️ Configuration
              </div>

              {/* Mode */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ fontSize: 10, color: 'var(--color-text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>Mode</label>
                <select value={settingsMode} onChange={(e) => setSettingsMode(e.target.value)} className="input-field" style={{ fontSize: 12, padding: '4px 8px' }}>
                  <option value="paper">🟢 Paper</option>
                  <option value="live">🔴 Live</option>
                </select>
              </div>

              {/* Capital */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ fontSize: 10, color: 'var(--color-text-secondary)', fontWeight: 600, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Capital/Trade ($)</label>
                <input type="number" value={settingsCPT} min={1} max={100000}
                  onChange={(e) => setSettingsCPT(Math.max(1, Number(e.target.value)))}
                  className="input-field" style={{ fontSize: 12, fontFamily: 'monospace', width: 80 }}
                />
              </div>

              {/* Max Trades */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ fontSize: 10, color: 'var(--color-text-secondary)', fontWeight: 600, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Max Trades</label>
                <input type="number" value={settingsMaxTrades} min={1} max={100}
                  onChange={(e) => setSettingsMaxTrades(Math.max(1, Number(e.target.value)))}
                  className="input-field" style={{ fontSize: 12, fontFamily: 'monospace', width: 70 }}
                />
              </div>

              <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                <button onClick={handleSaveSettings} disabled={saving}
                  style={{
                    padding: '7px 18px', borderRadius: 8, border: '1px solid var(--color-primary)',
                    background: 'var(--color-primary-transparent)', color: 'var(--color-primary)',
                    fontSize: 12, fontWeight: 700, cursor: saving ? 'wait' : 'pointer',
                    opacity: saving ? 0.7 : 1,
                  }}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => setShowSettings(false)}
                  style={{
                    padding: '7px 18px', borderRadius: 8, border: '1px solid var(--color-border)',
                    background: 'transparent', color: 'var(--color-text-secondary)',
                    fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  }}>
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
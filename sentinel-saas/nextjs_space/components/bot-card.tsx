'use client';

import { Bot, Play, Square, Trash2, Settings, ChevronDown, ChevronUp } from 'lucide-react';
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
const pnlColor = (v: number) => v >= 0 ? '#22C55E' : '#EF4444';
const sign = (v: number) => v >= 0 ? '+' : '';
const fmt = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2);

const BRAIN_META: Record<string, { label: string; color: string; glow: string }> = {
  adaptive: { label: 'Synaptic Adaptive', color: '#22C55E', glow: 'rgba(34,197,94,0.18)' },
  athena: { label: 'Athena AI', color: '#A78BFA', glow: 'rgba(167,139,250,0.18)' },
};
const getBrain = (name = '', brainType = '') => {
  if (brainType && BRAIN_META[brainType]) return BRAIN_META[brainType];
  if (name?.toLowerCase().includes('athena')) return BRAIN_META.athena;
  return BRAIN_META.adaptive;
};

// Segment icon - extract segment name from bot name
const SEGMENT_ICONS: Record<string, { icon: string; color: string }> = {
  'L1':      { icon: '🔷', color: '#A78BFA' },
  'L2':      { icon: '🔗', color: '#22D3EE' },
  'DeFi':    { icon: '🌊', color: '#34D399' },
  'Gaming':  { icon: '🎮', color: '#FBBF24' },
  'AI':      { icon: '🤖', color: '#F472B6' },
  'RWA':     { icon: '🏦', color: '#60A5FA' },
  'Meme':    { icon: '🐸', color: '#FCD34D' },
  'DePIN':   { icon: '📡', color: '#F97316' },
  'Modular': { icon: '🧩', color: '#8B5CF6' },
  'ALL':     { icon: '⚡', color: '#22C55E' },
};
function getSegmentInfo(botName: string): { name: string; icon: string; color: string } {
  const n = (botName || '').toLowerCase();
  if (n.includes('l1') || n.includes('layer 1') || n.includes('layer1')) return { name: 'L1', ...SEGMENT_ICONS['L1'] };
  if (n.includes('l2') || n.includes('layer 2') || n.includes('layer2')) return { name: 'L2', ...SEGMENT_ICONS['L2'] };
  if (n.includes('defi') || n.includes('de-fi')) return { name: 'DeFi', ...SEGMENT_ICONS['DeFi'] };
  if (n.includes('gaming') || n.includes('game') || n.includes('metaverse')) return { name: 'Gaming', ...SEGMENT_ICONS['Gaming'] };
  if (n.includes('ai') || n.includes('intelligence') || n.includes('neural')) return { name: 'AI', ...SEGMENT_ICONS['AI'] };
  if (n.includes('rwa') || n.includes('real world') || n.includes('asset')) return { name: 'RWA', ...SEGMENT_ICONS['RWA'] };
  if (n.includes('meme')) return { name: 'Meme', ...SEGMENT_ICONS['Meme'] };
  if (n.includes('depin')) return { name: 'DePIN', ...SEGMENT_ICONS['DePIN'] };
  if (n.includes('modular')) return { name: 'Modular', ...SEGMENT_ICONS['Modular'] };
  return { name: 'ALL', ...SEGMENT_ICONS['ALL'] };
}

export function BotCard({ bot, onToggle, onDelete, liveTradeCount, trades = [], sessions = [] }: BotCardProps) {
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
  const segment = getSegmentInfo(bot?.name || '');

  const activeTrades = trades.filter((t: any) => (t.status || '').toLowerCase() === 'active');
  const closedTrades = trades.filter((t: any) => (t.status || '').toLowerCase() !== 'active');

  const winCount = closedTrades.filter((t: any) => (parseFloat(t.realized_pnl) || parseFloat(t.totalPnl) || 0) > 0).length;
  const winRate = closedTrades.length > 0 ? (winCount / closedTrades.length * 100) : null;

  const totalPnl = trades.reduce((s: number, t: any) => {
    const isActive = (t.status || '').toLowerCase() === 'active';
    return s + (isActive
      ? (parseFloat(t.unrealized_pnl) || parseFloat(t.activePnl) || 0)
      : (parseFloat(t.realized_pnl) || parseFloat(t.totalPnl) || parseFloat(t.pnl) || 0));
  }, 0);

  const realizedPnl = closedTrades.reduce((s: number, t: any) =>
    s + (parseFloat(t.realized_pnl) || parseFloat(t.totalPnl) || parseFloat(t.pnl) || 0), 0);
  const unrealizedPnl = activeTrades.reduce((s: number, t: any) =>
    s + (parseFloat(t.unrealized_pnl) || parseFloat(t.activePnl) || 0), 0);

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

  const MetricCell = ({ label, value, color }: { label: string; value: string; color?: string }) => (
    <div style={{ textAlign: 'center' }}>
      <div style={{
        fontSize: '14px', fontWeight: 800, fontFamily: 'var(--font-mono, monospace)',
        color: color || 'var(--color-text)', lineHeight: 1.2,
      }}>
        {value}
      </div>
      <div style={{ fontSize: '8px', fontWeight: 700, color: 'var(--color-text-secondary)', letterSpacing: '0.8px', textTransform: 'uppercase' as const, marginTop: 2 }}>
        {label}
      </div>
    </div>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        background: 'var(--color-surface)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        border: `1px solid ${isRunning ? brain.color + '25' : 'var(--color-border)'}`,
        borderRadius: 16,
        boxShadow: isRunning
          ? `0 0 24px ${brain.glow}, var(--shadow-card)`
          : 'var(--shadow-card)',
        overflow: 'hidden',
        position: 'relative' as const,
        display: 'flex',
        flexDirection: 'column' as const,
      }}
      whileHover={{
        boxShadow: `0 0 36px ${brain.glow}, 0 6px 30px rgba(0,0,0,0.6)`,
        translateY: -2,
      }}
    >
      {/* Top accent bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '2px',
        background: isRunning
          ? `linear-gradient(90deg, transparent, ${brain.color}88, transparent)`
          : 'linear-gradient(90deg, transparent, var(--color-border), transparent)',
      }} />

      {/* ── Header: Segment + Name + Status ── */}
      <div style={{ padding: '14px 14px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          {/* Segment icon */}
          <div style={{
            width: 34, height: 34, borderRadius: 10, flexShrink: 0,
            background: `${segment.color}15`,
            border: `1px solid ${segment.color}30`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16,
          }}>
            {segment.icon}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: '13px', fontWeight: 700, color: 'var(--color-text)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {segment.name}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
              {isRunning && <span className="live-dot" />}
              <span style={{ fontSize: '10px', fontWeight: 600, color: isRunning ? brain.color : 'var(--color-text-secondary)' }}>
                {isRunning ? 'Running' : 'Stopped'}
              </span>
              <span style={{
                fontSize: '9px', fontWeight: 700, padding: '1px 5px', borderRadius: 4,
                background: botMode === 'live' ? 'rgba(239,68,68,0.12)' : 'rgba(6,182,212,0.1)',
                color: botMode === 'live' ? '#EF4444' : '#06B6D4',
              }}>
                {botMode === 'live' ? 'Live' : 'Paper'}
              </span>
            </div>
          </div>
        </div>
        {/* Active count badge */}
        {activeTrades.length > 0 && (
          <div style={{
            width: 26, height: 26, borderRadius: 8,
            background: 'rgba(0,229,255,0.1)', border: '1px solid rgba(0,229,255,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '13px', fontWeight: 800, fontFamily: 'var(--font-mono, monospace)', color: '#00E5FF',
          }}>
            {activeTrades.length}
          </div>
        )}
      </div>

      {/* ── PnL Hero: Realized + Unrealized ── */}
      <div style={{ padding: '10px 14px 6px' }}>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginBottom: 4 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              fontSize: '16px', fontWeight: 800, fontFamily: 'var(--font-mono, monospace)',
              color: pnlColor(realizedPnl), lineHeight: 1,
            }}>
              {sign(realizedPnl)}${Math.abs(realizedPnl).toFixed(2)}
            </div>
            <div style={{ fontSize: '8px', fontWeight: 700, color: 'var(--color-text-secondary)', letterSpacing: '0.8px', textTransform: 'uppercase' as const, marginTop: 2 }}>
              Realized
            </div>
          </div>
          <div style={{ width: 1, background: 'var(--color-border)', alignSelf: 'stretch' }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{
              fontSize: '16px', fontWeight: 800, fontFamily: 'var(--font-mono, monospace)',
              color: pnlColor(unrealizedPnl), lineHeight: 1,
            }}>
              {sign(unrealizedPnl)}${Math.abs(unrealizedPnl).toFixed(2)}
            </div>
            <div style={{ fontSize: '8px', fontWeight: 700, color: 'var(--color-text-secondary)', letterSpacing: '0.8px', textTransform: 'uppercase' as const, marginTop: 2 }}>
              Unrealized
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <span style={{
            fontSize: '11px', fontWeight: 700, fontFamily: 'var(--font-mono, monospace)',
            color: pnlColor(totalPnl),
          }}>
            Total: {sign(totalPnl)}${Math.abs(totalPnl).toFixed(2)}
          </span>
        </div>
      </div>

      {/* ── 3-col metrics: Win Rate | Active | ROI ── */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0,
        padding: '0 14px 10px',
      }}>
        <MetricCell
          label="Win Rate"
          value={winRate !== null ? `${winRate.toFixed(0)}%` : '—'}
          color={winRate !== null && winRate >= 50 ? '#22C55E' : '#9CA3AF'}
        />
        <MetricCell
          label="Active"
          value={`${activeTrades.length}`}
          color={activeTrades.length > 0 ? '#00E5FF' : '#9CA3AF'}
        />
        <MetricCell
          label="ROI"
          value={`${sign(roiPct)}${roiPct.toFixed(1)}%`}
          color={pnlColor(roiPct)}
        />
      </div>

      {/* ── Capital bar ── */}
      <div style={{ padding: '0 14px 12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: '8px', fontWeight: 700, color: 'var(--color-text-secondary)', letterSpacing: '0.8px', textTransform: 'uppercase' as const }}>Capital</span>
          <span style={{ fontSize: '10px', fontWeight: 700, fontFamily: 'monospace', color: 'var(--color-text-secondary)' }}>
            ${capitalDeployed}<span style={{ color: 'var(--color-text-secondary)', opacity: 0.6 }}>/${maxCapital}</span>
          </span>
        </div>
        <div style={{ height: 4, borderRadius: 4, background: 'var(--color-border)', overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 4, width: `${deployedPct}%`,
            background: deployedPct > 75
              ? 'linear-gradient(90deg, #F59E0B, #D97706)'
              : 'linear-gradient(90deg, #06B6D4, #22D3EE)',
            transition: 'width 0.5s ease',
          }} />
        </div>
      </div>

      {/* ── Action buttons ── */}
      <div style={{
        display: 'flex', gap: 6, padding: '0 14px 12px',
        borderTop: '1px solid var(--color-border)', paddingTop: 10,
      }}>
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(bot?.id ?? '', isRunning); }}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            padding: '7px 0', borderRadius: 8,
            background: isRunning
              ? 'rgba(239,68,68,0.1)' : `${brain.color}15`,
            color: isRunning ? '#EF4444' : brain.color,
            border: `1px solid ${isRunning ? 'rgba(239,68,68,0.25)' : brain.color + '25'}`,
            fontSize: '11px', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s',
          }}
        >
          {isRunning
            ? <><Square style={{ width: 11, height: 11 }} /> Stop</>
            : <><Play style={{ width: 11, height: 11 }} /> Start</>
          }
        </button>

        <button
          onClick={(e) => { e.stopPropagation(); setShowSettings(!showSettings); setDeleteConfirm(false); }}
          title="Settings"
          style={{
            width: 32, height: 32, borderRadius: 8, cursor: 'pointer',
            background: showSettings ? 'var(--color-primary-transparent)' : 'var(--color-surface-light)',
            color: showSettings ? 'var(--color-primary)' : 'var(--color-text-secondary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s',
            border: '1px solid var(--color-border)',
          }}
        ><Settings style={{ width: 13, height: 13 }} /></button>

        {onDelete && (
          <button
            onClick={(e) => { e.stopPropagation(); handleDeleteClick(); }}
            title={deleteConfirm ? 'Click again to confirm' : 'Delete bot'}
            style={{
              width: 32, height: 32, borderRadius: 8, cursor: 'pointer',
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
              padding: '12px 14px',
              background: 'var(--color-surface-light)',
            }}>
              <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-primary)', marginBottom: 10, letterSpacing: '0.8px', textTransform: 'uppercase' as const }}>
                ⚙️ Configuration
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
                <div>
                  <label style={{ display: 'block', fontSize: '9px', color: 'var(--color-text-secondary)', marginBottom: 3, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.5px' }}>Mode</label>
                  <select value={settingsMode} onChange={(e) => setSettingsMode(e.target.value)} className="input-field" style={{ fontSize: '12px', width: '100%' }}>
                    <option value="paper">🟢 Paper</option>
                    <option value="live">🔴 Live</option>
                  </select>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '9px', color: 'var(--color-text-secondary)', marginBottom: 3, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.5px' }}>Capital/Trade ($)</label>
                    <input type="number" value={settingsCPT}
                      onChange={(e) => setSettingsCPT(Number(e.target.value))}
                      className="input-field" style={{ fontSize: '12px', fontFamily: 'monospace', width: '100%', background: 'var(--color-background)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '9px', color: 'var(--color-text-secondary)', marginBottom: 3, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.5px' }}>Max Trades</label>
                    <input type="number" value={settingsMaxTrades}
                      onChange={(e) => setSettingsMaxTrades(Number(e.target.value))}
                      className="input-field" style={{ fontSize: '12px', fontFamily: 'monospace', width: '100%', background: 'var(--color-background)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                  <button onClick={handleSaveSettings} disabled={saving}
                    style={{
                      flex: 1, padding: '7px 0', borderRadius: 8, border: '1px solid var(--color-primary)',
                      background: 'var(--color-primary-transparent)', color: 'var(--color-primary)',
                      fontSize: '11px', fontWeight: 700, cursor: saving ? 'wait' : 'pointer',
                      opacity: saving ? 0.7 : 1,
                    }}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => setShowSettings(false)}
                    style={{
                      flex: 1, padding: '7px 0', borderRadius: 8, border: '1px solid var(--color-border)',
                      background: 'transparent', color: 'var(--color-text-secondary)',
                      fontSize: '11px', fontWeight: 700, cursor: 'pointer',
                    }}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
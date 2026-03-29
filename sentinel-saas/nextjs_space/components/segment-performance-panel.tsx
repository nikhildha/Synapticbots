'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

const SEGMENT_META: Record<string, { icon: string; color: string }> = {
  L1:      { icon: '🔷', color: '#A78BFA' },
  L2:      { icon: '🔗', color: '#22D3EE' },
  DeFi:    { icon: '🌊', color: '#34D399' },
  Gaming:  { icon: '🎮', color: '#FBBF24' },
  AI:      { icon: '🤖', color: '#F472B6' },
  RWA:     { icon: '🏦', color: '#60A5FA' },
  Meme:    { icon: '🐸', color: '#FCD34D' },
  DePIN:   { icon: '📡', color: '#F97316' },
  Modular: { icon: '🧩', color: '#8B5CF6' },
  ALL:     { icon: '⚡', color: '#22C55E' },
};

const pnlColor = (v: number) => v >= 0 ? '#22C55E' : '#EF4444';
const sign = (v: number) => v >= 0 ? '+' : '';
const fmt$ = (v: number) => `${sign(v)}$${Math.abs(v).toFixed(2)}`;
const fmtPct = (v: number) => `${sign(v)}${Math.abs(v).toFixed(1)}%`;

interface BotPeriod { name: string; from: string; to: string; pnl: number; }

interface SegmentStats {
  segment: string;
  totalPnl: number;
  totalCapital: number;
  roi: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
  closedTradeCount: number;
  sessionCount: number;
  botCount: number;
  botPeriods: BotPeriod[];
}

interface Props {
  segments: SegmentStats[];
}

function StatPill({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ textAlign: 'center', minWidth: 64 }}>
      <div style={{ fontSize: 14, fontWeight: 800, fontFamily: 'monospace', color: color || 'var(--color-text)', lineHeight: 1.2 }}>
        {value}
      </div>
      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.6px', textTransform: 'uppercase', marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}

function SegmentCard({ seg, index }: { seg: SegmentStats; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const meta = SEGMENT_META[seg.segment] || { icon: '📊', color: '#6B7280' };
  const sharpeColor = seg.sharpeRatio >= 1.5 ? '#22C55E' : seg.sharpeRatio >= 0.8 ? '#F59E0B' : '#EF4444';
  const ddColor = seg.maxDrawdown <= 5 ? '#22C55E' : seg.maxDrawdown <= 12 ? '#F59E0B' : '#EF4444';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      style={{
        background: 'rgba(13,20,32,0.7)',
        backdropFilter: 'blur(12px)',
        border: `1px solid ${meta.color}20`,
        borderRadius: 14,
        overflow: 'hidden',
      }}
    >
      {/* Card Header */}
      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          {/* Segment icon */}
          <div style={{
            width: 38, height: 38, borderRadius: 10, flexShrink: 0,
            background: `${meta.color}15`, border: `1px solid ${meta.color}30`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
          }}>
            {meta.icon}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text)' }}>{seg.segment}</div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 1 }}>
              {seg.botCount} retired bot{seg.botCount !== 1 ? 's' : ''} · {seg.closedTradeCount} trades · {seg.sessionCount} sessions
            </div>
          </div>
          {/* Total PnL */}
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'monospace', color: pnlColor(seg.totalPnl), lineHeight: 1 }}>
              {fmt$(seg.totalPnl)}
            </div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2, letterSpacing: '0.5px' }}>TOTAL P&L</div>
          </div>
        </div>

        {/* Metrics Row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, padding: '10px 0', borderTop: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>
          <StatPill label="ROI" value={fmtPct(seg.roi)} color={pnlColor(seg.roi)} />
          <StatPill label="Win Rate" value={`${seg.winRate.toFixed(0)}%`} color={seg.winRate >= 55 ? '#22C55E' : seg.winRate >= 45 ? '#F59E0B' : '#EF4444'} />
          <StatPill label="Sharpe" value={seg.sharpeRatio.toFixed(2)} color={sharpeColor} />
          <StatPill label="Max DD" value={`-${seg.maxDrawdown.toFixed(1)}%`} color={ddColor} />
        </div>

        {/* Mini win-rate bar */}
        <div style={{ marginTop: 10 }}>
          <div style={{ height: 3, borderRadius: 3, background: 'var(--color-border)', overflow: 'hidden' }}>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${seg.winRate}%` }}
              transition={{ duration: 0.8, delay: index * 0.05 + 0.3 }}
              style={{
                height: '100%', borderRadius: 3,
                background: `linear-gradient(90deg, ${meta.color}88, ${meta.color})`,
              }}
            />
          </div>
        </div>

        {/* Expand toggle */}
        {seg.botPeriods.length > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              marginTop: 10, display: 'flex', alignItems: 'center', gap: 4,
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontSize: 11, color: 'var(--color-text-secondary)', padding: 0,
            }}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {expanded ? 'Hide' : 'Show'} retired bots
          </button>
        )}
      </div>

      {/* Expanded: Bot Period List */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ padding: '0 16px 14px', borderTop: '1px solid var(--color-border)' }}>
              <div style={{ paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {seg.botPeriods.map((bp, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '7px 10px', borderRadius: 8,
                    background: 'rgba(255,255,255,0.03)', border: '1px solid var(--color-border)',
                  }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text)' }}>
                        🏛 {bp.name}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 1 }}>
                        {bp.from} → {bp.to}
                      </div>
                    </div>
                    <div style={{
                      fontFamily: 'monospace', fontSize: 13, fontWeight: 700,
                      color: pnlColor(bp.pnl),
                    }}>
                      {fmt$(bp.pnl)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export function SegmentPerformancePanel({ segments }: Props) {
  if (!segments || segments.length === 0) return null;

  const totalRetiredPnl = segments.reduce((s, seg) => s + seg.totalPnl, 0);
  const totalRetiredBots = segments.reduce((s, seg) => s + seg.botCount, 0);
  const totalTrades = segments.reduce((s, seg) => s + seg.closedTradeCount, 0);

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ marginTop: 40 }}
    >
      {/* Section Header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 18 }}>🏛</span>
            <h2 style={{ fontSize: 20, fontWeight: 800, margin: 0, color: 'var(--color-text)', letterSpacing: '-0.02em' }}>
              Retirement & Segment Analytics
            </h2>
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: 0 }}>
            Historical performance of your retired bots, aggregated by segment
          </p>
        </div>
        {/* Summary stats */}
        <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 2 }}>{totalRetiredBots} retired bots · {totalTrades} trades</div>
            <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'monospace', color: pnlColor(totalRetiredPnl) }}>
              {fmt$(totalRetiredPnl)} <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)' }}>archived PnL</span>
            </div>
          </div>
        </div>
      </div>

      {/* Segment Cards Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
        gap: 14,
      }}>
        {segments.map((seg, i) => (
          <SegmentCard key={seg.segment} seg={seg} index={i} />
        ))}
      </div>
    </motion.section>
  );
}

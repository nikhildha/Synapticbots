'use client';

import { motion } from 'framer-motion';
import { Header } from '@/components/header';

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
const fmt$ = (v: number) => `${sign(v)}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (v: number) => `${sign(v)}${Math.abs(v).toFixed(1)}%`;

interface SegmentStats {
  segment: string;
  totalPnl: number;
  totalCapital: number;
  roi: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
  closedTradeCount: number;
  totalBots: number;
  retiredBots: number;
  activeBots: number;
  uniqueUsers: number;
}

interface Summary {
  totalUsers?: number;
  totalBots?: number;
  totalTrades?: number;
  totalPlatformPnl?: number;
}

interface Props { segments: SegmentStats[]; summary: Summary; }

function StatBlock({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'monospace', color: color || 'var(--color-text)', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: pnlColor(parseFloat(sub)), fontWeight: 700, marginTop: 2 }}>{sub}</div>}
      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.7px', textTransform: 'uppercase', marginTop: 3 }}>{label}</div>
    </div>
  );
}

export function SegmentIntelligenceClient({ segments, summary }: Props) {
  const sharpeColor = (v: number) => v >= 1.5 ? '#22C55E' : v >= 0.8 ? '#F59E0B' : '#EF4444';
  const ddColor = (v: number) => v <= 5 ? '#22C55E' : v <= 12 ? '#F59E0B' : '#EF4444';

  return (
    <div className="min-h-screen">
      <Header />
      <main style={{ paddingTop: 96, paddingBottom: 60, paddingLeft: 24, paddingRight: 24 }}>
        <div style={{ maxWidth: 1280, margin: '0 auto' }}>

          {/* Page Header */}
          <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: 36 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase',
                padding: '3px 10px', borderRadius: 6,
                background: 'rgba(239,68,68,0.1)', color: '#F87171', border: '1px solid rgba(239,68,68,0.2)',
              }}>Admin Only</span>
              <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>Platform-wide · Anonymized</span>
            </div>
            <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 6px', letterSpacing: '-0.03em' }}>
              <span className="text-gradient">🌐 Global Segment Intelligence</span>
            </h1>
            <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: 0 }}>
              Aggregated performance across all users and segments. No individual user data is exposed.
            </p>
          </motion.div>

          {/* Platform Summary Bar */}
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            style={{
              display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1,
              background: 'rgba(13,20,32,0.8)', backdropFilter: 'blur(12px)',
              border: '1px solid var(--color-border)', borderRadius: 14,
              padding: '20px 24px', marginBottom: 32,
            }}
          >
            <StatBlock label="Total Users" value={String(summary.totalUsers ?? 0)} color="var(--color-info)" />
            <StatBlock label="Total Bots" value={String(summary.totalBots ?? 0)} color="var(--color-text)" />
            <StatBlock label="Total Trades" value={String(summary.totalTrades ?? 0)} color="var(--color-text)" />
            <StatBlock label="Platform P&L" value={fmt$(summary.totalPlatformPnl ?? 0)} color={pnlColor(summary.totalPlatformPnl ?? 0)} />
          </motion.div>

          {/* Segment Table */}
          {segments.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: 60,
              background: 'rgba(13,20,32,0.6)', border: '1px solid var(--color-border)', borderRadius: 14,
            }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>📊</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)', marginBottom: 6 }}>No data yet</div>
              <div style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Segment intelligence populates as users deploy and retire bots.</div>
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}
              style={{
                background: 'rgba(13,20,32,0.7)', backdropFilter: 'blur(12px)',
                border: '1px solid var(--color-border)', borderRadius: 14, overflow: 'hidden',
              }}
            >
              {/* Table Header */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '160px 1fr 90px 90px 90px 90px 80px 80px 70px',
                gap: 0, padding: '10px 16px',
                borderBottom: '1px solid var(--color-border)',
                background: 'rgba(0,0,0,0.3)',
              }}>
                {['Segment', 'Platform P&L', 'ROI', 'Win Rate', 'Sharpe', 'Max DD', 'Trades', 'Bots', 'Users'].map(h => (
                  <div key={h} style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.7px', textTransform: 'uppercase', textAlign: h === 'Segment' ? 'left' : 'center' }}>{h}</div>
                ))}
              </div>

              {/* Table Rows */}
              {segments.map((seg, i) => {
                const meta = SEGMENT_META[seg.segment] || { icon: '📊', color: '#6B7280' };
                const isTop = i === 0;
                return (
                  <motion.div
                    key={seg.segment}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 + 0.2 }}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '160px 1fr 90px 90px 90px 90px 80px 80px 70px',
                      gap: 0, padding: '14px 16px',
                      borderBottom: i < segments.length - 1 ? '1px solid var(--color-border)' : 'none',
                      background: isTop ? `${meta.color}06` : 'transparent',
                      borderLeft: isTop ? `3px solid ${meta.color}` : '3px solid transparent',
                    }}
                  >
                    {/* Segment Name */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                        background: `${meta.color}15`, border: `1px solid ${meta.color}25`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
                      }}>{meta.icon}</div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)' }}>{seg.segment}</div>
                        <div style={{ fontSize: 9, color: 'var(--color-text-muted)' }}>{seg.retiredBots} retired · {seg.activeBots} active</div>
                      </div>
                    </div>

                    {/* Platform P&L */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 14, color: pnlColor(seg.totalPnl) }}>
                        {fmt$(seg.totalPnl)}
                      </span>
                    </div>

                    {/* ROI */}
                    <div style={{ textAlign: 'center', fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: pnlColor(seg.roi) }}>
                      {fmtPct(seg.roi)}
                    </div>

                    {/* Win Rate */}
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: seg.winRate >= 55 ? '#22C55E' : seg.winRate >= 45 ? '#F59E0B' : '#EF4444' }}>
                        {seg.winRate.toFixed(0)}%
                      </div>
                    </div>

                    {/* Sharpe */}
                    <div style={{ textAlign: 'center', fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: sharpeColor(seg.sharpeRatio) }}>
                      {seg.sharpeRatio.toFixed(2)}
                    </div>

                    {/* Max Drawdown */}
                    <div style={{ textAlign: 'center', fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: ddColor(seg.maxDrawdown) }}>
                      -{seg.maxDrawdown.toFixed(1)}%
                    </div>

                    {/* Trades */}
                    <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>
                      {seg.closedTradeCount.toLocaleString()}
                    </div>

                    {/* Bots */}
                    <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>
                      {seg.totalBots}
                    </div>

                    {/* Users (count only — anonymized) */}
                    <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>
                      {seg.uniqueUsers}
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          )}

          <div style={{ marginTop: 24, fontSize: 11, color: 'var(--color-text-muted)', textAlign: 'center' }}>
            🔒 All data is anonymized — individual user identities are never exposed. User count reflects unique participants per segment.
          </div>
        </div>
      </main>
    </div>
  );
}

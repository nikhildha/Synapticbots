'use client';

import { useState, useEffect, useCallback } from 'react';
import { Sparkline } from './equity-curve';

const PROFIT = '#1D9E75';
const LOSS = '#D85A30';
const BRAND_BLUE = '#3E5EA6';
const fmt$ = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(2);

const RANK_STYLES = [
  { bg: 'linear-gradient(135deg,#B8860B,#FFD700)', color: '#111', label: '🥇 #1' },
  { bg: 'linear-gradient(135deg,#707070,#C0C0C0)', color: '#111', label: '🥈 #2' },
  { bg: 'linear-gradient(135deg,#8B4513,#CD7F32)', color: '#fff', label: '🥉 #3' },
];

// Simple SVG radar chart for 4 health pillars
function HealthRadar({ scores }: { scores: { label: string; pct: number }[] }) {
  const cx = 70, cy = 70, r = 50;
  const n = scores.length;
  const pts = scores.map((_, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    return {
      full: { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) },
      val: { x: cx + r * (scores[i].pct / 100) * Math.cos(angle), y: cy + r * (scores[i].pct / 100) * Math.sin(angle) },
      label: { x: cx + (r + 18) * Math.cos(angle), y: cy + (r + 18) * Math.sin(angle) },
    };
  });
  const gridPath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.full.x.toFixed(1)},${p.full.y.toFixed(1)}`).join(' ') + 'Z';
  const valuePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.val.x.toFixed(1)},${p.val.y.toFixed(1)}`).join(' ') + 'Z';
  return (
    <svg viewBox="0 0 140 140" style={{ width: 140, height: 140 }}>
      <path d={gridPath} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
      {/* Half-grid */}
      {pts.map((p, i) => {
        const halfAngle = (i / n) * Math.PI * 2 - Math.PI / 2;
        return (
          <line key={i} x1={cx} y1={cy} x2={p.full.x.toFixed(1)} y2={p.full.y.toFixed(1)} stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
        );
      })}
      <path d={valuePath} fill="rgba(62,94,166,0.25)" stroke={BRAND_BLUE} strokeWidth="2" />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.val.x} cy={p.val.y} r="3" fill={BRAND_BLUE} />
          <text x={p.label.x} y={p.label.y} textAnchor="middle" dominantBaseline="middle" fill="#6B7280" fontSize="8" fontWeight="600">{scores[i].label}</text>
        </g>
      ))}
    </svg>
  );
}

export function FleetDashboard() {
  const [bots, setBots] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'healthScore' | 'totalPnl' | 'winRate'>('healthScore');
  const [modeFilter, setModeFilter] = useState<'all' | 'paper' | 'live'>('all');

  const fetchFleet = useCallback(async () => {
    try {
      const res = await fetch('/api/journal/fleet', { cache: 'no-store' });
      if (res.ok) { const d = await res.json(); setBots(d.bots || []); }
    } catch { } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchFleet(); const t = setInterval(fetchFleet, 15000); return () => clearInterval(t); }, [fetchFleet]);

  const filtered = bots
    .filter(b => modeFilter === 'all' || b.mode === modeFilter)
    .sort((a, b) => (b.metrics[sortBy] || 0) - (a.metrics[sortBy] || 0));

  if (loading) return <div style={{ padding: '60px', textAlign: 'center', color: '#6B7280' }}>Loading fleet…</div>;
  if (!bots.length) return (
    <div style={{ padding: '80px', textAlign: 'center', color: '#4B5563' }}>
      <div style={{ fontSize: '40px', marginBottom: '12px' }}>🤖</div>
      <div style={{ fontSize: '16px', fontWeight: 600, color: '#9CA3AF' }}>No bots found</div>
      <div style={{ fontSize: '13px', marginTop: '6px' }}>Create and deploy bots to see your fleet here</div>
    </div>
  );

  return (
    <div>
      {/* Controls */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: '6px' }}>
          {(['all', 'paper', 'live'] as const).map(m => (
            <button key={m} onClick={() => setModeFilter(m)} style={{ padding: '6px 14px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 600, background: modeFilter === m ? BRAND_BLUE : 'rgba(255,255,255,0.06)', color: modeFilter === m ? '#fff' : '#9CA3AF' }}>
              {m === 'all' ? `All (${bots.length})` : m === 'paper' ? `🟢 Paper (${bots.filter(b => b.mode === 'paper').length})` : `⚡ Live (${bots.filter(b => b.mode === 'live').length})`}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: '#6B7280' }}>Sort:</span>
          {([['healthScore', 'Health Score'], ['totalPnl', 'PnL'], ['winRate', 'Win Rate']] as const).map(([key, label]) => (
            <button key={key} onClick={() => setSortBy(key)} style={{ padding: '5px 12px', borderRadius: '7px', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: 600, background: sortBy === key ? 'rgba(62,94,166,0.3)' : 'rgba(255,255,255,0.05)', color: sortBy === key ? BRAND_BLUE : '#6B7280' }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Bot rank grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '14px' }}>
        {filtered.map((bot, idx) => {
          const rankStyle = idx < 3 ? RANK_STYLES[idx] : null;
          const isActive = bot.isActive;
          const pnlC = bot.metrics.totalPnl >= 0 ? PROFIT : LOSS;
          const radarScores = [
            { label: 'Sharpe', pct: Math.min(100, (bot.metrics.sharpeEstimate / 2) * 100) },
            { label: 'WinRate', pct: bot.metrics.winRate },
            { label: 'PF', pct: Math.min(100, ((bot.metrics.profitFactor - 1) / 2) * 100) },
            { label: 'DD Ctrl', pct: Math.max(0, 100 - bot.metrics.maxDrawdownPct * 2) },
          ];

          return (
            <div key={bot.id} style={{ background: 'rgba(17,24,39,0.9)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '16px', padding: '20px', position: 'relative', overflow: 'hidden' }}>
              {/* Top accent bar */}
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: rankStyle ? rankStyle.bg : 'rgba(62,94,166,0.4)' }} />

              {/* Header row */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '14px' }}>
                <div>
                  {rankStyle && (
                    <div style={{ fontSize: '11px', fontWeight: 700, marginBottom: '4px', color: '#F59E0B' }}>{rankStyle.label}</div>
                  )}
                  {!rankStyle && (
                    <div style={{ fontSize: '11px', color: '#6B7280', marginBottom: '4px' }}>#{bot.rank}</div>
                  )}
                  <div style={{ fontSize: '16px', fontWeight: 700, color: '#F0F4F8' }}>{bot.name}</div>
                  <div style={{ fontSize: '11px', color: '#6B7280', marginTop: '2px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span style={{ padding: '2px 7px', borderRadius: '5px', background: bot.mode === 'live' ? 'rgba(216,90,48,0.1)' : 'rgba(62,94,166,0.1)', color: bot.mode === 'live' ? '#F59E0B' : BRAND_BLUE, fontWeight: 600, fontSize: '10px' }}>
                      {bot.mode === 'live' ? '⚡ LIVE' : '🟢 PAPER'}
                    </span>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: isActive ? PROFIT : '#4B5563', display: 'inline-block' }} />
                    <span style={{ color: isActive ? PROFIT : '#4B5563', fontSize: '10px', fontWeight: 600 }}>{isActive ? 'ACTIVE' : 'STOPPED'}</span>
                  </div>
                </div>
                {/* Health Score badge */}
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '28px', fontWeight: 800, color: bot.metrics.healthScore >= 60 ? PROFIT : bot.metrics.healthScore >= 35 ? '#F59E0B' : LOSS, lineHeight: 1 }}>
                    {bot.metrics.healthScore}
                  </div>
                  <div style={{ fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#4B5563', marginTop: '2px' }}>Health</div>
                </div>
              </div>

              {/* Stats grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '14px' }}>
                {[
                  { label: 'PnL', value: '$' + fmt$(bot.metrics.totalPnl), color: pnlC },
                  { label: 'Win%', value: bot.metrics.winRate.toFixed(1) + '%', color: bot.metrics.winRate >= 50 ? PROFIT : LOSS },
                  { label: 'Trades', value: String(bot.metrics.totalTrades), color: '#F0F4F8' },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '8px', padding: '8px 10px', textAlign: 'center' }}>
                    <div style={{ fontSize: '10px', color: '#4B5563', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '3px' }}>{label}</div>
                    <div style={{ fontSize: '14px', fontWeight: 700, color }}>{value}</div>
                  </div>
                ))}
              </div>

              {/* Sparkline + Radar side by side */}
              <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
                {bot.sparkline?.length >= 2 ? (
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '9px', color: '#4B5563', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '5px' }}>Equity</div>
                    <Sparkline points={bot.sparkline} width={100} height={36} />
                  </div>
                ) : (
                  <div style={{ flex: 1, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                    <span style={{ fontSize: '10px', color: '#4B5563' }}>No data</span>
                  </div>
                )}
                {/* Health radar */}
                <div>
                  <HealthRadar scores={radarScores} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

'use client';

import { useState, useEffect, useCallback } from 'react';
import { EquityCurve } from './equity-curve';

const PROFIT = '#1D9E75';
const LOSS = '#D85A30';
const BRAND_BLUE = '#3E5EA6';
const fmt$ = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(2);

export function CompareView() {
  const [paperData, setPaperData] = useState<any>(null);
  const [liveData, setLiveData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchBoth = useCallback(async () => {
    try {
      const [p, l] = await Promise.all([
        fetch('/api/journal?mode=paper').then(r => r.ok ? r.json() : null),
        fetch('/api/journal?mode=live').then(r => r.ok ? r.json() : null),
      ]);
      setPaperData(p);
      setLiveData(l);
    } catch { } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchBoth(); const t = setInterval(fetchBoth, 30000); return () => clearInterval(t); }, [fetchBoth]);

  if (loading) return <div style={{ padding: '60px', textAlign: 'center', color: '#6B7280' }}>Loading comparison…</div>;

  const pm = paperData?.metrics || {};
  const lm = liveData?.metrics || {};
  const hasPaper = (pm.closedTrades || 0) > 0;
  const hasLive = (lm.closedTrades || 0) > 0;

  if (!hasPaper) {
    return (
      <div style={{ padding: '80px', textAlign: 'center', color: '#4B5563' }}>
        <div style={{ fontSize: '40px', marginBottom: '12px' }}>📊</div>
        <div style={{ fontSize: '16px', fontWeight: 600, color: '#9CA3AF' }}>No comparison data yet</div>
        <div style={{ fontSize: '13px', marginTop: '6px' }}>Need at least some closed paper trades to compare.</div>
      </div>
    );
  }

  // Execution Drift: paper realized % - live realized %
  const paperRoiPct = pm.closedTrades > 0 ? (pm.realizedPnl / Math.max(pm.closedTrades, 1)) : 0;
  const liveRoiPct = lm.closedTrades > 0 ? (lm.realizedPnl / Math.max(lm.closedTrades, 1)) : 0;
  const drift = paperRoiPct - liveRoiPct;
  const driftColor = drift <= 0 ? PROFIT : Math.abs(drift) < 5 ? '#F59E0B' : LOSS;

  const rows = [
    { label: 'Total Trades', paper: pm.totalTrades || 0, live: lm.totalTrades || 0 },
    { label: 'Win Rate', paper: (pm.winRate || 0).toFixed(1) + '%', live: (lm.winRate || 0).toFixed(1) + '%' },
    { label: 'Realized PnL', paper: '$' + fmt$(pm.realizedPnl || 0), live: '$' + fmt$(lm.realizedPnl || 0) },
    { label: 'Profit Factor', paper: pm.profitFactor >= 999 ? '∞' : (pm.profitFactor || 0).toFixed(2), live: lm.profitFactor >= 999 ? '∞' : (lm.profitFactor || 0).toFixed(2) },
    { label: 'Max Drawdown', paper: (pm.maxDrawdownPct || 0).toFixed(2) + '%', live: (lm.maxDrawdownPct || 0).toFixed(2) + '%' },
    { label: 'Sharpe (est.)', paper: pm.sharpeEstimate || 0, live: lm.sharpeEstimate || 0 },
    { label: 'Avg R/R', paper: (pm.avgRR || 0).toFixed(2) + 'R', live: (lm.avgRR || 0).toFixed(2) + 'R' },
  ];

  return (
    <div>
      {/* Drift Score Hero */}
      <div style={{ background: 'rgba(17,24,39,0.85)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '14px', padding: '28px', marginBottom: '20px', textAlign: 'center' }}>
        <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.2px', color: '#6B7280', marginBottom: '12px' }}>Execution Drift Score</div>
        <div style={{ fontSize: '52px', fontWeight: 800, color: driftColor, lineHeight: 1.1, marginBottom: '8px' }}>
          {drift >= 0 ? '+' : ''}{drift.toFixed(2)}
        </div>
        <div style={{ fontSize: '13px', color: '#6B7280', marginBottom: '16px' }}>
          Paper avg/trade: <strong style={{ color: '#F0F4F8' }}>${paperRoiPct.toFixed(2)}</strong> vs Live avg/trade: <strong style={{ color: '#F0F4F8' }}>${liveRoiPct.toFixed(2)}</strong>
        </div>
        <div style={{ display: 'inline-block', padding: '8px 18px', borderRadius: '10px', background: drift <= 0 ? 'rgba(29,158,117,0.1)' : 'rgba(216,90,48,0.1)', color: driftColor, fontWeight: 600, fontSize: '13px' }}>
          {drift <= 0 ? '✓ Live is matching or beating simulation' : `⚠ Live underperforming paper by ${fmt$(drift)} per trade`}
        </div>
        {!hasLive && <div style={{ marginTop: '12px', fontSize: '12px', color: '#4B5563' }}>⚡ No closed live trades yet — drift calculated from paper baseline only</div>}
      </div>

      {/* Side-by-Side Equity Curves */}
      {(pm.equityCurve?.length >= 2 || lm.equityCurve?.length >= 2) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
          {[ { label: '🟢 Paper Equity Curve', data: pm, color: BRAND_BLUE }, { label: '⚡ Live Equity Curve', data: lm, color: PROFIT } ].map(({ label, data, color }) => (
            <div key={label} style={{ background: 'rgba(17,24,39,0.85)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '14px', padding: '20px' }}>
              <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.2px', color: '#6B7280', marginBottom: '12px' }}>{label}</div>
              {data?.metrics?.equityCurve?.length >= 2
                ? <EquityCurve points={data.metrics.equityCurve} height={90} color={color} />
                : <div style={{ height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4B5563', fontSize: '12px' }}>Not enough data</div>
              }
            </div>
          ))}
        </div>
      )}

      {/* Side-by-Side Metric Comparison Table */}
      <div style={{ background: 'rgba(17,24,39,0.85)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '14px', padding: '20px' }}>
        <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.2px', color: '#6B7280', marginBottom: '16px' }}>Performance Comparison</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: '10px', color: '#4B5563', fontWeight: 700, textTransform: 'uppercase' }}>Metric</th>
              <th style={{ padding: '10px 12px', textAlign: 'center', color: BRAND_BLUE, fontSize: '11px', fontWeight: 700 }}>🟢 PAPER</th>
              <th style={{ padding: '10px 12px', textAlign: 'center', color: PROFIT, fontSize: '11px', fontWeight: 700 }}>⚡ LIVE</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ label, paper, live }) => (
              <tr key={label} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <td style={{ padding: '10px 12px', color: '#9CA3AF', fontSize: '12px' }}>{label}</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: '#F0F4F8' }}>{paper}</td>
                <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: hasLive ? '#F0F4F8' : '#4B5563' }}>
                  {hasLive ? live : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!hasLive && <div style={{ marginTop: '12px', fontSize: '12px', color: '#4B5563', textAlign: 'center' }}>⚡ Run live trades to see the comparison unfold</div>}
      </div>
    </div>
  );
}

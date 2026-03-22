'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { MetricCard } from './metric-card';
import { EquityCurve } from './equity-curve';
import { Download } from 'lucide-react';

// ─── Brand colors (PRD spec) ──────────────────────────────────────────────────
const BRAND_BLUE = '#3E5EA6';
const PROFIT = '#1D9E75';
const LOSS = '#D85A30';
const pnlColor = (v: number) => v > 0 ? PROFIT : v < 0 ? LOSS : '#6B7280';
const fmt$ = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(2);
const fmtPct = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
const fmtPrice = (v: number) => v >= 1 ? v.toFixed(4) : v.toFixed(6);

interface PaperJournalProps { userId?: string }

export function PaperJournal({ }: PaperJournalProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'closed'>('active');
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/journal?mode=paper', { cache: 'no-store' });
      if (res.ok) { setData(await res.json()); }
    } catch { /* silent */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); const t = setInterval(fetchData, 10000); return () => clearInterval(t); }, [fetchData]);

  // Live Binance prices for active trades
  useEffect(() => {
    const activeTrades = (data?.trades || []).filter((t: any) => t.status === 'active');
    if (!activeTrades.length) return;
    const symbols: string[] = [...new Set(activeTrades.map((t: any) => t.symbol).filter(Boolean))] as string[];
    const poll = async () => {
      try {
        const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(symbols))}`, { signal: AbortSignal.timeout(4000) });
        if (res.ok) {
          const arr: { symbol: string; price: string }[] = await res.json();
          const m: Record<string, number> = {};
          arr.forEach(({ symbol, price }) => { m[symbol] = parseFloat(price); });
          setLivePrices(m);
        }
      } catch { /* silent */ }
    };
    poll();
    const t = setInterval(poll, 3000);
    return () => clearInterval(t);
  }, [data?.trades]);

  const metrics = data?.metrics || {};
  const trades: any[] = data?.trades || [];
  const filtered = useMemo(() =>
    trades.filter(t => statusFilter === 'all' ? true : t.status === statusFilter),
    [trades, statusFilter]);

  const exportCSV = () => {
    if (!trades.length) return;
    const headers = ['ID', 'Coin', 'Side', 'Leverage', 'Capital', 'Entry', 'Exit', 'SL', 'TP', 'PnL $', 'PnL %', 'Status', 'Regime', 'Confidence', 'Entry Time', 'Exit Time', 'Exit Reason'];
    const rows = trades.map(t => [
      t.id, t.coin, t.side, t.leverage, t.capital,
      t.entryPrice, t.exitPrice || '', t.stopLoss, t.takeProfit,
      t.status === 'active' ? t.activePnl : t.totalPnl,
      t.status === 'active' ? t.activePnlPct : t.totalPnlPct,
      t.status, t.regime, t.confidence, t.entryTime, t.exitTime || '', t.exitReason || '',
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `journal_paper_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  if (loading) return <div style={{ padding: '60px', textAlign: 'center', color: '#6B7280' }}>Loading paper journal…</div>;
  if (!trades.length && !loading) return (
    <div style={{ padding: '80px', textAlign: 'center', color: '#4B5563' }}>
      <div style={{ fontSize: '40px', marginBottom: '12px' }}>📄</div>
      <div style={{ fontSize: '16px', fontWeight: 600, color: '#9CA3AF' }}>No paper trades yet</div>
      <div style={{ fontSize: '13px', marginTop: '6px' }}>Start a paper bot to see your simulated trades here</div>
    </div>
  );

  return (
    <div>
      {/* Metric Summary — 9 cards, 3 per row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
        <MetricCard label="Total Trades" value={String(metrics.totalTrades || 0)} sub={`${metrics.activeTrades || 0} active · ${metrics.closedTrades || 0} closed`} delay={0} />
        <MetricCard label="Win Rate" value={(metrics.winRate || 0).toFixed(1) + '%'} sub={`${metrics.closedTrades || 0} closed trades`} color={metrics.winRate >= 50 ? PROFIT : LOSS} delay={0.04} />
        <MetricCard label="Total PnL" value={'$' + fmt$(metrics.totalPnl || 0)} sub={`Realized: $${fmt$(metrics.realizedPnl || 0)} · Active: $${fmt$(metrics.unrealizedPnl || 0)}`} color={pnlColor(metrics.totalPnl || 0)} delay={0.08} />
        <MetricCard label="Profit Factor" value={(metrics.profitFactor || 0) === 999 ? '∞' : (metrics.profitFactor || 0).toFixed(2)} sub="Gross profit / gross loss" color={(metrics.profitFactor || 0) >= 1.5 ? PROFIT : LOSS} delay={0.12} />
        <MetricCard label="Avg R/R" value={(metrics.avgRR || 0).toFixed(2) + 'R'} sub={`Expectancy: $${(metrics.expectancy || 0).toFixed(2)}`} delay={0.16} />
        <MetricCard label="Max Drawdown" value={(metrics.maxDrawdownPct || 0).toFixed(2) + '%'} sub="Peak-to-trough" color={LOSS} delay={0.2} />
        <MetricCard label="Sharpe (est.)" value={(metrics.sharpeEstimate || 0) === 0 ? '—' : (metrics.sharpeEstimate || 0).toFixed(2)} sub="Annualised from daily PnL" color={(metrics.sharpeEstimate || 0) > 1 ? PROFIT : '#6B7280'} delay={0.24} />
        <MetricCard label="Realized PnL" value={'$' + fmt$(metrics.realizedPnl || 0)} sub="Closed trades only" color={pnlColor(metrics.realizedPnl || 0)} delay={0.28} />
        <MetricCard label="Unrealised PnL" value={'$' + fmt$(metrics.unrealizedPnl || 0)} sub={`${metrics.activeTrades || 0} open positions`} color={pnlColor(metrics.unrealizedPnl || 0)} delay={0.32} />
      </div>

      {/* Equity Curve */}
      {metrics.equityCurve?.length >= 2 && (
        <div style={{ background: 'rgba(17,24,39,0.85)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '14px', padding: '20px', marginBottom: '20px' }}>
          <EquityCurve points={metrics.equityCurve} height={100} label="Equity Curve — Cumulative Realized PnL" />
        </div>
      )}

      {/* Daily PnL Heatmap */}
      {metrics.dailyPnl?.length > 0 && (
        <div style={{ background: 'rgba(17,24,39,0.85)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '14px', padding: '20px', marginBottom: '20px' }}>
          <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.2px', color: '#6B7280', marginBottom: '12px' }}>Daily PnL Heatmap</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {metrics.dailyPnl.map((d: any) => {
              const intensity = Math.min(1, Math.abs(d.pnl) / 50);
              const bg = d.pnl > 0
                ? `rgba(29,158,117,${0.15 + intensity * 0.6})`
                : d.pnl < 0
                  ? `rgba(216,90,48,${0.15 + intensity * 0.6})`
                  : 'rgba(255,255,255,0.05)';
              return (
                <div key={d.date} title={`${d.date}: ${d.pnl >= 0 ? '+' : ''}${d.pnl.toFixed(2)} USDT`}
                  style={{ width: '28px', height: '28px', background: bg, borderRadius: '4px', cursor: 'default', transition: 'opacity 0.2s' }}
                />
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: '16px', marginTop: '8px', fontSize: '11px', color: '#6B7280' }}>
            <span style={{ color: PROFIT }}>■ Profit</span>
            <span style={{ color: LOSS }}>■ Loss</span>
            <span>Each cell = 1 trading day</span>
          </div>
        </div>
      )}

      {/* Trade Table */}
      <div style={{ background: 'rgba(17,24,39,0.85)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '14px', padding: '20px' }}>
        {/* Controls */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            {(['all', 'active', 'closed'] as const).map(s => (
              <button key={s} onClick={() => setStatusFilter(s)} style={{
                padding: '6px 14px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                fontSize: '12px', fontWeight: 600,
                background: statusFilter === s ? BRAND_BLUE : 'rgba(255,255,255,0.06)',
                color: statusFilter === s ? '#fff' : '#9CA3AF',
                transition: 'all 0.15s',
              }}>
                {s === 'all' ? `All (${trades.length})` : s === 'active' ? `Active (${metrics.activeTrades || 0})` : `Closed (${metrics.closedTrades || 0})`}
              </button>
            ))}
          </div>
          <button onClick={exportCSV} style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '6px 14px', borderRadius: '8px', border: 'none',
            background: 'rgba(62,94,166,0.15)', color: BRAND_BLUE,
            fontSize: '12px', fontWeight: 600, cursor: 'pointer',
          }}>
            <Download size={13} /> Export CSV
          </button>
        </div>

        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#4B5563', fontSize: '13px' }}>
            No {statusFilter === 'all' ? '' : statusFilter} trades
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  {['Coin', 'Side', 'Lev', 'Capital', 'Entry', 'LTP', 'SL', 'TP', 'PnL', 'Status', 'Regime', 'Time'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#6B7280', textAlign: h === 'Coin' ? 'left' : 'center', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((t: any) => {
                  const isActive = t.status === 'active';
                  const livePrice = livePrices[t.symbol];
                  const dispPrice = isActive ? (livePrice || t.currentPrice || t.entryPrice) : null;
                  const isLong = ['long', 'buy'].includes(t.side);
                  const pnl = isActive
                    ? (livePrice && t.entryPrice ? (isLong ? (livePrice - t.entryPrice) : (t.entryPrice - livePrice)) / t.entryPrice * t.leverage * t.capital : t.activePnl)
                    : t.totalPnl;
                  return (
                    <tr key={t.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', transition: 'background 0.15s' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 700, color: '#F0F4F8' }}>{t.coin}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <span style={{ padding: '2px 8px', borderRadius: '5px', fontSize: '11px', fontWeight: 700, background: isLong ? 'rgba(29,158,117,0.15)' : 'rgba(216,90,48,0.15)', color: isLong ? PROFIT : LOSS }}>
                          {isLong ? 'LONG' : 'SHORT'}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', color: '#E5E7EB' }}>{t.leverage}×</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', color: '#E5E7EB' }}>${t.capital}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', fontFamily: 'monospace', color: '#E5E7EB' }}>{fmtPrice(t.entryPrice)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', fontFamily: 'monospace' }}>
                        {isActive && dispPrice ? (
                          <span style={{ color: livePrice ? PROFIT : '#9CA3AF', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                            {livePrice && <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: PROFIT, display: 'inline-block', animation: 'pulse 2s infinite' }} />}
                            {fmtPrice(dispPrice)}
                          </span>
                        ) : <span style={{ color: '#4B5563' }}>—</span>}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', fontFamily: 'monospace', color: LOSS }}>{fmtPrice(t.stopLoss)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', fontFamily: 'monospace', color: PROFIT }}>{fmtPrice(t.takeProfit)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: pnlColor(pnl) }}>
                        ${fmt$(pnl)}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <span style={{ padding: '2px 8px', borderRadius: '5px', fontSize: '11px', fontWeight: 700, background: isActive ? 'rgba(29,158,117,0.12)' : 'rgba(255,255,255,0.06)', color: isActive ? PROFIT : '#9CA3AF' }}>
                          {isActive ? 'ACTIVE' : 'CLOSED'}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', color: '#6B7280', fontSize: '11px' }}>{t.regime || '—'}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', color: '#6B7280', fontSize: '11px', whiteSpace: 'nowrap' }}>
                        {t.entryTime ? new Date(t.entryTime).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ marginTop: '10px', fontSize: '11px', color: '#6B7280', textAlign: 'right' }}>
              Showing {filtered.length} of {trades.length} paper trades
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

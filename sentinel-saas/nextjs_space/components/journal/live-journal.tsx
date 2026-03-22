'use client';

import { useState, useEffect, useCallback } from 'react';
import { MetricCard } from './metric-card';
import { Download } from 'lucide-react';

const PROFIT = '#1D9E75';
const LOSS = '#D85A30';
const BRAND_BLUE = '#3E5EA6';
const pnlColor = (v: number) => v > 0 ? PROFIT : v < 0 ? LOSS : '#6B7280';
const fmt$ = (v: number) => (v >= 0 ? '+' : '') + v.toFixed(2);
const fmtPrice = (v: number) => v >= 1 ? v.toFixed(4) : v.toFixed(6);

export function LiveJournal() {
  const [trades, setTrades] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any>({});
  const [health, setHealth] = useState<any>(null);
  const [loadingTrades, setLoadingTrades] = useState(true);
  const [loadingHealth, setLoadingHealth] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'closed'>('active');
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});

  const fetchTrades = useCallback(async () => {
    try {
      const res = await fetch('/api/journal?mode=live', { cache: 'no-store' });
      if (res.ok) { const d = await res.json(); setTrades(d.trades || []); setMetrics(d.metrics || {}); }
    } catch { } finally { setLoadingTrades(false); }
  }, []);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/journal/health', { cache: 'no-store' });
      if (res.ok) setHealth(await res.json());
    } catch { } finally { setLoadingHealth(false); }
  }, []);

  useEffect(() => {
    fetchTrades(); fetchHealth();
    const t1 = setInterval(fetchTrades, 5000);
    const t2 = setInterval(fetchHealth, 15000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [fetchTrades, fetchHealth]);

  // CoinDCX live prices for active live trades
  useEffect(() => {
    const active = trades.filter(t => t.status === 'active');
    if (!active.length) return;
    const poll = async () => {
      try {
        const symbols: string[] = [...new Set(active.map((t: any) => t.symbol).filter(Boolean))] as string[];
        const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(symbols))}`, { signal: AbortSignal.timeout(4000) });
        if (res.ok) {
          const arr: { symbol: string; price: string }[] = await res.json();
          const m: Record<string, number> = {};
          arr.forEach(({ symbol, price }) => { m[symbol] = parseFloat(price); });
          setLivePrices(m);
        }
      } catch { }
    };
    poll();
    const t = setInterval(poll, 3000);
    return () => clearInterval(t);
  }, [trades]);

  const filtered = trades.filter(t => statusFilter === 'all' ? true : t.status === statusFilter);

  const getStatusStyle = (status: string) => ({
    connected: { bg: 'rgba(29,158,117,0.15)', color: PROFIT, dot: PROFIT },
    failed: { bg: 'rgba(216,90,48,0.15)', color: LOSS, dot: LOSS },
    'n/a': { bg: 'rgba(255,255,255,0.06)', color: '#6B7280', dot: '#6B7280' },
    unknown: { bg: 'rgba(255,200,0,0.1)', color: '#F59E0B', dot: '#F59E0B' },
  }[status || 'unknown'] || { bg: 'rgba(255,255,255,0.06)', color: '#9CA3AF', dot: '#6B7280' });

  const exportCSV = () => {
    if (!trades.length) return;
    const headers = ['ID', 'Coin', 'Side', 'Leverage', 'Capital', 'Entry', 'Exit', 'PnL $', 'PnL %', 'Status', 'Fill Latency (ms)', 'Slippage %', 'Fee', 'Entry Time', 'Exit Reason'];
    const rows = trades.map(t => [t.id, t.coin, t.side, t.leverage, t.capital, t.entryPrice, t.exitPrice || '', t.status === 'active' ? t.activePnl : t.totalPnl, t.status === 'active' ? t.activePnlPct : t.totalPnlPct, t.status, t.fillLatencyMs || '', t.slippage || '', t.exchangeFee || '', t.entryTime, t.exitReason || '']);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `journal_live_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  if (loadingTrades && loadingHealth) {
    return <div style={{ padding: '60px', textAlign: 'center', color: '#6B7280' }}>Loading live journal…</div>;
  }

  const statusStyle = getStatusStyle(health?.exchangeStatus);

  return (
    <div>
      {/* Exchange Health Panel */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>

        {/* Connectivity Card */}
        <div style={{ background: 'rgba(17,24,39,0.85)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '14px', padding: '20px' }}>
          <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.2px', color: '#6B7280', marginBottom: '14px' }}>Exchange Connectivity</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: statusStyle.dot, boxShadow: `0 0 8px ${statusStyle.dot}` }} />
            <span style={{ fontSize: '18px', fontWeight: 700, color: statusStyle.color, textTransform: 'uppercase' }}>
              {health?.exchangeStatus === 'connected' ? 'Connected' : health?.exchangeStatus === 'failed' ? 'Failed' : health?.exchangeStatus || 'Unknown'}
            </span>
            <span style={{ fontSize: '12px', color: '#6B7280', background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: '6px' }}>
              {health?.exchange || 'CoinDCX'} Futures
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <div style={{ fontSize: '10px', color: '#4B5563', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '4px' }}>Balance</div>
              <div style={{ fontSize: '16px', fontWeight: 700, color: '#F0F4F8' }}>
                ${(health?.balance || 0).toFixed(2)} <span style={{ fontSize: '11px', color: '#6B7280' }}>USDT</span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: '10px', color: '#4B5563', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '4px' }}>Open Positions</div>
              <div style={{ fontSize: '16px', fontWeight: 700, color: '#F0F4F8' }}>{health?.openPositions ?? '—'}</div>
            </div>
          </div>
          {health?.lastCheckedAt && (
            <div style={{ marginTop: '12px', fontSize: '11px', color: '#4B5563' }}>
              Last checked: {new Date(health.lastCheckedAt).toLocaleTimeString('en-IN')}
            </div>
          )}
          {health?.engineHealth?.error && (
            <div style={{ marginTop: '8px', fontSize: '11px', color: LOSS, background: 'rgba(216,90,48,0.08)', padding: '6px 10px', borderRadius: '6px' }}>
              {health.engineHealth.error}
            </div>
          )}
        </div>

        {/* Reconciliation Card */}
        <div style={{ background: 'rgba(17,24,39,0.85)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '14px', padding: '20px' }}>
          <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.2px', color: '#6B7280', marginBottom: '14px' }}>Reconciliation</div>
          {health?.reconciliation ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '14px' }}>
                {[
                  { label: 'Engine Trades', value: health.reconciliation.engineTradeCount ?? '—' },
                  { label: 'Exchange Pos.', value: health.reconciliation.exchangePositionCount ?? '—' },
                  { label: 'Delta', value: health.reconciliation.delta != null ? (health.reconciliation.delta > 0 ? '+' : '') + health.reconciliation.delta : '—' },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <div style={{ fontSize: '10px', color: '#4B5563', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '4px' }}>{label}</div>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: label === 'Delta' && health.reconciliation.delta !== 0 ? LOSS : '#F0F4F8' }}>{value}</div>
                  </div>
                ))}
              </div>
              <div style={{
                padding: '8px 12px', borderRadius: '8px',
                background: health.reconciliation.match ? 'rgba(29,158,117,0.1)' : 'rgba(216,90,48,0.1)',
                color: health.reconciliation.match ? PROFIT : LOSS,
                fontSize: '12px', fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: '6px',
              }}>
                {health.reconciliation.match ? '✓ Engine and exchange are in sync' : '⚠ Position mismatch detected'}
              </div>

              {/* Recent check logs */}
              {health.recentLogs?.length > 0 && (
                <div style={{ marginTop: '14px' }}>
                  <div style={{ fontSize: '10px', color: '#4B5563', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '8px' }}>Recent Checks</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {health.recentLogs.slice(0, 5).map((log: any) => (
                      <div key={log.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <span style={{ color: log.status === 'pass' ? PROFIT : log.status === 'warning' ? '#F59E0B' : LOSS, fontWeight: 600, textTransform: 'uppercase' }}>{log.status}</span>
                        <span style={{ color: '#6B7280' }}>{log.notes || log.checkType}</span>
                        <span style={{ color: '#4B5563' }}>{new Date(log.checkedAt).toLocaleTimeString('en-IN')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ color: '#4B5563', fontSize: '13px' }}>
              {health?.mode === 'paper' ? 'Not applicable (paper mode)' : 'No reconciliation data yet'}
            </div>
          )}
        </div>
      </div>

      {/* Live Trade Metrics */}
      {trades.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '20px' }}>
          <MetricCard label="Live PnL" value={'$' + fmt$(metrics.totalPnl || 0)} sub="Realized + Unrealized" color={pnlColor(metrics.totalPnl || 0)} />
          <MetricCard label="Win Rate" value={(metrics.winRate || 0).toFixed(1) + '%'} color={metrics.winRate >= 50 ? PROFIT : LOSS} />
          <MetricCard label="Avg Fill Latency" value={metrics.avgFillLatencyMs != null ? metrics.avgFillLatencyMs + 'ms' : '—'} sub="Signal to exchange fill" />
          <MetricCard label="Avg Slippage" value={metrics.avgSlippage != null ? fmt$(metrics.avgSlippage) + '%' : '—'} sub="Expected vs actual entry" color={metrics.avgSlippage != null && metrics.avgSlippage > 0.1 ? LOSS : PROFIT} />
        </div>
      )}

      {/* Trade Table */}
      <div style={{ background: 'rgba(17,24,39,0.85)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '14px', padding: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            {(['all', 'active', 'closed'] as const).map(s => (
              <button key={s} onClick={() => setStatusFilter(s)} style={{
                padding: '6px 14px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                fontSize: '12px', fontWeight: 600,
                background: statusFilter === s ? BRAND_BLUE : 'rgba(255,255,255,0.06)',
                color: statusFilter === s ? '#fff' : '#9CA3AF',
              }}>
                {s.charAt(0).toUpperCase() + s.slice(1)} ({s === 'all' ? trades.length : s === 'active' ? (metrics.activeTrades || 0) : (metrics.closedTrades || 0)})
              </button>
            ))}
          </div>
          <button onClick={exportCSV} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 14px', borderRadius: '8px', border: 'none', background: 'rgba(62,94,166,0.15)', color: BRAND_BLUE, fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
            <Download size={13} /> Export CSV
          </button>
        </div>

        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#4B5563', fontSize: '13px' }}>
            {trades.length === 0 ? 'No live trades. Start a live bot to see trades here.' : `No ${statusFilter} live trades.`}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  {['Coin', 'Side', 'Lev', 'Entry', 'Mark', 'SL', 'TP', 'PnL', 'Latency', 'Slippage', 'Status'].map(h => (
                    <th key={h} style={{ padding: '10px 12px', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#6B7280', textAlign: h === 'Coin' ? 'left' : 'center', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((t: any) => {
                  const isActive = t.status === 'active';
                  const livePrice = livePrices[t.symbol] || t.currentPrice;
                  const isLong = ['long', 'buy'].includes(t.side);
                  const pnl = isActive && livePrice && t.entryPrice
                    ? (isLong ? (livePrice - t.entryPrice) : (t.entryPrice - livePrice)) / t.entryPrice * t.leverage * t.capital
                    : t.totalPnl;
                  return (
                    <tr key={t.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 700, color: '#F0F4F8' }}>{t.coin}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <span style={{ padding: '2px 8px', borderRadius: '5px', fontSize: '11px', fontWeight: 700, background: isLong ? 'rgba(29,158,117,0.15)' : 'rgba(216,90,48,0.15)', color: isLong ? PROFIT : LOSS }}>
                          {isLong ? 'LONG' : 'SHORT'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center', color: '#E5E7EB', padding: '10px 8px' }}>{t.leverage}×</td>
                      <td style={{ textAlign: 'center', fontFamily: 'monospace', color: '#E5E7EB', padding: '10px 8px' }}>{fmtPrice(t.entryPrice)}</td>
                      <td style={{ textAlign: 'center', fontFamily: 'monospace', padding: '10px 8px' }}>
                        {isActive && livePrice ? <span style={{ color: PROFIT }}>{fmtPrice(livePrice)}</span> : <span style={{ color: '#4B5563' }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'center', fontFamily: 'monospace', color: LOSS, padding: '10px 8px' }}>{fmtPrice(t.stopLoss)}</td>
                      <td style={{ textAlign: 'center', fontFamily: 'monospace', color: PROFIT, padding: '10px 8px' }}>{fmtPrice(t.takeProfit)}</td>
                      <td style={{ textAlign: 'center', fontWeight: 700, color: pnlColor(pnl), padding: '10px 8px' }}>${fmt$(pnl)}</td>
                      <td style={{ textAlign: 'center', color: '#6B7280', fontSize: '11px', padding: '10px 8px' }}>{t.fillLatencyMs != null ? `${t.fillLatencyMs}ms` : '—'}</td>
                      <td style={{ textAlign: 'center', color: t.slippage != null && t.slippage > 0.05 ? LOSS : '#6B7280', fontSize: '11px', padding: '10px 8px' }}>{t.slippage != null ? `${(t.slippage * 100).toFixed(3)}%` : '—'}</td>
                      <td style={{ textAlign: 'center', padding: '10px 8px' }}>
                        <span style={{ padding: '2px 8px', borderRadius: '5px', fontSize: '11px', fontWeight: 700, background: isActive ? 'rgba(29,158,117,0.12)' : 'rgba(255,255,255,0.06)', color: isActive ? PROFIT : '#9CA3AF' }}>
                          {isActive ? 'ACTIVE' : 'CLOSED'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div style={{ marginTop: '10px', fontSize: '11px', color: '#6B7280', textAlign: 'right' }}>Showing {filtered.length} live trades</div>
          </div>
        )}
      </div>
    </div>
  );
}

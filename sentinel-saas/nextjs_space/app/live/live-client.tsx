'use client';

import { useState, useEffect } from 'react';
import { Header } from '@/components/header';
import { motion } from 'framer-motion';
import { Shield, RefreshCw } from 'lucide-react';

interface ExchangePosition {
  id: string;
  pair: string;
  active_pos: number;
  leverage: number;
  avg_price: number;
  mark_price: number;
  liquidation_price: number;
  unrealized_pnl: number;
  margin: number;
  roe: number;
  tp_trigger?: number;
  sl_trigger?: number;
}

export function LiveClient() {
  const [positions, setPositions] = useState<ExchangePosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchExchangePositions = async () => {
    try {
      const res = await fetch('/api/exchange-positions', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch positions');
      
      // Filter out empty/closed positions (where active_pos essentially === 0)
      const activePositions = (data.positions || []).filter((p: any) => Math.abs(parseFloat(p.active_pos)) > 0);
      setPositions(activePositions);
      setError(null);
    } catch (err: any) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExchangePositions();
    const t = setInterval(fetchExchangePositions, 3000);
    return () => clearInterval(t);
  }, []);

  const totalUnrealized = positions.reduce((sum, p) => sum + parseFloat(p.unrealized_pnl as any), 0);
  const totalMargin = positions.reduce((sum, p) => sum + parseFloat(p.margin as any), 0);
  const totalRoe = totalMargin > 0 ? (totalUnrealized / totalMargin) * 100 : 0;
  
  const pnlColor = (v: number) => v > 0 ? '#22C55E' : v < 0 ? '#EF4444' : '#9CA3AF';
  const sign = (v: number) => (v > 0 ? '+' : '');

  // Render Table
  return (
    <div style={{ minHeight: '100vh' }}>
      <Header />
      
      <main style={{ paddingTop: 96, paddingBottom: 48, paddingLeft: 16, paddingRight: 16 }}>
        <div style={{ maxWidth: 1400, margin: '0 auto' }}>
          
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                <h1 style={{ fontSize: 22, fontWeight: 800, color: '#E5E7EB', margin: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
                  Active Positions ({positions.length})
                  <span style={{ fontSize: 16, fontWeight: 700, color: pnlColor(totalUnrealized) }}>
                    {sign(totalUnrealized)}{totalUnrealized.toFixed(2)} USDT ({sign(totalRoe)}{totalRoe.toFixed(2)}%)
                  </span>
                </h1>
              </div>
              <button
                onClick={fetchExchangePositions}
                style={{
                  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                  borderRadius: 8, padding: '8px 14px', cursor: 'pointer', color: 'var(--color-text-secondary)',
                  display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600,
                }}
              >
                <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh Exchange Data
              </button>
            </div>
          </motion.div>

          {error && (
            <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid #EF4444', color: '#EF4444', padding: '16px', borderRadius: '12px', marginBottom: 24 }}>
              <strong>Exchange connection error:</strong> {error}
            </div>
          )}

          <div style={{ 
            background: 'var(--color-surface)', border: '1px solid var(--color-border)', 
            borderRadius: 16, overflowX: 'auto', WebkitOverflowScrolling: 'touch' 
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border)', color: '#9CA3AF', fontSize: 12, fontWeight: 600 }}>
                  <th style={{ padding: '16px', textAlign: 'left', fontWeight: 600 }}>Name / Side</th>
                  <th style={{ padding: '16px', fontWeight: 600 }}>Leverage</th>
                  <th style={{ padding: '16px', fontWeight: 600 }}>Margin</th>
                  <th style={{ padding: '16px', fontWeight: 600 }}>Size</th>
                  <th style={{ padding: '16px', fontWeight: 600 }}>Active PNL</th>
                  <th style={{ padding: '16px', fontWeight: 600 }}>ROE (%)</th>
                  <th style={{ padding: '16px', fontWeight: 600 }}>Avg. Entry</th>
                  <th style={{ padding: '16px', fontWeight: 600 }}>Mark Price</th>
                  <th style={{ padding: '16px', fontWeight: 600 }}>Liq. Price / MR</th>
                  <th style={{ padding: '16px', fontWeight: 600 }}>TP / SL</th>
                  <th style={{ padding: '16px', fontWeight: 600, textAlign: 'center' }}>Close Position</th>
                </tr>
              </thead>
              <tbody>
                {loading && positions.length === 0 ? (
                  <tr>
                    <td colSpan={11} style={{ padding: '40px', textAlign: 'center', color: '#6B7280' }}>Connecting to physical exchange stream...</td>
                  </tr>
                ) : positions.length === 0 ? (
                  <tr>
                    <td colSpan={11} style={{ padding: '40px', textAlign: 'center', color: '#6B7280' }}>No active layout footprints on exchange.</td>
                  </tr>
                ) : (
                  positions.map((p) => {
                    const isLong = parseFloat(p.active_pos as any) > 0;
                    const coin = p.pair ? p.pair.replace('B-', '').replace('_', ' • ') : 'UNKNOWN';
                    const sz = Math.abs(parseFloat(p.active_pos as any));
                    
                    const mrgn = parseFloat(p.margin as any) || 0;
                    const lv = p.leverage || 10;
                    const upnl = parseFloat(p.unrealized_pnl as any) || 0;
                    
                    // Synthesize ROE to mimic CoinDCX screenshot exactly
                    const roePct = mrgn > 0 ? (upnl / mrgn) * 100 : 0;
                    
                    return (
                      <tr key={p.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', fontFamily: 'var(--font-mono, monospace)', color: '#E5E7EB' }}>
                        
                        <td style={{ padding: '16px', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'sans-serif' }}>
                          <span style={{ fontWeight: 800 }}>{coin}</span>
                          <span style={{ 
                            background: isLong ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                            color: isLong ? '#22C55E' : '#EF4444',
                            border: `1px solid ${isLong ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                            padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 800
                          }}>
                            {isLong ? 'L' : 'S'}
                          </span>
                        </td>
                        
                        <td style={{ padding: '16px' }}>{lv}x</td>
                        
                        <td style={{ padding: '16px' }}>{mrgn.toFixed(2)} USDT</td>
                        
                        <td style={{ padding: '16px' }}>{sz.toLocaleString('en-US', { maximumFractionDigits: 5 })} USDT</td>
                        
                        <td style={{ padding: '16px', color: pnlColor(upnl), fontWeight: 700 }}>
                          {sign(upnl)}{upnl.toFixed(2)} USDT
                        </td>
                        
                        <td style={{ padding: '16px', color: pnlColor(roePct), fontWeight: 700 }}>
                          {sign(roePct)}{roePct.toFixed(2)}%
                        </td>
                        
                        <td style={{ padding: '16px', color: '#D1D5DB' }}>
                          {parseFloat(p.avg_price as any).toFixed(5)}
                        </td>
                        
                        <td style={{ padding: '16px', color: '#D1D5DB' }}>
                          {parseFloat(p.mark_price as any || p.avg_price as any).toFixed(5)}
                        </td>
                        
                        <td style={{ padding: '16px', color: '#9CA3AF' }}>
                          {parseFloat(p.liquidation_price as any || 0).toFixed(5)}
                        </td>
                        
                        <td style={{ padding: '16px', color: '#9CA3AF' }}>
                          {p.tp_trigger ? parseFloat(p.tp_trigger as any).toFixed(5) : '—'} / {p.sl_trigger ? parseFloat(p.sl_trigger as any).toFixed(5) : '—'}
                        </td>

                        <td style={{ padding: '16px', textAlign: 'center' }}>
                          <button 
                            onClick={() => alert(`Exchange API: Exit order signal prepared for ${p.id}. Awaiting production connect.`)}
                            style={{ 
                              background: 'rgba(239,68,68,0.1)', cursor: 'pointer', border: '1px solid rgba(239,68,68,0.3)',
                              color: '#EF4444', padding: '6px 12px', borderRadius: '6px', fontSize: '12px', fontWeight: 700
                            }}
                          >
                            Close
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

        </div>
      </main>
    </div>
  );
}

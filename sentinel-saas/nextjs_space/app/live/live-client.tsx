'use client';

import { useState, useEffect } from 'react';
import { Header } from '@/components/header';

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

  const fetchExchangePositions = async () => {
    try {
      const res = await fetch('/api/exchange-positions', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) return;
      // By strict instruction, load ALL exchange positions (Active AND Closed)
      setPositions(data.positions || []);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExchangePositions();
    const t = setInterval(fetchExchangePositions, 2000);
    return () => clearInterval(t);
  }, []);

  const totalUnrealized = positions.reduce((sum, p) => sum + parseFloat(p.unrealized_pnl as any), 0);
  const totalMargin = positions.reduce((sum, p) => sum + parseFloat(p.margin as any), 0);
  const totalRoe = totalMargin > 0 ? (totalUnrealized / totalMargin) * 100 : 0;
  
  const pnlColor = (v: number) => v > 0 ? '#0ECB81' : v < 0 ? '#F6465D' : '#B7BDC6';
  const sign = (v: number) => (v > 0 ? '+' : '');

  return (
    <div style={{ minHeight: '100vh', background: '#0B0E11', color: '#B7BDC6', fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' }}>
      <Header />
      
      <main style={{ paddingTop: 80 }}>
        <div style={{ width: '100%', borderBottom: '1px solid #1E2329' }}>
          
          {/* Top Tabs */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '0 16px', gap: '24px', fontSize: '14px', fontWeight: 600, color: '#848E9C' }}>
            <div style={{ 
              color: '#EAECEF', padding: '16px 0', borderBottom: '2px solid #5562E4', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px'
            }}>
              Active Positions ({positions.length})
              <span style={{ color: pnlColor(totalUnrealized), fontSize: '13px', fontWeight: 500 }}>
                {sign(totalUnrealized)}{totalUnrealized.toFixed(2)} USDT ({sign(totalRoe)}{totalRoe.toFixed(2)}%)
              </span>
            </div>
            <div style={{ cursor: 'pointer', padding: '16px 0' }}>Open Orders (0)</div>
            <div style={{ cursor: 'pointer', padding: '16px 0' }}>Transaction History</div>
            <div style={{ cursor: 'pointer', padding: '16px 0' }}>Order History</div>
            <div style={{ cursor: 'pointer', padding: '16px 0' }}>Trades</div>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '16px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '12px' }}>
                <input type="checkbox" style={{ accentColor: '#5562E4' }} /> Hide other markets
              </label>
              <button 
                onClick={fetchExchangePositions}
                style={{ 
                  background: '#2B3139', border: 'none', color: '#EAECEF', padding: '4px 12px', borderRadius: '4px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' 
                }}>
                {loading ? 'Refreshing...' : 'Refresh'}
              </button>
              <button style={{ background: '#2B3139', border: 'none', color: '#EAECEF', padding: '4px 12px', borderRadius: '4px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>Close All</button>
            </div>
          </div>
        </div>

        {/* Dense Table */}
        <div style={{ width: '100%', overflowX: 'auto', padding: '8px 16px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '12px', fontFamily: '"Inter", sans-serif' }}>
            <thead>
              <tr style={{ color: '#848E9C', fontWeight: 500, fontSize: '11px', whiteSpace: 'nowrap' }}>
                <th style={{ padding: '8px 4px', textAlign: 'left', fontWeight: 500 }}>Name / Side <span style={{fontSize:'10px'}}>↕</span></th>
                <th style={{ padding: '8px 4px', fontWeight: 500, textAlign: 'left' }}>Leverage <span style={{fontSize:'10px'}}>↕</span></th>
                <th style={{ padding: '8px 4px', fontWeight: 500, textAlign: 'left' }}>Margin <span style={{fontSize:'10px'}}>↕</span></th>
                <th style={{ padding: '8px 4px', fontWeight: 500, textAlign: 'left' }}>Size <span style={{fontSize:'10px'}}>↕</span></th>
                <th style={{ padding: '8px 8px', fontWeight: 500, textAlign: 'left' }}>Active PNL <span style={{fontSize:'10px'}}>↕</span></th>
                <th style={{ padding: '8px 4px', fontWeight: 500 }}>ROE (%) <span style={{fontSize:'10px'}}>↕</span></th>
                <th style={{ padding: '8px 4px', fontWeight: 500 }}>Avg. Entry <span style={{fontSize:'10px'}}>↕</span></th>
                <th style={{ padding: '8px 4px', fontWeight: 500 }}>Mark Price</th>
                <th style={{ padding: '8px 4px', fontWeight: 500 }}>Liq. Price / MR</th>
                <th style={{ padding: '8px 4px', fontWeight: 500 }}>TP / SL</th>
                <th style={{ padding: '8px 8px', fontWeight: 500, textAlign: 'left' }}>Close Position</th>
                <th style={{ padding: '8px 4px', fontWeight: 500 }}></th>
              </tr>
            </thead>
            <tbody>
              {positions.length === 0 ? (
                <tr>
                  <td colSpan={12} style={{ padding: '40px', textAlign: 'center', color: '#848E9C' }}>
                    {loading ? 'Fetching Exchange Engine...' : 'No active layouts on exchange.'}
                  </td>
                </tr>
              ) : (
                positions.map((p) => {
                  const isLong = parseFloat(p.active_pos as any) > 0;
                  const tokenName = p.pair ? p.pair.replace('B-', '').split('_')[0] : 'UNKNOWN';
                  const quoteName = 'USDT';
                  const sz = Math.abs(parseFloat(p.active_pos as any));
                  
                  const mrgn = parseFloat(p.margin as any) || 0;
                  const lv = p.leverage || 10;
                  const upnl = parseFloat(p.unrealized_pnl as any) || 0;
                  
                  // Convert generic ROE mapping
                  const roePct = mrgn > 0 ? (upnl / mrgn) * 100 : 0;
                  
                  return (
                    <tr key={p.id} style={{ borderBottom: '1px solid transparent', color: '#EAECEF' }} 
                        onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#1E2329'}
                        onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                      
                      <td style={{ padding: '8px 4px', textAlign: 'left', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontWeight: 600, color: '#EAECEF' }}>{tokenName}<span style={{color: '#848E9C', margin: '0 2px'}}>•</span>{quoteName}</span>
                        <span style={{ 
                          color: isLong ? '#0ECB81' : '#F6465D', fontWeight: 600, fontSize: '10px',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          padding: '1px 3px', borderRadius: '3px', background: isLong ? 'rgba(14,203,129,0.1)' : 'rgba(246,70,93,0.1)'
                        }}>
                          {isLong ? 'L' : 'S'}
                        </span>
                        <span style={{ 
                          color: '#848E9C', fontWeight: 600, fontSize: '10px',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          padding: '1px 3px', borderRadius: '3px', background: 'rgba(132,142,156,0.1)'
                        }}>
                          I
                        </span>
                      </td>
                      
                      <td style={{ padding: '8px 4px', textAlign: 'left' }}>
                        {lv}x <span style={{color: '#848E9C', fontSize:'10px'}}>✎</span>
                      </td>
                      
                      <td style={{ padding: '8px 4px', textAlign: 'left' }}>
                        {mrgn.toFixed(2)} USDT <span style={{color: '#848E9C', fontSize:'10px'}}>✎</span>
                      </td>
                      
                      <td style={{ padding: '8px 4px', textAlign: 'left' }}>
                        {sz.toLocaleString('en-US', { maximumFractionDigits: 5 })} USDT
                      </td>
                      
                      <td style={{ padding: '8px 8px', color: pnlColor(upnl), fontWeight: 500, textAlign: 'left' }}>
                        {sign(upnl)}{upnl.toFixed(2)} USDT <span style={{color: '#848E9C', fontSize: '11px', display: 'inline-block', marginLeft: '4px'}}>₹{(Math.abs(upnl) * 87.5).toFixed(2)}</span>
                      </td>
                      
                      <td style={{ padding: '8px 4px', color: pnlColor(roePct), fontWeight: 500 }}>
                        {sign(roePct)}{roePct.toFixed(2)}%
                      </td>
                      
                      <td style={{ padding: '8px 4px' }}>
                        {parseFloat(p.avg_price as any).toFixed(5)}
                      </td>
                      
                      <td style={{ padding: '8px 4px' }}>
                        {parseFloat(p.mark_price as any || p.avg_price as any).toFixed(5)}
                      </td>
                      
                      <td style={{ padding: '8px 4px' }}>
                        {parseFloat(p.liquidation_price as any || 0).toFixed(5)} <span style={{color: '#848E9C', fontSize:'10px'}}>✎</span>
                      </td>
                      
                      <td style={{ padding: '8px 4px' }}>
                        {p.tp_trigger ? parseFloat(p.tp_trigger as any).toFixed(5) : '—'} / {p.sl_trigger ? parseFloat(p.sl_trigger as any).toFixed(5) : '—'} <span style={{color: '#848E9C', fontSize:'10px'}}>✎</span>
                      </td>

                      <td style={{ padding: '8px 8px', textAlign: 'left' }}>
                        <span 
                          onClick={() => alert(`Exchange API: Execute Market Close for ${p.id}`)}
                          style={{ 
                            color: '#F6465D', cursor: 'pointer', fontSize: '12px', fontWeight: 500
                          }}
                        >
                          Reduce / Close
                        </span>
                      </td>
                      
                      <td style={{ padding: '8px 4px', color: '#848E9C', cursor: 'pointer' }}>
                        ⋮
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

      </main>
    </div>
  );
}

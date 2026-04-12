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

interface ExchangeOrder {
  id: string;
  pair: string;
  side: string;
  price: number;
  quantity: number;
  status: string;
  type?: string;
  created_at?: string;
  updated_at?: string;
  fee?: number;
}

export function LiveClient() {
  const [activeTab, setActiveTab] = useState<'positions' | 'orders' | 'history'>('positions');

  const [positions, setPositions] = useState<ExchangePosition[]>([]);
  const [openOrders, setOpenOrders] = useState<ExchangeOrder[]>([]);
  const [orderHistory, setOrderHistory] = useState<ExchangeOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchExchangeData = async () => {
    try {
      setLoading(true);
      // Fetch Active Positions
      const resPos = await fetch('/api/exchange-positions', { cache: 'no-store' });
      if (resPos.ok) {
        const dataPos = await resPos.json();
        setPositions(dataPos.positions || []);
      }

      // Fetch Orders & History
      const resOrd = await fetch('/api/exchange-orders', { cache: 'no-store' });
      if (resOrd.ok) {
        const dataOrd = await resOrd.json();
        setOpenOrders(dataOrd.open_orders || []);
        // Reverse array natively so most recent trades are at the top
        setOrderHistory((dataOrd.history || []).reverse());
      }
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExchangeData();
    const t = setInterval(fetchExchangeData, 5000); // Poll every 5s natively
    return () => clearInterval(t);
  }, []);

  const totalUnrealized = positions.reduce((sum, p) => sum + parseFloat(p.unrealized_pnl as any), 0);
  const totalMargin = positions.reduce((sum, p) => sum + parseFloat(p.margin as any), 0);
  const totalRoe = totalMargin > 0 ? (totalUnrealized / totalMargin) * 100 : 0;
  
  const pnlColor = (v: number) => v > 0 ? '#0ECB81' : v < 0 ? '#F6465D' : '#B7BDC6';
  const sign = (v: number) => (v > 0 ? '+' : '');

  const renderActivePositions = () => (
    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '13px', fontFamily: '"Inter", sans-serif' }}>
      <thead>
        <tr style={{ color: '#848E9C', fontWeight: 500, fontSize: '11px', whiteSpace: 'nowrap' }}>
          <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 500 }}>Name / Side <span style={{fontSize:'10px'}}>↕</span></th>
          <th style={{ padding: '12px 8px', fontWeight: 500, textAlign: 'left' }}>Leverage <span style={{fontSize:'10px'}}>↕</span></th>
          <th style={{ padding: '12px 8px', fontWeight: 500, textAlign: 'left' }}>Margin <span style={{fontSize:'10px'}}>↕</span></th>
          <th style={{ padding: '12px 8px', fontWeight: 500, textAlign: 'left' }}>Size <span style={{fontSize:'10px'}}>↕</span></th>
          <th style={{ padding: '12px 8px', fontWeight: 500, textAlign: 'left' }}>Active PNL <span style={{fontSize:'10px'}}>↕</span></th>
          <th style={{ padding: '12px 8px', fontWeight: 500 }}>ROE (%) <span style={{fontSize:'10px'}}>↕</span></th>
          <th style={{ padding: '12px 8px', fontWeight: 500 }}>Avg. Entry <span style={{fontSize:'10px'}}>↕</span></th>
          <th style={{ padding: '12px 8px', fontWeight: 500 }}>Mark Price</th>
          <th style={{ padding: '12px 8px', fontWeight: 500 }}>Liq. Price / MR</th>
          <th style={{ padding: '12px 8px', fontWeight: 500 }}>TP / SL</th>
          <th style={{ padding: '12px 8px', fontWeight: 500, textAlign: 'left' }}>Close Position</th>
        </tr>
      </thead>
      <tbody>
        {positions.length === 0 ? (
          <tr>
            <td colSpan={11} style={{ padding: '80px', textAlign: 'center', color: '#848E9C', background: '#0B0E11' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '24px' }}>📭</span>
                <span style={{ fontWeight: '500', fontSize: '14px', color: '#EAECEF' }}>{loading ? 'Authenticating with CoinDCX...' : 'No Open Positions'}</span>
                <span style={{ fontSize: '12px' }}>{loading ? 'Initializing physical exchange proxy layer' : 'Your CoinDCX physical derivatives portfolio is currently empty.'}</span>
              </div>
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
            const roePct = mrgn > 0 ? (upnl / mrgn) * 100 : 0;
            
            return (
              <tr key={p.id} style={{ borderBottom: '1px solid #1E2329', color: '#EAECEF' }} 
                  onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#1E2329'}
                  onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                
                <td style={{ padding: '16px 8px', textAlign: 'left', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontWeight: 600, color: '#EAECEF' }}>{tokenName}<span style={{color: '#848E9C', margin: '0 2px'}}>•</span>{quoteName}</span>
                  <span style={{ 
                    color: isLong ? '#0ECB81' : '#F6465D', fontWeight: 600, fontSize: '10px',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    padding: '2px 4px', borderRadius: '3px', background: isLong ? 'rgba(14,203,129,0.1)' : 'rgba(246,70,93,0.1)'
                  }}>
                    {isLong ? 'Buy' : 'Sell'}
                  </span>
                </td>
                
                <td style={{ padding: '16px 8px', textAlign: 'left' }}>{lv}x</td>
                <td style={{ padding: '16px 8px', textAlign: 'left' }}>{mrgn.toFixed(2)} USDT</td>
                <td style={{ padding: '16px 8px', textAlign: 'left' }}>{sz.toLocaleString('en-US', { maximumFractionDigits: 5 })} USDT</td>
                <td style={{ padding: '16px 8px', color: pnlColor(upnl), fontWeight: 500, textAlign: 'left' }}>
                  {sign(upnl)}{upnl.toFixed(2)} USDT <span style={{color: '#848E9C', fontSize: '11px', display: 'inline-block', marginLeft: '4px'}}>₹{(Math.abs(upnl) * 87.5).toFixed(2)}</span>
                </td>
                <td style={{ padding: '16px 8px', color: pnlColor(roePct), fontWeight: 500 }}>{sign(roePct)}{roePct.toFixed(2)}%</td>
                <td style={{ padding: '16px 8px' }}>{parseFloat(p.avg_price as any).toFixed(5)}</td>
                <td style={{ padding: '16px 8px' }}>{parseFloat(p.mark_price as any || p.avg_price as any).toFixed(5)}</td>
                <td style={{ padding: '16px 8px' }}>{parseFloat(p.liquidation_price as any || 0).toFixed(5)}</td>
                <td style={{ padding: '16px 8px' }}>
                  {p.tp_trigger ? parseFloat(p.tp_trigger as any).toFixed(5) : '—'} / {p.sl_trigger ? parseFloat(p.sl_trigger as any).toFixed(5) : '—'}
                </td>
                <td style={{ padding: '16px 8px', textAlign: 'left' }}>
                  <span 
                    onClick={() => alert(`Close position functionality currently locked to Physical Engine`)}
                    style={{ background: '#2B3139', color: '#EAECEF', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                  >
                    Market Close
                  </span>
                </td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );

  const renderOpenOrders = () => (
    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '13px', fontFamily: '"Inter", sans-serif' }}>
      <thead>
        <tr style={{ color: '#848E9C', fontWeight: 500, fontSize: '11px', whiteSpace: 'nowrap' }}>
          <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 500 }}>Time <span style={{fontSize:'10px'}}>↕</span></th>
          <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 500 }}>Pair <span style={{fontSize:'10px'}}>↕</span></th>
          <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 500 }}>Type <span style={{fontSize:'10px'}}>↕</span></th>
          <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 500 }}>Side <span style={{fontSize:'10px'}}>↕</span></th>
          <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 500 }}>Price <span style={{fontSize:'10px'}}>↕</span></th>
          <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 500 }}>Quantity <span style={{fontSize:'10px'}}>↕</span></th>
          <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 500 }}>Action</th>
        </tr>
      </thead>
      <tbody>
        {openOrders.length === 0 ? (
          <tr>
            <td colSpan={7} style={{ padding: '80px', textAlign: 'center', color: '#848E9C', background: '#0B0E11' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '24px' }}>📄</span>
                <span style={{ fontWeight: '500', fontSize: '14px', color: '#EAECEF' }}>No Open Orders</span>
                <span style={{ fontSize: '12px' }}>You have no pending limit or trigger orders natively mapped.</span>
              </div>
            </td>
          </tr>
        ) : (
          openOrders.map((o) => {
            const isBuy = o.side.toLowerCase() === 'buy';
            return (
              <tr key={o.id} style={{ borderBottom: '1px solid #1E2329', color: '#EAECEF' }}>
                <td style={{ padding: '16px 8px', textAlign: 'left' }}>{o.created_at ? new Date(o.created_at).toLocaleString() : '—'}</td>
                <td style={{ padding: '16px 8px', textAlign: 'left', fontWeight: 500 }}>{o.pair.replace('B-', '').replace('_', ' / ')}</td>
                <td style={{ padding: '16px 8px', textAlign: 'left' }}>{o.type ? o.type.toUpperCase() : 'LIMIT'}</td>
                <td style={{ padding: '16px 8px', textAlign: 'left', color: isBuy ? '#0ECB81' : '#F6465D', fontWeight: 500 }}>
                  {isBuy ? 'Buy' : 'Sell'}
                </td>
                <td style={{ padding: '16px 8px', textAlign: 'left' }}>{parseFloat(o.price as any).toFixed(5)} USDT</td>
                <td style={{ padding: '16px 8px', textAlign: 'left' }}>{parseFloat(o.quantity as any).toFixed(5)}</td>
                <td style={{ padding: '16px 8px', textAlign: 'left' }}>
                  <span style={{ color: '#F6465D', cursor: 'not-allowed', fontSize: '12px', fontWeight: 500 }}>Cancel</span>
                </td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );

  const renderOrderHistory = () => (
    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'right', fontSize: '13px', fontFamily: '"Inter", sans-serif' }}>
      <thead>
        <tr style={{ color: '#848E9C', fontWeight: 500, fontSize: '11px', whiteSpace: 'nowrap' }}>
          <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 500 }}>Time <span style={{fontSize:'10px'}}>↕</span></th>
          <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 500 }}>Pair <span style={{fontSize:'10px'}}>↕</span></th>
          <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 500 }}>Type <span style={{fontSize:'10px'}}>↕</span></th>
          <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 500 }}>Side <span style={{fontSize:'10px'}}>↕</span></th>
          <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 500 }}>Avg. Price <span style={{fontSize:'10px'}}>↕</span></th>
          <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 500 }}>Filled / Total <span style={{fontSize:'10px'}}>↕</span></th>
          <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 500 }}>Status <span style={{fontSize:'10px'}}>↕</span></th>
        </tr>
      </thead>
      <tbody>
        {orderHistory.length === 0 ? (
          <tr>
            <td colSpan={7} style={{ padding: '80px', textAlign: 'center', color: '#848E9C', background: '#0B0E11' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '24px' }}>📊</span>
                <span style={{ fontWeight: '500', fontSize: '14px', color: '#EAECEF' }}>No Recent History</span>
                <span style={{ fontSize: '12px' }}>Your physical trade log is currently empty.</span>
              </div>
            </td>
          </tr>
        ) : (
          orderHistory.map((o) => {
            const isBuy = o.side.toLowerCase() === 'buy';
            const isFilled = o.status.toLowerCase() === 'filled';
            return (
              <tr key={o.id} style={{ borderBottom: '1px solid #1E2329', color: '#EAECEF' }}>
                <td style={{ padding: '16px 8px', textAlign: 'left' }}>{o.updated_at ? new Date(o.updated_at).toLocaleString() : '—'}</td>
                <td style={{ padding: '16px 8px', textAlign: 'left', fontWeight: 500 }}>{o.pair.replace('B-', '').replace('_', ' / ')}</td>
                <td style={{ padding: '16px 8px', textAlign: 'left' }}>{o.type ? o.type.toUpperCase() : 'MARKET'}</td>
                <td style={{ padding: '16px 8px', textAlign: 'left', color: isBuy ? '#0ECB81' : '#F6465D', fontWeight: 500 }}>
                  {isBuy ? 'Buy' : 'Sell'}
                </td>
                <td style={{ padding: '16px 8px', textAlign: 'left' }}>{parseFloat(o.price as any).toFixed(5)} USDT</td>
                <td style={{ padding: '16px 8px', textAlign: 'left' }}>{parseFloat(o.quantity as any).toFixed(5)}</td>
                <td style={{ padding: '16px 8px', textAlign: 'left', color: isFilled ? '#EAECEF' : '#848E9C', fontWeight: 500 }}>
                  {o.status.toUpperCase()}
                </td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#0B0E11', color: '#B7BDC6', fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' }}>
      <Header />
      
      <main style={{ paddingTop: 80, maxWidth: '1440px', margin: '0 auto' }}>
        <div style={{ width: '100%', borderBottom: '1px solid #1E2329' }}>
          
          {/* Top Navigational Tab Array */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '0 16px', gap: '32px', fontSize: '15px', fontWeight: 600, color: '#848E9C' }}>
            <div 
              onClick={() => setActiveTab('positions')}
              style={{ padding: '16px 0', borderBottom: activeTab === 'positions' ? '2px solid #5562E4' : '2px solid transparent', color: activeTab === 'positions' ? '#EAECEF' : '#848E9C', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}
            >
              Active Positions ({positions.length})
              {activeTab === 'positions' && (
                <span style={{ color: pnlColor(totalUnrealized), fontSize: '13px', fontWeight: 500 }}>
                  {sign(totalUnrealized)}{totalUnrealized.toFixed(2)} USDT
                </span>
              )}
            </div>
            <div 
              onClick={() => setActiveTab('orders')}
              style={{ padding: '16px 0', borderBottom: activeTab === 'orders' ? '2px solid #5562E4' : '2px solid transparent', color: activeTab === 'orders' ? '#EAECEF' : '#848E9C', cursor: 'pointer' }}
            >
              Open Orders ({openOrders.length})
            </div>
            <div 
              onClick={() => setActiveTab('history')}
              style={{ padding: '16px 0', borderBottom: activeTab === 'history' ? '2px solid #5562E4' : '2px solid transparent', color: activeTab === 'history' ? '#EAECEF' : '#848E9C', cursor: 'pointer' }}
            >
              Trade History ({orderHistory.length})
            </div>
            
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '16px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '13px' }}>
                <input type="checkbox" style={{ accentColor: '#5562E4' }} /> Hide other markets
              </label>
              <button 
                onClick={fetchExchangeData}
                style={{ background: '#2B3139', border: 'none', color: '#EAECEF', padding: '6px 16px', borderRadius: '4px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
              >
                {loading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
          </div>
        </div>

        {/* Dynamic Frame Display */}
        <div style={{ width: '100%', overflowX: 'auto', padding: '8px 16px', background: '#0B0E11' }}>
          {activeTab === 'positions' && renderActivePositions()}
          {activeTab === 'orders' && renderOpenOrders()}
          {activeTab === 'history' && renderOrderHistory()}
        </div>

      </main>
    </div>
  );
}

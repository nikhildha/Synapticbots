'use client';

import { useState, useEffect } from 'react';

interface VirtualLimitTrackerProps {
  trades: any[];
}

export function VirtualLimitTracker({ trades }: VirtualLimitTrackerProps) {
  const [now, setNow] = useState(Date.now());

  // Update timer every second for countdowns
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Filter for OPEN virtual limits
  const openLimits = (trades || []).filter((t: any) => (t.status || '').toUpperCase() === 'OPEN');

  if (openLimits.length === 0) {
    return (
      <div className="card-gradient rounded-xl overflow-hidden mb-6" style={{
        border: '1px solid rgba(167, 139, 250, 0.1)',
      }}>
        <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 700, color: 'rgba(167,139,250,0.5)', textTransform: 'uppercase', letterSpacing: '1px', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px' }}>⏱️</span> Virtual Limit Orders
          </h3>
          <span style={{ background: 'rgba(107,114,128,0.08)', color: '#6B7280', padding: '2px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: 700 }}>
            0 PENDING
          </span>
        </div>
        <div style={{ padding: '16px 20px', textAlign: 'center', color: 'rgba(107,114,128,0.5)', fontSize: '12px', borderTop: '1px solid rgba(255,255,255,0.03)' }}>
          No pending limit orders — will appear here when a limit entry is placed
        </div>
      </div>
    );
  }

  // TIF is 60 minutes as per Phase 4 description. We can use a constant or config.
  const TIF_MINUTES = 60;

  return (
    <div className="card-gradient rounded-xl overflow-hidden mb-6" style={{
      border: '1px solid rgba(167, 139, 250, 0.2)',
      boxShadow: '0 0 20px rgba(167, 139, 250, 0.05)',
    }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#A78BFA', textTransform: 'uppercase', letterSpacing: '1px', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px' }}>⏱️</span> Virtual Limit Orders
        </h3>
        <span style={{ background: 'rgba(167, 139, 250, 0.1)', color: '#A78BFA', padding: '2px 8px', borderRadius: '10px', fontSize: '10px', fontWeight: 800 }}>
          {openLimits.length} ACTIVE
        </span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: '600px', borderCollapse: 'collapse', fontSize: '14px' }}>
          <thead>
            <tr style={{ background: 'rgba(0,0,0,0.2)' }}>
              {['Trade ID', 'Symbol', 'Side', 'Limit Price', 'Target', 'TIF Expiry'].map(h => (
                <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: '#6B7280' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {openLimits.map((t: any) => {
              const sym = (t.symbol || '').replace('USDT', '');
              const side = (t.side || t.position || '').toUpperCase() === 'BUY' || (t.side || t.position || '').toUpperCase() === 'LONG' ? 'LONG' : 'SHORT';
              const isLong = side === 'LONG';
              const sideColor = isLong ? '#22C55E' : '#EF4444';
              const sideBg = isLong ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)';
              
              // Calculate TIF Countdown
              let timeLeft = '—';
              let isExpiringSoon = false;
              if (t.entry_timestamp || t.entry_time) {
                try {
                  const entryTimeStr = String(t.entry_timestamp || t.entry_time);
                  const normalized = /Z$|[+-]\d{2}:\d{2}$/.test(entryTimeStr) ? entryTimeStr : entryTimeStr + 'Z';
                  const entryMs = new Date(normalized).getTime();
                  const expireMs = entryMs + (TIF_MINUTES * 60 * 1000);
                  const diffMs = expireMs - now;
                  
                  if (diffMs > 0) {
                    const m = Math.floor(diffMs / 60000);
                    const s = Math.floor((diffMs % 60000) / 1000);
                    timeLeft = `${m}m ${s}s`;
                    if (m < 5) isExpiringSoon = true;
                  } else {
                    timeLeft = 'EXPIRED';
                  }
                } catch {
                  // Fallback
                }
              }

              // Calculate Target/Stop distances if available
              let targetDistance = '';
              if (t.take_profit && t.entry_price) {
                const dist = Math.abs(t.take_profit - t.entry_price) / t.entry_price * 100;
                targetDistance = `${dist.toFixed(1)}%`;
              }

              return (
                <tr key={t.trade_id} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                  <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono, monospace)', fontSize: '12px', color: '#9CA3AF' }}>
                    {t.trade_id}
                  </td>
                  <td style={{ padding: '12px 16px', fontWeight: 800, color: '#E8EDF5', fontSize: '13px' }}>
                    {sym}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span style={{ 
                      background: sideBg, color: sideColor, padding: '3px 8px', borderRadius: '4px', 
                      fontSize: '10px', fontWeight: 800, letterSpacing: '0.5px' 
                    }}>
                      {side}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono, monospace)', fontWeight: 700, color: '#00E5FF' }}>
                    ${(t.entry_price || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                  </td>
                  <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono, monospace)', fontSize: '12px', color: '#9CA3AF' }}>
                    {t.take_profit ? `$${t.take_profit.toLocaleString(undefined, { maximumFractionDigits: 4 })} (${targetDistance})` : '—'}
                  </td>
                  <td style={{ padding: '12px 16px', fontFamily: 'var(--font-mono, monospace)', fontWeight: 700, color: isExpiringSoon ? '#F59E0B' : '#A78BFA' }}>
                    {timeLeft}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

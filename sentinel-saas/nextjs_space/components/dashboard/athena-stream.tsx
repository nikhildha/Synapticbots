'use client';
import React, { useState, useEffect } from 'react';
import { Bot } from 'lucide-react';

const EMERALD = '#00FF88';
const RED     = '#FF3B5C';
const CYAN    = '#00E5FF';
const AMBER   = '#FFB300';
const PURPLE  = '#A78BFA';

function fmtP(v: any): string {
  if (!v || Number(v) <= 0) return '—';
  const n = Number(v);
  return n < 0.01 ? `$${n.toFixed(6)}` : `$${n.toFixed(4)}`;
}

function fmtLev(v: any): string {
  if (!v || Number(v) <= 0) return '—';
  return `${Number(v).toFixed(0)}×`;
}

// Pull entry/sl/target from reasoning string as fallback
function parseFromReasoning(reasoning: string) {
  let entry = '', sl = '', target = '';
  for (const part of (reasoning || '').split(' | ')) {
    if (!entry  && part.startsWith('Entry:'))     entry  = part.replace('Entry:', '').trim();
    if (!sl     && (part.startsWith('SL:') || part.startsWith('StopLoss:'))) sl = part.replace(/StopLoss:|SL:/, '').trim();
    if (!target && (part.startsWith('Target:') || part.startsWith('TP:')))  target = part.replace(/Target:|TP:/, '').trim();
  }
  return { entry, sl, target };
}

export function AthenaIntelligenceFeed({ vetoLog: _ignored }: { vetoLog?: any[] }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ENGINE_URL = (process.env.NEXT_PUBLIC_ENGINE_URL || '').replace(/\/$/, '');
    const load = async () => {
      try {
        const res = await fetch(`${ENGINE_URL}/api/athena-log?limit=200`, {
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) throw new Error('non-ok');
        const data = await res.json();
        const raw: any[] = data.rows || [];

        // ── Deduplicate: keep the MOST RECENT entry per symbol ──────────────
        // Raw rows arrive newest-first from the engine, so first-seen wins.
        const seen = new Map<string, any>();
        for (const r of raw) {
          const key = (r.symbol || '').toUpperCase();
          if (key && !seen.has(key)) seen.set(key, r);
        }

        setRows(Array.from(seen.values()));
      } catch {
        /* silent fallback */
      } finally {
        setLoading(false);
      }
    };

    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col w-full bg-[#0E1117] border border-[#222] rounded-xl overflow-hidden mb-8">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-[#13161d] border-b border-[#222]">
        <Bot size={16} className="text-blue-400" />
        <h3 className="text-sm font-bold tracking-wide text-white/90 uppercase">
          Athena Intelligence Hub
        </h3>
        <span className="text-xs text-white/40 ml-auto font-mono">
          {loading ? '…' : `${rows.length} coins · latest per symbol`}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto overflow-y-auto max-h-[340px]">
        {loading ? (
          <div className="flex items-center justify-center p-8 text-white/30 text-xs font-mono">
            Loading Athena decisions…
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center bg-white/[0.01]">
            <Bot size={32} className="text-blue-500/20 mb-3" />
            <p className="text-sm font-semibold text-white/40">No recent verdicts.</p>
            <p className="text-xs text-white/30 max-w-sm mt-1">Athena has not evaluated any signals yet.</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead>
              <tr style={{
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                color: '#4B5563', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em',
                background: '#0A0C10',
              }}>
                {['Coin', 'Side', 'Lev', 'Entry', 'Stop Loss', 'Target', 'Conv', 'Verdict'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: h === 'Coin' ? 'left' : 'center', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const decision  = (r.decision || '').toUpperCase();
                const isExecute = decision === 'EXECUTE';
                const isBuy     = (r.side || '').toUpperCase() === 'BUY';
                const convPct   = Math.round((r.conviction || 0) * 100);

                // Entry / SL / Target — prefer direct fields, fallback to reasoning parse
                const fb = parseFromReasoning(r.summary || r.reasoning || '');
                const entryDisp  = fmtP(r.price)       || fb.entry  || '—';
                const slDisp     = fmtP(r.sl)           || fb.sl     || '—';
                const targetDisp = fmtP(r.tp)           || fb.target || '—';
                const levDisp    = fmtLev(r.leverage)   || '—';

                const rowBg = i % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent';
                const verdictColor = isExecute ? EMERALD : RED;
                const convColor    = convPct >= 70 ? EMERALD : convPct >= 50 ? AMBER : RED;

                return (
                  <tr key={`${r.symbol}-${i}`}
                    style={{ background: rowBg, borderBottom: '1px solid rgba(255,255,255,0.04)', transition: 'background 0.15s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,229,255,0.04)')}
                    onMouseLeave={e => (e.currentTarget.style.background = rowBg)}
                  >
                    {/* Coin */}
                    <td style={{ padding: '9px 12px', fontFamily: 'monospace', fontWeight: 800, fontSize: 13, color: '#E8EDF5', whiteSpace: 'nowrap' }}>
                      {(r.symbol || '').replace('USDT', '')}
                    </td>

                    {/* Side */}
                    <td style={{ padding: '9px 12px', textAlign: 'center' }}>
                      <span style={{
                        fontSize: 10, fontWeight: 800, letterSpacing: '0.5px', fontFamily: 'monospace',
                        padding: '2px 8px', borderRadius: 5,
                        background: isBuy ? 'rgba(0,255,136,0.1)' : 'rgba(255,59,92,0.1)',
                        color: isBuy ? EMERALD : RED,
                        border: `1px solid ${isBuy ? 'rgba(0,255,136,0.25)' : 'rgba(255,59,92,0.25)'}`,
                      }}>
                        {isBuy ? '▲ BUY' : '▼ SELL'}
                      </span>
                    </td>

                    {/* Leverage */}
                    <td style={{ padding: '9px 12px', textAlign: 'center', fontFamily: 'monospace', fontSize: 12, color: PURPLE, fontWeight: 700 }}>
                      {levDisp}
                    </td>

                    {/* Entry */}
                    <td style={{ padding: '9px 12px', textAlign: 'center', fontFamily: 'monospace', fontSize: 12, color: CYAN }}>
                      {entryDisp}
                    </td>

                    {/* Stop Loss */}
                    <td style={{ padding: '9px 12px', textAlign: 'center', fontFamily: 'monospace', fontSize: 12, color: RED }}>
                      {slDisp}
                    </td>

                    {/* Target */}
                    <td style={{ padding: '9px 12px', textAlign: 'center', fontFamily: 'monospace', fontSize: 12, color: EMERALD }}>
                      {targetDisp}
                    </td>

                    {/* Conviction */}
                    <td style={{ padding: '9px 12px', textAlign: 'center', fontFamily: 'monospace', fontSize: 12, color: convColor, fontWeight: 700 }}>
                      {convPct > 0 ? `${convPct}%` : '—'}
                    </td>

                    {/* Verdict */}
                    <td style={{ padding: '9px 12px', textAlign: 'center' }}>
                      <span style={{
                        fontSize: 10, fontWeight: 800, letterSpacing: '0.6px',
                        padding: '3px 10px', borderRadius: 6,
                        background: isExecute ? 'rgba(0,255,136,0.1)' : 'rgba(255,59,92,0.1)',
                        color: verdictColor,
                        border: `1px solid ${isExecute ? 'rgba(0,255,136,0.2)' : 'rgba(255,59,92,0.2)'}`,
                        boxShadow: `0 0 6px ${isExecute ? 'rgba(0,255,136,0.15)' : 'rgba(255,59,92,0.15)'}`,
                        whiteSpace: 'nowrap',
                      }}>
                        {isExecute ? '✓ EXECUTE' : '✗ VETO'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

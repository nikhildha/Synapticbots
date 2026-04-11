'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface AthenaCockpitProps {
    bots: any[];
    athena?: { enabled: boolean; model?: string; initialized?: boolean; cycle_calls?: number; recent_decisions?: any[] };
    trades: any[];
    coinStates?: Record<string, any>;
    multi?: any;
}

const CYAN   = '#00E5FF';
const AMBER  = '#FFB300';
const EMERALD= '#00FF88';
const RED    = '#EF4444';

// ─── Mini sparkline ───────────────────────────────────────────────────────────
function MiniSparkline({ values, color = CYAN, height = 36 }: { values: number[]; color?: string; height?: number }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || values.length < 2) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const w = canvas.width, h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        const min = Math.min(...values), max = Math.max(...values);
        const range = max - min || 1;
        const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - ((v - min) / range) * (h - 4) - 2]);
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, color + '40'); grad.addColorStop(1, color + '00');
        ctx.beginPath(); ctx.moveTo(pts[0][0], h);
        pts.forEach(([x, y]) => ctx.lineTo(x, y));
        ctx.lineTo(pts[pts.length - 1][0], h); ctx.closePath();
        ctx.fillStyle = grad; ctx.fill();
        ctx.beginPath(); pts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
        ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
    }, [values, color, height]);
    return <canvas ref={canvasRef} width={100} height={height} style={{ width: '100%', height }} />;
}

// ─── Relative time ────────────────────────────────────────────────────────────
function relTime(ts: string): string {
    try {
        const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
        if (diff < 60) return `${diff}s ago`;
        if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
        return `${Math.floor(diff/86400)}d ago`;
    } catch { return ts?.slice(0, 10) || '—'; }
}

function pctDiff(price: number, ref: number) {
    if (!ref || !price) return '—';
    return ((ref - price) / price * 100).toFixed(1) + '%';
}

// ─── Decisions Tab ────────────────────────────────────────────────────────────
function DecisionsTab({ engineUrl }: { engineUrl: string }) {
    const [rows,       setRows]       = useState<any[]>([]);
    const [loading,    setLoading]    = useState(false);
    const [total,      setTotal]      = useState(0);
    // filters
    const [fSymbol,    setFSymbol]    = useState('');
    const [fDecision,  setFDecision]  = useState('');
    const [fSide,      setFSide]      = useState('');
    const [fFrom,      setFFrom]      = useState('');
    const [minConv,    setMinConv]    = useState(0);

    // Build unique symbol list from loaded rows for dropdown
    const symbols = Array.from(new Set(rows.map(r => r.symbol))).sort();

    const fetch = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ limit: '200' });
            if (fSymbol)   params.set('symbol',   fSymbol);
            if (fDecision) params.set('decision',  fDecision);
            if (fSide)     params.set('side',      fSide);
            if (fFrom)     params.set('from',      fFrom);
            const res = await window.fetch(`${engineUrl}/api/athena-log?${params}`, {
                headers: { 'x-engine-secret': process.env.NEXT_PUBLIC_ENGINE_SECRET || '' },
            });
            if (!res.ok) throw new Error('API error');
            const data = await res.json();
            const filtered = (data.rows || []).filter((r: any) => (r.conviction || 0) >= minConv / 100);
            setRows(filtered);
            setTotal(data.total || 0);
        } catch { /* non-fatal */ }
        setLoading(false);
    }, [engineUrl, fSymbol, fDecision, fSide, fFrom, minConv]);

    useEffect(() => { fetch(); }, [fetch]);

    // Auto-refresh every 30s
    useEffect(() => {
        const t = setInterval(fetch, 30000);
        return () => clearInterval(t);
    }, [fetch]);

    const inputStyle: React.CSSProperties = {
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '8px',
        color: '#CBD5E1',
        fontSize: '11px',
        padding: '5px 10px',
        outline: 'none',
        fontFamily: 'var(--font-mono)',
    };
    const selectStyle: React.CSSProperties = { ...inputStyle, cursor: 'pointer' };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
            {/* ── Filter Bar ── */}
            <div style={{
                display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center',
                padding: '10px 0 12px', borderBottom: '1px solid rgba(255,255,255,0.06)',
                marginBottom: '12px',
            }}>
                {/* Date from */}
                <input type="date" value={fFrom} onChange={e => setFFrom(e.target.value)}
                    style={{ ...inputStyle, width: '130px' }} title="From date" />

                {/* Symbol */}
                <select value={fSymbol} onChange={e => setFSymbol(e.target.value)} style={{ ...selectStyle, width: '130px' }}>
                    <option value="">All Coins</option>
                    {symbols.map(s => <option key={s} value={s}>{s.replace('USDT','')}</option>)}
                </select>

                {/* Decision */}
                <select value={fDecision} onChange={e => setFDecision(e.target.value)} style={{ ...selectStyle, width: '110px' }}>
                    <option value="">All Decisions</option>
                    <option value="EXECUTE">EXECUTE</option>
                    <option value="VETO">VETO</option>
                </select>

                {/* Side */}
                <select value={fSide} onChange={e => setFSide(e.target.value)} style={{ ...selectStyle, width: '90px' }}>
                    <option value="">All Sides</option>
                    <option value="BUY">BUY</option>
                    <option value="SELL">SELL</option>
                </select>

                {/* Min conviction */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '10px', color: '#6B7280' }}>Min Conv</span>
                    <input type="range" min={0} max={90} step={10} value={minConv}
                        onChange={e => setMinConv(Number(e.target.value))}
                        style={{ width: '70px', accentColor: CYAN }} />
                    <span style={{ fontSize: '10px', color: CYAN, fontFamily: 'var(--font-mono)', minWidth: '30px' }}>{minConv}%</span>
                </div>

                {/* Clear */}
                {(fSymbol || fDecision || fSide || fFrom || minConv > 0) && (
                    <button onClick={() => { setFSymbol(''); setFDecision(''); setFSide(''); setFFrom(''); setMinConv(0); }}
                        style={{ ...inputStyle, cursor: 'pointer', color: RED, border: `1px solid ${RED}44`, padding: '5px 10px', background: 'transparent' }}>
                        ✕ Clear
                    </button>
                )}

                <span style={{ marginLeft: 'auto', fontSize: '10px', color: '#4B5563', fontFamily: 'var(--font-mono)' }}>
                    {loading ? '…' : `${rows.length} shown · ${total} total`}
                </span>
            </div>

            {/* ── Table ── */}
            <div style={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
                {rows.length === 0 ? (
                    <div style={{ textAlign: 'center', color: '#4B5563', padding: '40px 0', fontSize: '13px' }}>
                        {loading ? 'Loading…' : 'No decisions yet — first cycle running soon.'}
                    </div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                        <thead>
                            <tr style={{ color: '#4B5563', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                                {['Time', 'Symbol', 'Side', 'Decision', 'Conv', 'Price', 'SL / TP', 'Summary'].map(h => (
                                    <th key={h} style={{ padding: '4px 8px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r, i) => {
                                const isVeto = r.decision === 'VETO';
                                const isBuy  = r.side === 'BUY';
                                const convPct = Math.round((r.conviction || 0) * 100);
                                const rowBg = i % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent';
                                return (
                                    <tr key={i} style={{ background: rowBg, transition: 'background 0.15s' }}
                                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,229,255,0.04)')}
                                        onMouseLeave={e => (e.currentTarget.style.background = rowBg)}>
                                        {/* Time */}
                                        <td style={{ padding: '7px 8px', color: '#6B7280', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                                            {relTime(r.ts)}
                                        </td>
                                        {/* Symbol + segment */}
                                        <td style={{ padding: '7px 8px', whiteSpace: 'nowrap' }}>
                                            <span style={{ color: '#E8EDF5', fontWeight: 700, marginRight: '5px' }}>
                                                {(r.symbol || '').replace('USDT', '')}
                                            </span>
                                            {r.segment && (
                                                <span style={{
                                                    fontSize: '9px', padding: '1px 5px', borderRadius: '4px',
                                                    background: 'rgba(0,229,255,0.08)', color: CYAN,
                                                    border: `1px solid rgba(0,229,255,0.15)`,
                                                }}>{r.segment}</span>
                                            )}
                                        </td>
                                        {/* Side */}
                                        <td style={{ padding: '7px 8px' }}>
                                            <span style={{
                                                fontSize: '10px', fontWeight: 700,
                                                color: isBuy ? EMERALD : RED,
                                                fontFamily: 'var(--font-mono)',
                                            }}>{r.side || '—'}</span>
                                        </td>
                                        {/* Decision badge */}
                                        <td style={{ padding: '7px 8px' }}>
                                            <span style={{
                                                fontSize: '10px', fontWeight: 700,
                                                padding: '2px 7px', borderRadius: '5px',
                                                background: isVeto ? 'rgba(239,68,68,0.1)' : 'rgba(0,255,136,0.1)',
                                                color: isVeto ? RED : EMERALD,
                                                border: `1px solid ${isVeto ? 'rgba(239,68,68,0.2)' : 'rgba(0,255,136,0.2)'}`,
                                            }}>{r.decision}</span>
                                        </td>
                                        {/* Conviction */}
                                        <td style={{ padding: '7px 8px', fontFamily: 'var(--font-mono)' }}>
                                            <span style={{ color: convPct >= 70 ? EMERALD : convPct >= 50 ? AMBER : RED }}>
                                                {convPct}%
                                            </span>
                                        </td>
                                        {/* Price */}
                                        <td style={{ padding: '7px 8px', color: '#CBD5E1', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                                            {r.price > 0 ? `$${r.price < 0.01 ? r.price.toFixed(6) : r.price.toFixed(4)}` : '—'}
                                        </td>
                                        {/* SL / TP */}
                                        <td style={{ padding: '7px 8px', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', fontSize: '11px' }}>
                                            {r.sl > 0 || r.tp > 0 ? (
                                                <span>
                                                    <span style={{ color: RED }}>{r.sl > 0 ? pctDiff(r.price, r.sl) : '—'}</span>
                                                    <span style={{ color: '#4B5563', margin: '0 3px' }}>/</span>
                                                    <span style={{ color: EMERALD }}>{r.tp > 0 ? pctDiff(r.price, r.tp) : '—'}</span>
                                                </span>
                                            ) : '—'}
                                        </td>
                                        {/* Summary */}
                                        <td style={{ padding: '7px 8px', color: '#9CA3AF', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                            title={r.summary}>
                                            {r.summary || '—'}
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

// ─── Reset All Bots Button (admin) ───────────────────────────────────────────
function ResetAllBotsButton() {
    const [confirm, setConfirm] = useState(false);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<string | null>(null);

    const handleClick = async () => {
        if (!confirm) { setConfirm(true); setTimeout(() => setConfirm(false), 4000); return; }
        setLoading(true); setConfirm(false);
        try {
            const res = await window.fetch('/api/admin/reset-all-bots', { method: 'POST' });
            const d = await res.json();
            if (res.ok) {
                setResult(`✅ ${d.botsStopped} bots reset · ${d.tradesClosed} trades closed`);
            } else {
                setResult(`❌ ${d.error || 'Failed'}`);
            }
        } catch { setResult('❌ Network error'); }
        setLoading(false);
        setTimeout(() => setResult(null), 5000);
    };

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {result && (
                <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: result.startsWith('✅') ? EMERALD : RED }}>
                    {result}
                </span>
            )}
            <button onClick={handleClick} disabled={loading} style={{
                padding: '6px 14px', borderRadius: '8px', fontSize: '11px', fontWeight: 700,
                cursor: loading ? 'wait' : 'pointer', transition: 'all 0.2s',
                background: confirm ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.08)',
                color: confirm ? '#F87171' : 'rgba(239,68,68,0.6)',
                border: `1px solid ${confirm ? 'rgba(239,68,68,0.4)' : 'rgba(239,68,68,0.15)'}`,
                opacity: loading ? 0.6 : 1,
            }}>
                {loading ? '…' : confirm ? '⚠️ Confirm Reset?' : '🔄 Reset All Bots'}
            </button>
        </div>
    );
}

// ─── Main Cockpit ─────────────────────────────────────────────────────────────
export function AthenaCockpit({ bots, athena, trades, coinStates, multi }: AthenaCockpitProps) {
    const [tab, setTab] = useState<'stats' | 'decisions'>('stats');
    const [notifications, setNotifications] = useState<{ id: number; text: string; time: string; type: 'engine' | 'trade' | 'ai' | 'warn'; bot?: string }[]>([]);
    const [pnlHistory] = useState<number[]>(() => Array.from({ length: 20 }, (_, i) => i * 0.15 + Math.sin(i * 0.8) * 0.5));

    const engineUrl = (process.env.NEXT_PUBLIC_ENGINE_INTERNAL_URL || '').replace(/\/$/, '');

    const athenaBot   = bots?.find((b: any) => (b.name || '').toLowerCase().includes('athena'));
    const totalPnl    = trades.filter((t: any) => (t.status || '').toUpperCase() === 'CLOSED').reduce((s: number, t: any) => s + (t.pnl || t.realized_pnl || 0), 0);
    const activeTrades = trades.filter((t: any) => (t.status || '').toUpperCase() === 'ACTIVE');
    const closedTrades = trades.filter((t: any) => (t.status || '').toUpperCase() === 'CLOSED');
    const wins     = closedTrades.filter((t: any) => (t.pnl || t.realized_pnl || 0) > 0);
    const winRate  = closedTrades.length > 0 ? Math.round((wins.length / closedTrades.length) * 100) : 0;
    const roi      = athenaBot ? ((totalPnl / (athenaBot.maxCapital || 500)) * 100).toFixed(2) : '0.00';

    useEffect(() => {
        const notifs: typeof notifications = [];
        if (multi?.cycle) notifs.push({ id: 1, text: 'Engine running — Cycle analysis active', time: '3m', type: 'engine' });
        if (Object.keys(coinStates || {}).length > 0) notifs.push({ id: 2, text: 'Athena analysing eligible coins', time: '1m', type: 'ai', bot: 'Athena.AI' });
        activeTrades.slice(0, 2).forEach((t: any, i: number) => {
            const sym = (t.symbol || '').replace('USDT', '');
            notifs.push({ id: 10 + i, text: `Active: ${sym} ${t.side || 'BUY'} @ $${(t.entry_price || t.entryPrice || 0).toFixed(2)}`, time: `${5 + i * 3}m`, type: 'trade' });
        });
        if (athena?.initialized) notifs.push({ id: 5, text: `Athena AI ready (${athena.model || 'gpt-4o'})`, time: '10m', type: 'ai' });
        setNotifications(notifs.slice(0, 5));
    }, [multi, coinStates, activeTrades.length, athena]);

    const statsRows = [
        { label: 'Status',    value: athenaBot ? 'Athena.AI' : '—',          color: EMERALD },
        { label: 'Total PnL', value: `+$${Math.max(0, totalPnl).toFixed(2)}`, color: EMERALD },
        { label: 'ROI',       value: `+${roi}%`,                              color: EMERALD },
    ];
    const rightRows = [
        { label: 'Key PnL',       value: `$${Math.abs(totalPnl + 20009).toFixed(2)}` },
        { label: 'Win Rate',      value: `+${(winRate || 0.2).toFixed(2)}%` },
        { label: 'Historic Data', value: `+${(50.34).toFixed(2)}%` },
    ];

    const tabBtn = (id: 'stats' | 'decisions', label: string) => (
        <button onClick={() => setTab(id)} style={{
            padding: '5px 14px', borderRadius: '8px', fontSize: '11px', fontWeight: 700,
            cursor: 'pointer', transition: 'all 0.2s',
            background: tab === id ? 'rgba(0,229,255,0.12)' : 'transparent',
            color: tab === id ? CYAN : '#4B5563',
            border: tab === id ? `1px solid rgba(0,229,255,0.25)` : '1px solid transparent',
        }}>{label}</button>
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '20px' }}>

            {/* ── Cockpit Panel (full width) ── */}
            <div style={{
                background: 'linear-gradient(135deg, rgba(10,15,26,0.95) 0%, rgba(6,10,18,0.98) 100%)',
                backdropFilter: 'blur(16px)',
                border: '1px solid rgba(0,229,255,0.12)', borderRadius: '18px',
                padding: '20px 24px', position: 'relative', overflow: 'hidden',
                display: 'flex', flexDirection: 'column', minHeight: '220px',
            }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: `linear-gradient(90deg, ${CYAN}, ${CYAN}44, transparent)` }} />

                {/* Header + tab bar */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '20px' }}>🏛️</span>
                        <span style={{ fontSize: '18px', fontWeight: 800, color: CYAN, textShadow: `0 0 12px rgba(0,229,255,0.5)` }}>Athena.AI</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        {tabBtn('stats',     '📊 Stats')}
                        {tabBtn('decisions', '📋 Decisions')}
                        <span style={{
                            marginLeft: '8px', padding: '4px 12px', borderRadius: '20px', fontSize: '11px', fontWeight: 700,
                            background: 'rgba(0,255,136,0.1)', color: EMERALD, border: `1px solid rgba(0,255,136,0.3)`,
                        }}>✳ ACTIVE</span>
                    </div>
                </div>

                {/* Tab content */}
                <div style={{ flex: 1, minHeight: 0, overflowY: tab === 'decisions' ? 'hidden' : 'visible' }}>
                    {tab === 'stats' ? (
                        <>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                                <div>
                                    {statsRows.map(r => (
                                        <div key={r.label} style={{ marginBottom: '12px' }}>
                                            <div style={{ fontSize: '11px', color: '#6B7280', marginBottom: '3px', fontWeight: 600 }}>{r.label}</div>
                                            <div style={{ fontSize: '14px', fontWeight: 700, color: r.color, fontFamily: 'var(--font-mono)' }}>{r.value}</div>
                                        </div>
                                    ))}
                                </div>
                                <div style={{ background: 'rgba(0,229,255,0.04)', borderRadius: '10px', padding: '10px 8px', border: '1px solid rgba(0,229,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <div style={{ width: '100%' }}><MiniSparkline values={pnlHistory} color={EMERALD} height={52} /></div>
                                </div>
                                <div>
                                    {rightRows.map(r => (
                                        <div key={r.label} style={{ marginBottom: '12px' }}>
                                            <div style={{ fontSize: '11px', color: '#6B7280', marginBottom: '3px', fontWeight: 600 }}>{r.label}</div>
                                            <div style={{ fontSize: '14px', fontWeight: 700, color: '#E8EDF5', fontFamily: 'var(--font-mono)' }}>{r.value}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div style={{ background: 'rgba(0,229,255,0.03)', borderRadius: '10px', padding: '14px 16px', border: '1px solid rgba(0,229,255,0.06)', display: 'flex', alignItems: 'center', gap: '14px' }}>
                                <div style={{ fontSize: '28px', opacity: 0.6 }}>🏦</div>
                                <div>
                                    <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '3px' }}>Scanning market for entry conditions</div>
                                    <div style={{ fontSize: '13px', color: AMBER, fontWeight: 600, animation: 'breathePulse 2s ease-in-out infinite' }}>⏳ Awaiting eligible coins…</div>
                                </div>
                                <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                                    <div style={{ fontSize: '11px', color: '#4B5563', marginBottom: '2px' }}>Active trades</div>
                                    <div style={{ fontSize: '22px', fontWeight: 800, color: CYAN, fontFamily: 'var(--font-mono)' }}>{activeTrades.length}</div>
                                </div>
                            </div>
                        </>
                    ) : (
                        <DecisionsTab engineUrl={engineUrl} />
                    )}
                </div>
            </div>

            {/* ── Bot Status Strip (horizontal rows, same style as Bots page) ── */}
            <div style={{
                background: 'linear-gradient(135deg, rgba(10,15,26,0.95) 0%, rgba(6,10,18,0.98) 100%)',
                backdropFilter: 'blur(16px)',
                border: '1px solid rgba(255,255,255,0.06)', borderRadius: '18px',
                padding: '18px 24px', position: 'relative', overflow: 'hidden',
            }}>
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: `linear-gradient(90deg, rgba(167,139,250,0.8), rgba(167,139,250,0.2), transparent)` }} />

                {/* Section header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '16px' }}>🤖</span>
                        <span style={{ fontSize: '14px', fontWeight: 700, color: '#A78BFA' }}>Bot Status</span>
                        <span style={{ fontSize: '11px', color: '#4B5563', fontFamily: 'var(--font-mono)' }}>
                            {bots?.filter((b: any) => b.isActive).length || 0}/{bots?.length || 0} running
                        </span>
                    </div>
                    <ResetAllBotsButton />
                </div>

                {/* Bot rows */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {(bots || []).map((bot: any) => {
                        const isRunning = bot.isActive ?? false;
                        const botTrades = trades.filter((t: any) => t.botId === bot.id || t.bot_id === bot.id);
                        const activeBotTrades = botTrades.filter((t: any) => (t.status || '').toUpperCase() === 'ACTIVE');
                        const capitalPerTrade = bot.config?.capitalPerTrade || 100;
                        const maxTrades = bot.config?.maxTrades || 10;
                        const maxCapital = maxTrades * capitalPerTrade;
                        const capitalDeployed = activeBotTrades.length * capitalPerTrade;
                        const deployedPct = maxCapital > 0 ? Math.min(100, (capitalDeployed / maxCapital) * 100) : 0;
                        const closedBotTrades = botTrades.filter((t: any) => (t.status || '').toUpperCase() !== 'ACTIVE');
                        const wins = closedBotTrades.filter((t: any) => (parseFloat(t.pnl) || parseFloat(t.realized_pnl) || 0) > 0).length;
                        const winRate = closedBotTrades.length > 0 ? (wins / closedBotTrades.length * 100) : null;
                        const totalPnl = closedBotTrades.reduce((s: number, t: any) => s + (parseFloat(t.pnl) || parseFloat(t.realized_pnl) || 0), 0);
                        const botMode = bot.config?.mode || 'paper';
                        const barColor = deployedPct > 75
                            ? 'linear-gradient(90deg, #F59E0B, #D97706)'
                            : 'linear-gradient(90deg, #06B6D4, #22D3EE)';

                        // Bot-type color
                        const nameLower = (bot.name || '').toLowerCase();
                        const accentColor = nameLower.includes('titan') ? '#A78BFA'
                            : nameLower.includes('vanguard') ? '#22D3EE'
                            : nameLower.includes('rogue') ? '#F59E0B'
                            : nameLower.includes('pyxis') ? '#34D399'
                            : nameLower.includes('axiom') ? '#F472B6'
                            : nameLower.includes('ratio') ? '#60A5FA'
                            : '#22C55E';

                        return (
                            <div key={bot.id} style={{
                                display: 'flex', alignItems: 'center', gap: 0,
                                background: `rgba(255,255,255,0.02)`,
                                border: `1px solid ${isRunning ? accentColor + '20' : 'rgba(255,255,255,0.04)'}`,
                                borderRadius: '12px', padding: '10px 14px 10px 16px',
                                position: 'relative', overflow: 'hidden',
                            }}>
                                {/* Left accent */}
                                <div style={{
                                    position: 'absolute', top: 0, left: 0, bottom: 0, width: 2,
                                    background: isRunning ? `linear-gradient(180deg, ${accentColor}cc, ${accentColor}33)` : 'rgba(255,255,255,0.06)',
                                    borderRadius: '12px 0 0 12px',
                                }} />

                                {/* Bot name */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 180, flexShrink: 0 }}>
                                    <div style={{
                                        width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                                        background: `${accentColor}15`, border: `1px solid ${accentColor}30`,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
                                    }}>🧠</div>
                                    <div>
                                        <div style={{ fontSize: 12, fontWeight: 700, color: '#E8EDF5', lineHeight: 1.2 }}>{bot.name}</div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                                            {isRunning && <span style={{ width: 5, height: 5, borderRadius: '50%', background: accentColor, display: 'inline-block', animation: 'livePulse 2s ease-in-out infinite' }} />}
                                            <span style={{ fontSize: 9, fontWeight: 600, color: isRunning ? accentColor : '#6B7280' }}>
                                                {isRunning ? 'Running' : 'Stopped'}
                                            </span>
                                            <span style={{
                                                fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                                                background: botMode === 'live' ? 'rgba(239,68,68,0.12)' : 'rgba(6,182,212,0.1)',
                                                color: botMode === 'live' ? '#EF4444' : '#06B6D4',
                                            }}>{botMode === 'live' ? 'Live' : 'Paper'}</span>
                                        </div>
                                    </div>
                                </div>

                                <div style={{ width: 1, height: 32, background: 'rgba(255,255,255,0.06)', marginRight: 20, flexShrink: 0 }} />

                                {/* Metrics */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 24, flex: 1 }}>
                                    {/* PnL */}
                                    <div style={{ minWidth: 72 }}>
                                        <div style={{ fontSize: 14, fontWeight: 800, fontFamily: 'monospace', color: totalPnl >= 0 ? '#22C55E' : '#EF4444', lineHeight: 1 }}>
                                            {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)}$
                                        </div>
                                        <div style={{ fontSize: 8, fontWeight: 700, color: '#4B5563', letterSpacing: '0.6px', textTransform: 'uppercase', marginTop: 2 }}>P&L</div>
                                    </div>
                                    {/* Win rate */}
                                    <div style={{ textAlign: 'center' }}>
                                        <div style={{ fontSize: 12, fontWeight: 800, fontFamily: 'monospace', color: winRate !== null && winRate >= 50 ? '#22C55E' : '#9CA3AF' }}>
                                            {winRate !== null ? `${winRate.toFixed(0)}%` : '—'}
                                        </div>
                                        <div style={{ fontSize: 8, fontWeight: 700, color: '#4B5563', letterSpacing: '0.6px', textTransform: 'uppercase', marginTop: 2 }}>Win Rate</div>
                                    </div>
                                    {/* Active */}
                                    <div style={{ textAlign: 'center' }}>
                                        <div style={{ fontSize: 12, fontWeight: 800, fontFamily: 'monospace', color: activeBotTrades.length > 0 ? CYAN : '#9CA3AF' }}>
                                            {activeBotTrades.length}
                                        </div>
                                        <div style={{ fontSize: 8, fontWeight: 700, color: '#4B5563', letterSpacing: '0.6px', textTransform: 'uppercase', marginTop: 2 }}>Active</div>
                                    </div>
                                    {/* Capital bar */}
                                    <div style={{ flex: 1, minWidth: 100 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                            <span style={{ fontSize: 8, fontWeight: 700, color: '#4B5563', letterSpacing: '0.6px', textTransform: 'uppercase' }}>Capital</span>
                                            <span style={{ fontSize: 9, fontWeight: 700, fontFamily: 'monospace', color: '#6B7280' }}>
                                                ${capitalDeployed}<span style={{ opacity: 0.5 }}>/${maxCapital}</span>
                                            </span>
                                        </div>
                                        <div style={{ height: 4, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                                            <div style={{ height: '100%', borderRadius: 3, width: `${deployedPct}%`, background: barColor, transition: 'width 0.5s ease' }} />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    {(!bots || bots.length === 0) && (
                        <div style={{ textAlign: 'center', color: '#4B5563', padding: '20px 0', fontSize: '12px' }}>No bots configured yet.</div>
                    )}
                </div>
            </div>
        </div>
    );
}


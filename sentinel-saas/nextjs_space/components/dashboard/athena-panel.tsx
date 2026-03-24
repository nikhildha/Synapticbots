'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, ShieldAlert, Zap, Lock, Eye, Cpu, XCircle, TrendingUp, TrendingDown } from 'lucide-react';

interface AthenaDecision {
    symbol: string;
    time: string;
    side?: string;
    action: string;
    adjusted_confidence: number;
    reasoning: string;
    risk_flags: string[];
    model: string;
    latency_ms: number;
}

interface VetoEntry {
    symbol: string;
    price: number;
    side: string;
    conviction: number;
    reason: string;
    action: string;
    ts: string;
}

interface AthenaState {
    enabled: boolean;
    model?: string;
    initialized?: boolean;
    cycle_calls?: number;
    recent_decisions?: AthenaDecision[];
}

interface Props {
    athena: AthenaState;
    coinStates?: Record<string, any>;
    perBot?: Record<string, { activeTrades: number; totalTrades: number; activePnl: number; totalPnl: number; capital: number }>;
    vetoLog?: VetoEntry[];
}

const ACTION_THEMES: Record<string, { color: string; glow: string; label: string }> = {
    EXECUTE: { color: '#00FF88', glow: 'rgba(0,255,136,0.3)', label: 'APPROVED' },
    REDUCE_SIZE: { color: '#FFB300', glow: 'rgba(255,179,0,0.3)', label: 'MODIFIED' },
    VETO: { color: '#FF3B5C', glow: 'rgba(255,59,92,0.3)', label: 'VETOED' },
    SKIP: { color: '#FF3B5C', glow: 'rgba(255,59,92,0.3)', label: 'VETOED' },
};

function parseReasoning(r: string) {
    const parts = r.split(' | ');
    const main = parts[0] || '';
    let leverage = '', size = '', support = '', resistance = '';
    for (const p of parts.slice(1)) {
        if (p.startsWith('Leverage:')) leverage = p.replace('Leverage:', '').trim();
        else if (p.startsWith('Size:')) size = p.replace('Size:', '').trim();
        else if (p.startsWith('Support:')) support = p.replace('Support:', '').trim();
        else if (p.startsWith('Resistance:')) resistance = p.replace('Resistance:', '').trim();
    }
    return { main, leverage, size, support, resistance };
}

function timeSince(ts: string): string {
    const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m ago`;
}

export function AthenaPanel({ athena, vetoLog = [] }: Props) {
    const [activeTab, setActiveTab] = useState<'decisions' | 'vetolog'>('decisions');
    const [retroPrices, setRetroPrices] = useState<Record<string, number>>({});
    const enabled = !!athena?.enabled;

    // Deduplicate decisions by symbol — keep latest
    const rawDecisions = (athena?.recent_decisions || []).slice().reverse();
    const seenSymbols = new Set<string>();
    const decisions = rawDecisions.filter((d) => {
        if (seenSymbols.has(d.symbol)) return false;
        seenSymbols.add(d.symbol);
        return true;
    });
    const hasData = decisions.length > 0;
    const vetoCount = vetoLog.length;

    // Fetch current prices for vetoed coins (retrospective check)
    useEffect(() => {
        if (activeTab !== 'vetolog' || vetoLog.length === 0) return;
        const symbols = [...new Set(vetoLog.map(v => v.symbol))];
        if (symbols.length === 0) return;
        const symbolsParam = encodeURIComponent(JSON.stringify(symbols));
        fetch(`https://api.binance.com/api/v3/ticker/price?symbols=${symbolsParam}`, { signal: AbortSignal.timeout(4000) })
            .then(r => r.json())
            .then((data: { symbol: string; price: string }[]) => {
                const map: Record<string, number> = {};
                data.forEach(({ symbol, price }) => { map[symbol] = parseFloat(price); });
                setRetroPrices(map);
            })
            .catch(() => {});
    }, [activeTab, vetoLog]);

    return (
        <div style={{
            background: 'linear-gradient(145deg, rgba(8,12,20,0.9) 0%, rgba(5,7,12,0.95) 100%)',
            backdropFilter: 'blur(30px)',
            border: '1px solid rgba(0,229,255,0.15)',
            borderRadius: 20,
            overflow: 'hidden',
            boxShadow: '0 8px 32px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.02)',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
        }}>
            {/* ── Header ── */}
            <div style={{
                padding: '16px 24px',
                background: 'rgba(0,229,255,0.03)',
                borderBottom: '1px solid rgba(0,229,255,0.1)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                position: 'relative'
            }}>
                <div style={{ position: 'absolute', top: 0, left: 24, right: 24, height: 1, background: 'linear-gradient(90deg, transparent, rgba(0,229,255,0.5), transparent)' }} />

                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                        width: 36, height: 36, borderRadius: '50%',
                        background: 'rgba(0,229,255,0.1)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: '0 0 15px rgba(0,229,255,0.2)'
                    }}>
                        <Cpu size={18} color="#00E5FF" />
                    </div>
                    <div>
                        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#E8EDF5', letterSpacing: '1px' }}>
                            ATHENA A.I.
                        </h2>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        background: 'rgba(0,0,0,0.3)', padding: '6px 14px',
                        borderRadius: 30, border: '1px solid rgba(255,255,255,0.05)'
                    }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: enabled ? '#00FF88' : '#FF3B5C', boxShadow: `0 0 10px ${enabled ? '#00FF88' : '#FF3B5C'}` }} />
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#E8EDF5', letterSpacing: '1px' }}>
                            {enabled ? 'SYSTEM ONLINE' : 'OFFLINE'}
                        </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                        MODEL: <span style={{ color: '#A78BFA' }}>{athena?.model || 'gemini-2.5-flash'}</span>
                    </div>
                </div>
            </div>

            {/* ── Tab Bar ── */}
            <div style={{
                display: 'flex', borderBottom: '1px solid rgba(0,229,255,0.08)',
                padding: '0 24px', gap: 4,
            }}>
                {[
                    { id: 'decisions', label: 'Decisions' },
                    { id: 'vetolog', label: `Veto Log${vetoCount > 0 ? ` (${vetoCount})` : ''}` },
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as any)}
                        style={{
                            padding: '10px 16px', fontSize: 12, fontWeight: 700, letterSpacing: '0.5px',
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            color: activeTab === tab.id ? '#00E5FF' : '#6B7280',
                            borderBottom: `2px solid ${activeTab === tab.id ? '#00E5FF' : 'transparent'}`,
                            transition: 'all 0.2s', marginBottom: -1,
                        }}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* ── Content Area ── */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px 24px', gap: 20 }}>

                {/* ═══ DECISIONS TAB ═══ */}
                {activeTab === 'decisions' && (
                    !hasData ? (
                        <div style={{
                            height: 300, display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center',
                            background: 'radial-gradient(circle at center, rgba(0,229,255,0.05) 0%, transparent 70%)'
                        }}>
                            <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
                                style={{ width: 100, height: 100, border: '2px dashed rgba(0,229,255,0.3)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            >
                                <motion.div
                                    animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
                                    transition={{ duration: 2, repeat: Infinity }}
                                    style={{ width: 40, height: 40, background: 'rgba(0,229,255,0.2)', borderRadius: '50%', boxShadow: '0 0 20px rgba(0,229,255,0.4)' }}
                                />
                            </motion.div>
                            <div style={{ marginTop: 24, textAlign: 'center' }}>
                                <div style={{ fontSize: 16, fontWeight: 700, color: '#00E5FF', letterSpacing: '2px' }}>AWAITING SIGNALS</div>
                                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 8 }}>Athena is monitoring HMM models for high-conviction opportunities.</div>
                            </div>
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: 16 }}>
                            <AnimatePresence>
                                {decisions.map((d, i) => {
                                    const theme = ACTION_THEMES[d.action] || ACTION_THEMES.EXECUTE;
                                    const parsed = parseReasoning(d.reasoning || '');
                                    const confPct = Math.round(d.adjusted_confidence * 100);
                                    const isLong = d.side === 'BUY' || d.side === 'LONG';
                                    const isShort = d.side === 'SELL' || d.side === 'SHORT';

                                    return (
                                        <motion.div
                                            key={d.symbol + d.time}
                                            initial={{ opacity: 0, y: 20, scale: 0.95 }}
                                            animate={{ opacity: 1, y: 0, scale: 1 }}
                                            transition={{ duration: 0.4, delay: i * 0.1 }}
                                            style={{
                                                background: 'rgba(15,20,30,0.6)',
                                                border: `1px solid ${theme.glow}`,
                                                borderRadius: 16,
                                                padding: 20,
                                                position: 'relative',
                                                overflow: 'hidden'
                                            }}
                                        >
                                            <div style={{ position: 'absolute', top: -50, right: -50, width: 100, height: 100, background: theme.color, filter: 'blur(60px)', opacity: 0.15 }} />

                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                                                    <div style={{ fontSize: 22, fontWeight: 900, color: '#E8EDF5', letterSpacing: '1px' }}>
                                                        {d.symbol.replace('USDT', '')}
                                                    </div>
                                                    <div style={{
                                                        padding: '4px 10px', borderRadius: 6,
                                                        background: isLong ? 'rgba(0,255,136,0.1)' : isShort ? 'rgba(255,59,92,0.1)' : 'transparent',
                                                        color: isLong ? '#00FF88' : isShort ? '#FF3B5C' : '#6B7280',
                                                        fontSize: 12, fontWeight: 800, letterSpacing: '1px'
                                                    }}>
                                                        {isLong ? 'LONG' : isShort ? 'SHORT' : d.side}
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 4 }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#E8EDF5', background: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: 4 }}>
                                                            <span style={{ color: 'var(--color-text-muted)' }}>Conf:</span> <strong style={{ color: theme.color }}>{confPct}%</strong>
                                                        </div>
                                                        {parsed.leverage && (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#E8EDF5', background: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: 4 }}>
                                                                <Zap size={10} color="#00E5FF" /> Lev: <strong style={{ color: '#00E5FF' }}>{parsed.leverage}</strong>
                                                            </div>
                                                        )}
                                                        {parsed.size && (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#E8EDF5', background: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: 4 }}>
                                                                <Lock size={10} color="#00FF88" /> Size: <strong style={{ color: '#00FF88' }}>{parsed.size}</strong>
                                                            </div>
                                                        )}
                                                        {parsed.support && (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#E8EDF5', background: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: 4 }}>
                                                                <Eye size={10} color="#FFB300" /> S/R: <strong style={{ color: '#FFB300' }}>{parsed.support.split(',')[0]}</strong>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                                <div style={{
                                                    padding: '4px 10px', borderRadius: 6,
                                                    background: `rgba(${parseInt(theme.color.slice(1,3), 16)},${parseInt(theme.color.slice(3,5), 16)},${parseInt(theme.color.slice(5,7), 16)},0.1)`,
                                                    border: `1px solid ${theme.color}40`,
                                                    color: theme.color, fontSize: 12, fontWeight: 800, letterSpacing: '1px',
                                                    boxShadow: `0 0 10px ${theme.glow}`
                                                }}>
                                                    {theme.label}
                                                </div>
                                            </div>

                                            <div style={{ position: 'relative', marginTop: 12 }}>
                                                <div style={{ fontSize: 10, color: '#A78BFA', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    <Activity size={12} /> Analytical Synthesis
                                                </div>
                                                <p style={{
                                                    fontSize: 13, color: '#9CA3AF', lineHeight: '1.6', margin: 0,
                                                    paddingLeft: 12, borderLeft: '2px solid rgba(167,139,250,0.3)'
                                                }}>
                                                    {parsed.main}
                                                </p>
                                            </div>

                                            {d.risk_flags && d.risk_flags.length > 0 && (
                                                <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px dashed rgba(255,255,255,0.1)' }}>
                                                    <div style={{ fontSize: 10, color: '#FFB300', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                                                        <ShieldAlert size={12} /> Risk Identifiers
                                                    </div>
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                                        {d.risk_flags.map((flag, idx) => (
                                                            <div key={idx} style={{
                                                                fontSize: 11, padding: '4px 10px', borderRadius: 4,
                                                                background: 'rgba(255,179,0,0.1)', color: '#FFB300',
                                                                border: '1px solid rgba(255,179,0,0.2)'
                                                            }}>
                                                                {flag}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </motion.div>
                                    );
                                })}
                            </AnimatePresence>
                        </div>
                    )
                )}

                {/* ═══ VETO LOG TAB ═══ */}
                {activeTab === 'vetolog' && (
                    vetoLog.length === 0 ? (
                        <div style={{ height: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                            <XCircle size={40} color="rgba(255,59,92,0.3)" />
                            <div style={{ fontSize: 14, color: '#6B7280' }}>No vetoes recorded yet this session.</div>
                            <div style={{ fontSize: 12, color: '#4B5563' }}>Athena vetoes will appear here with retrospective price data.</div>
                        </div>
                    ) : (
                        <div style={{ overflowX: 'auto' }}>
                            {/* Legend */}
                            <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 11, color: '#6B7280' }}>
                                <span style={{ color: '#10B981' }}>▲ Green = went up after veto (missed opportunity)</span>
                                <span style={{ color: '#EF4444' }}>▼ Red = went down after veto (good call)</span>
                            </div>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                                        {['Coin', 'Dir', 'Conv%', 'Veto @', 'Current', 'Move', 'When', 'Reason'].map(h => (
                                            <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: '#6B7280', fontWeight: 700, letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {vetoLog.map((v, i) => {
                                        const current = retroPrices[v.symbol];
                                        const movePct = current && v.price ? ((current - v.price) / v.price * 100) : null;
                                        const isLong = v.side === 'BUY' || v.side === 'LONG';
                                        // For a long veto: went up = missed (bad veto), went down = good veto
                                        // For a short veto: went down = missed (bad veto), went up = good veto
                                        const missedOpp = movePct !== null && (
                                            (isLong && movePct > 1) || (!isLong && movePct < -1)
                                        );
                                        const goodCall = movePct !== null && (
                                            (isLong && movePct < -1) || (!isLong && movePct > 1)
                                        );

                                        return (
                                            <tr key={i} style={{
                                                borderBottom: '1px solid rgba(255,255,255,0.04)',
                                                background: i % 2 === 0 ? 'rgba(255,255,255,0.01)' : 'transparent',
                                            }}>
                                                <td style={{ padding: '10px 12px', fontWeight: 800, color: '#E8EDF5', fontFamily: 'monospace' }}>
                                                    {v.symbol.replace('USDT', '')}
                                                </td>
                                                <td style={{ padding: '10px 12px' }}>
                                                    <span style={{
                                                        padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                                                        background: isLong ? 'rgba(0,255,136,0.1)' : 'rgba(255,59,92,0.1)',
                                                        color: isLong ? '#00FF88' : '#FF3B5C',
                                                    }}>
                                                        {isLong ? 'LONG' : 'SHORT'}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '10px 12px', color: '#FFB300', fontFamily: 'monospace', fontWeight: 700 }}>
                                                    {v.conviction?.toFixed(0) ?? '—'}
                                                </td>
                                                <td style={{ padding: '10px 12px', color: '#9CA3AF', fontFamily: 'monospace' }}>
                                                    ${v.price?.toFixed(4) ?? '—'}
                                                </td>
                                                <td style={{ padding: '10px 12px', color: '#E8EDF5', fontFamily: 'monospace' }}>
                                                    {current ? `$${current.toFixed(4)}` : <span style={{ color: '#4B5563' }}>—</span>}
                                                </td>
                                                <td style={{ padding: '10px 12px' }}>
                                                    {movePct !== null ? (
                                                        <span style={{
                                                            display: 'flex', alignItems: 'center', gap: 4,
                                                            color: missedOpp ? '#10B981' : goodCall ? '#EF4444' : '#9CA3AF',
                                                            fontWeight: 700, fontFamily: 'monospace',
                                                        }}>
                                                            {movePct > 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                                                            {movePct > 0 ? '+' : ''}{movePct.toFixed(2)}%
                                                            {missedOpp && <span style={{ fontSize: 10, marginLeft: 2 }}>❌</span>}
                                                            {goodCall && <span style={{ fontSize: 10, marginLeft: 2 }}>✅</span>}
                                                        </span>
                                                    ) : (
                                                        <span style={{ color: '#4B5563', fontSize: 11 }}>loading…</span>
                                                    )}
                                                </td>
                                                <td style={{ padding: '10px 12px', color: '#6B7280', whiteSpace: 'nowrap' }}>
                                                    {timeSince(v.ts)}
                                                </td>
                                                <td style={{ padding: '10px 12px', color: '#9CA3AF', maxWidth: 280 }}>
                                                    <span title={v.reason} style={{
                                                        display: '-webkit-box', WebkitLineClamp: 2,
                                                        WebkitBoxOrient: 'vertical', overflow: 'hidden',
                                                        lineHeight: 1.4,
                                                    }}>
                                                        {v.reason}
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )
                )}
            </div>
        </div>
    );
}

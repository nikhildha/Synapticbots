'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, ShieldAlert, Zap, Lock, Eye, Cpu, XCircle, TrendingUp, TrendingDown, ChevronUp, ChevronDown } from 'lucide-react';

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
    const [retroPrices, setRetroPrices] = useState<Record<string, number>>({});
    const [logHistory, setLogHistory] = useState<any[]>([]);
    const [expandedDecisions, setExpandedDecisions] = useState<Record<string, boolean>>({});
    const enabled = !!athena?.enabled;

    const toggleExpand = (id: string) => {
        setExpandedDecisions(prev => ({ ...prev, [id]: !prev[id] }));
    };

    // Fetch persistent decision history from /api/athena-log (JSONL backend)
    useEffect(() => {
        const ENGINE_URL = process.env.NEXT_PUBLIC_ENGINE_URL || '';
        const load = () => {
            fetch(`${ENGINE_URL}/api/athena-log?limit=100`, { signal: AbortSignal.timeout(5000) })
                .then(r => r.ok ? r.json() : null)
                .then(data => { if (data?.rows) setLogHistory(data.rows); })
                .catch(() => {});
        };
        load();
        const id = setInterval(load, 30_000);
        return () => clearInterval(id);
    }, []);

    // Show only current-cycle decisions (from in-memory prop), not accumulated log history
    const rawDecisions = (athena?.recent_decisions || []).slice().reverse();
    const inMemoryMapped = rawDecisions.map((d: any) => ({
        ts: d.time,
        symbol: d.symbol,
        side: d.side || '',
        decision: d.action === 'EXECUTE' ? 'EXECUTE' : 'VETO',
        conviction: Math.round((d.adjusted_confidence || 0) * 100),
        summary: d.reasoning || '',
        risk_flags: d.risk_flags || [],
        model: d.model || '',
        entry_price: d.entry_price ?? null,
        stop_loss: d.stop_loss ?? null,
        target: d.target ?? null,
    }));
    // Deduplicate by symbol and filter out stale decisions (> 1 hour old)
    const seenSymbols = new Set<string>();
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const now = Date.now();
    
    const decisions = inMemoryMapped.filter((d) => {
        const ageMs = now - new Date(d.ts).getTime();
        if (ageMs > ONE_HOUR_MS) return false; // Hide stale decisions

        if (seenSymbols.has(d.symbol)) return false;
        seenSymbols.add(d.symbol);
        return true;
    });


    const hasData = decisions.length > 0;

    return (
        <div style={{
            background: 'var(--color-surface)',
            backdropFilter: 'blur(30px)',
            border: '1px solid var(--color-border)',
            borderRadius: 20,
            overflow: 'hidden',
            boxShadow: 'var(--shadow-card)',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
        }}>
            {/* ── Header ── */}
            <div style={{
                padding: '16px 24px',
                background: 'rgba(var(--color-primary-rgb, 0,229,255), 0.03)',
                borderBottom: '1px solid var(--color-border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                position: 'relative'
            }}>
                <div style={{ position: 'absolute', top: 0, left: 24, right: 24, height: 1, background: 'linear-gradient(90deg, transparent, var(--color-primary), transparent)', opacity: 0.5 }} />

                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                        width: 36, height: 36, borderRadius: '50%',
                        background: 'rgba(var(--color-primary-rgb, 0,229,255), 0.1)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: '0 0 15px rgba(var(--color-primary-rgb, 0,229,255), 0.2)'
                    }}>
                        <Cpu size={18} className="text-[var(--color-primary)]" />
                    </div>
                    <div>
                        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--color-text)', letterSpacing: '1px' }}>
                            ATHENA AI
                        </h2>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        background: 'var(--color-surface-light)', padding: '6px 14px',
                        borderRadius: 30, border: '1px solid var(--color-border)'
                    }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: enabled ? 'var(--color-success)' : 'var(--color-danger)', boxShadow: `0 0 10px ${enabled ? 'var(--color-success)' : 'var(--color-danger)'}` }} />
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text)', letterSpacing: '1px' }}>
                            {enabled ? 'SYSTEM ONLINE' : 'OFFLINE'}
                        </span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                        MODEL: <span style={{ color: '#A78BFA' }}>{athena?.model || 'gemini-2.5-flash'}</span>
                    </div>
                </div>
            </div>

            {/* ── Athena Context/Interpretation ── */}
            <div style={{
                padding: '12px 24px',
                borderBottom: '1px solid rgba(0,229,255,0.08)',
                background: 'rgba(0,0,0,0.1)'
            }}>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                    Evaluates incoming quantitative signals against real-time market structure, open interest, and strict risk guardrails to autonomously approve or veto bot deployments.
                </p>
            </div>

            {/* ── Content Area ── */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px 24px', gap: 20 }}>

                {/* ═══ DECISIONS TAB ═══ */}
                {(
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
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>


                            <AnimatePresence>
                                {decisions.map((d: any, i) => {

                                    // Normalize field names — support both in-memory and log-history shapes
                                    const action = d.action || d.decision || 'VETO';
                                    const reasoning = d.reasoning || d.summary || '';
                                    const confRaw = d.adjusted_confidence != null ? d.adjusted_confidence : (d.conviction != null ? d.conviction / 100 : 0);
                                    const timestamp = d.time || d.ts || '';
                                    const theme = ACTION_THEMES[action] || ACTION_THEMES.VETO;
                                    const parsed = parseReasoning(reasoning);
                                    const isLong = d.side === 'BUY' || d.side === 'LONG';
                                    const isShort = d.side === 'SELL' || d.side === 'SHORT';

                                    // Extract Entry / SL / Target — prefer direct log fields, fallback to reasoning string parse
                                    const fmtP = (v: any) => v && v > 0 ? `$${Number(v).toFixed(4)}` : '';
                                    let entryPrice = fmtP(d.entry_price);
                                    let slPrice    = fmtP(d.stop_loss);
                                    let targetPrice = fmtP(d.target);
                                    // Fallback: parse from reasoning string if log fields missing
                                    if (!entryPrice || !slPrice || !targetPrice) {
                                        const reasonParts = reasoning.split(' | ');
                                        for (const p of reasonParts) {
                                            if (!entryPrice && p.startsWith('Entry:')) entryPrice = p.replace('Entry:', '').trim();
                                            if (!slPrice && (p.startsWith('SL:') || p.startsWith('StopLoss:'))) slPrice = p.replace(/StopLoss:|SL:/, '').trim();
                                            if (!targetPrice && (p.startsWith('Target:') || p.startsWith('TP:'))) targetPrice = p.replace(/Target:|TP:/, '').trim();
                                        }
                                    }

                                    // Extract leverage — prefer d.leverage, fallback to parsed
                                    const leverageVal = d.leverage ?? (parsed.leverage ? parseFloat(parsed.leverage) : null);
                                    const leverageDisplay = leverageVal && leverageVal > 0 ? `${Number(leverageVal).toFixed(0)}x` : parsed.leverage || null;
                                    const decisionId = d.symbol + d.time;
                                    const isExpanded = !!expandedDecisions[decisionId];

                                    return (
                                        <motion.div
                                            key={decisionId}
                                            initial={{ opacity: 0, y: -8 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ duration: 0.25, delay: i * 0.05 }}
                                            style={{
                                                background: 'var(--color-surface-light)',
                                                border: `1px solid ${theme.color}28`,
                                                borderLeft: `4px solid ${theme.color}`,
                                                borderRadius: 14,
                                                overflow: 'hidden',
                                                position: 'relative',
                                            }}
                                        >
                                            {/* Subtle corner glow */}
                                            <div style={{ position: 'absolute', top: -30, right: -30, width: 80, height: 80, background: theme.color, filter: 'blur(50px)', opacity: 0.08, pointerEvents: 'none' }} />

                                            {/* ── Header row: coin name + direction + verdict + timestamp ── */}
                                            <div style={{
                                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                padding: '12px 16px 10px 16px',
                                                borderBottom: `1px solid var(--color-border)`,
                                                gap: 10,
                                            }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                    {/* Coin name — big & prominent */}
                                                    <span style={{
                                                        fontSize: 20, fontWeight: 900, color: 'var(--color-text)',
                                                        letterSpacing: '1.5px', fontFamily: 'monospace',
                                                        textShadow: `0 0 12px ${theme.color}44`,
                                                    }}>
                                                        {d.symbol.replace('USDT', '')}
                                                    </span>
                                                    {/* Long/Short direction pill */}
                                                    <span style={{
                                                        padding: '3px 10px', borderRadius: 20,
                                                        background: isLong ? 'rgba(0,255,136,0.13)' : isShort ? 'rgba(255,59,92,0.13)' : 'rgba(107,114,128,0.15)',
                                                        color: isLong ? '#00FF88' : isShort ? '#FF3B5C' : '#9CA3AF',
                                                        fontSize: 10, fontWeight: 800, letterSpacing: '1px',
                                                        border: `1px solid ${isLong ? 'rgba(0,255,136,0.25)' : isShort ? 'rgba(255,59,92,0.25)' : 'rgba(107,114,128,0.2)'}`,
                                                    }}>
                                                        {isLong ? '▲ LONG' : isShort ? '▼ SHORT' : d.side || '—'}
                                                    </span>
                                                    {/* Leverage badge */}
                                                    {leverageDisplay && (
                                                        <span style={{
                                                            padding: '2px 8px', borderRadius: 6,
                                                            background: 'rgba(167,139,250,0.1)',
                                                            border: '1px solid rgba(167,139,250,0.2)',
                                                            color: '#A78BFA', fontSize: 11, fontWeight: 700,
                                                            fontFamily: 'monospace',
                                                        }}>
                                                            {leverageDisplay} LEV
                                                        </span>
                                                    )}
                                                </div>

                                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                    {/* Timestamp */}
                                                    {timestamp && (
                                                        <span style={{ fontSize: 10, color: '#4B5563', fontFamily: 'monospace' }}>{timeSince(timestamp)}</span>
                                                    )}
                                                    {/* Verdict pill — prominent */}
                                                    <div style={{
                                                        padding: '3px 10px', borderRadius: 12,
                                                        background: `rgba(${parseInt(theme.color.slice(1,3),16)},${parseInt(theme.color.slice(3,5),16)},${parseInt(theme.color.slice(5,7),16)},0.15)`,
                                                        border: `1px solid ${theme.color}55`,
                                                        color: theme.color, fontSize: 10, fontWeight: 800,
                                                        letterSpacing: '1px',
                                                        boxShadow: `0 0 6px ${theme.glow}`,
                                                        whiteSpace: 'nowrap',
                                                    }}>
                                                        {action === 'EXECUTE' ? '✓ APPROVED' : '✗ VETOED'}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* ── Trade levels: Entry | SL | Target ── */}
                                            {(entryPrice || slPrice || targetPrice) && (
                                                <div style={{
                                                    display: 'grid',
                                                    gridTemplateColumns: entryPrice && slPrice && targetPrice ? '1fr 1fr 1fr' : 'repeat(auto-fit, minmax(80px, 1fr))',
                                                    gap: '1px',
                                                    background: 'var(--color-border)',
                                                    borderBottom: '1px solid var(--color-border)',
                                                }}>
                                                    {entryPrice && (
                                                        <div style={{ padding: '10px 16px', background: 'var(--color-surface)', textAlign: 'center' }}>
                                                            <div style={{ fontSize: 9, color: '#6B7280', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 4 }}>Entry</div>
                                                            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--color-text)', fontFamily: 'monospace' }}>{entryPrice}</div>
                                                        </div>
                                                    )}
                                                    {slPrice && (
                                                        <div style={{ padding: '10px 16px', background: 'var(--color-surface)', textAlign: 'center', borderLeft: '1px solid var(--color-border)' }}>
                                                            <div style={{ fontSize: 9, color: '#6B7280', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 4 }}>Stop Loss</div>
                                                            <div style={{ fontSize: 14, fontWeight: 800, color: '#FF3B5C', fontFamily: 'monospace' }}>{slPrice}</div>
                                                        </div>
                                                    )}
                                                    {targetPrice && (
                                                        <div style={{ padding: '10px 16px', background: 'var(--color-surface)', textAlign: 'center', borderLeft: '1px solid var(--color-border)' }}>
                                                            <div style={{ fontSize: 9, color: '#6B7280', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: 4 }}>Target</div>
                                                            <div style={{ fontSize: 14, fontWeight: 800, color: '#00FF88', fontFamily: 'monospace' }}>{targetPrice}</div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {/* ── Toggle expanding reasoning ── */}
                                            {parsed.main && (
                                                <button
                                                    onClick={() => toggleExpand(decisionId)}
                                                    style={{
                                                        width: '100%', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                                        background: 'transparent', borderTop: '1px solid var(--color-border)', cursor: 'pointer',
                                                        color: 'var(--color-text-secondary)', fontSize: 11, fontWeight: 600, letterSpacing: '0.5px'
                                                    }}
                                                    className="hover:bg-[var(--color-surface)] hover:text-[var(--color-primary)] transition-colors"
                                                >
                                                    {isExpanded ? (
                                                        <><ChevronUp size={14} /> Hide Reasoning</>
                                                    ) : (
                                                        <><ChevronDown size={14} /> Show Reasoning</>
                                                    )}
                                                </button>
                                            )}

                                            <AnimatePresence>
                                                {isExpanded && parsed.main && (
                                                    <motion.div
                                                        initial={{ opacity: 0, height: 0 }}
                                                        animate={{ opacity: 1, height: 'auto' }}
                                                        exit={{ opacity: 0, height: 0 }}
                                                        style={{ overflow: 'hidden' }}
                                                    >
                                                        {/* ── Reasoning strip ── */}
                                                        <div style={{ padding: '10px 16px', borderBottom: d.risk_flags?.length ? '1px solid var(--color-border)' : 'none', background: 'var(--color-surface-light)' }}>
                                                            <p style={{
                                                                fontSize: 11, color: 'var(--color-text-secondary)', lineHeight: '1.5', margin: 0,
                                                                paddingLeft: 8, borderLeft: '2px solid rgba(167,139,250,0.5)',
                                                            }}>
                                                                {parsed.main}
                                                            </p>
                                                        </div>

                                                        {/* ── Risk Flags ── */}
                                                        {d.risk_flags && d.risk_flags.length > 0 && (
                                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: '8px 16px', background: 'var(--color-surface-light)' }}>
                                                                {(d.risk_flags as string[]).map((flag: string, idx: number) => (
                                                                    <span key={idx} style={{
                                                                        fontSize: 9, padding: '2px 7px', borderRadius: 4,
                                                                        background: 'rgba(255,179,0,0.1)', color: '#D4860A',
                                                                        border: '1px solid rgba(255,179,0,0.2)',
                                                                        letterSpacing: '0.3px',
                                                                    }}>
                                                                        ⚠ {flag}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>
                                        </motion.div>
                                    );
                                })}
                            </AnimatePresence>
                        </div>

                    )
                )}

            </div>
        </div>
    );
}

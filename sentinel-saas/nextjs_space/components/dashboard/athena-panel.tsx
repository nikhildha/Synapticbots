'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, ShieldAlert, Zap, Lock, Eye, Cpu } from 'lucide-react';

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
}

const ACTION_THEMES: Record<string, { color: string; glow: string; label: string }> = {
    EXECUTE: { color: '#00FF88', glow: 'rgba(0,255,136,0.3)', label: 'APPROVED' },
    REDUCE_SIZE: { color: '#FFB300', glow: 'rgba(255,179,0,0.3)', label: 'MODIFIED' },
    VETO: { color: '#FF3B5C', glow: 'rgba(255,59,92,0.3)', label: 'VETOED' },
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

export function AthenaPanel({ athena }: Props) {
    const enabled = !!athena?.enabled;
    const decisions = (athena?.recent_decisions || []).slice().reverse();
    const hasData = decisions.length > 0;

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
                {/* Cyberpunk accent line */}
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
                        <div style={{ fontSize: 11, color: '#00E5FF', opacity: 0.8, letterSpacing: '2px', textTransform: 'uppercase' }}>
                            Lead Investment Officer
                        </div>
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

            {/* ── Content Area ── */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px 24px', gap: 20 }}>
                {/* Animated Empty State */}
                {!hasData ? (
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
                                        {/* Background Glow */}
                                        <div style={{ position: 'absolute', top: -50, right: -50, width: 100, height: 100, background: theme.color, filter: 'blur(60px)', opacity: 0.15 }} />

                                        {/* Header Row */}
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
                                                {/* Injected Parameters (Lev, Size, Conf, S/R) */}
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

                                        {/* Analysis Text */}
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

                                        {/* Risk Flags */}
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

                                        {/* Parameters moved to Header */}
                                    </motion.div>
                                );
                            })}
                        </AnimatePresence>
                    </div>
                )}
            </div>
        </div>
    );
}

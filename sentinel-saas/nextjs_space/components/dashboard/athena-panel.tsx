'use client';

/**
 * Athena Intelligence Panel — scrollable dashboard widget showing Lead Investment Officer decisions
 * with full analysis: reasoning, S/R levels, leverage/size recs, risk flags, timestamps.
 */

interface AthenaDecision {
    symbol: string;
    time: string;
    side?: string;
    conviction?: number;
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
    cache_size?: number;
    recent_decisions?: AthenaDecision[];
}

interface Props {
    athena: AthenaState;
    coinStates?: Record<string, any>;
}

const ACTION_CONFIG: Record<string, { gradient: string; border: string; text: string; icon: string; label: string; glow: string }> = {
    EXECUTE: {
        gradient: 'linear-gradient(135deg, rgba(16,185,129,0.12) 0%, rgba(16,185,129,0.04) 100%)',
        border: 'rgba(16,185,129,0.25)',
        text: '#10B981',
        icon: '🟢',
        label: 'EXECUTE',
        glow: '0 0 20px rgba(16,185,129,0.15)',
    },
    REDUCE_SIZE: {
        gradient: 'linear-gradient(135deg, rgba(245,158,11,0.12) 0%, rgba(245,158,11,0.04) 100%)',
        border: 'rgba(245,158,11,0.25)',
        text: '#F59E0B',
        icon: '🟡',
        label: 'REDUCE',
        glow: '0 0 20px rgba(245,158,11,0.15)',
    },
    VETO: {
        gradient: 'linear-gradient(135deg, rgba(239,68,68,0.12) 0%, rgba(239,68,68,0.04) 100%)',
        border: 'rgba(239,68,68,0.25)',
        text: '#EF4444',
        icon: '🔴',
        label: 'VETO',
        glow: '0 0 20px rgba(239,68,68,0.15)',
    },
};

function formatTimestamp(iso: string): string {
    try {
        const d = new Date(iso);
        const now = new Date();
        const isToday = d.toDateString() === now.toDateString();
        if (isToday) {
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
        }
        return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
            d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    } catch {
        return '—';
    }
}

function parseReasoning(reasoning: string) {
    // Parse the pipe-separated reasoning format:
    // "Main reasoning | Leverage: 5x | Size: 25% | Support: $x | Resistance: $y"
    const parts = reasoning.split(' | ');
    const mainReasoning = parts[0] || '';
    let leverage = '';
    let size = '';
    let support = '';
    let resistance = '';

    for (const part of parts.slice(1)) {
        if (part.startsWith('Leverage:')) leverage = part.replace('Leverage:', '').trim();
        else if (part.startsWith('Size:')) size = part.replace('Size:', '').trim();
        else if (part.startsWith('Support:')) support = part.replace('Support:', '').trim();
        else if (part.startsWith('Resistance:')) resistance = part.replace('Resistance:', '').trim();
    }

    return { mainReasoning, leverage, size, support, resistance };
}

export function AthenaPanel({ athena, coinStates }: Props) {
    if (!athena?.enabled) return null;

    const decisions = athena.recent_decisions || [];
    const hasData = decisions.length > 0;

    return (
        <div style={{
            background: 'rgba(17, 24, 39, 0.90)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(139,92,246,0.25)',
            borderRadius: '16px',
            overflow: 'hidden',
            boxShadow: '0 4px 30px rgba(0,0,0,0.3), 0 0 40px rgba(139,92,246,0.05)',
        }}>
            {/* Header */}
            <div style={{
                padding: '16px 24px',
                background: 'linear-gradient(135deg, rgba(139,92,246,0.15) 0%, rgba(59,130,246,0.08) 50%, rgba(16,185,129,0.05) 100%)',
                borderBottom: '1px solid rgba(139,92,246,0.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '24px' }}>🏛️</span>
                    <div>
                        <h2 style={{ fontSize: '17px', fontWeight: 800, color: '#A78BFA', margin: 0, letterSpacing: '0.5px' }}>
                            Athena Intelligence
                        </h2>
                        <span style={{ fontSize: '11px', color: '#6B7280' }}>
                            Lead Investment Officer · Google Search Grounded
                        </span>
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {athena.initialized ? (
                        <span style={{
                            fontSize: '11px', padding: '3px 10px', borderRadius: '8px',
                            background: 'rgba(16,185,129,0.15)', color: '#10B981', fontWeight: 700,
                            border: '1px solid rgba(16,185,129,0.2)',
                        }}>
                            ● ONLINE
                        </span>
                    ) : (
                        <span style={{
                            fontSize: '11px', padding: '3px 10px', borderRadius: '8px',
                            background: 'rgba(245,158,11,0.15)', color: '#F59E0B', fontWeight: 700,
                        }}>
                            ○ STANDBY
                        </span>
                    )}
                    <span style={{
                        fontSize: '10px', color: '#4B5563', fontFamily: 'monospace',
                        padding: '2px 8px', borderRadius: '6px',
                        background: 'rgba(255,255,255,0.03)',
                    }}>
                        {athena.model || 'gemini-2.5-flash'}
                    </span>
                    {(athena.cycle_calls ?? 0) > 0 && (
                        <span style={{ fontSize: '10px', color: '#6B7280' }}>
                            {athena.cycle_calls} calls
                        </span>
                    )}
                </div>
            </div>

            {/* Scrollable Decision History */}
            <div style={{
                maxHeight: '480px',
                overflowY: 'auto',
                padding: '16px',
            }}>
                {!hasData ? (
                    <div style={{
                        textAlign: 'center', padding: '40px 20px',
                        color: '#4B5563', fontSize: '13px',
                    }}>
                        <span style={{ fontSize: '40px', display: 'block', marginBottom: '12px', opacity: 0.4 }}>🏛️</span>
                        <span style={{ color: '#6B7280', fontWeight: 600 }}>Awaiting eligible coins…</span>
                        <br />
                        <span style={{ fontSize: '11px', color: '#4B5563', marginTop: '4px', display: 'inline-block' }}>
                            Athena will analyze coins that pass the HMM conviction threshold
                        </span>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {decisions.slice().reverse().map((d, i) => {
                            const config = ACTION_CONFIG[d.action] || ACTION_CONFIG.EXECUTE;
                            const parsed = parseReasoning(d.reasoning || '');
                            const confPct = Math.round(d.adjusted_confidence * 100);

                            return (
                                <div key={`decision-${i}`} style={{
                                    background: config.gradient,
                                    border: `1px solid ${config.border}`,
                                    borderRadius: '14px',
                                    overflow: 'hidden',
                                    boxShadow: config.glow,
                                    transition: 'all 0.2s ease',
                                }}>
                                    {/* Decision Header */}
                                    <div style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                        padding: '12px 16px',
                                        borderBottom: `1px solid ${config.border}`,
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <span style={{ fontSize: '16px' }}>{config.icon}</span>
                                            <span style={{
                                                fontWeight: 800, fontSize: '15px', color: '#F9FAFB',
                                                letterSpacing: '0.3px',
                                            }}>
                                                {d.symbol?.replace('USDT', '')}
                                            </span>
                                            <span style={{
                                                fontSize: '11px', fontWeight: 700, color: config.text,
                                                padding: '2px 8px', borderRadius: '6px',
                                                background: 'rgba(0,0,0,0.2)',
                                                letterSpacing: '0.5px',
                                            }}>
                                                {config.label}
                                            </span>
                                            {d.side && (
                                                <span style={{
                                                    fontSize: '11px', fontWeight: 700,
                                                    color: d.side === 'BUY' || d.side === 'LONG' ? '#10B981' : '#EF4444',
                                                    padding: '2px 8px', borderRadius: '6px',
                                                    background: d.side === 'BUY' || d.side === 'LONG'
                                                        ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                                                }}>
                                                    {d.side === 'BUY' ? '↑ LONG' : d.side === 'SELL' ? '↓ SHORT' : d.side}
                                                </span>
                                            )}
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            {/* Confidence meter */}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <div style={{
                                                    width: '60px', height: '6px', borderRadius: '3px',
                                                    background: 'rgba(255,255,255,0.08)',
                                                    overflow: 'hidden',
                                                }}>
                                                    <div style={{
                                                        width: `${confPct}%`, height: '100%', borderRadius: '3px',
                                                        background: config.text,
                                                        transition: 'width 0.5s ease',
                                                    }} />
                                                </div>
                                                <span style={{
                                                    fontSize: '12px', fontWeight: 700, color: config.text,
                                                    fontFamily: 'monospace',
                                                }}>
                                                    {confPct}%
                                                </span>
                                            </div>
                                            <span style={{
                                                fontSize: '10px', color: '#4B5563',
                                                fontFamily: 'monospace',
                                            }}>
                                                {formatTimestamp(d.time)}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Reasoning Body */}
                                    <div style={{ padding: '12px 16px' }}>
                                        <p style={{
                                            fontSize: '12px', lineHeight: '1.6', color: '#D1D5DB',
                                            margin: '0 0 10px 0',
                                        }}>
                                            {parsed.mainReasoning}
                                        </p>

                                        {/* Metrics Row: Leverage, Size, Latency */}
                                        {(parsed.leverage || parsed.size) && (
                                            <div style={{
                                                display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap',
                                            }}>
                                                {parsed.leverage && (
                                                    <span style={{
                                                        fontSize: '10px', fontWeight: 700, padding: '3px 10px',
                                                        borderRadius: '6px', background: 'rgba(139,92,246,0.15)',
                                                        color: '#A78BFA', border: '1px solid rgba(139,92,246,0.2)',
                                                    }}>
                                                        ⚡ Leverage: {parsed.leverage}
                                                    </span>
                                                )}
                                                {parsed.size && (
                                                    <span style={{
                                                        fontSize: '10px', fontWeight: 700, padding: '3px 10px',
                                                        borderRadius: '6px', background: 'rgba(59,130,246,0.15)',
                                                        color: '#60A5FA', border: '1px solid rgba(59,130,246,0.2)',
                                                    }}>
                                                        📊 Size: {parsed.size}
                                                    </span>
                                                )}
                                                {d.latency_ms > 0 && (
                                                    <span style={{
                                                        fontSize: '10px', fontWeight: 600, padding: '3px 10px',
                                                        borderRadius: '6px', background: 'rgba(255,255,255,0.04)',
                                                        color: '#6B7280',
                                                    }}>
                                                        ⏱️ {(d.latency_ms / 1000).toFixed(1)}s
                                                    </span>
                                                )}
                                            </div>
                                        )}

                                        {/* Support & Resistance */}
                                        {(parsed.support || parsed.resistance) && (
                                            <div style={{
                                                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px',
                                                marginBottom: '8px',
                                            }}>
                                                {parsed.support && (
                                                    <div style={{
                                                        fontSize: '10px', padding: '6px 10px', borderRadius: '8px',
                                                        background: 'rgba(16,185,129,0.06)',
                                                        border: '1px solid rgba(16,185,129,0.12)',
                                                    }}>
                                                        <span style={{ color: '#10B981', fontWeight: 700 }}>▼ Support</span>
                                                        <div style={{ color: '#9CA3AF', marginTop: '2px', lineHeight: '1.4' }}>
                                                            {parsed.support}
                                                        </div>
                                                    </div>
                                                )}
                                                {parsed.resistance && (
                                                    <div style={{
                                                        fontSize: '10px', padding: '6px 10px', borderRadius: '8px',
                                                        background: 'rgba(239,68,68,0.06)',
                                                        border: '1px solid rgba(239,68,68,0.12)',
                                                    }}>
                                                        <span style={{ color: '#EF4444', fontWeight: 700 }}>▲ Resistance</span>
                                                        <div style={{ color: '#9CA3AF', marginTop: '2px', lineHeight: '1.4' }}>
                                                            {parsed.resistance}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Risk Flags */}
                                        {d.risk_flags && d.risk_flags.length > 0 && (
                                            <div style={{
                                                display: 'flex', flexWrap: 'wrap', gap: '4px',
                                            }}>
                                                {d.risk_flags.map((flag: string, fi: number) => (
                                                    <span key={fi} style={{
                                                        fontSize: '9px', fontWeight: 600, padding: '2px 8px',
                                                        borderRadius: '4px',
                                                        background: 'rgba(245,158,11,0.08)',
                                                        color: '#D97706',
                                                        border: '1px solid rgba(245,158,11,0.12)',
                                                    }}>
                                                        ⚠ {flag}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

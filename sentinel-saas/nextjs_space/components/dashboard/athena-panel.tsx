'use client';

/**
 * Athena Intelligence Panel — Lead Investment Officer decisions
 * Rethemed to match app cyberpunk palette (cyan / dark glass / monospace data)
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
    perBot?: Record<string, { activeTrades: number; totalTrades: number; activePnl: number; totalPnl: number; capital: number }>;
}

const ACTION_CONFIG: Record<string, { border: string; badge: string; badgeBg: string; label: string; dot: string }> = {
    EXECUTE: { border: 'rgba(0,255,136,0.18)', badge: '#00FF88', badgeBg: 'rgba(0,255,136,0.10)', label: 'EXECUTE', dot: '#00FF88' },
    REDUCE_SIZE: { border: 'rgba(255,179,0,0.18)', badge: '#FFB300', badgeBg: 'rgba(255,179,0,0.10)', label: 'REDUCE', dot: '#FFB300' },
    VETO: { border: 'rgba(255,59,92,0.18)', badge: '#FF3B5C', badgeBg: 'rgba(255,59,92,0.10)', label: 'VETO', dot: '#FF3B5C' },
};

function timeAgo(iso: string): string {
    try {
        const diff = Date.now() - new Date(iso).getTime();
        const m = Math.floor(diff / 60000);
        const h = Math.floor(m / 60);
        if (h > 0) return `${h}h ago`;
        if (m > 0) return `${m}m ago`;
        return 'just now';
    } catch { return '—'; }
}

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

export function AthenaPanel({ athena, perBot = {} }: Props) {
    const enabled = !!athena?.enabled;
    const decisions = (athena?.recent_decisions || []).slice().reverse();
    const hasData = decisions.length > 0;

    // Calculate Bot Summary from perBot data
    let totalBots = 0;
    let totalActiveTrades = 0;
    let totalActivePnl = 0;
    let totalCapital = 0;

    Object.values(perBot).forEach(botStats => {
        totalBots++;
        totalActiveTrades += botStats.activeTrades;
        totalActivePnl += botStats.activePnl;
        totalCapital += botStats.capital;
    });

    const isRunning = hasData || totalActiveTrades > 0;

    return (
        <div style={{
            height: '100%',
            background: 'rgba(5,10,18,0.90)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(0,229,255,0.12)',
            borderRadius: 16,
            overflow: 'hidden',
            boxShadow: '0 4px 30px rgba(0,0,0,0.4), 0 0 0 1px rgba(0,229,255,0.04)',
        }}>
            {/* ── Header ── */}
            <div style={{
                padding: '14px 20px',
                background: 'linear-gradient(135deg, rgba(0,229,255,0.06) 0%, rgba(0,184,204,0.03) 100%)',
                borderBottom: '1px solid rgba(0,229,255,0.08)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: '#00E5FF', letterSpacing: '1px', textTransform: 'uppercase' }}>
                            Athena AI
                        </div>
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                        fontSize: 10, padding: '3px 10px', borderRadius: 20,
                        background: enabled ? 'rgba(0,255,136,0.10)' : 'rgba(255,59,92,0.10)',
                        color: enabled ? '#00FF88' : '#FF3B5C',
                        fontWeight: 700,
                        border: `1px solid ${enabled ? 'rgba(0,255,136,0.20)' : 'rgba(255,59,92,0.20)'}`,
                        letterSpacing: '0.5px',
                    }}>
                        ○ {enabled ? 'ACTIVE' : 'OFFLINE'}
                    </span>
                    <span style={{
                        fontSize: 10, color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)',
                        padding: '2px 7px', borderRadius: 6, background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.05)',
                    }}>{athena?.model || 'gemini-2.5-flash'}</span>
                    {(athena.cycle_calls ?? 0) > 0 && (
                        <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                            {athena.cycle_calls} calls
                        </span>
                    )}
                </div>
            </div>

            {/* ── Legend: Border color = Athena verdict ── */}
            <div style={{
                padding: '5px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)',
                display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
                background: 'rgba(0,0,0,0.2)',
            }}>
                <span style={{ fontSize: 9.5, color: '#4B5563', letterSpacing: '0.3px' }}>BORDER COLOR = ATHENA VERDICT</span>
                <span style={{ fontSize: 9.5, color: '#00FF88', fontWeight: 700 }}>🟢 EXECUTE — approved &amp; deployed</span>
                <span style={{ fontSize: 9.5, color: '#FF3B5C', fontWeight: 700 }}>🔴 VETO — blocked by Athena</span>
                <span style={{ fontSize: 9.5, color: '#4B5563', marginLeft: 'auto' }}>↑↓ direction badge is independent</span>
            </div>

            {/* ── Decision List ── */}
            <div style={{ maxHeight: 960, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {!hasData ? (
                    <div style={{ textAlign: 'center', padding: '36px 20px', color: 'var(--color-text-muted)' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)' }}>Awaiting eligible coins…</div>
                        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                            Athena analyzes coins passing HMM conviction threshold
                        </div>
                    </div>
                ) : decisions.map((d, i) => {
                    const cfg = ACTION_CONFIG[d.action] || ACTION_CONFIG.EXECUTE;
                    const parsed = parseReasoning(d.reasoning || '');
                    const confPct = Math.round(d.adjusted_confidence * 100);
                    const isLong = d.side === 'BUY' || d.side === 'LONG';
                    const isShort = d.side === 'SELL' || d.side === 'SHORT';

                    return (
                        <div key={`d-${i}`} style={{
                            background: 'rgba(255,255,255,0.015)',
                            border: `1px solid ${cfg.border}`,
                            borderRadius: 12, overflow: 'hidden',
                        }}>
                            {/* Decision header row */}
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                padding: '10px 14px',
                                borderBottom: `1px solid ${cfg.border}`,
                                background: `${cfg.badgeBg.replace('0.10', '0.05')}`,
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    {/* Status dot */}
                                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: cfg.dot, boxShadow: `0 0 6px ${cfg.dot}` }} />
                                    <span style={{ fontWeight: 800, fontSize: 15, color: '#E8EDF5', letterSpacing: 0 }}>
                                        {d.symbol?.replace('USDT', '')}
                                    </span>
                                    {/* Action badge */}
                                    <span style={{
                                        fontSize: 10, fontWeight: 800, color: cfg.badge, letterSpacing: '0.8px',
                                        padding: '2px 8px', borderRadius: 4, background: cfg.badgeBg,
                                        border: `1px solid ${cfg.badge}30`,
                                    }}>{cfg.label}</span>
                                    {/* Direction */}
                                    {d.side && (
                                        <span style={{
                                            fontSize: 10, fontWeight: 700,
                                            color: isLong ? '#00FF88' : isShort ? '#FF3B5C' : '#6B7280',
                                            padding: '2px 7px', borderRadius: 4,
                                            background: isLong ? 'rgba(0,255,136,0.10)' : isShort ? 'rgba(255,59,92,0.10)' : 'transparent',
                                        }}>
                                            {isLong ? '↑ LONG' : isShort ? '↓ SHORT' : d.side}
                                        </span>
                                    )}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    {/* Confidence bar */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                        <div style={{ width: 48, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                                            <div style={{ width: `${confPct}%`, height: '100%', borderRadius: 2, background: cfg.badge, transition: 'width 0.5s' }} />
                                        </div>
                                        <span style={{ fontSize: 11, fontWeight: 700, color: cfg.badge, fontFamily: 'var(--font-mono)' }}>{confPct}%</span>
                                    </div>
                                    <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>{timeAgo(d.time)}</span>
                                </div>
                            </div>

                            {/* Body */}
                            <div style={{ padding: '10px 14px' }}>
                                {/* Reasoning */}
                                <p style={{ fontSize: 12, lineHeight: 1.55, color: '#9CA3AF', margin: '0 0 8px' }}>
                                    {parsed.main}
                                </p>

                                {/* Metric chips */}
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: parsed.support || parsed.resistance ? 8 : 0 }}>
                                    {parsed.leverage && (
                                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: 'rgba(0,229,255,0.08)', color: '#00E5FF', border: '1px solid rgba(0,229,255,0.15)' }}>
                                            ⚡ {parsed.leverage}
                                        </span>
                                    )}
                                    {parsed.size && (
                                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: 'rgba(255,179,0,0.08)', color: '#FFB300', border: '1px solid rgba(255,179,0,0.15)' }}>
                                            📊 {parsed.size}
                                        </span>
                                    )}
                                    {d.latency_ms > 0 && (
                                        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.04)', color: 'var(--color-text-muted)' }}>
                                            {(d.latency_ms / 1000).toFixed(1)}s
                                        </span>
                                    )}
                                </div>

                                {/* S/R levels */}
                                {(parsed.support || parsed.resistance) && (
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
                                        {parsed.support && (
                                            <div style={{ fontSize: 10, padding: '5px 8px', borderRadius: 6, background: 'rgba(0,255,136,0.04)', border: '1px solid rgba(0,255,136,0.10)' }}>
                                                <span style={{ color: '#00FF88', fontWeight: 700 }}>▼ Support</span>
                                                <div style={{ color: '#6B7280', marginTop: 2 }}>{parsed.support}</div>
                                            </div>
                                        )}
                                        {parsed.resistance && (
                                            <div style={{ fontSize: 10, padding: '5px 8px', borderRadius: 6, background: 'rgba(255,59,92,0.04)', border: '1px solid rgba(255,59,92,0.10)' }}>
                                                <span style={{ color: '#FF3B5C', fontWeight: 700 }}>▲ Resistance</span>
                                                <div style={{ color: '#6B7280', marginTop: 2 }}>{parsed.resistance}</div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Risk flags */}
                                {d.risk_flags?.length > 0 && (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                        {d.risk_flags.map((flag, fi) => (
                                            <span key={fi} style={{
                                                fontSize: 10, padding: '2px 8px', borderRadius: 4,
                                                background: 'rgba(255,179,0,0.06)', color: '#D97706',
                                                border: '1px solid rgba(255,179,0,0.12)',
                                            }}>⚠ {flag}</span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

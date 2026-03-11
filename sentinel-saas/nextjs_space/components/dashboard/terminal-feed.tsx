'use client';
import { useEffect, useRef, useState } from 'react';

interface LogEntry {
    id: string;
    timestamp: string;
    type: 'engine' | 'trade' | 'regime' | 'warn' | 'error' | 'athena';
    text: string;
}

const TYPE_COLORS: Record<string, string> = {
    engine: '#00E5FF',
    trade: '#00FF88',
    regime: '#00B8CC',
    warn: '#FFB300',
    error: '#FF3B5C',
    athena: '#A78BFA',
};

const TYPE_PREFIX: Record<string, string> = {
    engine: 'SYS',
    trade: 'TRD',
    regime: 'HMM',
    warn: 'WRN',
    error: 'ERR',
    athena: 'ATH',
};

interface TerminalFeedProps {
    coinStates?: Record<string, any>;
    cycle?: number;
    activeTrades?: any[];
    athenaEnabled?: boolean;
    maxLines?: number;
}

function tsNow() {
    return new Date().toLocaleTimeString('en-IN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function makeId() {
    return Math.random().toString(36).slice(2, 9);
}

export function TerminalFeed({ coinStates, cycle, activeTrades = [], athenaEnabled, maxLines = 40 }: TerminalFeedProps) {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const scrollRef = useRef<HTMLDivElement>(null);
    const prevCycle = useRef<number | undefined>(undefined);
    const prevTrades = useRef<string>('');

    // Initial boot messages
    useEffect(() => {
        const boot: LogEntry[] = [
            { id: makeId(), timestamp: tsNow(), type: 'engine', text: 'Synaptic Engine initializing…' },
            { id: makeId(), timestamp: tsNow(), type: 'engine', text: 'HMM multi-timeframe model loaded' },
        ];
        if (athenaEnabled) boot.push({ id: makeId(), timestamp: tsNow(), type: 'athena', text: 'Athena AI layer enabled — Gemini context active' });
        setLogs(boot);
    }, []);

    // Watch cycle changes → log engine heartbeat
    useEffect(() => {
        if (cycle === undefined) return;
        if (prevCycle.current === cycle) return;
        prevCycle.current = cycle;
        if (cycle === 0) return;

        const coinStateEntries = Object.entries(coinStates || {}).slice(0, 4);
        const newLogs: LogEntry[] = [
            { id: makeId(), timestamp: tsNow(), type: 'engine', text: `Cycle #${cycle} complete — ${Object.keys(coinStates || {}).length} coins scanned` },
        ];

        for (const [sym, state] of coinStateEntries) {
            const ticker = sym.replace('USDT', '');
            const regime = state?.regime || 'NEUTRAL';
            const conf = ((state?.confidence || 0) * 100).toFixed(0);
            const regimeType: LogEntry['type'] = regime === 'BULLISH' ? 'trade' : regime === 'BEARISH' ? 'warn' : 'regime';
            newLogs.push({ id: makeId(), timestamp: tsNow(), type: regimeType, text: `${ticker}: ${regime} | conf ${conf}%` });
        }

        setLogs(prev => {
            const combined = [...prev, ...newLogs];
            return combined.slice(-maxLines);
        });
    }, [cycle]);

    // Watch trade changes
    useEffect(() => {
        const key = JSON.stringify(activeTrades.map((t: any) => t.id || t.coin));
        if (prevTrades.current === key) return;
        prevTrades.current = key;
        if (activeTrades.length === 0) return;

        const newLogs: LogEntry[] = activeTrades.slice(0, 3).map((t: any) => ({
            id: makeId(),
            timestamp: tsNow(),
            type: 'trade' as const,
            text: `ACTIVE: ${(t.symbol || t.coin || '').replace('USDT', '')} ${t.side || ''} @$${parseFloat(t.entry_price || 0).toFixed(2)} · PnL: ${t.unrealized_pnl ? `${parseFloat(t.unrealized_pnl) >= 0 ? '+' : ''}${parseFloat(t.unrealized_pnl).toFixed(2)}` : '—'}`,
        }));

        setLogs(prev => [...prev, ...newLogs].slice(-maxLines));
    }, [activeTrades.length]);

    // Auto-scroll to bottom
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [logs]);

    return (
        <div style={{
            display: 'flex', flexDirection: 'column',
            height: '100%',
            background: 'rgba(5,10,18,0.85)',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            border: '1px solid rgba(0,229,255,0.12)',
            borderRadius: 14,
            overflow: 'hidden',
        }}>
            {/* Header */}
            <div style={{
                padding: '13px 18px',
                background: 'linear-gradient(135deg, rgba(0,229,255,0.08) 0%, rgba(255,179,0,0.04) 100%)',
                borderBottom: '1px solid rgba(0,229,255,0.1)',
                display: 'flex', alignItems: 'center', gap: 10,
            }}>
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '2px', textTransform: 'uppercase', color: '#00E5FF', fontFamily: 'var(--font-ui)' }}>
                    Engine Terminal
                </span>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {/* Blinking cursor */}
                    <span style={{ fontSize: 12, color: '#00E5FF', fontFamily: 'var(--font-mono)', animation: 'livePulse 1.2s ease-in-out infinite' }}>▋</span>
                    <span style={{ fontSize: 10, color: 'rgba(0,229,255,0.4)', fontFamily: 'var(--font-mono)' }}>{logs.length} lines</span>
                </div>
            </div>

            {/* Log area */}
            <div
                ref={scrollRef}
                style={{
                    flex: 1, minHeight: 0, maxHeight: 320,
                    overflowY: 'auto', padding: '10px 14px',
                    display: 'flex', flexDirection: 'column', gap: 3,
                }}
            >
                {logs.length === 0 ? (
                    <div style={{ padding: '24px 0', textAlign: 'center', color: 'rgba(0,229,255,0.2)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                        Waiting for engine signal…
                    </div>
                ) : (
                    logs.map((log, i) => {
                        const isNewest = i === logs.length - 1;
                        const col = TYPE_COLORS[log.type] || '#00E5FF';
                        return (
                            <div
                                key={log.id}
                                className="terminal-line"
                                style={{
                                    display: 'flex', alignItems: 'baseline', gap: 8,
                                    fontFamily: 'var(--font-mono)',
                                    animation: isNewest ? 'terminalSlideIn 0.28s ease both' : undefined,
                                    animationDelay: '0ms',
                                }}
                            >
                                {/* Timestamp */}
                                <span style={{ fontSize: 10, color: 'rgba(255,179,0,0.55)', flexShrink: 0, letterSpacing: '0.3px' }}>
                                    [{log.timestamp}]
                                </span>
                                {/* Type badge */}
                                <span style={{
                                    fontSize: 9, fontWeight: 800, letterSpacing: '0.8px',
                                    color: col, background: `${col}15`,
                                    padding: '0 5px', borderRadius: 3, flexShrink: 0,
                                    border: `1px solid ${col}25`,
                                }}>
                                    {TYPE_PREFIX[log.type]}
                                </span>
                                {/* Message */}
                                <span style={{
                                    fontSize: 11, color: TYPE_COLORS[log.type] === TYPE_COLORS.trade
                                        ? 'rgba(0,255,136,0.85)'
                                        : log.type === 'warn' ? 'rgba(255,179,0,0.85)'
                                            : log.type === 'error' ? 'rgba(255,59,92,0.85)'
                                                : log.type === 'athena' ? 'rgba(167,139,250,0.85)'
                                                    : 'rgba(180,210,230,0.75)',
                                    lineHeight: 1.4,
                                }}>
                                    {log.text}
                                    {/* Typewriter cursor on newest line */}
                                    {isNewest && (
                                        <span style={{ color: '#00E5FF', animation: 'livePulse 1s ease-in-out infinite', marginLeft: 2 }}>▋</span>
                                    )}
                                </span>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}

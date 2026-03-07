'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * EngineConsole — Admin-only live engine log viewer.
 * Renders a terminal-style black window with auto-scrolling green text
 * that shows real-time engine processing: coin scanning, HMM analysis,
 * trade decisions, heartbeat syncs, etc.
 */
export function EngineConsole() {
    const [lines, setLines] = useState<string[]>([]);
    const [isLive, setIsLive] = useState(true);
    const [error, setError] = useState('');
    const bottomRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const fetchLogs = useCallback(async () => {
        try {
            const res = await fetch('/api/engine-logs?n=300', { cache: 'no-store' });
            if (!res.ok) {
                setError(res.status === 403 ? 'Admin access required' : 'Engine unreachable');
                return;
            }
            const data = await res.json();
            if (data.lines) {
                setLines(data.lines);
                setError('');
            }
        } catch {
            setError('Connection lost');
        }
    }, []);

    useEffect(() => {
        fetchLogs();
        if (!isLive) return;
        const timer = setInterval(fetchLogs, 3000);
        return () => clearInterval(timer);
    }, [fetchLogs, isLive]);

    // Auto-scroll to bottom on new lines
    useEffect(() => {
        if (isLive && bottomRef.current) {
            bottomRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [lines, isLive]);

    const colorize = (line: string) => {
        // Color different log types
        if (line.includes('ERROR') || line.includes('❌')) return '#EF4444';
        if (line.includes('WARNING') || line.includes('⚠')) return '#F59E0B';
        if (line.includes('ELIGIBLE') || line.includes('✓') || line.includes('DEPLOYED')) return '#22C55E';
        if (line.includes('📘') || line.includes('📕') || line.includes('EXCHANGE_CLOSED')) return '#06B6D4';
        if (line.includes('🔄') || line.includes('heartbeat') || line.includes('Heartbeat')) return '#6366F1';
        if (line.includes('Cycle') || line.includes('cycle') || line.includes('TICK')) return '#A78BFA';
        if (line.includes('SKIP') || line.includes('VETO') || line.includes('filtered')) return '#6B7280';
        return '#4ADE80'; // default green
    };

    return (
        <div style={{
            background: '#0C0C0C',
            border: '1px solid #1F2937',
            borderRadius: '12px',
            overflow: 'hidden',
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
        }}>
            {/* Title bar */}
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 16px',
                background: '#111827',
                borderBottom: '1px solid #1F2937',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ display: 'flex', gap: '6px' }}>
                        <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#EF4444', display: 'inline-block' }} />
                        <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#F59E0B', display: 'inline-block' }} />
                        <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#22C55E', display: 'inline-block' }} />
                    </div>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#9CA3AF', letterSpacing: '1px', marginLeft: '8px' }}>
                        ENGINE CONSOLE
                    </span>
                    <span style={{
                        fontSize: '9px', fontWeight: 600, padding: '2px 8px', borderRadius: '10px',
                        background: isLive ? 'rgba(34,197,94,0.2)' : 'rgba(107,114,128,0.2)',
                        color: isLive ? '#22C55E' : '#6B7280',
                    }}>
                        {isLive ? '● LIVE' : '○ PAUSED'}
                    </span>
                    {error && (
                        <span style={{ fontSize: '10px', color: '#EF4444', marginLeft: '8px' }}>
                            ⚠ {error}
                        </span>
                    )}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        onClick={() => setIsLive(!isLive)}
                        style={{
                            fontSize: '10px', padding: '4px 12px', borderRadius: '6px',
                            background: isLive ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)',
                            color: isLive ? '#EF4444' : '#22C55E',
                            border: 'none', cursor: 'pointer', fontWeight: 600,
                        }}
                    >
                        {isLive ? 'Pause' : 'Resume'}
                    </button>
                    <button
                        onClick={() => { setLines([]); fetchLogs(); }}
                        style={{
                            fontSize: '10px', padding: '4px 12px', borderRadius: '6px',
                            background: 'rgba(99,102,241,0.15)', color: '#818CF8',
                            border: 'none', cursor: 'pointer', fontWeight: 600,
                        }}
                    >
                        Refresh
                    </button>
                </div>
            </div>

            {/* Log output */}
            <div
                ref={containerRef}
                style={{
                    height: '400px',
                    overflowY: 'auto',
                    padding: '12px 16px',
                    fontSize: '11px',
                    lineHeight: '1.6',
                }}
            >
                {lines.length === 0 ? (
                    <div style={{ color: '#4B5563', textAlign: 'center', paddingTop: '60px' }}>
                        <div style={{ fontSize: '20px', marginBottom: '8px' }}>⏳</div>
                        Waiting for engine output...
                    </div>
                ) : (
                    lines.map((line, i) => (
                        <div key={i} style={{ color: colorize(line), whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                            {line}
                        </div>
                    ))
                )}
                <div ref={bottomRef} />
            </div>
        </div>
    );
}

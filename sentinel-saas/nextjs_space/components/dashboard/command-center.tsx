'use client';

import React, { useState, useEffect, useRef } from 'react';

const REGIME_MAP: Record<string, { emoji: string; color: string; bgGlow: string }> = {
    'BULLISH': { emoji: '🟢', color: '#00FF88', bgGlow: 'rgba(0,255,136,0.12)' },
    'BEARISH': { emoji: '🔴', color: '#FF3B5C', bgGlow: 'rgba(255,59,92,0.12)' },
    'SIDEWAYS/CHOP': { emoji: '🟡', color: '#FFB300', bgGlow: 'rgba(255,179,0,0.12)' },
    'CRASH/PANIC': { emoji: '💀', color: '#FF3B5C', bgGlow: 'rgba(255,59,92,0.18)' },
    'WAITING': { emoji: '🔍', color: '#A78BFA', bgGlow: 'rgba(167,139,250,0.10)' },
    'SCANNING': { emoji: '🔍', color: '#00E5FF', bgGlow: 'rgba(0,229,255,0.10)' },
    'OFFLINE': { emoji: '⚫', color: '#4B5563', bgGlow: 'rgba(75,85,99,0.08)' },
};




function getRegimeInfo(regime: string) {
    const key = regime.toUpperCase();
    return REGIME_MAP[key] || (key.includes('WAIT') || key.includes('SCAN') ? REGIME_MAP['SCANNING'] : REGIME_MAP['SCANNING']);
}

interface RegimeCardProps {
    regime: string;
    confidence: number;
    symbol: string;
    macroRegime?: string;
    trend15m?: string;
    coinStates?: Record<string, any>;
    macro?: {
        btc_action: string;
        btc_regime_name: string;
        confidence: number;
    };
}

export function RegimeCard({ regime, confidence, symbol, macroRegime, trend15m, coinStates, macro }: RegimeCardProps) {
    let conf = confidence;
    if (conf <= 1) conf *= 100;
    const pct = Math.round(conf);

    // Parse multi-TF regime string like "1d=BEARISH(0.92) | 1h=BULLISH(1.00) | 15m=BEARISH(0.84)"
    const tfEntries: { tf: string; regime: string; conf: number }[] = [];
    const rawRegime = regime || '';
    const tfPattern = /(\d+[mhd])=(\w[\w/]*)\(([\d.]+)\)/gi;
    let match;
    while ((match = tfPattern.exec(rawRegime)) !== null) {
        tfEntries.push({ tf: match[1].toUpperCase(), regime: match[2].toUpperCase(), conf: parseFloat(match[3]) });
    }

    // Determine dominant regime (from 1h or first entry, or fall back to raw string)
    const dominant = tfEntries.find(e => e.tf === '1H') || tfEntries[0];
    const dominantRegime = dominant ? dominant.regime : rawRegime.split('=')[0]?.includes('BULL') ? 'BULLISH' : rawRegime.includes('BEAR') ? 'BEARISH' : rawRegime.includes('CHOP') || rawRegime.includes('SIDE') ? 'SIDEWAYS/CHOP' : rawRegime.includes('CRASH') ? 'CRASH/PANIC' : rawRegime;
    const info = getRegimeInfo(dominantRegime);

    const getTfColor = (r: string) => {
        if (r.includes('BULL')) return '#22C55E';
        if (r.includes('BEAR')) return '#EF4444';
        if (r.includes('CHOP') || r.includes('SIDE')) return '#F59E0B';
        if (r.includes('CRASH')) return '#DC2626';
        return '#6B7280';
    };

    let gaugeColor = '#FF3B5C';
    if (pct >= 85) gaugeColor = '#00FF88';
    else if (pct >= 65) gaugeColor = '#00E5FF';
    else if (pct >= 50) gaugeColor = '#FFB300';

    // SVG ring constants
    const ringRadius = 46;
    const ringCircumference = 2 * Math.PI * ringRadius;
    const ringOffset = ringCircumference - (pct / 100) * ringCircumference;

    // Live BTC price + 1s background sparkline (persists last 25 pts via sessionStorage)
    const [btcPrice, setBtcPrice] = useState<number | null>(null);
    const [btcChange, setBtcChange] = useState<number>(0);
    // Always start empty (SSR-safe). Hydrate from sessionStorage after mount in useEffect below.
    const [btcPriceHistory, setBtcPriceHistory] = useState<number[]>([]);

    // Seed sparkline history from sessionStorage on mount (safe — client-only useEffect)
    useEffect(() => {
        try {
            const saved = sessionStorage.getItem('btcSparkHistory');
            if (saved) {
                const arr = JSON.parse(saved) as number[];
                if (Array.isArray(arr) && arr.length > 0) setBtcPriceHistory(arr.slice(-25));
            }
        } catch { /* ignore */ }
    }, []);

    useEffect(() => {
        const fetchBtc = async () => {
            try {
                const res = await fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT',
                    { signal: AbortSignal.timeout(900) });
                if (res.ok) {
                    const d = await res.json();
                    const price = parseFloat(d.lastPrice);
                    setBtcPrice(price);
                    setBtcChange(parseFloat(d.priceChangePercent));
                    setBtcPriceHistory(prev => {
                        const next = [...prev, price];
                        const capped = next.length > 300 ? next.slice(-300) : next;
                        // Persist rolling window to sessionStorage
                        try { sessionStorage.setItem('btcSparkHistory', JSON.stringify(capped.slice(-25))); } catch { /* ignore */ }
                        return capped;
                    });
                }
            } catch { /* silent */ }
        };
        fetchBtc();
        const timer = setInterval(fetchBtc, 1000); // 1-second sparkline
        return () => clearInterval(timer);
    }, []);

    // Group coins by regime
    const regimeCoins: Record<string, string[]> = { bullish: [], bearish: [], sideways: [], crash: [] };
    if (coinStates) {
        Object.values(coinStates).forEach((c: any) => {
            const r = (c.regime || '').toUpperCase();
            const name = (c.symbol || '').replace('USDT', '');
            if (!name) return;
            if (r.includes('BULL')) regimeCoins.bullish.push(name);
            else if (r.includes('CRASH') || r.includes('PANIC')) regimeCoins.crash.push(name);
            else if (r.includes('BEAR')) regimeCoins.bearish.push(name);
            else if (r.includes('CHOP') || r.includes('SIDE')) regimeCoins.sideways.push(name);
        });
    }

    const categories = [
        { label: 'Bullish', coins: regimeCoins.bullish, color: '#22C55E', emoji: '🟢' },
        { label: 'Bearish', coins: regimeCoins.bearish, color: '#EF4444', emoji: '🔴' },
        { label: 'Sideways', coins: regimeCoins.sideways, color: '#F59E0B', emoji: '🟡' },
        { label: 'Crash', coins: regimeCoins.crash, color: '#DC2626', emoji: '💀' },
    ].filter(c => c.coins.length > 0);

    // Gauge dimensions — +50% from reduced
    const GAUGE_SIZE = 198;
    const GAUGE_CX = GAUGE_SIZE / 2;
    const GAUGE_CY = GAUGE_SIZE / 2;
    const OUTER_R = 87;
    const INNER_R = 66;
    const ARC_R = 77;
    const arcCirc = 2 * Math.PI * ARC_R;
    // Arc spans 240° (starting from 150° → 390°) for the C-shape gauge
    const ARC_SPAN_DEG = 240;
    const ARC_SPAN = (ARC_SPAN_DEG / 360) * arcCirc;
    const arcOffset = arcCirc - (pct / 100) * ARC_SPAN;
    const startDeg = 150; // gauge starts bottom-left, sweeps clockwise

    // Mini ECG sparkline points for inside the gauge
    const ecgPoints = Array.from({ length: 32 }, (_, i) => {
        const x = (i / 31) * 90 + 5;
        const base = 50 + Math.sin(i * 0.7 + (btcPrice || 0) * 0.0001) * 14;
        const spike = (i === 14) ? base - 22 : (i === 15) ? base + 18 : (i === 16) ? base - 10 : base;
        return `${x},${spike}`;
    }).join(' ');

    const displayRegime = (() => {
        if (dominantRegime === 'WAITING' || dominantRegime === 'SCANNING') return 'HIGH VOLATILITY';
        if (dominantRegime === 'BULLISH') return 'BULLISH TREND';
        if (dominantRegime === 'BEARISH') return 'BEARISH TREND';
        if (dominantRegime === 'SIDEWAYS/CHOP') return 'SIDEWAYS / CHOP';
        if (dominantRegime === 'CRASH/PANIC') return 'CRASH / PANIC';
        return dominantRegime;
    })();

    const btcDom = 30; // BTC dominance placeholder

    return (
        <div style={{
            background: 'var(--color-surface)',
            backdropFilter: 'blur(20px)',
            border: `1px solid ${info.color}18`,
            borderRadius: '22px',
            padding: '16px 20px 20px',
            position: 'relative',
            overflow: 'hidden',
            boxShadow: `0 0 40px rgba(0,0,0,0.8), inset 0 1px 0 var(--color-border)`,
        }}>
            {/* Top accent line */}
            <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, height: '1px',
                background: `linear-gradient(90deg, transparent, ${info.color}60, transparent)`,
            }} />

            {/* ── BTC background sparkline watermark — brighter + vertically centered ── */}
            {btcPriceHistory.length >= 2 && (() => {
                const pts = btcPriceHistory;
                const minP = Math.min(...pts);
                const maxP = Math.max(...pts);
                const range = maxP - minP || 1;
                const W = 400, H = 100;
                // Center the line vertically: map to middle 60% of height
                const PAD_TOP = H * 0.35, PAD_BOT = H * 0.15;
                const sparkPts = pts.map((p, i) => {
                    const x = (i / (pts.length - 1)) * W;
                    const y = PAD_TOP + (1 - (p - minP) / range) * (H - PAD_TOP - PAD_BOT);
                    return `${x.toFixed(1)},${y.toFixed(1)}`;
                }).join(' ');
                const last = pts[pts.length - 1];
                const first = pts[0];
                const rising = last >= first;
                const lc = rising ? '#00FF88' : '#FF3B5C';
                return (
                    <svg
                        width="100%" viewBox={`0 0 ${W} ${H}`}
                        preserveAspectRatio="none"
                        style={{
                            position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
                            height: '100%', opacity: 0.32, pointerEvents: 'none', display: 'block',
                            filter: `drop-shadow(0 0 4px ${lc}88)`,
                        }}
                    >
                        <defs>
                            <linearGradient id="bgSparkGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={lc} stopOpacity="0.4" />
                                <stop offset="100%" stopColor={lc} stopOpacity="0" />
                            </linearGradient>
                        </defs>
                        {/* Fill area below line */}
                        <polyline points={`0,${H} ${sparkPts} ${W},${H}`} fill="url(#bgSparkGrad)" stroke="none" />
                        {/* Bright glowing line */}
                        <polyline points={sparkPts} fill="none" stroke={lc} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                        {/* Live dot at latest data point */}
                        {(() => {
                            const lastX = W;
                            const lastY = PAD_TOP + (1 - (last - minP) / range) * (H - PAD_TOP - PAD_BOT);
                            return (
                                <>
                                    {/* Outer glow ring */}
                                    <circle cx={lastX} cy={lastY} r="5" fill="none" stroke={lc} strokeWidth="1" opacity="0.4" />
                                    {/* Solid dot */}
                                    <circle cx={lastX} cy={lastY} r="3" fill={lc} />
                                </>
                            );
                        })()}
                    </svg>
                );
            })()}

            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '14px' }}>
                <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '6px' }}>
                    <div style={{
                        fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' as const,
                        letterSpacing: '2.5px', color: 'var(--color-text-secondary)',
                    }}>Market Regime</div>
                    {macro && (
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: '6px',
                            background: macro.btc_action === 'LONG_ALTCOINS' ? 'rgba(34,197,94,0.1)' : 
                                        macro.btc_action.includes('VETO') || macro.btc_action === 'NEUTRAL' ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)',
                            border: `1px solid ${macro.btc_action === 'LONG_ALTCOINS' ? 'rgba(34,197,94,0.2)' : 
                                        macro.btc_action.includes('VETO') || macro.btc_action === 'NEUTRAL' ? 'rgba(245,158,11,0.2)' : 'rgba(239,68,68,0.2)'}`,
                            padding: '4px 8px', borderRadius: '6px', width: 'fit-content'
                        }}>
                            <div style={{
                                width: '8px', height: '8px', borderRadius: '50%',
                                background: macro.btc_action === 'LONG_ALTCOINS' ? '#22C55E' : 
                                            macro.btc_action.includes('VETO') || macro.btc_action === 'NEUTRAL' ? '#F59E0B' : '#EF4444',
                                boxShadow: `0 0 6px ${macro.btc_action === 'LONG_ALTCOINS' ? '#22C55E' : 
                                            macro.btc_action.includes('VETO') || macro.btc_action === 'NEUTRAL' ? '#F59E0B' : '#EF4444'}`
                            }} />
                            <span style={{ fontSize: '10px', fontWeight: 800, color: '#E8EDF5', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                {macro.btc_action !== 'WAITING' && (
                                    <>
                                        <span>MACRO: {macro.btc_action.replace('_', ' ')}</span>
                                        <span style={{ color: '#6B7280' }}>|</span>
                                    </>
                                )}
                                <span style={{ color: '#9CA3AF', fontWeight: 700 }}>
                                    {displayRegime} ({Math.round(macro.confidence > 1 ? macro.confidence : macro.confidence * 100)}%)
                                </span>
                            </span>
                        </div>
                    )}
                </div>

                {/* ── Top Right Text: Regime, Price, Delta ── */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                    <div style={{
                        fontSize: '10px', fontWeight: 800, letterSpacing: '1px',
                        color: info.color, textTransform: 'uppercase' as const,
                        textShadow: `0 0 8px ${info.color}88`,
                        textAlign: 'center',
                    }}>
                        BTC REGIME: {displayRegime}
                    </div>
                    {btcPrice && (
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                            <div style={{
                                fontSize: '13px', fontWeight: 900,
                                fontFamily: 'var(--font-mono, monospace)',
                                color: 'var(--color-text)', letterSpacing: '-0.5px',
                                textShadow: '0 0 10px rgba(0,229,255,0.15)',
                            }}>
                                ${btcPrice.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                            </div>
                            <div style={{
                                fontSize: '10px', fontWeight: 700,
                                fontFamily: 'var(--font-mono, monospace)',
                                color: btcChange >= 0 ? '#00FF88' : '#FF3B5C',
                                textShadow: btcChange >= 0 ? '0 0 8px rgba(0,255,136,0.5)' : '0 0 8px rgba(255,59,92,0.5)',
                            }}>
                                {btcChange >= 0 ? '▲' : '▼'}{Math.abs(btcChange).toFixed(2)}%
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* ── Gauge (Centered alone) ── */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '6px' }}>

                {/* Gauge */}
                <div style={{ position: 'relative', width: GAUGE_SIZE, height: GAUGE_SIZE }}>
                    <svg width={GAUGE_SIZE} height={GAUGE_SIZE} viewBox={`0 0 ${GAUGE_SIZE} ${GAUGE_SIZE}`}>
                        <defs>
                            <radialGradient id="bezelGrad" cx="50%" cy="45%">
                                <stop offset="0%" stopColor="#0A1428" stopOpacity="1" />
                                <stop offset="60%" stopColor="#050A14" stopOpacity="1" />
                                <stop offset="100%" stopColor="#020608" stopOpacity="1" />
                            </radialGradient>
                            <radialGradient id="rimGrad" cx="30%" cy="25%">
                                <stop offset="0%" stopColor="rgba(0,229,255,0.25)" />
                                <stop offset="100%" stopColor="rgba(0,80,120,0.04)" />
                            </radialGradient>
                            <filter id="arcGlow" x="-30%" y="-30%" width="160%" height="160%">
                                <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
                                <feMerge>
                                    <feMergeNode in="blur" />
                                    <feMergeNode in="blur" />
                                    <feMergeNode in="SourceGraphic" />
                                </feMerge>
                            </filter>
                        </defs>
                        <circle cx={GAUGE_CX} cy={GAUGE_CY} r={OUTER_R + 6} fill="none" stroke={info.color} strokeWidth="16" strokeOpacity="0.04" />
                        <circle cx={GAUGE_CX} cy={GAUGE_CY} r={OUTER_R + 2} fill="url(#rimGrad)" stroke="rgba(0,229,255,0.08)" strokeWidth="1" />
                        <circle cx={GAUGE_CX} cy={GAUGE_CY} r={OUTER_R} fill="url(#bezelGrad)" stroke="rgba(0,229,255,0.06)" strokeWidth="0.5" />
                        <circle cx={GAUGE_CX} cy={GAUGE_CY} r={INNER_R + 2} fill="none" stroke="rgba(0,0,0,0.8)" strokeWidth="8" />
                        <circle cx={GAUGE_CX} cy={GAUGE_CY} r={INNER_R} fill="rgba(2,6,14,0.95)" />
                        <circle cx={GAUGE_CX} cy={GAUGE_CY} r={ARC_R}
                            fill="none" stroke="rgba(0,229,255,0.08)" strokeWidth="15" strokeLinecap="round"
                            strokeDasharray={`${ARC_SPAN} ${arcCirc - ARC_SPAN}`}
                            strokeDashoffset={0}
                            style={{ transform: `rotate(${startDeg}deg)`, transformOrigin: `${GAUGE_CX}px ${GAUGE_CY}px` }}
                        />
                        <circle cx={GAUGE_CX} cy={GAUGE_CY} r={ARC_R}
                            fill="none" stroke={gaugeColor} strokeWidth="15" strokeLinecap="round"
                            strokeDasharray={`${(pct / 100) * ARC_SPAN} ${arcCirc - (pct / 100) * ARC_SPAN}`}
                            strokeDashoffset={0}
                            filter="url(#arcGlow)"
                            style={{
                                transform: `rotate(${startDeg}deg)`,
                                transformOrigin: `${GAUGE_CX}px ${GAUGE_CY}px`,
                                transition: 'stroke-dasharray 1.5s cubic-bezier(0.4,0,0.2,1)',
                            }}
                        />
                        <text x={GAUGE_CX} y={GAUGE_CY + 8} textAnchor="middle"
                            fontSize="32" fontWeight="800" fill={gaugeColor}
                            fontFamily="monospace"
                            style={{ filter: `drop-shadow(0 0 8px ${gaugeColor}88)` }}>
                            ~{pct}%
                        </text>
                        <text x={GAUGE_CX} y={GAUGE_CY + 18} textAnchor="middle"
                            fontSize="8" fontWeight="700" fill="rgba(100,160,200,0.6)"
                            fontFamily="sans-serif" letterSpacing="2">
                            CONFID
                        </text>
                    </svg>
                </div>

            </div>

        </div>
    );
}

// ─── Shared mini-cell styles (Redesigned) ────────────────────────────────────
const cellStyleClean = (): React.CSSProperties => ({
    padding: '10px 12px', borderRadius: 12,
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    display: 'flex', flexDirection: 'column',
    justifyContent: 'space-between', gap: 2,
});
const cellLabelClean: React.CSSProperties = { fontSize: '9px', fontWeight: 700, color: 'var(--color-text-secondary)', letterSpacing: '1.2px', textTransform: 'uppercase' };
const cellValueClean = (size = '22px'): React.CSSProperties => ({ fontSize: size, fontWeight: 800, fontFamily: 'var(--font-mono, monospace)', color: 'var(--color-text)', lineHeight: 1 });

// ─── Trades Summary Card ─────────────────────────────────────────────────────
interface TradesCardProps {
    activeTrades: number;
    activeBots: number;
    pnl: number;
    pnlPct: number;
    deployedCapital: number;
    totalCapital?: number;
    totalTrades: number;
    wins: number;
    losses: number;
    // Live-only: wallet balance replaces capital
    walletBalance?: number | null;
}

function _TradesCard({ title, accent, activeTrades, activeBots, pnl, pnlPct, deployedCapital, totalCapital, totalTrades, wins, losses, walletBalance }: TradesCardProps & { title: string; accent: string }) {
    const pSign = (v: number) => v >= 0 ? '+' : '';
    const pnlColor = (v: number) => v >= 0 ? '#22C55E' : '#EF4444';
    const fmtAmt = (v: number) => `${pSign(v)}$${Math.abs(v).toFixed(2)}`;
    const winRate = totalTrades > 0 ? Math.round((wins / totalTrades) * 100) : 0;
    const showWallet = walletBalance != null;

    return (
        <div style={{
            background: 'var(--color-surface)',
            backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid var(--color-border)',
            borderRadius: 22, padding: '14px 16px 16px',
            position: 'relative', overflow: 'hidden',
            boxShadow: '0 0 40px rgba(0,0,0,0.8), inset 0 1px 0 var(--color-border)',
            display: 'flex', flexDirection: 'column' as const,
        }}>
            {/* Top accent line */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '1px', background: `linear-gradient(90deg, transparent, ${accent}66, transparent)` }} />

            {/* Header with status dot */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: accent, boxShadow: `0 0 8px ${accent}88` }} />
                <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '2.5px', color: 'var(--color-text-secondary)' }}>
                    {title}
                </div>
            </div>

            {/* 2×3 grid of metrics */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, flex: 1 }}>
                {/* 1. Active Trades */}
                <div style={cellStyleClean()}>
                    <div style={cellLabelClean}>Active Trades</div>
                    <div style={cellValueClean('24px')}>{activeTrades}</div>
                </div>

                {/* 2. Active Bots */}
                <div style={cellStyleClean()}>
                    <div style={cellLabelClean}>Active Bots</div>
                    <div style={cellValueClean('24px')}>{activeBots}</div>
                </div>

                {/* 3. Total PnL */}
                <div style={cellStyleClean()}>
                    <div style={cellLabelClean}>Total P&L</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' as const }}>
                        <div style={{ ...cellValueClean('20px'), color: pnlColor(pnl), textShadow: `0 0 10px ${pnlColor(pnl)}33` }}>
                            {fmtAmt(pnl)}
                        </div>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: pnlColor(pnlPct) }}>
                            {pSign(pnlPct)}{Math.abs(pnlPct).toFixed(1)}%
                        </div>
                    </div>
                </div>

                {/* 4. Capital — shows wallet balance for Live, deployed/total for Paper */}
                <div style={cellStyleClean()}>
                    <div style={cellLabelClean}>
                        {showWallet ? 'Wallet Balance' : 'Capital'}
                    </div>
                    {showWallet ? (
                        <div style={cellValueClean('20px')}>
                            ${walletBalance != null ? walletBalance.toFixed(2) : '—'}
                        </div>
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                            <div style={cellValueClean('20px')}>
                                ${deployedCapital.toFixed(0)}
                            </div>
                            {totalCapital != null && totalCapital > 0 && (
                                <span style={{ fontSize: '11px', color: '#6B7280', fontWeight: 600 }}>
                                    / ${totalCapital.toFixed(0)}
                                </span>
                            )}
                        </div>
                    )}
                </div>

                {/* 5. Total Trades */}
                <div style={cellStyleClean()}>
                    <div style={cellLabelClean}>Total Trades</div>
                    <div style={cellValueClean('24px')}>{totalTrades}</div>
                </div>

                {/* 6. Win Rate */}
                <div style={cellStyleClean()}>
                    <div style={cellLabelClean}>Win Rate</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        <div style={cellValueClean('24px')}>{winRate}%</div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                            <span style={{ fontSize: '11px', fontWeight: 700, color: '#22C55E' }}>{wins}W</span>
                            <span style={{ fontSize: '10px', color: '#4B5563' }}>/</span>
                            <span style={{ fontSize: '11px', fontWeight: 700, color: '#EF4444' }}>{losses}L</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export function PaperTradesCard(props: Omit<TradesCardProps, 'walletBalance'>) {
    return <_TradesCard title="Paper Trading" accent="#06B6D4" {...props} />;
}

export function LiveTradesCard(props: TradesCardProps) {
    return <_TradesCard title="Live Trading" accent="#22C55E" {...props} />;
}

interface ActivePositionsProps {
    deployedCount: number;
    activePositions: Record<string, any>;
    trades: any[];
}

export function ActivePositionsCard({ deployedCount, activePositions, trades }: ActivePositionsProps) {
    const activeTrades = (trades || []).filter((t: any) => t.status === 'ACTIVE');
    const count = activeTrades.length || deployedCount || 0;
    const coinList = activeTrades.length > 0
        ? activeTrades.map((t: any) => t.symbol?.replace('USDT', '')).join(', ')
        : Object.keys(activePositions || {}).map(s => s.replace('USDT', '')).join(', ') || 'No coins deployed';

    const capital = count * 100;

    return (
        <div style={{
            background: 'var(--color-surface)',
            backdropFilter: 'blur(12px)',
            border: '1px solid var(--color-border)',
            borderRadius: '16px',
            padding: '28px',
            textAlign: 'center',
        }}>
            <div style={{
                fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' as const,
                letterSpacing: '1.5px', color: 'var(--color-text-secondary)', marginBottom: '16px',
            }}>Deployment</div>

            <div style={{
                fontSize: '42px', fontWeight: 700, color: 'var(--color-text)',
            }}>{count}</div>

            <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                Active Positions
            </div>

            <div style={{
                fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '8px',
                maxWidth: '200px', margin: '8px auto 0',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
            }}>
                {coinList}
            </div>

            <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                Capital: ${capital}
            </div>
        </div>
    );
}


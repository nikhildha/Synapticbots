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
            background: 'linear-gradient(160deg, rgba(8,14,26,0.97) 0%, rgba(4,8,16,0.99) 100%)',
            backdropFilter: 'blur(20px)',
            border: `1px solid ${info.color}18`,
            borderRadius: '22px',
            padding: '16px 20px 20px',
            position: 'relative',
            overflow: 'hidden',
            boxShadow: `0 0 40px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.04)`,
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
                        letterSpacing: '2.5px', color: '#4B6080',
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
                                color: '#E8EDF5', letterSpacing: '-0.5px',
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

interface PnlCardProps {
    trades: any[];
    coinDcxBalance?: number | null;
    binanceBalance?: number | null;
    paperPnl?: number;
    livePnl?: number;
    paperPct?: number;
    livePct?: number;
    activeBots?: number | string;
    activeTrades?: number | string;
}

export function PnlCard({ trades, coinDcxBalance, binanceBalance, paperPnl = 0, livePnl = 0, paperPct = 0, livePct = 0, activeBots = 0, activeTrades = 0 }: PnlCardProps) {
    const totalBalance = (binanceBalance ?? 0) + (coinDcxBalance ?? 0);
    const pSign = (v: number) => v >= 0 ? '+' : '';
    const pnlColor = (v: number) => v >= 0 ? '#00FF88' : '#FF3B5C';
    const pnlShadow = (v: number) => v >= 0 ? '0 0 10px rgba(0,255,136,0.4)' : '0 0 10px rgba(255,59,92,0.4)';
    const fmtAmt = (v: number) => `${pSign(v)}$${Math.abs(v).toFixed(2)}`;

    return (
        <div style={{
            background: 'linear-gradient(160deg, rgba(8,14,26,0.97) 0%, rgba(4,8,16,0.99) 100%)',
            backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(0,229,255,0.1)',
            borderRadius: 22, padding: '14px 16px 16px',
            position: 'relative' as const, overflow: 'hidden',
            boxShadow: '0 0 40px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.04)',
            display: 'flex', flexDirection: 'column' as const,
        }}>
            {/* Top accent */}
            <div style={{
                position: 'absolute' as const, top: 0, left: 0, right: 0, height: '1px',
                background: 'linear-gradient(90deg, transparent, rgba(0,229,255,0.5), transparent)',
            }} />

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '2.5px', color: '#4B6080' }}>
                    Wallet Balance
                </div>
            </div>

            {/* Grid: exchange row | partition | pnl row | bots row */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gridTemplateRows: '1fr auto 1fr 1fr',
                gap: 8,
                flex: 1,
            }}>
                {/* Row 1: Binance | CoinDCX */}
                <div style={{
                    padding: '10px 12px', borderRadius: 12,
                    background: 'rgba(240,185,11,0.05)',
                    border: '1px solid rgba(240,185,11,0.15)',
                    display: 'flex', flexDirection: 'column' as const,
                    justifyContent: 'space-between',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ fontSize: 12 }}>🔶</span>
                        <span style={{ fontSize: '9px', fontWeight: 700, color: '#F0B90B', letterSpacing: '1px' }}>BINANCE</span>
                        {binanceBalance != null && <span style={{ fontSize: 9 }}>🔒</span>}
                    </div>
                    <div style={{ fontSize: '17px', fontWeight: 800, fontFamily: 'var(--font-mono, monospace)', color: '#E8EDF5', lineHeight: 1 }}>
                        {binanceBalance != null ? `$${binanceBalance.toFixed(2)}` : <span style={{ fontSize: 11, color: '#3D4F63', fontStyle: 'italic' }}>—</span>}
                        {binanceBalance != null && <span style={{ fontSize: 9, color: '#4B6080', marginLeft: 3 }}>USDT</span>}
                    </div>
                </div>

                <div style={{
                    padding: '10px 12px', borderRadius: 12,
                    background: 'rgba(14,165,233,0.05)',
                    border: '1px solid rgba(14,165,233,0.15)',
                    display: 'flex', flexDirection: 'column' as const,
                    justifyContent: 'space-between',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ fontSize: 12 }}>🇮🇳</span>
                        <span style={{ fontSize: '9px', fontWeight: 700, color: '#0EA5E9', letterSpacing: '1px' }}>COINDCX</span>
                        {coinDcxBalance != null && <span style={{ fontSize: 9 }}>🔒</span>}
                    </div>
                    <div style={{ fontSize: '17px', fontWeight: 800, fontFamily: 'var(--font-mono, monospace)', color: '#E8EDF5', lineHeight: 1 }}>
                        {coinDcxBalance != null ? `$${coinDcxBalance.toFixed(2)}` : <span style={{ fontSize: 11, color: '#3D4F63', fontStyle: 'italic' }}>—</span>}
                        {coinDcxBalance != null && <span style={{ fontSize: 9, color: '#4B6080', marginLeft: 3 }}>USDT</span>}
                    </div>
                </div>

                {/* Partition — auto height, spans both columns */}
                <div style={{
                    gridColumn: '1 / -1',
                    height: 1,
                    background: 'linear-gradient(90deg, transparent, rgba(0,229,255,0.12), transparent)',
                    margin: '0 2px',
                    alignSelf: 'center' as const,
                }} />

                {/* Row 2: Paper PnL | Live PnL */}
                <div style={{
                    padding: '10px 12px', borderRadius: 12,
                    background: 'rgba(0,255,136,0.04)',
                    border: '1px solid rgba(0,255,136,0.1)',
                    display: 'flex', flexDirection: 'column' as const,
                    justifyContent: 'space-between',
                }}>
                    <div style={{ fontSize: '9px', fontWeight: 700, color: '#4B6080', letterSpacing: '1px', textTransform: 'uppercase' as const }}>Paper PnL</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' as const }}>
                        <div style={{ fontSize: '22px', fontWeight: 800, fontFamily: 'var(--font-mono, monospace)', color: pnlColor(paperPnl), textShadow: pnlShadow(paperPnl), lineHeight: 1 }}>
                            {fmtAmt(paperPnl)}
                        </div>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: pnlColor(paperPnl) }}>
                            {pSign(paperPct)}{Math.abs(paperPct).toFixed(1)}%
                        </div>
                    </div>
                </div>

                <div style={{
                    padding: '10px 12px', borderRadius: 12,
                    background: 'rgba(255,184,0,0.04)',
                    border: '1px solid rgba(255,184,0,0.1)',
                    display: 'flex', flexDirection: 'column' as const,
                    justifyContent: 'space-between',
                }}>
                    <div style={{ fontSize: '9px', fontWeight: 700, color: '#4B6080', letterSpacing: '1px', textTransform: 'uppercase' as const }}>Live PnL</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' as const }}>
                        <div style={{ fontSize: '22px', fontWeight: 800, fontFamily: 'var(--font-mono, monospace)', color: pnlColor(livePnl), textShadow: pnlShadow(livePnl), lineHeight: 1 }}>
                            {fmtAmt(livePnl)}
                        </div>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: pnlColor(livePnl) }}>
                            {pSign(livePct)}{Math.abs(livePct).toFixed(1)}%
                        </div>
                    </div>
                </div>

                {/* Row 3: Active Bots | Active Trades (no icons) */}
                <div style={{
                    padding: '10px 12px', borderRadius: 12,
                    background: 'rgba(0,229,255,0.04)',
                    border: '1px solid rgba(0,229,255,0.08)',
                    display: 'flex', flexDirection: 'column' as const,
                    justifyContent: 'space-between',
                }}>
                    <div style={{ fontSize: '9px', color: '#4B6080', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' as const }}>Active Bots</div>
                    <div style={{ fontSize: '28px', fontWeight: 800, color: '#00E5FF', fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
                        {activeBots}
                    </div>
                </div>

                <div style={{
                    padding: '10px 12px', borderRadius: 12,
                    background: 'rgba(0,229,255,0.04)',
                    border: '1px solid rgba(0,229,255,0.08)',
                    display: 'flex', flexDirection: 'column' as const,
                    justifyContent: 'space-between',
                }}>
                    <div style={{ fontSize: '9px', color: '#4B6080', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' as const }}>Active Trades</div>
                    <div style={{ fontSize: '28px', fontWeight: 800, color: '#00E5FF', fontFamily: 'var(--font-mono)', lineHeight: 1 }}>
                        {activeTrades}
                    </div>
                </div>
            </div>
        </div>
    );
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
            background: 'rgba(17, 24, 39, 0.8)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '16px',
            padding: '28px',
            textAlign: 'center',
        }}>
            <div style={{
                fontSize: '11px', fontWeight: 600, textTransform: 'uppercase' as const,
                letterSpacing: '1.5px', color: '#9CA3AF', marginBottom: '16px',
            }}>Deployment</div>

            <div style={{
                fontSize: '42px', fontWeight: 700, color: '#F0F4F8',
            }}>{count}</div>

            <div style={{ fontSize: '13px', color: '#9CA3AF', marginTop: '4px' }}>
                Active Positions
            </div>

            <div style={{
                fontSize: '12px', color: '#6B7280', marginTop: '8px',
                maxWidth: '200px', margin: '8px auto 0',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
            }}>
                {coinList}
            </div>

            <div style={{ fontSize: '11px', color: '#6B7280', marginTop: '4px' }}>
                Capital: ${capital}
            </div>
        </div>
    );
}

interface BrainExecutionProps {
    coinStates: Record<string, any>;
    multi?: any;
    heatmap?: any;
    botId?: string;
    pendingSignals?: { symbol: string; queue_reason: string; cycles_pending: number; conviction: number; side: string; expires_in_sec: number }[];
}

export function BrainExecutionSummary({ coinStates, multi, heatmap: heatmapProp, botId, pendingSignals = [] }: BrainExecutionProps) {
    const [expandedCoin, setExpandedCoin] = useState<string | null>(null);
    const [liveMulti, setLiveMulti] = useState<any>(multi);
    const [liveCoinStates, setLiveCoinStates] = useState<Record<string, any>>(coinStates || {});

    // Auto-refresh at engine interval
    const refreshMs = Math.min(Math.max((liveMulti?.analysis_interval_seconds || 60) * 1000, 30000), 900000);
    useEffect(() => {
        const fetchLatest = async () => {
            try {
                const res = await fetch('/api/bot-state', { cache: 'no-store' });
                if (res.ok) {
                    const d = await res.json();
                    if (d?.multi?.coin_states) setLiveCoinStates(d.multi.coin_states);
                    if (d?.multi) setLiveMulti(d.multi);
                }
            } catch { /* silent */ }
        };
        const timer = setInterval(fetchLatest, refreshMs);
        return () => clearInterval(timer);
    }, [refreshMs]);

    useEffect(() => { if (coinStates) setLiveCoinStates(coinStates); }, [coinStates]);
    useEffect(() => { if (multi) setLiveMulti(multi); }, [multi]);

    const coins = liveCoinStates ? Object.entries(liveCoinStates).map(([sym, c]: [string, any]) => ({ ...c, symbol: sym })) : [];
    const lastCycle = liveMulti?.last_analysis_time || null;

    const formatIST = (iso: string | null) => {
        if (!iso) return '—';
        try {
            const normalized = /Z$|[+-]\d{2}:\d{2}$/.test(iso) ? iso : iso + 'Z';
            return new Date(normalized).toLocaleTimeString('en-IN', {
                hour: '2-digit', minute: '2-digit', second: '2-digit',
                hour12: true, timeZone: 'Asia/Kolkata',
            }) + ' IST';
        } catch { return '—'; }
    };

    // ── Pipeline Stage Classification ──────────────────────────────────────
    const getStage = (c: any): { stage: string; stageNum: number; reason: string; color: string; icon: string } => {
        const a = (c.action || '').toUpperCase();
        const ds = (botId && c.bot_deploy_statuses?.[botId]) || c.deploy_status || '';
        const athena = c.athena_state;

        // Stage 5: Deployed
        if (ds === 'DEPLOY_QUEUED' || ds === 'ACTIVE' || a.includes('DEPLOYED')) {
            return { stage: 'DEPLOYED', stageNum: 5, reason: 'Trade opened successfully', color: '#06B6D4', icon: '' };
        }

        // Stage 4: Athena processed
        if (athena) {
            if (athena.action === 'EXECUTE' || athena.action === 'LONG' || athena.action === 'SHORT') {
                // Athena approved but something else blocked
                const blockReason = ds.startsWith('FILTERED') ? ds.replace('FILTERED: ', '') : 'Exec failed';
                return { stage: 'ATHENA', stageNum: 4, reason: `Approved but: ${blockReason}`, color: '#22C55E', icon: '' };
            }
            if (athena.action === 'VETO' || athena.action === 'SKIP' || athena.action === 'HOLD') {
                return { stage: 'ATHENA VETO', stageNum: 4, reason: `Vetoed: ${(athena.reasoning || '').slice(0, 80)}`, color: '#EF4444', icon: '' };
            }
        }

        // Check if filtered by deploy pipeline (after Athena)
        if (ds.startsWith('FILTERED')) {
            const filterReason = ds.replace('FILTERED: ', '');
            // Athena-related filter
            if (filterReason.includes('Athena')) {
                return { stage: 'ATHENA VETO', stageNum: 4, reason: filterReason, color: '#EF4444', icon: '' };
            }
            // Cap/dupe/conviction filters — coin was qualified but blocked
            return { stage: 'FILTERED', stageNum: 3, reason: filterReason, color: '#F59E0B', icon: '' };
        }

        // Stage 3: HMM Qualified (eligible but not yet sent to Athena — shouldn't happen in normal flow)
        if (a.includes('ELIGIBLE')) {
            return { stage: 'QUALIFIED', stageNum: 3, reason: 'HMM eligible — awaiting deploy', color: '#22C55E', icon: '' };
        }

        // Stage 2: In Segment Pool but no signal
        if (!a.includes('SEGMENT_POOL_SKIP') && !a.includes('SEGMENT POOL SKIP') &&
            !a.includes('DIRECTION_GATE_SKIP') && !a.includes('DIRECTION GATE SKIP')) {
            // In pool but no HMM signal
            let reason = 'No HMM consensus';
            if (a.includes('MTF_CONFLICT') || a.includes('NO_CONSENSUS')) reason = 'No multi-TF consensus';
            else if (a.includes('CHOP')) reason = 'Sideways — no signal';
            else if (a.includes('15M_FILTER')) reason = '15m momentum opposes';
            else if (a.includes('CRASH') || a.includes('MACRO')) reason = 'Crash regime — safety skip';
            else if (a.includes('WEEKEND')) reason = 'Weekend skip';
            else if (a.includes('VOL_TOO_HIGH')) reason = 'ATR too high';
            else if (a.includes('VOL_TOO_LOW')) reason = 'ATR too low';
            else if (a.includes('SENTIMENT')) reason = 'Sentiment veto';
            else if (a.includes('LOW_CONVICTION')) reason = 'Conviction too low';
            const conv = c.conviction != null ? Number(c.conviction) : (c.confidence != null ? (c.confidence <= 1 ? c.confidence * 100 : c.confidence) : 0);
            if (conv === 0 && !a) reason = 'No HMM consensus across timeframes';
            return { stage: 'IN POOL', stageNum: 2, reason, color: '#6B7280', icon: '' };
        }

        // Stage 1: Scanned but not in segment pool
        const poolReason = c.reason || c.pool_desc || 'Not in current segment rotation';
        return { stage: 'OUT OF POOL', stageNum: 1, reason: poolReason, color: '#4B5563', icon: '' };
    };

    // Classify all coins
    const classified = coins.map(c => ({ ...c, ...getStage(c) }));

    // Sort: deployed first, then by stage (highest first), then by conviction
    const sorted = [...classified].sort((a, b) => {
        if (a.stageNum !== b.stageNum) return b.stageNum - a.stageNum;
        const ac = a.conviction != null ? Number(a.conviction) : 0;
        const bc = b.conviction != null ? Number(b.conviction) : 0;
        return bc - ac;
    });

    // Pipeline counts
    const total = coins.length;
    const inPool = classified.filter(c => c.stageNum >= 2).length;
    const qualified = classified.filter(c => c.stageNum >= 3).length;
    const athenaProcessed = classified.filter(c => c.stageNum >= 4).length;
    const deployed = classified.filter(c => c.stageNum === 5).length;
    const athenaVetoed = classified.filter(c => c.stage === 'ATHENA VETO').length;

    const getSegment = (symbol: string): string => {
        const coin = symbol.replace('USDT', '').toUpperCase();
        const map: Record<string, string> = {
            // L1
            BTC: 'L1', ETH: 'L1', SOL: 'L1', BNB: 'L1', AVAX: 'L1', SUI: 'L1', XRP: 'L1', APT: 'L1',
            ETC: 'L1', ADA: 'L1', DOT: 'L1', NEAR: 'L1', TRX: 'L1', BCH: 'L1', TON: 'L1', ICP: 'L1',
            // L2
            ARB: 'L2', OP: 'L2', POL: 'L2', MATIC: 'L2', STRK: 'L2', IMX: 'L2', RONIN: 'L2',
            ZK: 'L2', MANTA: 'L2', METIS: 'L2', AXL: 'L2',
            // DeFi
            UNI: 'DeFi', AAVE: 'DeFi', CRV: 'DeFi', JUP: 'DeFi', RUNE: 'DeFi', PENDLE: 'DeFi',
            LINK: 'DeFi', LDO: 'DeFi', GMX: 'DeFi', ENA: 'DeFi', SUSHI: 'DeFi', COMP: 'DeFi',
            SNX: 'DeFi', CAKE: 'DeFi', GRT: 'DeFi',
            // AI
            TAO: 'AI', FET: 'AI', INJ: 'AI', WLD: 'AI', RENDER: 'AI', ARKM: 'AI',
            // Meme
            DOGE: 'Meme', SHIB: 'Meme', PEPE: 'Meme', BONK: 'Meme', NOT: 'Meme', MANA: 'Meme',
            // RWA
            ONDO: 'RWA', TRU: 'RWA', RSR: 'RWA',
            // Gaming
            AXS: 'Gaming', SAND: 'Gaming', PIXEL: 'Gaming', IOTX: 'Gaming', GALA: 'Gaming',
            ENJ: 'Gaming', YGG: 'Gaming', GLM: 'Gaming',
            // DePIN
            AR: 'DePIN', IO: 'DePIN', JTO: 'DePIN',
            // Modular
            TIA: 'Modular', DYM: 'Modular', STX: 'Modular', QNT: 'Modular', ALT: 'Modular', EIGEN: 'Modular',
            // Oracles
            PYTH: 'Oracles', TRB: 'Oracles', API3: 'Oracles', HBAR: 'Oracles', BAND: 'Oracles',
        };
        return map[coin] || '—';
    };


    const segColors: Record<string, { bg: string; color: string }> = {
        L1: { bg: 'rgba(139,92,246,0.12)', color: '#A78BFA' },
        L2: { bg: 'rgba(6,182,212,0.12)', color: '#22D3EE' },
        DeFi: { bg: 'rgba(16,185,129,0.12)', color: '#34D399' },
        Gaming: { bg: 'rgba(245,158,11,0.12)', color: '#FBBF24' },
        AI: { bg: 'rgba(236,72,153,0.12)', color: '#F472B6' },
        RWA: { bg: 'rgba(59,130,246,0.12)', color: '#60A5FA' },
        DePIN: { bg: 'rgba(168,85,247,0.12)', color: '#C084FC' },
        Meme: { bg: 'rgba(251,146,60,0.12)', color: '#FB923C' },
        Modular: { bg: 'rgba(52,211,153,0.12)', color: '#34D399' },
        Oracles: { bg: 'rgba(96,165,250,0.12)', color: '#60A5FA' },
    };

    const regColor = (r: string) => {
        if (r.includes('BULL')) return '#22C55E';
        if (r.includes('BEAR')) return '#EF4444';
        if (r.includes('CHOP') || r.includes('SIDE')) return '#F59E0B';
        if (r.includes('CRASH')) return '#DC2626';
        return '#6B7280';
    };

    const queued = liveMulti?.pending_signals_count ?? 0;

    const funnelStages = [
        { label: 'SCANNED',   count: total,          color: '#9CA3AF' },
        { label: 'IN POOL',   count: inPool,         color: '#A78BFA' },
        { label: 'QUALIFIED', count: qualified,      color: '#22C55E' },
        { label: 'QUEUED',    count: queued,         color: '#F59E0B', sub: queued > 0 ? 'next cycle' : undefined },
        { label: 'ATHENA',    count: athenaProcessed, color: '#F59E0B', sub: athenaVetoed > 0 ? `${athenaVetoed} vetoed` : undefined },
        { label: 'DEPLOYED',  count: deployed,       color: '#06B6D4' },
    ];

    return (
        <div>
            {/* Header */}
            <div style={{ marginBottom: '20px' }}>
                <h2 style={{ fontSize: '22px', fontWeight: 800, color: '#E5E7EB', margin: 0, letterSpacing: '-0.3px' }}>
                    Brain Execution Summary
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'rgba(156,163,175,0.5)', fontFamily: 'var(--font-mono, monospace)', marginLeft: '10px' }}>
                        Cycle #{liveMulti?.cycle || 0} · {formatIST(lastCycle)}
                    </span>
                </h2>
                <p style={{ fontSize: '12px', color: 'rgba(156,163,175,0.35)', marginTop: 4, fontFamily: 'var(--font-mono, monospace)' }}>
                    Full pipeline visibility — Segment → HMM → Athena → Deploy
                </p>
            </div>

            {/* ═══ Signal Queue Panel ══════════════════════════════════════ */}
            {pendingSignals.length > 0 && (
                <div style={{
                    marginBottom: '16px', padding: '14px 16px',
                    background: 'rgba(245,158,11,0.05)',
                    border: '1px solid rgba(245,158,11,0.2)',
                    borderRadius: '12px',
                    display: 'flex', flexDirection: 'column', gap: 10,
                }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#F59E0B', letterSpacing: '1.5px', textTransform: 'uppercase' }}>
                        📥 Signal Queue — Athena-Approved, Awaiting Deploy
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {pendingSignals.map((s: any) => { // Assuming 'any' type for pendingSignals items as the interface is not provided
                            const isLong = s.side === 'BUY' || s.side === 'LONG';
                            const reasonLabel = s.queue_reason === 'guard4_segment_locked'
                                ? 'Guard 4'
                                : s.queue_reason === 'no_bots'
                                ? 'No Bots'
                                : s.queue_reason;
                            const ttlMin = Math.ceil(s.expires_in_sec / 60);
                            return (
                                <div key={s.symbol} style={{
                                    display: 'flex', alignItems: 'center', gap: 8,
                                    background: 'rgba(245,158,11,0.08)',
                                    border: '1px solid rgba(245,158,11,0.25)',
                                    borderRadius: 8, padding: '6px 12px',
                                }}>
                                    <span style={{ fontWeight: 800, color: '#E8EDF5', fontFamily: 'monospace', fontSize: 13 }}>
                                        {s.symbol.replace('USDT', '')}
                                    </span>
                                    <span style={{
                                        fontSize: 10, fontWeight: 700,
                                        color: isLong ? '#00FF88' : '#FF3B5C',
                                        background: isLong ? 'rgba(0,255,136,0.08)' : 'rgba(255,59,92,0.08)',
                                        padding: '2px 6px', borderRadius: 4,
                                    }}>
                                        {isLong ? 'LONG' : 'SHORT'}
                                    </span>
                                    <span style={{ fontSize: 10, color: '#9CA3AF' }}>
                                        Conv: <strong style={{ color: '#F59E0B' }}>{s.conviction?.toFixed(0)}%</strong>
                                    </span>
                                    <span style={{
                                        fontSize: 10, color: '#6B7280',
                                        background: 'rgba(255,255,255,0.05)',
                                        padding: '2px 6px', borderRadius: 4,
                                    }}>
                                        {reasonLabel}
                                    </span>
                                    <span style={{ fontSize: 10, color: '#4B5563' }}>TTL {ttlMin}m</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ── Pipeline Funnel ──────────────────────────────────────── */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: '0', marginBottom: '20px',
                background: 'rgba(255,255,255,0.02)', borderRadius: '14px', padding: '16px 12px',
                border: '1px solid rgba(255,255,255,0.05)',
            }}>
                {funnelStages.map((s, i) => (
                    <div key={s.label} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                        <div style={{
                            textAlign: 'center', flex: 1, padding: '8px 4px',
                            background: s.count > 0 ? `${s.color}08` : 'transparent',
                            borderRadius: '10px',
                            border: s.count > 0 ? `1px solid ${s.color}20` : '1px solid transparent',
                        }}>
                            <div style={{ fontSize: '10px', textTransform: 'uppercase' as const, letterSpacing: '1.2px', color: '#6B7280', marginBottom: '4px', fontWeight: 700 }}>
                                {s.label}
                            </div>
                            <div style={{ fontSize: '26px', fontWeight: 800, color: s.count > 0 ? s.color : '#374151', lineHeight: 1 }}>
                                {s.count}
                            </div>
                            {s.sub && (
                                <div style={{ fontSize: '9px', color: '#EF4444', marginTop: '3px', fontWeight: 600 }}>
                                    {s.sub}
                                </div>
                            )}
                        </div>
                        {i < funnelStages.length - 1 && (
                            <div style={{ color: '#374151', fontSize: '16px', padding: '0 4px', fontWeight: 300 }}>→</div>
                        )}
                    </div>
                ))}
            </div>

            {/* ── Per-Coin Detail Table ────────────────────────────────── */}
            <div className="card-gradient rounded-xl overflow-hidden">
                <div style={{ overflowX: 'auto', maxHeight: '520px', overflowY: 'auto' }}>
                    <table style={{ width: '100%', minWidth: '900px', borderCollapse: 'collapse', fontSize: '13px' }}>
                        <thead>
                            <tr style={{ borderBottom: '2px solid rgba(255,255,255,0.08)' }}>
                                {['#', 'Coin', 'Segment', 'Pool', 'HMM Regime', 'Conv %', 'Athena', 'Result', 'Reason'].map(h => (
                                    <th key={h} style={{
                                        padding: '12px 8px', textAlign: h === '#' || h === 'Coin' || h === 'Reason' ? 'left' : 'center',
                                        fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '1px', color: '#6B7280',
                                        position: 'sticky' as const, top: 0, background: 'var(--color-surface, rgba(17,24,39,0.98))',
                                    }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {sorted.map((c: any, idx: number) => {
                                const regime = c.regime || '—';
                                const conv = c.conviction != null ? Number(c.conviction) : (c.confidence != null ? (c.confidence <= 1 ? c.confidence * 100 : c.confidence) : 0);
                                const isExpanded = expandedCoin === c.symbol;
                                const athena = c.athena_state;
                                const seg = getSegment(c.symbol || '');
                                const sc = segColors[seg] || { bg: 'rgba(107,114,128,0.10)', color: '#9CA3AF' };
                                const isDeployed = c.stageNum === 5;
                                const inSegPool = c.stageNum >= 2;

                                return (
                                    <React.Fragment key={c.symbol}>
                                        <tr
                                            style={{
                                                borderBottom: '1px solid rgba(255,255,255,0.04)',
                                                background: isDeployed ? 'rgba(6,182,212,0.04)' : 'transparent',
                                                cursor: athena ? 'pointer' : 'default',
                                                transition: 'background 0.2s',
                                            }}
                                            onClick={() => athena && setExpandedCoin(isExpanded ? null : c.symbol)}
                                            onMouseEnter={e => (e.currentTarget.style.background = isDeployed ? 'rgba(6,182,212,0.07)' : 'rgba(255,255,255,0.03)')}
                                            onMouseLeave={e => (e.currentTarget.style.background = isDeployed ? 'rgba(6,182,212,0.04)' : 'transparent')}
                                        >
                                            {/* # */}
                                            <td style={{ padding: '10px 8px', color: 'rgba(156,163,175,0.4)', fontSize: '10px', fontWeight: 600, fontFamily: 'monospace' }}>{idx + 1}</td>
                                            {/* Coin */}
                                            <td style={{ padding: '10px 8px' }}>
                                                <div style={{ fontWeight: 800, color: '#E8EDF5', fontSize: '14px', fontFamily: 'var(--font-mono, monospace)', letterSpacing: '-0.3px' }}>
                                                    {(c.symbol || '').replace('USDT', '')}
                                                    {athena && <span style={{ fontSize: '9px', marginLeft: '5px', color: '#6B7280' }}>{isExpanded ? '▼' : '▶'}</span>}
                                                </div>
                                            </td>
                                            {/* Segment */}
                                            <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                                                <span style={{ background: sc.bg, color: sc.color, padding: '3px 9px', borderRadius: '8px', fontSize: '10px', fontWeight: 700 }}>{seg}</span>
                                            </td>
                                            {/* Pool */}
                                            <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                                                <span style={{
                                                    padding: '3px 8px', borderRadius: '8px', fontSize: '10px', fontWeight: 700,
                                                    background: inSegPool ? 'rgba(34,197,94,0.1)' : 'rgba(107,114,128,0.08)',
                                                    color: inSegPool ? '#22C55E' : '#6B7280',
                                                }}>{inSegPool ? '✅ IN' : '⛔ OUT'}</span>
                                            </td>
                                            {/* HMM Regime */}
                                            <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                                                {inSegPool ? (
                                                    <span style={{
                                                        background: regime.includes('BULL') ? 'rgba(34,197,94,0.12)' : regime.includes('BEAR') ? 'rgba(239,68,68,0.12)' : 'rgba(107,114,128,0.10)',
                                                        color: regColor(regime), padding: '3px 10px', borderRadius: '10px', fontSize: '10px', fontWeight: 700,
                                                    }}>{regime}</span>
                                                ) : <span style={{ color: '#374151' }}>—</span>}
                                            </td>
                                            {/* Conv % */}
                                            <td style={{
                                                padding: '10px 8px', textAlign: 'center', fontWeight: 800, fontSize: '14px', fontFamily: 'monospace',
                                                color: conv > 80 ? '#00FF88' : conv > 60 ? '#06B6D4' : conv > 40 ? '#F59E0B' : '#4B5563',
                                            }}>
                                                {inSegPool && conv > 0 ? `${conv.toFixed(0)}%` : <span style={{ color: '#374151' }}>—</span>}
                                            </td>
                                            {/* Athena */}
                                            <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                                                {athena ? (
                                                    <span style={{
                                                        padding: '3px 10px', borderRadius: '10px', fontSize: '10px', fontWeight: 700,
                                                        background: athena.action === 'EXECUTE' || athena.action === 'LONG' || athena.action === 'SHORT'
                                                            ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                                                        color: athena.action === 'EXECUTE' || athena.action === 'LONG' || athena.action === 'SHORT'
                                                            ? '#22C55E' : '#EF4444',
                                                    }}>
                                                        {athena.action === 'EXECUTE' || athena.action === 'LONG' || athena.action === 'SHORT'
                                                            ? `✅ ${Math.round((athena.confidence || 0) * 100)}%`
                                                            : `🚫 ${athena.action}`}
                                                    </span>
                                                ) : <span style={{ color: '#374151' }}>—</span>}
                                            </td>
                                            {/* Result */}
                                            <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                                                <span style={{
                                                    padding: '4px 10px', borderRadius: '10px', fontSize: '10px', fontWeight: 700,
                                                    background: `${c.color}15`,
                                                    color: c.color,
                                                }}>{c.stage}</span>
                                            </td>
                                            {/* Reason */}
                                            <td style={{ padding: '10px 8px', fontSize: '11px', color: 'rgba(180,200,220,0.55)', maxWidth: '220px' }}>
                                                {c.reason}
                                            </td>
                                        </tr>

                                        {/* ── Expanded Athena Detail Row ── */}
                                        {isExpanded && athena && (
                                            <tr>
                                                <td colSpan={9} style={{ padding: 0 }}>
                                                    <div style={{
                                                        background: 'rgba(139,92,246,0.04)', borderLeft: '3px solid #A78BFA',
                                                        padding: '14px 20px', margin: '0',
                                                    }}>
                                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px', marginBottom: '10px' }}>
                                                            <div>
                                                                <div style={{ fontSize: '9px', color: '#6B7280', textTransform: 'uppercase' as const, letterSpacing: '1px', marginBottom: '4px' }}>Athena Decision</div>
                                                                <div style={{ fontSize: '13px', fontWeight: 700, color: athena.action === 'EXECUTE' ? '#22C55E' : '#EF4444' }}>
                                                                    {athena.action} ({Math.round((athena.confidence || 0) * 100)}%)
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <div style={{ fontSize: '9px', color: '#6B7280', textTransform: 'uppercase' as const, letterSpacing: '1px', marginBottom: '4px' }}>Model</div>
                                                                <div style={{ fontSize: '13px', fontWeight: 600, color: '#A78BFA', fontFamily: 'monospace' }}>{athena.model || 'gpt-4o'}</div>
                                                            </div>
                                                            <div>
                                                                <div style={{ fontSize: '9px', color: '#6B7280', textTransform: 'uppercase' as const, letterSpacing: '1px', marginBottom: '4px' }}>Latency</div>
                                                                <div style={{ fontSize: '13px', fontWeight: 600, color: '#9CA3AF', fontFamily: 'monospace' }}>
                                                                    {athena.latency_ms ? `${athena.latency_ms}ms` : '—'}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        {athena.risk_flags && athena.risk_flags.length > 0 && (
                                                            <div style={{ marginBottom: '8px' }}>
                                                                <span style={{ fontSize: '9px', color: '#EF4444', textTransform: 'uppercase' as const, letterSpacing: '1px' }}>Risk Flags: </span>
                                                                {athena.risk_flags.map((f: string, i: number) => (
                                                                    <span key={i} style={{ fontSize: '11px', color: '#F59E0B', background: 'rgba(245,158,11,0.1)', padding: '2px 6px', borderRadius: '4px', marginRight: '4px' }}>{f}</span>
                                                                ))}
                                                            </div>
                                                        )}
                                                        <div>
                                                            <div style={{ fontSize: '9px', color: '#6B7280', textTransform: 'uppercase' as const, letterSpacing: '1px', marginBottom: '4px' }}>Reasoning</div>
                                                            <div style={{ fontSize: '12px', color: '#D1D5DB', lineHeight: 1.5, fontFamily: 'var(--font-mono, monospace)' }}>
                                                                {athena.reasoning || '—'}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}


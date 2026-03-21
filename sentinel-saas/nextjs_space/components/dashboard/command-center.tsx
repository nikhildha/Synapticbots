'use client';

import { useState, useEffect, useRef } from 'react';

const REGIME_MAP: Record<string, { emoji: string; color: string; bgGlow: string }> = {
    'BULLISH': { emoji: '🟢', color: '#00FF88', bgGlow: 'rgba(0,255,136,0.12)' },
    'BEARISH': { emoji: '🔴', color: '#FF3B5C', bgGlow: 'rgba(255,59,92,0.12)' },
    'SIDEWAYS/CHOP': { emoji: '🟡', color: '#FFB300', bgGlow: 'rgba(255,179,0,0.12)' },
    'CRASH/PANIC': { emoji: '💀', color: '#FF3B5C', bgGlow: 'rgba(255,59,92,0.18)' },
    'WAITING': { emoji: '🔍', color: '#A78BFA', bgGlow: 'rgba(167,139,250,0.10)' },
    'SCANNING': { emoji: '🔍', color: '#00E5FF', bgGlow: 'rgba(0,229,255,0.10)' },
    'OFFLINE': { emoji: '⚫', color: '#4B5563', bgGlow: 'rgba(75,85,99,0.08)' },
};

// Mirrors CRYPTO_SEGMENTS in config.py — keep in sync when adding new coins
const SEGMENT_MAP: Record<string, string> = {
    // L1
    BTC: 'L1', ETH: 'L1', SOL: 'L1', BNB: 'L1', AVAX: 'L1', SUI: 'L1',
    // L2
    MATIC: 'L2', ARB: 'L2', OP: 'L2', POL: 'L2', MNT: 'L2', STRK: 'L2', IMX: 'L2', RONIN: 'L2', RON: 'L2', MANTA: 'L2',
    // DeFi
    UNI: 'DeFi', AAVE: 'DeFi', DYDX: 'DeFi', CRV: 'DeFi', JUP: 'DeFi', RUNE: 'DeFi',
    LINK: 'DeFi', PENDLE: 'DeFi', GMX: 'DeFi', ENS: 'DeFi',
    // Gaming
    AXS: 'Gaming', SAND: 'Gaming', MANA: 'Gaming', GALA: 'Gaming', ILV: 'Gaming',
    BEAM: 'Gaming', PIXEL: 'Gaming', IOTX: 'Gaming',
    // AI
    FET: 'AI', AGIX: 'AI', RENDER: 'AI', WLD: 'AI', TAO: 'AI', OCEAN: 'AI', NMR: 'AI', ALT: 'AI', INJ: 'AI', AKT: 'AI',
    // RWA
    POLYX: 'RWA', ONDO: 'RWA', TRU: 'RWA', CPOOL: 'RWA', CFG: 'RWA', RIO: 'RWA',
    // DePIN
    FIL: 'DePIN', AR: 'DePIN', HNT: 'DePIN',
    // Oracles
    PYTH: 'Oracles', TRB: 'Oracles', API3: 'Oracles',
    // Modular
    TIA: 'Modular', DYM: 'Modular',
    // Meme
    DOGE: 'Meme', SHIB: 'Meme', PEPE: 'Meme', WIF: 'Meme', BONK: 'Meme',
};


function getSegment(symbol: string): string {
    const coin = symbol.replace('USDT', '').toUpperCase();
    return SEGMENT_MAP[coin] || '';
}

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

interface SignalSummaryProps {
    coinStates: Record<string, any>;
    multi?: any;
    heatmap?: any;
    botId?: string;
}

function formatPrice(price: number): string {
    if (!price || isNaN(price)) return '$0';
    if (price >= 1000) return '$' + price.toLocaleString('en-US', { maximumFractionDigits: 2 });
    if (price >= 1) return '$' + price.toFixed(4);
    return '$' + price.toFixed(6);
}

export function SignalSummaryTable({ coinStates, multi, heatmap: heatmapProp, botId }: SignalSummaryProps) {
    const [selectedCoins, setSelectedCoins] = useState<string[]>([]);
    const [filterOpen, setFilterOpen] = useState(false);
    const [liveMulti, setLiveMulti] = useState<any>(multi);
    const [liveCoinStates, setLiveCoinStates] = useState<Record<string, any>>(coinStates || {});
    const [liveHeatmap, setLiveHeatmap] = useState<any>(heatmapProp || null);

    // Main data refresh: poll at engine interval (10min)
    const refreshMs = Math.min(Math.max((liveMulti?.analysis_interval_seconds || 60) * 1000, 30000), 900000);
    useEffect(() => {
        const fetchLatest = async () => {
            try {
                const res = await fetch('/api/bot-state', { cache: 'no-store' });
                if (res.ok) {
                    const d = await res.json();
                    if (d?.multi?.coin_states) setLiveCoinStates(d.multi.coin_states);
                    if (d?.multi) setLiveMulti(d.multi);
                    if (d?.heatmap) setLiveHeatmap(d.heatmap);
                }
            } catch { /* silent */ }
        };
        const timer = setInterval(fetchLatest, refreshMs);
        return () => clearInterval(timer);
    }, [refreshMs]);

    // Fast re-registration heartbeat: every 30s check if bots are still registered.
    // Engine restart clears ENGINE_ACTIVE_BOTS — this re-pushes them quickly.
    useEffect(() => {
        const reRegister = async () => {
            try {
                await fetch('/api/bot-state', { cache: 'no-store' });
                // bot-state/route.ts auto-re-registers any unregistered active bots
                // on every call — so simply calling it is enough.
            } catch { /* silent */ }
        };
        // Run immediately on mount, then every 30s
        reRegister();
        const hb = setInterval(reRegister, 30_000);
        return () => clearInterval(hb);
    }, []);

    useEffect(() => { if (coinStates) setLiveCoinStates(coinStates); }, [coinStates]);
    useEffect(() => { if (multi) setLiveMulti(multi); }, [multi]);

    const coins = liveCoinStates ? Object.entries(liveCoinStates).map(([sym, c]: [string, any]) => ({ ...c, symbol: sym })) : [];
    const allSymbols = coins.map((c: any) => c.symbol || '').filter(Boolean).sort();
    const lastCycle = liveMulti?.last_analysis_time || null;
    const intervalSec = Number(liveMulti?.analysis_interval_seconds || 0);

    const formatIST = (iso: string | null) => {
        if (!iso) return '—';
        try {
            // Normalize: if no timezone suffix, assume UTC (Railway engine runs UTC)
            const normalized = /Z$|[+-]\d{2}:\d{2}$/.test(iso) ? iso : iso + 'Z';
            return new Date(normalized).toLocaleTimeString('en-IN', {
                hour: '2-digit', minute: '2-digit', second: '2-digit',
                hour12: true, timeZone: 'Asia/Kolkata',
            }) + ' IST';
        } catch { return '—'; }
    };


    const filtered = selectedCoins.length > 0 ? coins.filter((c: any) => selectedCoins.includes(c.symbol)) : coins;
    const sorted = [...filtered].sort((a: any, b: any) => {
        const ae = (a.action || '').includes('ELIGIBLE') ? 1 : 0;
        const be = (b.action || '').includes('ELIGIBLE') ? 1 : 0;
        if (ae !== be) return be - ae;
        const ac = a.conviction != null ? Number(a.conviction) : (a.confidence != null ? (a.confidence <= 1 ? a.confidence * 100 : a.confidence) : 0);
        const bc = b.conviction != null ? Number(b.conviction) : (b.confidence != null ? (b.confidence <= 1 ? b.confidence * 100 : b.confidence) : 0);
        return bc - ac;
    });

    const eligible = coins.filter((c: any) => (c.action || '').includes('ELIGIBLE'));
    const skipped = coins.filter((c: any) => {
        const a = c.action || '';
        return a.includes('SKIP') || a.includes('VETO') || a.includes('CONFLICT') || a.includes('CRASH');
    });

    const actStyle = (action: string) => {
        if (action.includes('ELIGIBLE')) return { bg: 'rgba(34,197,94,0.12)', color: '#22C55E', icon: '✓' };
        if (action.includes('CRASH')) return { bg: 'rgba(220,38,38,0.12)', color: '#DC2626', icon: '✕' };
        if (action.includes('SEGMENT POOL SKIP') || action.includes('DIRECTION GATE SKIP')) return { bg: 'rgba(245,158,11,0.12)', color: '#F59E0B', icon: '⊘' };
        if (action.includes('SKIP') || action.includes('VETO') || action.includes('CONFLICT')) return { bg: 'rgba(239,68,68,0.12)', color: '#EF4444', icon: '✕' };
        if (action.includes('CHOP') || action.includes('MEAN_REV')) return { bg: 'rgba(245,158,11,0.12)', color: '#F59E0B', icon: '~' };
        return { bg: 'rgba(107,114,128,0.08)', color: '#6B7280', icon: '•' };
    };

    const regColor = (r: string) => {
        if (r.includes('BULL')) return '#22C55E';
        if (r.includes('BEAR')) return '#EF4444';
        if (r.includes('CHOP') || r.includes('SIDE')) return '#F59E0B';
        if (r.includes('CRASH')) return '#DC2626';
        return '#6B7280';
    };

    const getReason = (c: any) => {
        const ds = (botId && c.bot_deploy_statuses?.[botId]) || c.deploy_status || '';
        const a = ds || c.action || '', r = c.regime || '';
        // Use conviction (post 8-factor score, 0-100) if available, fallback to raw HMM confidence
        const pct = c.conviction != null ? Number(c.conviction) : (c.confidence != null ? (c.confidence <= 1 ? c.confidence * 100 : c.confidence) : 0);
        // If coin was eligible but filtered in deploy phase, show the deploy filter reason
        if (ds.startsWith('FILTERED')) return ds.replace('FILTERED: ', '').charAt(0).toUpperCase() + ds.replace('FILTERED: ', '').slice(1);
        // Segment pool skip — use the pre-built reason from engine (includes mode + pools)
        if (a.includes('SEGMENT_POOL_SKIP') || a.includes('SEGMENT POOL SKIP')) {
            return c.reason || c.pool_desc || 'Not in current segment pool';
        }
        // Direction gate skip — HMM signal direction opposed to pool
        if (a.includes('DIRECTION_GATE_SKIP') || a.includes('DIRECTION GATE SKIP')) {
            return c.reason || 'Signal direction ≠ regime pool';
        }
        if (a.includes('ELIGIBLE_BUY')) return `Bullish @ ${pct.toFixed(0)} conv — LONG ready`;
        if (a.includes('ELIGIBLE_SELL')) return `Bearish @ ${pct.toFixed(0)} conv — SHORT ready`;
        if (a.includes('ELIGIBLE')) return `${r} @ ${pct.toFixed(0)} conv — trade ready`;
        if (a.includes('CRASH_SKIP') || a.includes('MACRO_CRASH')) return 'Crash regime — safety skip';
        if (a.includes('WEEKEND') || a.includes('WEEK_SKIP')) return 'Weekend — skipped';
        if (a.includes('MTF_CONFLICT') || a.includes('MTF_NO_CONSENSUS') || a.includes('NO_CONSENSUS')) return 'No HMM consensus across timeframes';
        if (a.includes('15M_FILTER')) return '15m momentum opposes direction';
        if (a.includes('SENTIMENT_VETO') || a.includes('SENTIMENT_ALERT')) return 'Sentiment filter — vetoed';
        if (a.includes('CHOP_NO_SIGNAL')) return 'Sideways — no mean-rev signal';
        if (a.includes('MEAN_REV')) return 'Mean-reversion in choppy market';
        if (a.includes('LOW_CONVICTION') || (pct === 0 && !a)) return 'Conviction too low';
        if (a.includes('VOL_TOO_HIGH')) return 'ATR too high — risky';
        if (a.includes('VOL_TOO_LOW')) return 'ATR too low — no opportunity';
        // 0.0% confidence with no known code → HMM model couldn't converge on a state
        if (pct === 0) return 'No HMM consensus across timeframes';
        // Fallback: show the raw action code so users can see the actual engine reason
        return a ? a.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c: string) => c.toUpperCase()) : 'Analyzing market conditions...';
    };

    const toggleCoin = (sym: string) => setSelectedCoins(prev => prev.includes(sym) ? prev.filter(s => s !== sym) : [...prev, sym]);

    return (
        <div>
            {/* Header */}
            <div style={{ marginBottom: '16px' }}>
                <h2 style={{ fontSize: 20, fontWeight: 800, color: '#00E5FF', margin: 0, textShadow: '0 0 12px rgba(0,229,255,0.3)' }}>Bot Scan Summary <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(0,229,255,0.4)', fontFamily: 'var(--font-mono, monospace)' }}>· Cycle #{liveMulti?.cycle || 0}</span></h2>
                <p style={{ fontSize: 12, color: 'rgba(0,229,255,0.25)', marginTop: 4, fontFamily: 'var(--font-mono, monospace)' }}>Synaptic Adaptive · Auto-refreshes every {Math.round(refreshMs / 1000)}s · <span style={{ color: 'rgba(255,255,255,0.2)' }}>showing current batch slice</span></p>
            </div>

            {/* Stats Bar */}
            {(() => {
                const engineTs = liveMulti?.last_analysis_time || liveMulti?.timestamp || null;
                // Multi-signal engine detection:
                // 1. Engine status field from health endpoint (most reliable)
                // 2. Uptime > 0 means Flask is serving
                // 3. Timestamp staleness fallback (generous 20-min to cover long cycles)
                const engineStatus = liveMulti?.status || '';
                const engineUptime = liveMulti?.uptime_seconds || 0;
                const tsAge = engineTs ? (Date.now() - new Date(String(engineTs)).getTime()) : Infinity;
                const isEngineOn = engineStatus === 'running' || engineUptime > 0 || tsAge < 1200000;
                // Detect if engine is mid-cycle (ON but no recent completed cycle). Allow 14m before showing SCANNING.
                const isScanning = isEngineOn && (!engineTs || tsAge > 240000);
                const nextCycleLabel = (() => {
                    const nextRaw = liveMulti?.next_analysis_time;
                    try {
                        // Countdown timer to next cycle
                        if (nextRaw) {
                            const ts = String(nextRaw);
                            const normalized = /Z$|[+-]\d{2}:\d{2}$/.test(ts) ? ts : ts + 'Z';
                            const nextMs = new Date(normalized).getTime();
                            const secsLeft = Math.max(0, Math.round((nextMs - Date.now()) / 1000));
                            if (secsLeft <= 0) return 'Running…';
                            const m = Math.floor(secsLeft / 60);
                            const s = secsLeft % 60;
                            const timeStr = new Date(nextMs).toLocaleTimeString('en-IN', {
                                hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
                            });
                            return m > 0 ? `${m}m ${s}s · ${timeStr} IST` : `${s}s · ${timeStr} IST`;
                        }
                        // Fallback: compute from last_analysis_time + interval
                        if (!engineTs || !intervalSec) return isScanning ? 'Scanning…' : '—';
                        const ts = String(engineTs);
                        const normalized = /Z$|[+-]\d{2}:\d{2}$/.test(ts) ? ts : ts + 'Z';
                        const nextMs = new Date(normalized).getTime() + (intervalSec * 1000);
                        if (isNaN(nextMs) || nextMs <= Date.now()) return 'Running…';
                        return new Date(nextMs).toLocaleTimeString('en-IN', {
                            hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
                        }) + ' IST';
                    } catch { return '—'; }
                })();
                const engineLabel = isScanning ? '🔄 SCANNING' : isEngineOn ? '🟢 ON' : '🔴 OFF';
                const engineColor = isScanning ? '#A78BFA' : isEngineOn ? '#22C55E' : '#EF4444';
                const statsItems = [
                    { label: 'Engine', value: engineLabel, color: engineColor, isText: true },
                    { label: 'Next Cycle', value: nextCycleLabel, color: '#A78BFA', isText: true },
                    { label: 'Scanned', value: coins.length, color: '#06B6D4' },
                    { label: 'Eligible', value: eligible.length, color: '#22C55E' },
                    { label: 'Deployed', value: (liveMulti as any)?.deployed_count ?? '?', color: '#F59E0B' },
                    { label: 'Filtered', value: skipped.length, color: '#EF4444' },
                    { label: 'Last Cycle', value: formatIST(lastCycle), color: '#9CA3AF', isText: true },
                    { label: 'Interval', value: intervalSec ? `${Math.round(Number(intervalSec) / 60)}m` : '—', color: '#9CA3AF', isText: true },
                ];
                return (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '8px', marginBottom: '12px' }}>
                        {statsItems.map((s, i) => (
                            <div key={i} style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${s.label === 'Engine' ? (isEngineOn ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)') : 'rgba(255,255,255,0.06)'}`, borderRadius: '10px', padding: '10px 12px', textAlign: 'center' }}>
                                <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '1px', color: '#6B7280', marginBottom: '4px' }}>{s.label}</div>
                                <div style={{ fontSize: (s as any).isText ? '12px' : '20px', fontWeight: 700, color: '#FFFFFF', fontFamily: (s as any).isText ? 'monospace' : 'inherit' }}>{s.value}</div>
                            </div>
                        ))}
                    </div>
                );
            })()}

            {/* ── Segment Heatmap ─────────────────────────────────── */}
            {liveHeatmap?.segments?.length > 0 && (() => {
                const segs: any[] = liveHeatmap.segments;
                const btc24h: number = liveHeatmap.btc_24h ?? 0;
                const maxAbs = Math.max(...segs.map((s: any) => Math.abs(s.composite_score)), 0.01);
                return (
                    <div style={{ marginBottom: '14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                            <span style={{ fontSize: '11px', fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '1px' }}>🔥 Segment Heatmap</span>
                            <span style={{ fontSize: '10px', color: btc24h >= 0 ? '#22C55E' : '#EF4444', fontFamily: 'monospace', background: 'rgba(255,255,255,0.05)', padding: '2px 7px', borderRadius: '6px' }}>
                                BTC 24h: {btc24h >= 0 ? '+' : ''}{btc24h.toFixed(2)}%
                            </span>
                            <span style={{ fontSize: '10px', color: '#4B5563', marginLeft: 'auto' }}>Score = VW-RR × Breadth</span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px' }}>
                            {segs.map((seg: any, i: number) => {
                                const pos = seg.composite_score >= 0;
                                const barW = Math.round((Math.abs(seg.composite_score) / maxAbs) * 100);
                                const rankColors = ['#FFD700', '#C0C0C0', '#CD7F32'];
                                return (
                                    <div key={seg.segment} style={{
                                        background: pos ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
                                        border: `1px solid ${pos ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
                                        borderRadius: '10px', padding: '8px 10px', position: 'relative', overflow: 'hidden',
                                    }}>
                                        {/* rank badge */}
                                        {i < 3 && <span style={{ position: 'absolute', top: 4, right: 6, fontSize: '10px', color: rankColors[i] }}>#{i + 1}</span>}
                                        {/* segment name */}
                                        <div style={{ fontSize: '11px', fontWeight: 700, color: '#E5E7EB', marginBottom: '4px' }}>{seg.segment}</div>
                                        {/* composite score */}
                                        <div style={{ fontSize: '15px', fontWeight: 800, color: pos ? '#22C55E' : '#EF4444', lineHeight: 1, marginBottom: '4px' }}>
                                            {pos ? '+' : ''}{seg.composite_score.toFixed(2)}
                                        </div>
                                        {/* bar */}
                                        <div style={{ height: '3px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', marginBottom: '5px' }}>
                                            <div style={{ height: '100%', width: `${barW}%`, background: pos ? '#22C55E' : '#EF4444', borderRadius: '2px', transition: 'width 0.4s ease' }} />
                                        </div>
                                        {/* sub-metrics */}
                                        <div style={{ display: 'flex', gap: '6px', fontSize: '9px', color: '#6B7280' }}>
                                            <span title="VW-RR">VW {seg.vw_rr >= 0 ? '+' : ''}{seg.vw_rr}%</span>
                                            <span title="Alpha vs BTC">α {seg.btc_alpha >= 0 ? '+' : ''}{seg.btc_alpha}%</span>
                                            <span title="Breadth">🫧{seg.breadth_pct}%</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })()}

            {/* Coin Filter Dropdown removed as per user request */}

            {/* Table */}
            <div className="card-gradient rounded-xl overflow-hidden">
                <div style={{ overflowX: 'auto', maxHeight: '480px', overflowY: 'auto' }}>
                    <table style={{ width: '100%', minWidth: '900px', borderCollapse: 'collapse', fontSize: '14px' }}>
                        <thead>
                            <tr style={{ borderBottom: '2px solid rgba(255,255,255,0.08)' }}>
                                {['#', 'Coin', 'Segment', 'Regime', 'Conv %', 'Deploy', 'Reason', 'Cycle #', 'Scan Time'].map(h => (
                                    <th key={h} style={{ padding: '10px 8px', textAlign: h === '#' || h === 'Coin' || h === 'Reason' ? 'left' : 'center', fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: '#4B5563', position: 'sticky' as const, top: 0, background: 'var(--color-surface, rgba(17,24,39,0.98))' }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {sorted.map((c: any, idx: number) => {
                                const regime = c.regime || 'WAITING';
                                const conf = c.conviction != null ? Number(c.conviction) : (c.confidence != null ? (c.confidence <= 1 ? c.confidence * 100 : c.confidence) : 0);
                                const action = (c.action || '').replace(/_/g, ' ');
                                const as = actStyle(action);
                                const isE = action.includes('ELIGIBLE');
                                const regBg = regime.includes('BULL') ? 'rgba(34,197,94,0.12)' : regime.includes('BEAR') ? 'rgba(239,68,68,0.12)' : regime.includes('CHOP') || regime.includes('SIDE') ? 'rgba(245,158,11,0.12)' : 'rgba(107,114,128,0.10)';
                                // Check if this coin has an active trade (deployed)
                                const activePositions = liveMulti?.active_positions || liveMulti?.positions || {};
                                const symBase = (c.symbol || '').replace('USDT', '');
                                const isDeployed = Object.keys(activePositions).some(k => k === symBase || k === c.symbol || k.endsWith(':' + c.symbol) || k.endsWith(':' + symBase));
                                const deployStatus = (botId && c.bot_deploy_statuses?.[botId]) || c.deploy_status || '';
                                let dLabel = 'PENDING', dColor = '#6B7280', dBg = 'rgba(107,114,128,0.08)';
                                if (isDeployed || deployStatus === 'ACTIVE') { dLabel = 'DEPLOYED'; dColor = '#06B6D4'; dBg = 'rgba(6,182,212,0.12)'; }
                                else if (deployStatus.startsWith('FILTERED')) { dLabel = 'NOT ELIGIBLE'; dColor = '#F59E0B'; dBg = 'rgba(245,158,11,0.08)'; }
                                else if (action.includes('SEGMENT POOL SKIP') || action.includes('DIRECTION GATE SKIP')) { dLabel = 'OUT OF POOL'; dColor = '#F59E0B'; dBg = 'rgba(245,158,11,0.08)'; }
                                else if (isE) { dLabel = 'READY'; dColor = '#22C55E'; dBg = 'rgba(34,197,94,0.12)'; }
                                else if (action.includes('SKIP') || action.includes('VETO') || action.includes('CONFLICT') || action.includes('CRASH')) { dLabel = 'NOT ELIGIBLE'; dColor = '#EF4444'; dBg = 'rgba(239,68,68,0.08)'; }

                                return (
                                    <tr key={c.symbol}
                                        style={{ borderBottom: '1px solid rgba(0,229,255,0.04)', background: isE ? 'rgba(0,255,136,0.03)' : 'transparent', transition: 'background 0.2s, box-shadow 0.2s' }}
                                        onMouseEnter={e => (e.currentTarget.style.background = isE ? 'rgba(0,255,136,0.06)' : 'rgba(0,229,255,0.04)')}
                                        onMouseLeave={e => (e.currentTarget.style.background = isE ? 'rgba(0,255,136,0.03)' : 'transparent')}>
                                        <td style={{ padding: '8px 8px', color: 'rgba(0,229,255,0.3)', fontSize: 10, fontWeight: 600, fontFamily: 'var(--font-mono, monospace)' }}>{idx + 1}</td>
                                        <td style={{ padding: '8px 8px' }}><div style={{ fontWeight: 800, color: '#E8EDF5', fontSize: 14, fontFamily: 'var(--font-mono, monospace)', letterSpacing: '-0.3px' }}>{(c.symbol || '').replace('USDT', '')}</div></td>
                                        <td style={{ padding: '8px 8px', textAlign: 'center' }}>
                                            {(() => {
                                                const seg = getSegment(c.symbol || '');
                                                const segColors: Record<string, { bg: string; color: string }> = {
                                                    L1: { bg: 'rgba(139,92,246,0.12)', color: '#A78BFA' },
                                                    L2: { bg: 'rgba(6,182,212,0.12)', color: '#22D3EE' },
                                                    DeFi: { bg: 'rgba(16,185,129,0.12)', color: '#34D399' },
                                                    Gaming: { bg: 'rgba(245,158,11,0.12)', color: '#FBBF24' },
                                                    AI: { bg: 'rgba(236,72,153,0.12)', color: '#F472B6' },
                                                    RWA: { bg: 'rgba(59,130,246,0.12)', color: '#60A5FA' },
                                                };
                                                const sc = segColors[seg] || { bg: 'rgba(107,114,128,0.10)', color: '#9CA3AF' };
                                                return <span style={{ background: sc.bg, color: sc.color, padding: '3px 9px', borderRadius: 8, fontSize: 10, fontWeight: 700 }}>{seg || '—'}</span>;
                                            })()}
                                        </td>
                                        <td style={{ padding: '8px 8px', textAlign: 'center' }}><span style={{ background: regBg, color: regColor(regime), padding: '3px 10px', borderRadius: 10, fontSize: 10, fontWeight: 700, textShadow: `0 0 6px ${regColor(regime)}66` }}>{regime}</span></td>
                                        <td style={{ padding: '8px 8px', textAlign: 'center', fontWeight: 800, fontSize: 14, fontFamily: 'var(--font-mono, monospace)', color: conf > 80 ? '#00FF88' : conf > 60 ? '#00E5FF' : conf > 40 ? '#FFB300' : '#4B5563', textShadow: conf > 80 ? '0 0 8px rgba(0,255,136,0.4)' : undefined }}>{conf.toFixed(1)}%</td>
                                        <td style={{ padding: '8px 8px', textAlign: 'center' }}><span style={{ background: dBg, color: dColor, padding: '3px 10px', borderRadius: 10, fontSize: 10, fontWeight: 700 }}>{dLabel}</span></td>
                                        <td style={{ padding: '8px 8px', fontSize: 12, color: 'rgba(180,200,220,0.6)', maxWidth: 200 }}>{getReason(c)}</td>
                                        <td style={{ padding: '8px 8px', textAlign: 'center', fontFamily: 'var(--font-mono, monospace)', fontSize: 12, fontWeight: 700, color: '#A78BFA' }}>{liveMulti?.cycle || '—'}</td>
                                        <td style={{ padding: '8px 8px', textAlign: 'center', fontFamily: 'var(--font-mono, monospace)', fontSize: 11, color: 'rgba(0,229,255,0.3)' }}>{formatIST(lastCycle)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}


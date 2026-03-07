'use client';

import { useState, useEffect } from 'react';

const TIMEFRAMES = [
    { label: '5m', interval: '5m', limit: 96 },
    { label: '15m', interval: '15m', limit: 96 },
    { label: '1H', interval: '1h', limit: 96 },
    { label: '4H', interval: '4h', limit: 96 },
    { label: '1D', interval: '1d', limit: 90 },
    { label: '1W', interval: '1w', limit: 52 },
    { label: '1M', interval: '1M', limit: 24 },
];

interface Candle {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export function BtcCandlestickChart() {
    const [tf, setTf] = useState('1h');
    const [candles, setCandles] = useState<Candle[]>([]);
    const [loading, setLoading] = useState(true);
    const [currentPrice, setCurrentPrice] = useState<number | null>(null);
    const [priceChange, setPriceChange] = useState(0);

    useEffect(() => {
        const selected = TIMEFRAMES.find(t => t.interval === tf) || TIMEFRAMES[2];
        setLoading(true);
        fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${selected.interval}&limit=${selected.limit}`)
            .then(r => r.json())
            .then((data: any[]) => {
                const parsed: Candle[] = data.map(k => ({
                    time: k[0],
                    open: parseFloat(k[1]),
                    high: parseFloat(k[2]),
                    low: parseFloat(k[3]),
                    close: parseFloat(k[4]),
                    volume: parseFloat(k[5]),
                }));
                setCandles(parsed);
                if (parsed.length > 0) {
                    const last = parsed[parsed.length - 1];
                    setCurrentPrice(last.close);
                    const first = parsed[0];
                    setPriceChange(((last.close - first.open) / first.open) * 100);
                }
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, [tf]);

    // Auto-refresh every 10s
    useEffect(() => {
        const timer = setInterval(() => {
            const selected = TIMEFRAMES.find(t => t.interval === tf) || TIMEFRAMES[2];
            fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${selected.interval}&limit=${selected.limit}`)
                .then(r => r.json())
                .then((data: any[]) => {
                    const parsed: Candle[] = data.map(k => ({
                        time: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]),
                        low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]),
                    }));
                    setCandles(parsed);
                    if (parsed.length > 0) {
                        setCurrentPrice(parsed[parsed.length - 1].close);
                        setPriceChange(((parsed[parsed.length - 1].close - parsed[0].open) / parsed[0].open) * 100);
                    }
                })
                .catch(() => { });
        }, 10000);
        return () => clearInterval(timer);
    }, [tf]);

    if (loading && candles.length === 0) {
        return (
            <div style={{
                background: 'linear-gradient(135deg, rgba(17,24,39,0.95), rgba(15,23,42,0.9))',
                border: '1px solid rgba(255,255,255,0.06)', borderRadius: '20px',
                padding: '40px', textAlign: 'center', color: '#6B7280',
            }}>
                Loading BTC chart...
            </div>
        );
    }

    // Chart dimensions
    const W = 960, H = 320, PADL = 65, PADR = 65, PADT = 15, PADB = 50;
    const chartW = W - PADL - PADR;
    const chartH = H - PADT - PADB;
    const volH = chartH * 0.2; // 20% for volume

    if (candles.length < 2) return null;

    const allHigh = Math.max(...candles.map(c => c.high));
    const allLow = Math.min(...candles.map(c => c.low));
    const priceRange = allHigh - allLow || 1;
    const padPrice = priceRange * 0.05;
    const yMin = allLow - padPrice;
    const yMax = allHigh + padPrice;
    const yRange = yMax - yMin;

    const maxVol = Math.max(...candles.map(c => c.volume));

    const candleW = Math.max(1, (chartW / candles.length) * 0.7);
    const gap = (chartW / candles.length);

    const toX = (i: number) => PADL + i * gap + gap / 2;
    const toY = (price: number) => PADT + (1 - (price - yMin) / yRange) * (chartH - volH);
    const toVolY = (vol: number) => PADT + chartH - (vol / maxVol) * volH;

    // Grid
    const gridCount = 5;
    const gridValues = Array.from({ length: gridCount }, (_, i) => yMin + (yRange * i) / (gridCount - 1));

    // Date labels
    const labelCount = Math.min(6, candles.length);
    const labelStep = Math.floor(candles.length / labelCount);
    const fmtTime = (ts: number) => {
        const d = new Date(ts);
        if (tf === '1d' || tf === '1w' || tf === '1M') {
            return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
        }
        return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
    };

    return (
        <div style={{
            background: 'linear-gradient(135deg, rgba(17,24,39,0.95) 0%, rgba(15,23,42,0.9) 100%)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '20px',
            overflow: 'hidden',
        }}>
            {/* Header */}
            <div style={{
                padding: '16px 24px 0 24px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                        fontSize: '13px', fontWeight: 800, textTransform: 'uppercase' as const,
                        letterSpacing: '2px', color: '#F59E0B',
                    }}>₿ BTC/USDT</div>
                    {currentPrice && (
                        <span style={{ fontSize: '20px', fontWeight: 800, color: '#E5E7EB', fontFamily: 'monospace' }}>
                            ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                    )}
                    <span style={{
                        fontSize: '12px', fontWeight: 700, fontFamily: 'monospace',
                        color: priceChange >= 0 ? '#22C55E' : '#EF4444',
                    }}>
                        {priceChange >= 0 ? '▲' : '▼'} {Math.abs(priceChange).toFixed(2)}%
                    </span>
                </div>
                {/* Timeframe selector */}
                <div style={{ display: 'flex', gap: '2px', background: 'rgba(255,255,255,0.04)', borderRadius: '8px', padding: '2px' }}>
                    {TIMEFRAMES.map(t => (
                        <button key={t.interval} onClick={() => setTf(t.interval)} style={{
                            padding: '4px 10px', borderRadius: '6px', border: 'none', cursor: 'pointer',
                            fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px',
                            background: tf === t.interval ? 'rgba(245,158,11,0.2)' : 'transparent',
                            color: tf === t.interval ? '#F59E0B' : '#6B7280',
                            transition: 'all 0.15s',
                        }}>
                            {t.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Chart */}
            <div style={{ padding: '8px 8px 16px 8px' }}>
                <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '300px' }}>
                    {/* Price grid */}
                    {gridValues.map((v, i) => (
                        <g key={i}>
                            <line x1={PADL} y1={toY(v)} x2={W - PADR} y2={toY(v)}
                                stroke="rgba(255,255,255,0.04)" strokeDasharray="4,6" />
                            <text x={PADL - 8} y={toY(v) + 3.5} fontSize="9" fill="#4B5563"
                                textAnchor="end" fontFamily="monospace">
                                ${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </text>
                        </g>
                    ))}

                    {/* Volume bars */}
                    {candles.map((c, i) => (
                        <rect key={`vol-${i}`}
                            x={toX(i) - candleW / 2}
                            y={toVolY(c.volume)}
                            width={candleW}
                            height={PADT + chartH - toVolY(c.volume)}
                            fill={c.close >= c.open ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'}
                            rx="1"
                        />
                    ))}

                    {/* Candlesticks */}
                    {candles.map((c, i) => {
                        const bullish = c.close >= c.open;
                        const color = bullish ? '#22C55E' : '#EF4444';
                        const bodyTop = Math.min(toY(c.open), toY(c.close));
                        const bodyBottom = Math.max(toY(c.open), toY(c.close));
                        const bodyH = Math.max(1, bodyBottom - bodyTop);
                        return (
                            <g key={i}>
                                {/* Wick */}
                                <line x1={toX(i)} y1={toY(c.high)} x2={toX(i)} y2={toY(c.low)}
                                    stroke={color} strokeWidth="1" opacity="0.7" />
                                {/* Body */}
                                <rect
                                    x={toX(i) - candleW / 2}
                                    y={bodyTop}
                                    width={candleW}
                                    height={bodyH}
                                    fill={bullish ? color : color}
                                    stroke={color}
                                    strokeWidth="0.5"
                                    rx="1"
                                    opacity={bullish ? 0.8 : 1}
                                />
                            </g>
                        );
                    })}

                    {/* Current price line */}
                    {currentPrice && (
                        <>
                            <line x1={PADL} y1={toY(currentPrice)} x2={W - PADR} y2={toY(currentPrice)}
                                stroke="#F59E0B" strokeWidth="1" strokeDasharray="3,3" opacity="0.6" />
                            <rect x={W - PADR + 2} y={toY(currentPrice) - 8} width="58" height="16" rx="4"
                                fill="rgba(245,158,11,0.2)" stroke="rgba(245,158,11,0.3)" strokeWidth="0.5" />
                            <text x={W - PADR + 6} y={toY(currentPrice) + 4} fontSize="9" fill="#F59E0B"
                                fontFamily="monospace" fontWeight="700">
                                ${currentPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </text>
                        </>
                    )}

                    {/* Date labels */}
                    {Array.from({ length: labelCount }, (_, i) => {
                        const idx = Math.min(i * labelStep, candles.length - 1);
                        return (
                            <text key={i} x={toX(idx)} y={H - 8} fontSize="9" fill="#4B5563"
                                textAnchor="middle" fontFamily="monospace">
                                {fmtTime(candles[idx].time)}
                            </text>
                        );
                    })}
                </svg>
            </div>
        </div>
    );
}

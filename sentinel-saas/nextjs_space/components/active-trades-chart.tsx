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

export function ActiveTradesChart({ activeTrades }: { activeTrades: any[] }) {
    const [tf, setTf] = useState('5m');
    const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
    const [candles, setCandles] = useState<Candle[]>([]);
    const [loading, setLoading] = useState(false);
    const [currentPrice, setCurrentPrice] = useState<number | null>(null);
    const [priceChange, setPriceChange] = useState(0);

    const currentTrade = activeTrades.find(t => t.id === selectedTradeId) || activeTrades[0];

    useEffect(() => {
        if (activeTrades.length > 0 && !selectedTradeId) {
            setSelectedTradeId(activeTrades[0].id);
        }
    }, [activeTrades, selectedTradeId]);

    useEffect(() => {
        if (!currentTrade || !currentTrade.symbol) {
             setCandles([]);
             return;
        }
        let sym = currentTrade.symbol;
        if (!sym.endsWith('USDT')) sym += 'USDT'; 
        
        const selected = TIMEFRAMES.find(t => t.interval === tf) || TIMEFRAMES[0];
        setLoading(true);
        fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${selected.interval}&limit=${selected.limit}`)
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
    }, [tf, currentTrade?.symbol]);

    // Auto-refresh every 10s
    useEffect(() => {
        const timer = setInterval(() => {
            if (!currentTrade || !currentTrade.symbol) return;
            let sym = currentTrade.symbol;
            if (!sym.endsWith('USDT')) sym += 'USDT';
            
            const selected = TIMEFRAMES.find(t => t.interval === tf) || TIMEFRAMES[0];
            fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${selected.interval}&limit=${selected.limit}`)
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
    }, [tf, currentTrade?.symbol]);

    if (!activeTrades || activeTrades.length === 0) {
        return (
            <div style={{
                background: 'linear-gradient(135deg, rgba(17,24,39,0.95), rgba(15,23,42,0.9))',
                border: '1px solid rgba(255,255,255,0.06)', borderRadius: '20px',
                padding: '40px', textAlign: 'center', color: '#6B7280', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
            }}>
                <div style={{ fontSize: '18px', fontWeight: 600, color: '#9CA3AF', marginBottom: '8px' }}>No Active Trades</div>
                <div style={{ fontSize: '13px' }}>The market is currently being monitored for new opportunities.</div>
            </div>
        );
    }

    if (loading && candles.length === 0) {
        return (
            <div style={{
                background: 'linear-gradient(135deg, rgba(17,24,39,0.95), rgba(15,23,42,0.9))',
                border: '1px solid rgba(255,255,255,0.06)', borderRadius: '20px',
                padding: '40px', textAlign: 'center', color: '#6B7280',
            }}>
                Loading chart...
            </div>
        );
    }

    // Chart dimensions
    const W = 960, H = 340, PADL = 65, PADR = 65, PADT = 15, PADB = 50;
    const chartW = W - PADL - PADR;
    const chartH = H - PADT - PADB;
    const volH = chartH * 0.2; // 20% for volume

    if (candles.length < 2) return null;

    // Calculate Y range encompassing candles + entry/sl/tp
    let allHigh = Math.max(...candles.map(c => c.high));
    let allLow = Math.min(...candles.map(c => c.low));
    
    if (currentTrade) {
        if (currentTrade.entryPrice) {
             allHigh = Math.max(allHigh, currentTrade.entryPrice);
             allLow = Math.min(allLow, currentTrade.entryPrice);
        }
        if (currentTrade.stopLoss) {
             allHigh = Math.max(allHigh, currentTrade.stopLoss);
             allLow = Math.min(allLow, currentTrade.stopLoss);
        }
        if (currentTrade.takeProfit) {
             allHigh = Math.max(allHigh, currentTrade.takeProfit);
             allLow = Math.min(allLow, currentTrade.takeProfit);
        }
    }

    const priceRange = allHigh - allLow || 1;
    const padPrice = priceRange * 0.10; // Extra padding
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
                display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px'
            }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        {activeTrades.map(trade => {
                             const isActive = currentTrade?.id === trade.id;
                             const isTrLong = (trade.position || '').toLowerCase() === 'buy' || (trade.position || '').toLowerCase() === 'long';
                             return (
                                <button key={trade.id} onClick={() => setSelectedTradeId(trade.id)} style={{
                                    padding: '6px 10px', borderRadius: '8px', border: `1px solid ${isActive ? (isTrLong ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)') : 'rgba(255,255,255,0.06)'}`,
                                    cursor: 'pointer', fontSize: '12px', fontWeight: 700, letterSpacing: '0.5px',
                                    background: isActive ? (isTrLong ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)') : 'rgba(255,255,255,0.02)',
                                    color: isActive ? '#FFFFFF' : '#9CA3AF',
                                    transition: 'all 0.15s',
                                }}>
                                    {trade.coin} 
                                    <span style={{ color: isActive ? (isTrLong ? '#4ADE80' : '#F87171') : (isTrLong ? '#22C55E' : '#EF4444'), marginLeft: '6px' }}>{isTrLong ? 'LONG' : 'SHORT'}</span>
                                </button>
                             );
                        })}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                        {currentTrade && currentPrice ? (
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
                                 <span style={{ fontSize: '20px', fontWeight: 800, color: '#E5E7EB', fontFamily: 'monospace' }}>
                                     ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                                 </span>
                                 <span style={{
                                     fontSize: '13px', fontWeight: 700, fontFamily: 'monospace',
                                     color: priceChange >= 0 ? '#22C55E' : '#EF4444',
                                 }}>
                                     {priceChange >= 0 ? '▲' : '▼'} {Math.abs(priceChange).toFixed(2)}%
                                 </span>
                            </div>
                        ) : <div/>}
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
                </div>
            </div>

            {/* Chart */}
            <div style={{ padding: '8px 8px 16px 8px', marginTop: '12px' }}>
                <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '320px' }}>
                    {/* Price grid */}
                    {gridValues.map((v, i) => (
                        <g key={i}>
                            <line x1={PADL} y1={toY(v)} x2={W - PADR} y2={toY(v)}
                                stroke="rgba(255,255,255,0.04)" strokeDasharray="4,6" />
                            <text x={PADL - 8} y={toY(v) + 3.5} fontSize="9" fill="#4B5563"
                                textAnchor="end" fontFamily="monospace">
                                ${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </text>
                        </g>
                    ))}

                    {/* Trade Levels (Entry, SL, TP) */}
                    {currentTrade && (
                        <>
                            {currentTrade.takeProfit > 0 && (
                                <g>
                                    <line x1={PADL} y1={toY(currentTrade.takeProfit)} x2={W - PADR} y2={toY(currentTrade.takeProfit)}
                                        stroke="#10B981" strokeWidth="1.5" strokeDasharray="5,5" opacity="0.9" />
                                    <rect x={W - PADR + 2} y={toY(currentTrade.takeProfit) - 8} width="60" height="16" rx="2"
                                        fill="rgba(16,185,129,0.2)" stroke="rgba(16,185,129,0.4)" strokeWidth="0.5" />
                                    <text x={W - PADR + 6} y={toY(currentTrade.takeProfit) + 3} fontSize="9" fill="#6EE7B7" fontFamily="monospace" fontWeight="600">
                                        TP: {currentTrade.takeProfit.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                                    </text>
                                </g>
                            )}
                            {currentTrade.stopLoss > 0 && (
                                <g>
                                    <line x1={PADL} y1={toY(currentTrade.stopLoss)} x2={W - PADR} y2={toY(currentTrade.stopLoss)}
                                        stroke="#EF4444" strokeWidth="1.5" strokeDasharray="5,5" opacity="0.9" />
                                    <rect x={W - PADR + 2} y={toY(currentTrade.stopLoss) - 8} width="60" height="16" rx="2"
                                        fill="rgba(239,68,68,0.2)" stroke="rgba(239,68,68,0.4)" strokeWidth="0.5" />
                                    <text x={W - PADR + 6} y={toY(currentTrade.stopLoss) + 3} fontSize="9" fill="#FCA5A5" fontFamily="monospace" fontWeight="600">
                                        SL: {currentTrade.stopLoss.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                                    </text>
                                </g>
                            )}
                            {currentTrade.entryPrice > 0 && (
                                <g>
                                    <line x1={PADL} y1={toY(currentTrade.entryPrice)} x2={W - PADR} y2={toY(currentTrade.entryPrice)}
                                        stroke="#3B82F6" strokeWidth="1" strokeDasharray="4,4" opacity="0.8" />
                                    <rect x={W - PADR + 2} y={toY(currentTrade.entryPrice) - 8} width="60" height="16" rx="2"
                                        fill="rgba(59,130,246,0.2)" stroke="rgba(59,130,246,0.4)" strokeWidth="0.5" />
                                    <text x={W - PADR + 6} y={toY(currentTrade.entryPrice) + 3} fontSize="9" fill="#93C5FD" fontFamily="monospace" fontWeight="600">
                                        E: {currentTrade.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                                    </text>
                                </g>
                            )}
                        </>
                    )}

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
                                stroke="#F59E0B" strokeWidth="1" strokeDasharray="3,3" opacity="0.4" />
                            <rect x={W - PADR + 2} y={toY(currentPrice) - 8} width="60" height="16" rx="2"
                                fill="rgba(245,158,11,0.2)" stroke="rgba(245,158,11,0.3)" strokeWidth="0.5" />
                            <text x={W - PADR + 6} y={toY(currentPrice) + 4} fontSize="9" fill="#F59E0B"
                                fontFamily="monospace" fontWeight="700">
                                C: {currentPrice.toLocaleString(undefined, { maximumFractionDigits: 4 })}
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

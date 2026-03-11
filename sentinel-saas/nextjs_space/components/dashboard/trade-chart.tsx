'use client';

/**
 * TradeChart — Real-time candlestick chart powered by lightweight-charts v4
 * ─────────────────────────────────────────────────────────────────────────
 * • Default: BTCUSDT · 5m
 * • Click any deployed coin pill → chart switches to that coin
 * • Shows horizontal price lines for Entry, SL, TP when trade data provided
 * • Auto-refreshes every 10 seconds with latest kline
 * • Dark glass theme matching the app palette
 */

import { useEffect, useRef, useState, useCallback } from 'react';

type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

interface TradeLevels {
    entry?: number;
    sl?: number;
    tp?: number;
    side?: string; // 'LONG' | 'SHORT'
}

interface TradeChartProps {
    /** Currently selected symbol e.g. 'BTCUSDT' */
    symbol?: string;
    /** Active trade levels to draw as horizontal lines */
    levels?: TradeLevels;
    /** All deployed coins to show as clickable tabs */
    coins?: Array<{ symbol: string; side?: string; entry?: number; sl?: number; tp?: number }>;
    /** Called when user clicks a coin tab */
    onCoinSelect?: (symbol: string) => void;
}

const TF_OPTIONS: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];
const BINANCE_KLINES = 'https://api.binance.com/api/v3/klines';

async function fetchKlines(symbol: string, interval: Timeframe, limit = 200) {
    const url = `${BINANCE_KLINES}?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Binance API ${res.status}`);
    const raw: any[][] = await res.json();
    return raw.map(k => ({
        time: Math.floor(k[0] / 1000) as any,
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
    }));
}

export function TradeChart({ symbol: propSymbol, levels, coins = [], onCoinSelect }: TradeChartProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<any>(null);
    const seriesRef = useRef<any>(null);
    const linesRef = useRef<any[]>([]);

    const [selectedSymbol, setSelectedSymbol] = useState(propSymbol || 'BTCUSDT');
    const [selectedTf, setSelectedTf] = useState<Timeframe>('5m');
    const [currentPrice, setCurrentPrice] = useState<number | null>(null);
    const [priceChange, setPriceChange] = useState<number>(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Sync external symbol prop
    useEffect(() => {
        if (propSymbol && propSymbol !== selectedSymbol) setSelectedSymbol(propSymbol);
    }, [propSymbol]);

    // ── Init chart ──────────────────────────────────────────────────────────
    useEffect(() => {
        if (!containerRef.current) return;
        let chart: any;

        import('lightweight-charts').then(({ createChart, CrosshairMode }) => {
            if (!containerRef.current) return;

            chart = createChart(containerRef.current, {
                width: containerRef.current.clientWidth,
                height: 420,
                layout: {
                    background: { color: 'rgba(5,10,18,0)' },
                    textColor: '#9CA3AF',
                    fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
                    fontSize: 11,
                },
                grid: {
                    vertLines: { color: 'rgba(255,255,255,0.04)' },
                    horzLines: { color: 'rgba(255,255,255,0.04)' },
                },
                crosshair: { mode: CrosshairMode.Normal },
                rightPriceScale: {
                    borderColor: 'rgba(255,255,255,0.06)',
                    textColor: '#6B7280',
                    scaleMargins: { top: 0.1, bottom: 0.1 },
                },
                timeScale: {
                    borderColor: 'rgba(255,255,255,0.06)',
                    timeVisible: true,
                    secondsVisible: false,
                },
                handleScroll: { mouseWheel: true, pressedMouseMove: true },
                handleScale: { mouseWheel: true, pinch: true },
            });

            const series = chart.addCandlestickSeries({
                upColor: '#00FF88',
                downColor: '#FF3B5C',
                borderUpColor: '#00FF88',
                borderDownColor: '#FF3B5C',
                wickUpColor: 'rgba(0,255,136,0.6)',
                wickDownColor: 'rgba(255,59,92,0.6)',
            });

            chartRef.current = chart;
            seriesRef.current = series;

            // Responsive resize
            const ro = new ResizeObserver(() => {
                if (containerRef.current && chart) {
                    chart.resize(containerRef.current.clientWidth, 420);
                }
            });
            ro.observe(containerRef.current);

            return () => { ro.disconnect(); };
        });

        return () => { if (chart) chart.remove(); };
    }, []);

    // ── Draw price lines (Entry / SL / TP) ──────────────────────────────────
    const drawPriceLines = useCallback((lvl?: TradeLevels) => {
        if (!seriesRef.current) return;
        // Remove old lines
        linesRef.current.forEach(l => { try { seriesRef.current.removePriceLine(l); } catch { } });
        linesRef.current = [];
        if (!lvl) return;

        const add = (price: number, color: string, title: string, dash = false) => {
            const l = seriesRef.current.createPriceLine({
                price,
                color,
                lineWidth: 1,
                lineStyle: dash ? 2 : 0, // 0=Solid, 2=Dashed
                axisLabelVisible: true,
                title,
            });
            linesRef.current.push(l);
        };

        if (lvl.entry && lvl.entry > 0) add(lvl.entry, '#00E5FF', `ENTRY ${lvl.entry.toFixed(4)}`);
        if (lvl.sl && lvl.sl > 0) add(lvl.sl, '#FF3B5C', `SL ${lvl.sl.toFixed(4)}`, true);
        if (lvl.tp && lvl.tp > 0) add(lvl.tp, '#00FF88', `TARGET ${lvl.tp.toFixed(4)}`, true);
    }, []);

    // ── Load klines ──────────────────────────────────────────────────────────
    const loadKlines = useCallback(async (sym: string, tf: Timeframe) => {
        if (!seriesRef.current) return;
        setLoading(true);
        setError('');
        try {
            const data = await fetchKlines(sym, tf, 200);
            if (!seriesRef.current) return;
            seriesRef.current.setData(data);
            chartRef.current?.timeScale().fitContent();
            const last = data[data.length - 1];
            setCurrentPrice(last.close);
            const first = data[0];
            setPriceChange(((last.close - first.open) / first.open) * 100);
            drawPriceLines(levels);
        } catch (e: any) {
            setError(e.message || 'Failed to load chart data');
        } finally {
            setLoading(false);
        }
    }, [levels, drawPriceLines]);

    // Reload whenever symbol or timeframe changes
    useEffect(() => {
        loadKlines(selectedSymbol, selectedTf);
    }, [selectedSymbol, selectedTf, loadKlines]);

    // ── Auto-refresh last candle every 10s ──────────────────────────────────
    useEffect(() => {
        if (!seriesRef.current) return;
        const id = setInterval(async () => {
            try {
                const data = await fetchKlines(selectedSymbol, selectedTf, 2);
                if (!seriesRef.current) return;
                const last = data[data.length - 1];
                seriesRef.current.update(last);
                setCurrentPrice(last.close);
            } catch { }
        }, 10_000);
        return () => clearInterval(id);
    }, [selectedSymbol, selectedTf]);

    // Redraw lines when levels prop changes
    useEffect(() => {
        drawPriceLines(levels);
    }, [levels, drawPriceLines]);

    // ── Coin tab click ───────────────────────────────────────────────────────
    const handleCoinClick = (sym: string, coinLevels?: TradeLevels) => {
        setSelectedSymbol(sym);
        onCoinSelect?.(sym);
    };

    const ticker = selectedSymbol.replace('USDT', '');
    const isUp = priceChange >= 0;

    return (
        <div style={{
            background: 'rgba(5,10,18,0.88)',
            backdropFilter: 'blur(20px)',
            border: '1px solid rgba(0,229,255,0.10)',
            borderRadius: 16,
            overflow: 'hidden',
        }}>
            {/* ── Header ── */}
            <div style={{
                padding: '12px 16px',
                background: 'linear-gradient(135deg,rgba(0,229,255,0.06) 0%,rgba(0,0,0,0) 100%)',
                borderBottom: '1px solid rgba(0,229,255,0.08)',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
            }}>
                {/* Symbol + price */}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 16, fontWeight: 800, color: '#E8EDF5', letterSpacing: '-0.5px' }}>{ticker}</span>
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>/USDT</span>
                    {currentPrice !== null && (
                        <span style={{ fontSize: 15, fontWeight: 700, color: '#E8EDF5', fontFamily: 'var(--font-mono)', marginLeft: 8 }}>
                            ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                        </span>
                    )}
                    {currentPrice !== null && (
                        <span style={{
                            fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)',
                            color: isUp ? '#00FF88' : '#FF3B5C',
                            background: isUp ? 'rgba(0,255,136,0.08)' : 'rgba(255,59,92,0.08)',
                            padding: '1px 6px', borderRadius: 4,
                        }}>
                            {isUp ? '▲' : '▼'} {Math.abs(priceChange).toFixed(2)}%
                        </span>
                    )}
                    {/* Live dot */}
                    <span className="live-dot" style={{ marginLeft: 4, width: 6, height: 6 }} />
                </div>

                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {/* Timeframe selector */}
                    {TF_OPTIONS.map(tf => (
                        <button key={tf} onClick={() => setSelectedTf(tf)} style={{
                            padding: '3px 8px',
                            borderRadius: 5,
                            border: `1px solid ${selectedTf === tf ? 'rgba(0,229,255,0.4)' : 'rgba(255,255,255,0.07)'}`,
                            background: selectedTf === tf ? 'rgba(0,229,255,0.12)' : 'rgba(255,255,255,0.03)',
                            color: selectedTf === tf ? '#00E5FF' : '#6B7280',
                            fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
                        }}>{tf}</button>
                    ))}
                </div>
            </div>

            {/* ── Coin row ── */}
            {coins.length > 0 && (
                <div style={{
                    padding: '8px 16px',
                    display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                }}>
                    <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontWeight: 600, marginRight: 4 }}>POSITIONS</span>

                    {/* Default BTC tab */}
                    <button onClick={() => handleCoinClick('BTCUSDT')} style={{
                        padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                        border: `1px solid ${selectedSymbol === 'BTCUSDT' ? 'rgba(0,229,255,0.4)' : 'rgba(255,255,255,0.07)'}`,
                        background: selectedSymbol === 'BTCUSDT' ? 'rgba(0,229,255,0.10)' : 'rgba(255,255,255,0.03)',
                        color: selectedSymbol === 'BTCUSDT' ? '#00E5FF' : '#6B7280',
                        transition: 'all 0.15s',
                    }}>BTC</button>

                    {coins.map(c => {
                        const sym = c.symbol || '';
                        const tick = sym.replace('USDT', '');
                        const isLong = (c.side || '').toUpperCase() === 'LONG' || (c.side || '').toUpperCase() === 'BUY';
                        const isShort = (c.side || '').toUpperCase() === 'SHORT' || (c.side || '').toUpperCase() === 'SELL';
                        const isSelected = selectedSymbol === sym;
                        const dotColor = isLong ? '#00FF88' : isShort ? '#FF3B5C' : '#6B7280';

                        return (
                            <button key={sym} onClick={() => handleCoinClick(sym, { entry: c.entry, sl: c.sl, tp: c.tp, side: c.side })} style={{
                                display: 'flex', alignItems: 'center', gap: 5,
                                padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                                border: `1px solid ${isSelected ? `${dotColor}40` : 'rgba(255,255,255,0.07)'}`,
                                background: isSelected ? `${dotColor}12` : 'rgba(255,255,255,0.03)',
                                color: isSelected ? dotColor : '#6B7280',
                                transition: 'all 0.15s',
                            }}>
                                <span style={{ width: 5, height: 5, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
                                {tick}
                                {c.side && (
                                    <span style={{ fontSize: 9, opacity: 0.7 }}>{isLong ? '↑' : '↓'}</span>
                                )}
                            </button>
                        );
                    })}
                </div>
            )}

            {/* ── Legend: price lines ── */}
            {levels && (levels.entry || levels.sl || levels.tp) && (
                <div style={{
                    padding: '6px 16px', display: 'flex', gap: 16, alignItems: 'center',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    background: 'rgba(0,0,0,0.2)',
                }}>
                    {levels.entry && <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#00E5FF', fontWeight: 700 }}>── ENTRY ${levels.entry.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>}
                    {levels.tp && <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#00FF88', fontWeight: 700 }}>╌ TARGET ${levels.tp.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>}
                    {levels.sl && <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: '#FF3B5C', fontWeight: 700 }}>╌ SL ${levels.sl.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span>}
                </div>
            )}

            {/* ── Chart canvas ── */}
            <div style={{ position: 'relative' }}>
                <div ref={containerRef} style={{ width: '100%', height: 420, display: 'block' }} />

                {/* Loading overlay */}
                {loading && (
                    <div style={{
                        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'rgba(5,10,18,0.6)', backdropFilter: 'blur(4px)',
                    }}>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 11, color: '#00E5FF', fontFamily: 'var(--font-mono)', animation: 'livePulse 1s ease-in-out infinite' }}>
                                Loading {selectedSymbol} {selectedTf}…
                            </div>
                        </div>
                    </div>
                )}

                {/* Error overlay */}
                {error && !loading && (
                    <div style={{
                        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'rgba(5,10,18,0.7)',
                    }}>
                        <div style={{ fontSize: 11, color: '#FF3B5C', fontFamily: 'var(--font-mono)' }}>⚠ {error}</div>
                    </div>
                )}
            </div>

            {/* Footer */}
            <div style={{
                padding: '6px 16px', borderTop: '1px solid rgba(255,255,255,0.04)',
                display: 'flex', alignItems: 'center', gap: 12,
            }}>
                <span style={{ fontSize: 9, color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                    Live data via Binance · refreshes every 10s
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--color-text-muted)' }}>
                    lightweight-charts v4
                </span>
            </div>
        </div>
    );
}

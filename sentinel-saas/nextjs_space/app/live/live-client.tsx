'use client';

import { useState, useEffect } from 'react';
import { Activity, ShieldAlert, Radio, RefreshCw, PowerOff, ShieldX, TerminalSquare, Zap, AlertTriangle, PauseCircle, PlayCircle, BarChart2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { Header } from '@/components/header';

export function LiveClient() {
    const [selectedExchange, setSelectedExchange] = useState<'binance' | 'coindcx'>('binance');
    const [balance, setBalance] = useState<{ 
        binance: number | null, binanceConnected: boolean, binanceLabel: string | null,
        coindcx: number | null, coindcxConnected: boolean, coindcxLabel: string | null 
    } | null>(null);
    const [engineState, setEngineState] = useState<any>(null);
    const [prismaActiveCount, setPrismaActiveCount] = useState<number>(0);
    const [pingHistory, setPingHistory] = useState<number[]>([]);
    const [heatmap, setHeatmap] = useState<{ symbol: string; pnl: number }[]>([]);
    const [logs, setLogs] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [stoppingAll, setStoppingAll] = useState(false);
    const [exitingAll, setExitingAll] = useState(false);
    const [pausing, setPausing] = useState(false);

    const fetchData = async () => {
        const startTime = Date.now();
        try {
            const [balRes, stateRes, logsRes, tradesRes, heatRes] = await Promise.all([
                fetch('/api/wallet-balance'),
                fetch('/api/bot-state?mode=live'),
                fetch('/api/engine-logs?mode=live&n=50'),
                fetch('/api/trades'),
                fetch('/api/trades/heatmap')
            ]);
            
            const elapsed = Date.now() - startTime;
            setPingHistory(prev => [...prev.slice(-19), elapsed]);

            if (balRes.ok) {
                const bal = await balRes.json();
                setBalance(bal);
            }
            if (stateRes.ok) {
                const state = await stateRes.json();
                setEngineState(state);
            }
            if (logsRes.ok) {
                const data = await logsRes.json();
                if (data.lines) setLogs(data.lines);
            }
            if (tradesRes.ok) {
                const data = await tradesRes.json();
                if (data.trades) {
                    const activeDb = data.trades.filter((t: any) => t.status === 'ACTIVE').length;
                    setPrismaActiveCount(activeDb);
                }
            }
            if (heatRes.ok) {
                const data = await heatRes.json();
                if (data.heatmap) setHeatmap(data.heatmap);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const t = setInterval(fetchData, 10000);
        return () => clearInterval(t);
    }, []);

    const handleStopAll = async () => {
        if (!confirm('Are you sure you want to stop all active bots?')) return;
        setStoppingAll(true);
        try {
            await fetch('/api/bots/stop-all', { method: 'POST' });
            await fetchData();
        } finally {
            setStoppingAll(false);
        }
    };

    const handleExitAll = async () => {
        if (!confirm('DANGER: This will market-close all active trades on the exchange. Proceed?')) return;
        setExitingAll(true);
        try {
            await fetch('/api/trades/exit-all', { method: 'POST' });
            await fetchData();
        } finally {
            setExitingAll(false);
        }
    };

    const handleForceSync = async () => {
        setSyncing(true);
        try {
            await fetch('/api/trades/sync', { method: 'POST' });
            await fetchData();
        } finally {
            setSyncing(false);
        }
    };

    const isEnginePaused = engineState?.engine?.status === 'paused';

    const handlePauseToggle = async () => {
        if (!confirm(`Are you sure you want to ${isEnginePaused ? 'RESUME' : 'PAUSE'} the engine?`)) return;
        setPausing(true);
        try {
            await fetch('/api/bots/toggle-pause', { 
                method: 'POST',
                body: JSON.stringify({ action: isEnginePaused ? 'resume' : 'pause' }),
                headers: { 'Content-Type': 'application/json' }
            });
            await fetchData();
        } finally {
            setPausing(false);
        }
    };

    const engineOnline = ['running', 'paused'].includes(engineState?.engine?.status);
    const isConnected = selectedExchange === 'binance' ? balance?.binanceConnected : balance?.coindcxConnected;
    const marginAmount = selectedExchange === 'binance' ? balance?.binance : balance?.coindcx;
    const apiLabel = selectedExchange === 'binance' ? balance?.binanceLabel : balance?.coindcxLabel;
    
    // Drift calculation: compare Prisma ACTIVE trades vs Engine JSON active trades.
    // Sometimes engine JSON treats 'filtered' or others internally differently, but active_trades is accurate.
    const engineActiveCount = typeof engineState?.tradebook?.active_trades === 'object' 
        ? Object.keys(engineState.tradebook.active_trades).length 
        : 0;
    const hasDrift = engineOnline && (engineActiveCount !== prismaActiveCount);

    return (
        <div className="min-h-screen bg-[var(--color-background)] pt-24 pb-12">
            <Header />
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
                
                {/* ── Page Header ── */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold flex items-center gap-3" style={{ color: '#E8EDF5', textShadow: '0 0 20px rgba(0,229,255,0.2)' }}>
                            <Activity className="w-8 h-8" color="#00E5FF" />
                            Live Deployment
                        </h1>
                        <p className="text-[var(--color-text-muted)] mt-1 font-mono text-sm tracking-wider uppercase">
                            Mission Control — Exchange Sync & Execution
                        </p>
                    </div>
                    
                    <div className="flex items-center gap-3">
                        <div className="px-4 py-2 rounded-lg" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.05)' }}>
                            <div className="flex items-center gap-2">
                                <motion.div 
                                    animate={engineOnline && !isEnginePaused ? { opacity: [0.4, 1, 0.4] } : { opacity: 1 }}
                                    transition={{ duration: 2, repeat: Infinity }}
                                    className="w-2.5 h-2.5 rounded-full" 
                                    style={{ 
                                        background: isEnginePaused ? '#FBBF24' : (engineOnline ? '#00FF88' : '#FF3B5C'), 
                                        boxShadow: `0 0 10px ${isEnginePaused ? '#FBBF24' : (engineOnline ? '#00FF88' : '#FF3B5C')}` 
                                    }} 
                                />
                                <span className="text-xs font-bold tracking-widest" style={{ color: isEnginePaused ? '#FBBF24' : (engineOnline ? '#00FF88' : '#FF3B5C') }}>
                                    {isEnginePaused ? 'ENGINE PAUSED' : (engineOnline ? 'ENGINE ONLINE' : 'ENGINE OFFLINE')}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── Main Grid ── */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    
                    {/* Main Content Area (2/3 width) */}
                    <div className="lg:col-span-2 space-y-6">
                        
                        {/* API Connection Card */}
                        <div style={{
                            background: 'linear-gradient(145deg, rgba(8,12,20,0.9) 0%, rgba(5,7,12,0.95) 100%)',
                            backdropFilter: 'blur(30px)',
                            border: '1px solid rgba(0,229,255,0.15)',
                            borderRadius: '20px',
                            padding: '24px',
                            boxShadow: '0 8px 32px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.02)'
                        }}>
                            <div className="flex items-center justify-between border-b border-[rgba(0,229,255,0.1)] pb-4 mb-6">
                                <h2 className="text-xl font-bold flex items-center gap-2 text-[#E8EDF5]">
                                    <Radio size={20} color="#00E5FF" /> Exchange Uplink
                                </h2>
                                <button onClick={fetchData} className="text-[var(--color-primary)] hover:opacity-80 transition-opacity">
                                    <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                                </button>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="p-4 rounded-xl" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.05)' }}>
                                    <div className="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Select Exchange</div>
                                    <select 
                                        value={selectedExchange}
                                        onChange={(e) => setSelectedExchange(e.target.value as 'binance' | 'coindcx')}
                                        className="w-full bg-black/40 border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-2 text-sm text-[#E8EDF5] focus:outline-none focus:border-[#00E5FF] mb-4 transition-colors font-medium"
                                    >
                                        <option value="binance">Binance Futures</option>
                                        <option value="coindcx">CoinDCX Futures</option>
                                    </select>
                                    
                                    <div className="mt-2 text-[11px] text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Available Margin</div>
                                    <div className="text-2xl font-mono text-[#00E5FF]">
                                        {isConnected 
                                            ? `$${marginAmount?.toFixed(2) || '0.00'}` 
                                            : 'Not Connected'}
                                    </div>

                                    {apiLabel && (
                                        <div className="mt-4 pt-4 border-t border-[rgba(255,255,255,0.05)]">
                                            <div className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Sub-Account Profile</div>
                                            <div className="text-xs font-bold text-[#E8EDF5] bg-black/40 inline-block px-3 py-1.5 rounded-md border border-[#00E5FF] shadow-[0_0_10px_rgba(0,229,255,0.1)]">
                                                {apiLabel}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="p-4 rounded-xl" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.05)' }}>
                                    <div className="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Status</div>
                                    {isConnected ? (
                                        <div className="text-sm text-[#00FF88] flex items-center gap-2 mt-2">
                                            <ShieldAlert size={14} color="#00FF88" /> Credentials Validated
                                        </div>
                                    ) : (
                                        <div className="text-sm text-[#FF3B5C] flex items-center gap-2 mt-2">
                                            <ShieldX size={14} color="#FF3B5C" /> Disconnected
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Execution Pulse Terminal */}
                        <div style={{
                            background: 'linear-gradient(145deg, rgba(8,12,20,0.9) 0%, rgba(5,7,12,0.95) 100%)',
                            backdropFilter: 'blur(30px)',
                            border: '1px solid rgba(0,229,255,0.15)',
                            borderRadius: '20px',
                            padding: '24px',
                            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.02)',
                            display: 'flex',
                            flexDirection: 'column',
                            height: '500px'
                        }}>
                            <div className="flex items-center justify-between border-b border-[rgba(0,229,255,0.1)] pb-4 mb-4">
                                <h2 className="text-xl font-bold flex items-center gap-2 text-[#E8EDF5]">
                                    <TerminalSquare size={20} color="#00E5FF" /> Execution Pulse
                                </h2>
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#00E5FF', boxShadow: '0 0 8px #00E5FF' }}></div>
                                    <span className="text-xs font-mono text-[#00E5FF] tracking-wider">LIVE FEED</span>
                                </div>
                            </div>
                            
                            <div className="flex-1 overflow-y-auto font-mono text-[11px] leading-relaxed pr-2 space-y-1" style={{
                                scrollbarWidth: 'thin',
                                scrollbarColor: 'rgba(0,229,255,0.2) transparent'
                            }}>
                                {logs.length > 0 ? logs.map((line, i) => {
                                    // Basic syntax highlighting for the log line
                                    const isError = line.includes('ERROR') || line.includes('CRITICAL');
                                    const isWarning = line.includes('WARNING');
                                    const isDeploy = line.includes('DEPLOYING') || line.includes('EXECUTE');
                                    
                                    let color = 'rgba(232,237,245,0.7)';
                                    if (isError) color = '#FF3B5C';
                                    else if (isWarning) color = '#FBBF24';
                                    else if (isDeploy) color = '#00FF88';
                                    
                                    return (
                                        <div key={i} style={{ color }} className="break-all hover:bg-white/5 px-2 py-0.5 rounded transition-colors">
                                            {line}
                                        </div>
                                    );
                                }) : (
                                    <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] italic">
                                        {loading ? 'Initializing uplink...' : 'Awaiting signals...'}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* 24h PnL Heatmap */}
                        <div style={{
                            background: 'linear-gradient(145deg, rgba(8,12,20,0.9) 0%, rgba(5,7,12,0.95) 100%)',
                            backdropFilter: 'blur(30px)',
                            border: '1px solid rgba(0,229,255,0.15)',
                            borderRadius: '20px',
                            padding: '24px',
                            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.02)'
                        }}>
                            <h2 className="text-xl font-bold flex items-center gap-2 text-[#E8EDF5] border-b border-[rgba(0,229,255,0.1)] pb-4 mb-4">
                                <BarChart2 size={20} color="#00E5FF" /> 24h Realized PnL Heatmap
                            </h2>
                            <div className="flex flex-wrap gap-2">
                                {heatmap.length > 0 ? heatmap.map((entry, i) => {
                                    const isWin = entry.pnl > 0;
                                    const intensity = Math.min(1, Math.abs(entry.pnl) / 50); // scales color intensity up to $50
                                    // Base color
                                    const color = isWin ? `rgba(0, 255, 136, ${0.2 + (intensity * 0.8)})` : `rgba(255, 59, 92, ${0.2 + (intensity * 0.8)})`;
                                    const border = isWin ? '#00FF88' : '#FF3B5C';
                                    
                                    return (
                                        <div 
                                            key={i} 
                                            className="px-3 py-2 rounded-lg border text-center min-w-[80px]"
                                            style={{ backgroundColor: color, borderColor: border }}
                                        >
                                            <div className="text-[10px] font-bold text-white uppercase tracking-wider mb-1">{entry.symbol.replace('USDT', '')}</div>
                                            <div className="text-sm font-mono text-white text-shadow-sm font-bold">
                                                {isWin ? '+' : ''}${entry.pnl.toFixed(2)}
                                            </div>
                                        </div>
                                    );
                                }) : (
                                    <div className="text-sm text-[var(--color-text-muted)] italic py-4">
                                        No closed trades in the last 24 hours. Awaiting opportunities...
                                    </div>
                                )}
                            </div>
                        </div>

                    </div>

                    {/* Sidebar Area (1/3 width) */}
                    <div className="space-y-6">
                        
                        {/* Position Intelligence */}
                        <div style={{
                            background: 'linear-gradient(145deg, rgba(8,12,20,0.9) 0%, rgba(5,7,12,0.95) 100%)',
                            border: '1px solid rgba(255,255,255,0.05)',
                            borderRadius: '20px',
                            padding: '24px',
                            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.02)'
                        }}>
                            <h2 className="text-xl font-bold flex items-center gap-2 text-[#E8EDF5] border-b border-[rgba(255,255,255,0.05)] pb-4 mb-4">
                                <Zap size={20} color="#FBBF24" /> Intelligence
                            </h2>
                            
                            <div className="space-y-5">
                                <div>
                                    <div className="flex justify-between text-[11px] text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
                                        <span>Ping Latency</span>
                                        <span>{pingHistory.length > 0 ? `${pingHistory[pingHistory.length - 1]}ms` : '--'}</span>
                                    </div>
                                    <div className="flex items-end gap-[2px] h-8 bg-black/40 rounded-lg p-2 border border-[rgba(255,255,255,0.05)] overflow-hidden">
                                        {pingHistory.map((ping, i) => {
                                            const height = Math.min(100, Math.max(10, (ping / 1000) * 100)); // Cap at 1s for visuals
                                            const color = ping > 800 ? '#FF3B5C' : ping > 400 ? '#FBBF24' : '#00E5FF';
                                            return (
                                                <div 
                                                    key={i} 
                                                    className="w-full rounded-t-sm"
                                                    style={{ height: `${height}%`, background: color }}
                                                />
                                            );
                                        })}
                                        {pingHistory.length === 0 && <div className="text-xs text-[var(--color-text-muted)] w-full text-center">Awaiting...</div>}
                                    </div>
                                </div>

                                {hasDrift && (
                                    <div className="p-3 bg-[rgba(251,191,36,0.1)] border border-[rgba(251,191,36,0.3)] rounded-lg">
                                        <div className="text-sm text-[#FBBF24] flex items-center gap-2 font-bold mb-1">
                                            <AlertTriangle size={16} /> Drift Detected
                                        </div>
                                        <div className="text-xs text-[var(--color-text-muted)]">
                                            Engine reports {engineActiveCount} positions, but {prismaActiveCount} active in DB. Re-sync required.
                                        </div>
                                    </div>
                                )}

                                <button 
                                    onClick={handleForceSync}
                                    disabled={syncing}
                                    className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-lg font-bold transition-all disabled:opacity-50"
                                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#E8EDF5' }}
                                >
                                    <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
                                    {syncing ? 'SYNCING...' : 'FORCE RE-SYNC'}
                                </button>
                            </div>
                        </div>

                        {/* Emergency Controls */}
                        <div style={{
                            background: 'rgba(239, 68, 68, 0.05)',
                            border: '1px solid rgba(239, 68, 68, 0.2)',
                            borderRadius: '20px',
                            padding: '24px',
                            boxShadow: 'inset 0 0 0 1px rgba(239, 68, 68, 0.05)'
                        }}>
                            <h2 className="text-xl font-bold flex items-center gap-2 text-[#EF4444] border-b border-[rgba(239,68,68,0.2)] pb-4 mb-6">
                                <ShieldAlert size={20} /> Emergency Override
                            </h2>
                            
                            <div className="space-y-4">
                                <div>
                                    <button 
                                        onClick={handlePauseToggle}
                                        disabled={pausing}
                                        className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-lg font-bold transition-all disabled:opacity-50 text-[13px]"
                                        style={{ 
                                            background: isEnginePaused ? 'rgba(0, 255, 136, 0.1)' : 'rgba(251, 191, 36, 0.1)', 
                                            border: `1px solid ${isEnginePaused ? '#00FF88' : '#FBBF24'}`, 
                                            color: isEnginePaused ? '#00FF88' : '#FBBF24' 
                                        }}
                                    >
                                        {isEnginePaused ? <PlayCircle size={18} /> : <PauseCircle size={18} />}
                                        {pausing ? 'TOGGLING...' : (isEnginePaused ? 'RESUME DEPLOYMENTS' : 'PAUSE NEW TRADES')}
                                    </button>
                                    <p className="text-xs text-[var(--color-text-muted)] mt-2 text-center">
                                        {isEnginePaused ? 'Engine will resume HMM signals.' : 'Stops new entries. Existing trades will still manage TP/SL.'}
                                    </p>
                                </div>

                                <div className="pt-4 border-t border-[rgba(255,255,255,0.05)]">
                                    <button 
                                        onClick={handleStopAll}
                                        disabled={stoppingAll}
                                        className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-lg font-bold text-white transition-all disabled:opacity-50 text-[13px]"
                                        style={{ background: 'linear-gradient(135deg, #FF3B5C 0%, #D92B48 100%)', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}
                                    >
                                        <PowerOff size={18} />
                                        {stoppingAll ? 'STOPPING...' : 'STOP ALL BOTS'}
                                    </button>
                                    <p className="text-xs text-[var(--color-text-muted)] mt-2 text-center">
                                        Halts all scanning completely. Leaves positions open.
                                    </p>
                                </div>

                                <div className="pt-4 border-t border-[rgba(255,255,255,0.05)]">
                                    <button 
                                        onClick={handleExitAll}
                                        disabled={exitingAll}
                                        className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-lg font-bold transition-all disabled:opacity-50"
                                        style={{ background: 'transparent', border: '1px solid #FF3B5C', color: '#FF3B5C' }}
                                    >
                                        <ShieldX size={18} />
                                        {exitingAll ? 'EXITING...' : 'FLATTEN ALL POSITIONS'}
                                    </button>
                                    <p className="text-xs text-[var(--color-text-muted)] mt-2 text-center">
                                        Market-closes every open trade instantly.
                                    </p>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>

            </div>
        </div>
    );
}

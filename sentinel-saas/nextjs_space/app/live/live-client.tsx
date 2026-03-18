'use client';

import { useState, useEffect } from 'react';
import { Activity, ShieldAlert, Radio, RefreshCw, PowerOff, ShieldX, TerminalSquare } from 'lucide-react';
import { motion } from 'framer-motion';

export function LiveClient() {
    const [balance, setBalance] = useState<{ binance: number | null, binanceConnected: boolean } | null>(null);
    const [engineState, setEngineState] = useState<any>(null);
    const [logs, setLogs] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    const [stoppingAll, setStoppingAll] = useState(false);
    const [exitingAll, setExitingAll] = useState(false);

    const fetchData = async () => {
        try {
            const [balRes, stateRes, logsRes] = await Promise.all([
                fetch('/api/wallet-balance'),
                fetch('/api/bot-state?mode=live'),
                fetch('/api/engine-logs?mode=live&n=50')
            ]);
            
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

    const engineOnline = engineState?.engine?.status === 'running';

    return (
        <div className="min-h-screen bg-[var(--color-background)] pt-24 pb-12">
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
                                    animate={engineOnline ? { opacity: [0.4, 1, 0.4] } : { opacity: 1 }}
                                    transition={{ duration: 2, repeat: Infinity }}
                                    className="w-2.5 h-2.5 rounded-full" 
                                    style={{ 
                                        background: engineOnline ? '#00FF88' : '#FF3B5C', 
                                        boxShadow: `0 0 10px ${engineOnline ? '#00FF88' : '#FF3B5C'}` 
                                    }} 
                                />
                                <span className="text-xs font-bold tracking-widest" style={{ color: engineOnline ? '#00FF88' : '#FF3B5C' }}>
                                    {engineOnline ? 'ENGINE ONLINE' : 'ENGINE OFFLINE'}
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
                                    <div className="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Exchange</div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full" style={{ background: balance?.binanceConnected ? '#00FF88' : '#FF3B5C' }} />
                                        <span className="text-lg font-bold text-[#E8EDF5]">Binance Futures</span>
                                    </div>
                                    <div className="mt-4 text-[11px] text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Available Margin</div>
                                    <div className="text-2xl font-mono text-[#00E5FF]">
                                        {balance?.binanceConnected ? `$${balance?.binance?.toFixed(2) || '0.00'}` : 'Not Connected'}
                                    </div>
                                </div>

                                <div className="p-4 rounded-xl" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.05)' }}>
                                    <div className="text-[11px] text-[var(--color-text-muted)] uppercase tracking-wider mb-1">Status</div>
                                    {balance?.binanceConnected ? (
                                        <div className="text-sm text-[#00FF88] flex items-center gap-2">
                                            <ShieldAlert size={14} color="#00FF88" /> Credentials Validated
                                        </div>
                                    ) : (
                                        <div className="text-sm text-[#FF3B5C] flex items-center gap-2">
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

                    </div>

                    {/* Sidebar Area (1/3 width) */}
                    <div className="space-y-6">
                        
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
                                        onClick={handleStopAll}
                                        disabled={stoppingAll}
                                        className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-lg font-bold text-white transition-all disabled:opacity-50"
                                        style={{ background: 'linear-gradient(135deg, #FF3B5C 0%, #D92B48 100%)', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}
                                    >
                                        <PowerOff size={18} />
                                        {stoppingAll ? 'STOPPING...' : 'STOP ALL BOTS'}
                                    </button>
                                    <p className="text-xs text-[var(--color-text-muted)] mt-2 text-center">
                                        Halts all scanning. Leaves positions open.
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

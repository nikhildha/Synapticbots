'use client';

import { useState, useEffect } from 'react';
import { RefreshCw, Target, ShieldCheck, XCircle, CheckCircle2, Bot, Clock, AlertTriangle } from 'lucide-react';

interface GateStats {
    count: number;
    true_positive: number;
    false_positive: number;
    hit_rate_pct: number;
    avg_age_hours: number;
}

interface SVSReport {
    updated_at: string;
    active_since: string;
    total_signals_tracked: number;
    base_win_rate_pct: number;
    engine_accuracy_pct: number;
    avg_evaluation_latency_hours: number;
    by_gate: Record<string, GateStats>;
}

interface SVSSignal {
    timestamp: string;
    symbol: string;
    side: string;
    signal_type: string;
    segment: string;
    conviction: number;
    deployed: boolean;
    gate_vetoed: string | null;
    evaluation_status: 'PENDING' | 'CORRECT' | 'WRONG';
    evaluated_at: string | null;
    price_entry: number;
    price_eval: number | null;
}

interface SVSData {
    report: SVSReport | null;
    recent_signals: SVSSignal[];
}

export default function SignalValidationSystem() {
    const [data, setData] = useState<SVSData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const fetchData = async () => {
        setLoading(true);
        setError('');
        try {
            const res = await fetch('/api/admin/svs');
            if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
            const result = await res.json();
            
            // Re-map format if the backend returns report directly versus nested
            setData({
                report: result.report || result, 
                recent_signals: result.recent_signals || result.signals || []
            });
        } catch (err: any) {
            setError(err.message);
        }
        setLoading(false);
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 60000); // 1-minute auto-refresh
        return () => clearInterval(interval);
    }, []);

    if (loading && !data) {
        return (
            <div className="flex items-center justify-center py-20">
                <RefreshCw className="w-8 h-8 text-gray-400 animate-spin" />
            </div>
        );
    }

    if (error && !data) {
        return (
            <div className="bg-red-500/10 border border-red-500/20 p-6 rounded-xl flex items-center gap-4">
                <AlertTriangle className="w-6 h-6 text-red-400" />
                <p className="text-red-400">Failed to load SVS data: {error}</p>
                <button onClick={fetchData} className="ml-auto px-4 py-2 bg-red-500/20 rounded-lg text-red-400">Retry</button>
            </div>
        );
    }

    const rep = data?.report;
    const signals = data?.recent_signals || [];

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                        <Target className="w-6 h-6 text-purple-400" />
                        Signal Validation Oracle
                    </h2>
                    <p className="text-sm text-gray-400">Real-time forward testing and gateway accuracy tracking</p>
                </div>
                <button
                    onClick={fetchData}
                    className="p-2 bg-white/5 hover:bg-white/10 text-gray-400 transition rounded-lg"
                >
                    <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {/* Top Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                    <span className="text-gray-400 text-sm flex items-center justify-between mb-3">
                        Total Evaluated <Bot className="w-4 h-4 text-blue-400" />
                    </span>
                    <p className="text-2xl font-bold text-white">{rep?.total_signals_tracked || 0}</p>
                    <p className="text-xs text-gray-500 mt-1">
                        Active since: {rep?.active_since ? new Date(rep.active_since).toLocaleDateString() : 'N/A'}
                    </p>
                </div>
                
                <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                    <span className="text-gray-400 text-sm flex items-center justify-between mb-3">
                        Base Win Rate <Target className="w-4 h-4 text-emerald-400" />
                    </span>
                    <p className="text-2xl font-bold text-emerald-400">
                        {rep?.base_win_rate_pct !== undefined ? rep.base_win_rate_pct.toFixed(1) : 0}%
                    </p>
                    <p className="text-xs text-gray-500 mt-1">Accuracy of DEPLOYED trades only</p>
                </div>

                <div className="bg-white/5 border border-white/10 rounded-xl p-5 relative overflow-hidden">
                    <div className="absolute -right-4 -top-4 w-16 h-16 bg-purple-500/20 blur-2xl rounded-full" />
                    <span className="text-gray-400 text-sm flex items-center justify-between mb-3 relative">
                        Overall Engine Accuracy <ShieldCheck className="w-4 h-4 text-purple-400" />
                    </span>
                    <p className="text-3xl font-bold text-white relative flex items-baseline gap-1">
                        {rep?.engine_accuracy_pct !== undefined ? rep.engine_accuracy_pct.toFixed(1) : 0}
                        <span className="text-lg text-gray-400">%</span>
                    </p>
                    <p className="text-xs text-gray-500 mt-1 relative">Includes correctly vetoed losers</p>
                </div>

                <div className="bg-white/5 border border-white/10 rounded-xl p-5">
                    <span className="text-gray-400 text-sm flex items-center justify-between mb-3">
                        Eval Latency <Clock className="w-4 h-4 text-amber-400" />
                    </span>
                    <p className="text-2xl font-bold text-white">{rep?.avg_evaluation_latency_hours?.toFixed(1) || 0}h</p>
                    <p className="text-xs text-gray-500 mt-1">Average wait for confirmation</p>
                </div>
            </div>

            {/* Gate Matrix */}
            <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-white/10 bg-white/5">
                    <h3 className="text-white font-medium">Waterfall Gate Analysis</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-white/5">
                                <th className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase">Gate Name</th>
                                <th className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase">Blocks</th>
                                <th className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase">Hit Rate</th>
                                <th className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase">True Positive (Save)</th>
                                <th className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase">False Positive (Miss)</th>
                                <th className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase">Avg Hold Time</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rep?.by_gate && Object.entries(rep.by_gate)
                                .sort(([,a], [,b]) => b.count - a.count)
                                .map(([gateName, stats]) => (
                                <tr key={gateName} className="border-b border-white/5 hover:bg-white/5 transition">
                                    <td className="px-6 py-4">
                                        <span className={`px-2.5 py-1 rounded-md text-xs font-mono font-medium ${
                                            gateName === 'DEPLOYED' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                                            'bg-red-500/10 text-red-400 border border-red-500/20'
                                        }`}>
                                            {gateName}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-white font-medium">{stats.count}</td>
                                    <td className="px-6 py-4">
                                        <span className={`inline-flex items-center gap-1 ${
                                            stats.hit_rate_pct > 60 ? 'text-emerald-400' :
                                            stats.hit_rate_pct > 40 ? 'text-amber-400' : 'text-red-400'
                                        }`}>
                                            {stats.hit_rate_pct.toFixed(1)}%
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-gray-300">{stats.true_positive}</td>
                                    <td className="px-6 py-4 text-gray-300">{stats.false_positive}</td>
                                    <td className="px-6 py-4 text-gray-400">{stats.avg_age_hours.toFixed(1)}h</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Signal Feed */}
            <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-white/10 bg-white/5 flex justify-between items-center">
                    <h3 className="text-white font-medium">Recent Signals</h3>
                    <span className="text-xs text-gray-500">Last 50 entries</span>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-white/5">
                                <th className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase">Time</th>
                                <th className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase">Coin</th>
                                <th className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase">Type</th>
                                <th className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase">Decision</th>
                                <th className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase">Result</th>
                            </tr>
                        </thead>
                        <tbody>
                            {signals.map((sig, i) => (
                                <tr key={i} className="border-b border-white/5 hover:bg-white/5 transition">
                                    <td className="px-6 py-4 text-gray-400 text-sm whitespace-nowrap">
                                        {new Date(sig.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-2">
                                            <span className={`text-xs font-bold ${sig.side === 'LONG' ? 'text-green-400' : 'text-red-400'}`}>
                                                {sig.side}
                                            </span>
                                            <span className="text-white font-medium">{sig.symbol}</span>
                                        </div>
                                        <p className="text-xs text-gray-500 mt-1">Conviction: {sig.conviction?.toFixed(0) || 'N/A'}</p>
                                    </td>
                                    <td className="px-6 py-4 text-gray-300 text-sm capitalize">
                                        {sig.signal_type?.replace('_', ' ').toLowerCase() || 'Trend follow'}
                                    </td>
                                    <td className="px-6 py-4">
                                        {sig.deployed ? (
                                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-medium">
                                                <CheckCircle2 className="w-3.5 h-3.5" /> DEPLOYED
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-red-500/10 text-red-400 border border-red-500/20 text-xs font-medium font-mono truncate max-w-[150px]">
                                                <XCircle className="w-3.5 h-3.5 min-w-[14px]" /> {sig.gate_vetoed || 'VETO'}
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4">
                                        {sig.evaluation_status === 'CORRECT' ? (
                                            <span className="text-emerald-400 flex items-center gap-1 text-sm font-medium">
                                                <CheckCircle2 className="w-4 h-4" /> Correct
                                            </span>
                                        ) : sig.evaluation_status === 'WRONG' ? (
                                            <span className="text-red-400 flex items-center gap-1 text-sm font-medium">
                                                <XCircle className="w-4 h-4" /> Wrong
                                            </span>
                                        ) : (
                                            <span className="text-gray-400 flex items-center gap-1 text-sm">
                                                <Clock className="w-4 h-4" /> Pending
                                            </span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {signals.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                                        No recent signals found in log.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}


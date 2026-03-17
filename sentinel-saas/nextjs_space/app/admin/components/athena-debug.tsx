'use client';

import { useState, useEffect, useCallback } from 'react';
import { Brain, RefreshCw, CheckCircle2, AlertTriangle, XCircle, Clock } from 'lucide-react';

interface AthenaError {
    time: string;
    symbol: string;
    side: string;
    error: string;
    cycle_call: number;
}

interface AthenaState {
    enabled: boolean;
    model: string;
    initialized: boolean;
    cycle_calls: number;
    cache_size: number;
    status: 'ok' | 'degraded' | 'down';
    fail_count: number;
    recent_errors: AthenaError[];
    recent_decisions: any[];
}

function statusBadge(status: string) {
    if (status === 'ok') return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-green-500/10 text-green-400 border border-green-500/20">
            <CheckCircle2 className="w-3.5 h-3.5" /> Healthy
        </span>
    );
    if (status === 'degraded') return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
            <AlertTriangle className="w-3.5 h-3.5" /> Degraded
        </span>
    );
    return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-red-500/10 text-red-400 border border-red-500/20">
            <XCircle className="w-3.5 h-3.5" /> Down
        </span>
    );
}

function formatTime(iso: string) {
    try {
        return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
    } catch {
        return iso;
    }
}

export default function AthenaDebug() {
    const [athena, setAthena] = useState<AthenaState | null>(null);
    const [loading, setLoading] = useState(true);
    const [lastFetch, setLastFetch] = useState<Date | null>(null);

    const fetchAthena = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/bot-state', { cache: 'no-store' });
            if (res.ok) {
                const data = await res.json();
                setAthena(data?.athena || null);
                setLastFetch(new Date());
            }
        } catch (e) {
            console.error('[AthenaDebug] fetch failed:', e);
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        fetchAthena();
        const interval = setInterval(fetchAthena, 30_000);
        return () => clearInterval(interval);
    }, [fetchAthena]);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Brain className="w-6 h-6 text-purple-400" />
                    <div>
                        <h2 className="text-white font-semibold text-lg">Athena LLM Debug</h2>
                        <p className="text-gray-400 text-xs">Real-time signal validator health &amp; error log</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {lastFetch && (
                        <span className="text-gray-500 text-xs flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {lastFetch.toLocaleTimeString('en-IN', { hour12: false })}
                        </span>
                    )}
                    <button
                        onClick={fetchAthena}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 text-sm transition"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>
                </div>
            </div>

            {/* Status Banner */}
            {athena ? (
                <div className={`rounded-xl p-5 border ${
                    athena.status === 'ok'
                        ? 'bg-green-500/5 border-green-500/20'
                        : athena.status === 'degraded'
                        ? 'bg-yellow-500/5 border-yellow-500/20'
                        : 'bg-red-500/5 border-red-500/20'
                }`}>
                    <div className="flex items-center justify-between flex-wrap gap-3">
                        <div className="flex items-center gap-4">
                            {statusBadge(athena.status)}
                            <span className="text-gray-300 text-sm">
                                Model: <span className="text-white font-medium">{athena.model || 'unknown'}</span>
                            </span>
                            <span className="text-gray-300 text-sm">
                                Calls this cycle: <span className="text-white font-medium">{athena.cycle_calls ?? 0}</span>
                            </span>
                            <span className="text-gray-300 text-sm">
                                Cache hits: <span className="text-white font-medium">{athena.cache_size ?? 0}</span>
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className={`text-sm font-semibold ${athena.fail_count > 0 ? 'text-red-400' : 'text-green-400'}`}>
                                {athena.fail_count} error{athena.fail_count !== 1 ? 's' : ''} logged
                            </span>
                            {!athena.enabled && (
                                <span className="text-xs text-gray-500 bg-white/5 px-2 py-0.5 rounded">disabled</span>
                            )}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="rounded-xl p-5 border border-white/10 bg-white/5 text-gray-400 text-sm">
                    {loading ? 'Fetching Athena state...' : 'Athena state unavailable — engine may be down.'}
                </div>
            )}

            {/* Error Log Table */}
            <div className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
                    <h3 className="text-white font-semibold">Recent Errors (last 20)</h3>
                    {athena?.fail_count === 0 && (
                        <span className="text-green-400 text-xs">No errors recorded</span>
                    )}
                </div>

                {athena?.recent_errors && athena.recent_errors.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-white/5">
                                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase">Time (IST)</th>
                                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase">Symbol</th>
                                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase">Side</th>
                                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase">Cycle</th>
                                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase">Error</th>
                                </tr>
                            </thead>
                            <tbody>
                                {[...athena.recent_errors].reverse().map((err, i) => (
                                    <tr key={i} className="border-b border-white/5 hover:bg-white/5 transition">
                                        <td className="px-6 py-3 text-gray-300 whitespace-nowrap font-mono text-xs">
                                            {formatTime(err.time)}
                                        </td>
                                        <td className="px-6 py-3">
                                            <span className="text-white font-medium">{err.symbol}</span>
                                        </td>
                                        <td className="px-6 py-3">
                                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                                err.side === 'LONG'
                                                    ? 'bg-green-500/10 text-green-400'
                                                    : err.side === 'SHORT'
                                                    ? 'bg-red-500/10 text-red-400'
                                                    : 'bg-gray-500/10 text-gray-400'
                                            }`}>
                                                {err.side || '?'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-3 text-gray-400 text-xs">#{err.cycle_call}</td>
                                        <td className="px-6 py-3 text-red-300 text-xs font-mono max-w-xs truncate" title={err.error}>
                                            {err.error}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="px-6 py-10 text-center text-gray-500 text-sm">
                        {loading ? (
                            <RefreshCw className="w-6 h-6 animate-spin mx-auto text-gray-600" />
                        ) : (
                            <div className="flex flex-col items-center gap-2">
                                <CheckCircle2 className="w-8 h-8 text-green-500/50" />
                                <span>No Athena errors recorded since last restart</span>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Note */}
            <p className="text-gray-600 text-xs">
                Errors reset on engine restart. Athena errors cause fail-closed behavior — trades are skipped, not auto-approved.
                Auto-refreshes every 30 seconds.
            </p>
        </div>
    );
}

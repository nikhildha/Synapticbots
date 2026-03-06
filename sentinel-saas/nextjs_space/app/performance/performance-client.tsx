'use client';

import { useState } from 'react';
import { TrendingUp, TrendingDown, BarChart2, Trophy, Activity, ChevronDown, ChevronUp } from 'lucide-react';
import { Header } from '@/components/header';

interface BotSession {
    id: string;
    sessionIndex: number;
    startedAt: string;
    endedAt: string | null;
    status: string;
    mode: string;
    totalTrades: number;
    closedTrades: number;
    winTrades: number;
    totalPnl: number;
    roi: number;
    winRate: number;
    bestTrade: number;
    worstTrade: number;
    totalCapital: number;
    livePnl: number;
    liveRoi: number;
    openTrades: number;
    bot: { name: string; exchange: string };
}

interface Summary {
    totalSessions: number;
    allTimePnl: number;
    allTimeTrades: number;
    allTimeRoi: number;
    bestSessionPnl: number;
}

interface Props {
    sessions: BotSession[];
    summary: Summary;
    activeSessionId: string | null;
}

function fmt(n: number, digits = 2) {
    return (n >= 0 ? '+' : '') + n.toFixed(digits);
}

function fmtDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
}

function duration(start: string, end: string | null) {
    const ms = (end ? new Date(end) : new Date()).getTime() - new Date(start).getTime();
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    if (days > 0) return `${days}d ${hours}h`;
    return `${hours}h`;
}

function PnlBadge({ value }: { value: number }) {
    const pos = value >= 0;
    return (
        <span className={`font-mono font-semibold ${pos ? 'text-emerald-400' : 'text-red-400'}`}>
            {fmt(value)}
        </span>
    );
}

function RoiBadge({ value }: { value: number }) {
    const pos = value >= 0;
    return (
        <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${pos ? 'bg-emerald-900/40 text-emerald-400' : 'bg-red-900/40 text-red-400'}`}>
            {fmt(value)}%
        </span>
    );
}

function SessionLabel({ index, status }: { index: number; status: string }) {
    if (index === 0) return <span className="text-xs px-2 py-0.5 rounded bg-zinc-700 text-zinc-300">Legacy</span>;
    if (status === 'active') return (
        <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-emerald-900/50 text-emerald-400 border border-emerald-700/50">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live
        </span>
    );
    return <span className="text-xs text-zinc-400">Run #{index}</span>;
}

export function PerformanceClient({ sessions, summary, activeSessionId }: Props) {
    const [expanded, setExpanded] = useState<string | null>(null);

    const toggle = (id: string) => setExpanded(prev => prev === id ? null : id);

    return (
        <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)]">
            <Header />
            <div className="px-4 py-8 max-w-6xl mx-auto">
            <h1 className="text-2xl font-bold mb-1">Performance History</h1>
            <p className="text-sm text-[var(--color-text-secondary)] mb-6">All-time bot run records, session by session.</p>

            {/* All-time summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
                <div className="rounded-xl bg-[var(--color-surface)] border border-[var(--color-surface-light)] p-4">
                    <p className="text-xs text-[var(--color-text-secondary)] mb-1">All-time PnL</p>
                    <p className={`text-xl font-bold font-mono ${summary.allTimePnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {fmt(summary.allTimePnl)} USDT
                    </p>
                </div>
                <div className="rounded-xl bg-[var(--color-surface)] border border-[var(--color-surface-light)] p-4">
                    <p className="text-xs text-[var(--color-text-secondary)] mb-1">All-time ROI</p>
                    <p className={`text-xl font-bold font-mono ${summary.allTimeRoi >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {fmt(summary.allTimeRoi)}%
                    </p>
                </div>
                <div className="rounded-xl bg-[var(--color-surface)] border border-[var(--color-surface-light)] p-4">
                    <p className="text-xs text-[var(--color-text-secondary)] mb-1">Total Sessions</p>
                    <p className="text-xl font-bold">{summary.totalSessions}</p>
                </div>
                <div className="rounded-xl bg-[var(--color-surface)] border border-[var(--color-surface-light)] p-4">
                    <p className="text-xs text-[var(--color-text-secondary)] mb-1">Best Session</p>
                    <p className={`text-xl font-bold font-mono ${summary.bestSessionPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {fmt(summary.bestSessionPnl)} USDT
                    </p>
                </div>
            </div>

            {/* Sessions table */}
            {sessions.length === 0 ? (
                <div className="text-center py-16 text-[var(--color-text-secondary)]">
                    <BarChart2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>No sessions yet. Start your bot to begin tracking performance.</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {/* Header row */}
                    <div className="hidden sm:grid grid-cols-[120px_1fr_80px_80px_80px_90px_90px_32px] gap-2 px-4 py-2 text-xs text-[var(--color-text-secondary)] uppercase tracking-wide">
                        <span>Run</span>
                        <span>Period</span>
                        <span className="text-right">Trades</span>
                        <span className="text-right">Win%</span>
                        <span className="text-right">Mode</span>
                        <span className="text-right">PnL</span>
                        <span className="text-right">ROI</span>
                        <span />
                    </div>

                    {sessions.map((s) => (
                        <div key={s.id} className="rounded-xl bg-[var(--color-surface)] border border-[var(--color-surface-light)] overflow-hidden">
                            {/* Main row */}
                            <button
                                onClick={() => toggle(s.id)}
                                className="w-full text-left grid grid-cols-[120px_1fr_80px_80px_80px_90px_90px_32px] gap-2 items-center px-4 py-3 hover:bg-[var(--color-surface-light)]/30 transition-colors"
                            >
                                <SessionLabel index={s.sessionIndex} status={s.status} />
                                <div className="text-sm">
                                    <span className="font-medium">{fmtDate(s.startedAt)}</span>
                                    <span className="text-[var(--color-text-secondary)] text-xs"> · {duration(s.startedAt, s.endedAt)}</span>
                                </div>
                                <span className="text-right text-sm">{s.totalTrades}</span>
                                <span className={`text-right text-sm font-mono ${s.winRate >= 50 ? 'text-emerald-400' : 'text-[var(--color-text-secondary)]'}`}>
                                    {s.closedTrades > 0 ? s.winRate.toFixed(0) + '%' : '—'}
                                </span>
                                <span className="text-right">
                                    <span className={`text-xs px-1.5 py-0.5 rounded ${s.mode === 'live' ? 'bg-amber-900/40 text-amber-400' : 'bg-zinc-700 text-zinc-300'}`}>
                                        {s.mode}
                                    </span>
                                </span>
                                <span className="text-right"><PnlBadge value={s.livePnl} /></span>
                                <span className="text-right"><RoiBadge value={s.liveRoi} /></span>
                                <span className="text-[var(--color-text-secondary)]">
                                    {expanded === s.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                </span>
                            </button>

                            {/* Expanded detail */}
                            {expanded === s.id && (
                                <div className="border-t border-[var(--color-surface-light)] px-4 py-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                                    <div>
                                        <p className="text-xs text-[var(--color-text-secondary)] mb-1">Closed Trades</p>
                                        <p className="font-semibold">{s.closedTrades}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-[var(--color-text-secondary)] mb-1">Open Trades</p>
                                        <p className="font-semibold">{s.openTrades}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-[var(--color-text-secondary)] mb-1">Best Trade</p>
                                        <p className="font-mono text-emerald-400">{fmt(s.bestTrade)} USDT</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-[var(--color-text-secondary)] mb-1">Worst Trade</p>
                                        <p className="font-mono text-red-400">{fmt(s.worstTrade)} USDT</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-[var(--color-text-secondary)] mb-1">Capital Deployed</p>
                                        <p className="font-mono">${s.totalCapital.toFixed(0)}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-[var(--color-text-secondary)] mb-1">Bot</p>
                                        <p>{s.bot.name}</p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-[var(--color-text-secondary)] mb-1">Exchange</p>
                                        <p className="capitalize">{s.bot.exchange}</p>
                                    </div>
                                    {s.endedAt && (
                                        <div>
                                            <p className="text-xs text-[var(--color-text-secondary)] mb-1">Ended</p>
                                            <p>{fmtDate(s.endedAt)}</p>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
            </div>
        </div>
    );
}

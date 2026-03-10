'use client';

import { useState, useEffect, useCallback } from 'react';
import {
    Bot, RefreshCw, TrendingUp, TrendingDown, ChevronDown, ChevronRight,
    StopCircle, Trash2, Activity, DollarSign, BarChart3, Users,
    AlertTriangle, CheckCircle2, XCircle, Loader2
} from 'lucide-react';

interface BotTrade {
    id: string;
    symbol: string;
    position: string;
    status: string;
    entryPrice: number;
    exitPrice: number | null;
    currentPrice: number;
    leverage: number;
    capital: number;
    pnl: number;
    pnlPct: number;
    entryTime: string;
    exitTime: string | null;
    exitReason: string | null;
    mode: string;
}

interface BotData {
    id: string;
    name: string;
    isActive: boolean;
    status: string;
    exchange: string;
    startedAt: string | null;
    stoppedAt: string | null;
    createdAt: string;
    mode: string;
    capitalPerTrade: number | null;
    maxLossPct: number | null;
    user: { id: string; email: string; name: string | null };
    stats: {
        activeTradeCount: number;
        closedTradeCount: number;
        totalTradeCount: number;
        totalPnl: number;
        activePnl: number;
        winRate: number;
    };
    recentTrades: BotTrade[];
}

export default function UserBotMonitor() {
    const [bots, setBots] = useState<BotData[]>([]);
    const [loading, setLoading] = useState(true);
    const [expandedBot, setExpandedBot] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [confirmAction, setConfirmAction] = useState<{ botId: string; action: 'stop' | 'delete' } | null>(null);

    const fetchBots = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/bots');
            if (res.ok) setBots(await res.json());
        } catch (e) {
            console.error('Failed to fetch bots:', e);
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        fetchBots();
        const interval = setInterval(fetchBots, 30000);
        return () => clearInterval(interval);
    }, [fetchBots]);

    const handleAction = async (botId: string, action: 'stop' | 'delete') => {
        setActionLoading(botId);
        setConfirmAction(null);
        try {
            const res = await fetch('/api/admin/bots', {
                method: action === 'delete' ? 'DELETE' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ botId, action }),
            });
            if (res.ok) {
                await fetchBots();
            } else {
                const err = await res.json();
                alert(err.error || 'Action failed');
            }
        } catch (e) {
            console.error(`Failed to ${action} bot:`, e);
        }
        setActionLoading(null);
    };

    // Group bots by user
    const userGroups = bots.reduce((acc, bot) => {
        const userId = bot.user?.id || 'unknown';
        if (!acc[userId]) {
            acc[userId] = {
                user: bot.user,
                bots: [],
                totalPnl: 0,
                activePnl: 0,
                totalTrades: 0,
                activeTrades: 0,
            };
        }
        acc[userId].bots.push(bot);
        acc[userId].totalPnl += bot.stats.totalPnl;
        acc[userId].activePnl += bot.stats.activePnl;
        acc[userId].totalTrades += bot.stats.totalTradeCount;
        acc[userId].activeTrades += bot.stats.activeTradeCount;
        return acc;
    }, {} as Record<string, { user: BotData['user']; bots: BotData[]; totalPnl: number; activePnl: number; totalTrades: number; activeTrades: number }>);

    const totalBots = bots.length;
    const activeBots = bots.filter(b => b.isActive).length;
    const totalPnl = bots.reduce((s, b) => s + b.stats.totalPnl + b.stats.activePnl, 0);
    const avgWinRate = bots.length > 0 ? Math.round(bots.reduce((s, b) => s + b.stats.winRate, 0) / bots.length) : 0;

    return (
        <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <SummaryCard icon={<Bot className="w-5 h-5 text-purple-400" />} label="Total Bots" value={String(totalBots)} sub={`${activeBots} active`} />
                <SummaryCard icon={<Activity className="w-5 h-5 text-blue-400" />} label="Active Trades" value={String(bots.reduce((s, b) => s + b.stats.activeTradeCount, 0))} sub={`across ${activeBots} bots`} />
                <SummaryCard
                    icon={totalPnl >= 0 ? <TrendingUp className="w-5 h-5 text-green-400" /> : <TrendingDown className="w-5 h-5 text-red-400" />}
                    label="Platform PnL"
                    value={`$${Math.abs(totalPnl).toFixed(2)}`}
                    sub={totalPnl >= 0 ? 'profit' : 'loss'}
                    color={totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}
                />
                <SummaryCard icon={<BarChart3 className="w-5 h-5 text-amber-400" />} label="Avg Win Rate" value={`${avgWinRate}%`} sub={`${bots.reduce((s, b) => s + b.stats.closedTradeCount, 0)} closed trades`} />
            </div>

            {/* Refresh */}
            <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                    <Users className="w-5 h-5 text-gray-400" />
                    All Users' Bots ({totalBots})
                </h3>
                <button onClick={() => { setLoading(true); fetchBots(); }} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 text-sm transition">
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                    Refresh
                </button>
            </div>

            {/* User Groups */}
            {loading && bots.length === 0 ? (
                <div className="flex items-center justify-center py-16">
                    <RefreshCw className="w-8 h-8 text-gray-500 animate-spin" />
                </div>
            ) : Object.entries(userGroups).length === 0 ? (
                <div className="text-center py-16 text-gray-500">
                    <Bot className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p>No bots found</p>
                </div>
            ) : (
                Object.entries(userGroups).map(([userId, group]) => (
                    <div key={userId} className="bg-white/[0.03] border border-white/10 rounded-2xl overflow-hidden">
                        {/* User Header */}
                        <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-full bg-blue-500/15 flex items-center justify-center text-blue-400 font-bold text-sm">
                                    {(group.user?.name || group.user?.email || '?')[0].toUpperCase()}
                                </div>
                                <div>
                                    <p className="text-white font-medium text-sm">{group.user?.name || 'No name'}</p>
                                    <p className="text-gray-500 text-xs">{group.user?.email}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-4 text-xs">
                                <span className="text-gray-400">{group.bots.length} bot{group.bots.length !== 1 ? 's' : ''}</span>
                                <span className="text-gray-400">{group.totalTrades} trades</span>
                                <span className={`font-semibold ${(group.totalPnl + group.activePnl) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                    {(group.totalPnl + group.activePnl) >= 0 ? '+' : ''}${(group.totalPnl + group.activePnl).toFixed(2)}
                                </span>
                            </div>
                        </div>

                        {/* Bot Rows */}
                        {group.bots.map((bot) => (
                            <div key={bot.id}>
                                <div
                                    className="px-5 py-3 flex items-center justify-between hover:bg-white/[0.03] transition cursor-pointer border-b border-white/5"
                                    onClick={() => setExpandedBot(expandedBot === bot.id ? null : bot.id)}
                                >
                                    <div className="flex items-center gap-3 min-w-0 flex-1">
                                        <button className="text-gray-500 hover:text-gray-300 flex-shrink-0">
                                            {expandedBot === bot.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                        </button>
                                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${bot.isActive ? 'bg-green-400 animate-pulse' : 'bg-gray-500'}`} />
                                        <span className="text-white text-sm font-medium truncate">{bot.name || 'Unnamed Bot'}</span>
                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider flex-shrink-0 ${bot.mode?.toLowerCase().startsWith('live')
                                                ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                                                : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                                            }`}>
                                            {bot.mode || 'paper'}
                                        </span>
                                    </div>

                                    <div className="flex items-center gap-5 text-xs flex-shrink-0">
                                        <div className="text-center w-16">
                                            <p className="text-gray-500">Active</p>
                                            <p className="text-white font-semibold">{bot.stats.activeTradeCount}</p>
                                        </div>
                                        <div className="text-center w-16">
                                            <p className="text-gray-500">Closed</p>
                                            <p className="text-white font-semibold">{bot.stats.closedTradeCount}</p>
                                        </div>
                                        <div className="text-center w-16">
                                            <p className="text-gray-500">Win%</p>
                                            <p className="text-white font-semibold">{bot.stats.winRate}%</p>
                                        </div>
                                        <div className="text-center w-20">
                                            <p className="text-gray-500">PnL</p>
                                            <p className={`font-bold ${(bot.stats.totalPnl + bot.stats.activePnl) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                                {(bot.stats.totalPnl + bot.stats.activePnl) >= 0 ? '+' : ''}${(bot.stats.totalPnl + bot.stats.activePnl).toFixed(2)}
                                            </p>
                                        </div>

                                        {/* Action Buttons */}
                                        <div className="flex items-center gap-1.5 ml-2" onClick={e => e.stopPropagation()}>
                                            {bot.isActive && (
                                                confirmAction?.botId === bot.id && confirmAction.action === 'stop' ? (
                                                    <button
                                                        onClick={() => handleAction(bot.id, 'stop')}
                                                        disabled={actionLoading === bot.id}
                                                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-orange-500/20 text-orange-300 text-xs font-medium hover:bg-orange-500/30 transition"
                                                    >
                                                        {actionLoading === bot.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <AlertTriangle className="w-3 h-3" />}
                                                        Confirm
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => setConfirmAction({ botId: bot.id, action: 'stop' })}
                                                        className="p-1.5 rounded-lg bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 transition"
                                                        title="Stop Bot"
                                                    >
                                                        <StopCircle className="w-3.5 h-3.5" />
                                                    </button>
                                                )
                                            )}
                                            {!bot.isActive && (
                                                confirmAction?.botId === bot.id && confirmAction.action === 'delete' ? (
                                                    <button
                                                        onClick={() => handleAction(bot.id, 'delete')}
                                                        disabled={actionLoading === bot.id}
                                                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-500/20 text-red-300 text-xs font-medium hover:bg-red-500/30 transition"
                                                    >
                                                        {actionLoading === bot.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <AlertTriangle className="w-3 h-3" />}
                                                        Confirm Delete
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => setConfirmAction({ botId: bot.id, action: 'delete' })}
                                                        className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition"
                                                        title="Delete Bot"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                )
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Expanded: Recent Trades */}
                                {expandedBot === bot.id && (
                                    <div className="bg-black/20 border-b border-white/5">
                                        <div className="px-6 py-2 flex items-center gap-4 text-[10px] text-gray-500 uppercase tracking-wider border-b border-white/5">
                                            <span className="w-20">Symbol</span>
                                            <span className="w-14">Side</span>
                                            <span className="w-16">Status</span>
                                            <span className="w-16 text-right">Entry</span>
                                            <span className="w-16 text-right">Exit</span>
                                            <span className="w-10 text-right">Lev</span>
                                            <span className="w-16 text-right">Capital</span>
                                            <span className="w-20 text-right">PnL</span>
                                            <span className="w-14 text-right">PnL%</span>
                                            <span className="flex-1 text-right">Reason</span>
                                        </div>
                                        {bot.recentTrades.length === 0 ? (
                                            <div className="px-6 py-4 text-gray-500 text-xs text-center">No trades yet</div>
                                        ) : (
                                            bot.recentTrades.map((t) => (
                                                <div key={t.id} className="px-6 py-2 flex items-center gap-4 text-xs hover:bg-white/[0.02] transition">
                                                    <span className="w-20 text-white font-medium">{(t.symbol || '').replace('USDT', '')}</span>
                                                    <span className={`w-14 font-semibold ${t.position?.toUpperCase() === 'LONG' ? 'text-green-400' : 'text-red-400'}`}>
                                                        {t.position?.toUpperCase() === 'LONG' ? '▲ Long' : '▼ Short'}
                                                    </span>
                                                    <span className={`w-16 ${(t.status || '').toLowerCase() === 'active' ? 'text-green-400' : 'text-gray-400'}`}>
                                                        {(t.status || '').toLowerCase() === 'active' ? '● Active' : '○ Closed'}
                                                    </span>
                                                    <span className="w-16 text-right text-gray-300">${t.entryPrice?.toFixed(t.entryPrice > 100 ? 2 : 4)}</span>
                                                    <span className="w-16 text-right text-gray-300">{t.exitPrice ? `$${t.exitPrice.toFixed(t.exitPrice > 100 ? 2 : 4)}` : '—'}</span>
                                                    <span className="w-10 text-right text-gray-400">{t.leverage}×</span>
                                                    <span className="w-16 text-right text-gray-300">${t.capital?.toFixed(0)}</span>
                                                    <span className={`w-20 text-right font-semibold ${t.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                                        {t.pnl >= 0 ? '+' : ''}${t.pnl?.toFixed(2)}
                                                    </span>
                                                    <span className={`w-14 text-right ${t.pnlPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                                        {t.pnlPct >= 0 ? '+' : ''}{t.pnlPct?.toFixed(1)}%
                                                    </span>
                                                    <span className="flex-1 text-right text-gray-500 truncate">{t.exitReason || '—'}</span>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                ))
            )}
        </div>
    );
}

function SummaryCard({ icon, label, value, sub, color }: {
    icon: React.ReactNode; label: string; value: string; sub?: string; color?: string;
}) {
    return (
        <div className="bg-white/5 border border-white/10 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
                <span className="text-gray-400 text-sm">{label}</span>
                {icon}
            </div>
            <p className={`text-2xl font-bold ${color || 'text-white'}`}>{value}</p>
            {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
        </div>
    );
}

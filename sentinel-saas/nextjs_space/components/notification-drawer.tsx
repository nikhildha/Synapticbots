'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Bell, TrendingUp, TrendingDown, Bot, Zap, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Notification {
    id: string;
    type: 'trade_open' | 'trade_close' | 'bot_start' | 'bot_stop' | 'sl_hit' | 'tp_hit' | 'engine_alert';
    title: string;
    body: string;
    time: string;
    read: boolean;
    meta?: Record<string, any>;
}

const TYPE_STYLE: Record<string, { color: string; bg: string; icon: any }> = {
    trade_open: { color: '#00E5FF', bg: 'rgba(0,229,255,0.08)', icon: TrendingUp },
    trade_close: { color: '#9CA3AF', bg: 'rgba(156,163,175,0.08)', icon: TrendingDown },
    bot_start: { color: '#00FF88', bg: 'rgba(0,255,136,0.08)', icon: Bot },
    bot_stop: { color: '#4B5563', bg: 'rgba(75,85,99,0.08)', icon: Bot },
    sl_hit: { color: '#FF3B5C', bg: 'rgba(255,59,92,0.08)', icon: TrendingDown },
    tp_hit: { color: '#00FF88', bg: 'rgba(0,255,136,0.08)', icon: TrendingUp },
    engine_alert: { color: '#FFB300', bg: 'rgba(255,179,0,0.08)', icon: AlertTriangle },
};

function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (d > 0) return `${d}d ago`;
    if (h > 0) return `${h}h ago`;
    if (m > 0) return `${m}m ago`;
    return 'just now';
}

interface NotificationDrawerProps {
    open: boolean;
    onClose: () => void;
}

export function NotificationDrawer({ open, onClose }: NotificationDrawerProps) {
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [readIds, setReadIds] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(false);

    const fetch_ = useCallback(async () => {
        setLoading(true);
        try {
            const r = await fetch('/api/notifications');
            if (r.ok) {
                const d = await r.json();
                setNotifications(d.notifications || []);
            }
        } catch { /* silent */ }
        setLoading(false);
    }, []);

    useEffect(() => {
        if (open) fetch_();
    }, [open, fetch_]);

    const markAllRead = () => setReadIds(new Set(notifications.map(n => n.id)));
    const unreadCount = notifications.filter(n => !readIds.has(n.id)).length;

    // Close on Escape
    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [onClose]);

    return (
        <AnimatePresence>
            {open && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        onClick={onClose}
                        style={{
                            position: 'fixed', inset: 0, zIndex: 998,
                            background: 'rgba(0,0,0,0.45)',
                            backdropFilter: 'blur(2px)',
                        }}
                    />

                    {/* Drawer */}
                    <motion.div
                        initial={{ x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        transition={{ type: 'spring', damping: 28, stiffness: 300 }}
                        style={{
                            position: 'fixed', top: 0, right: 0, bottom: 0,
                            width: 400, zIndex: 999,
                            background: 'linear-gradient(160deg, rgba(8,14,26,0.99) 0%, rgba(2,6,14,1) 100%)',
                            borderLeft: '1px solid rgba(0,229,255,0.12)',
                            boxShadow: '-20px 0 60px rgba(0,0,0,0.7)',
                            display: 'flex', flexDirection: 'column',
                        }}
                    >
                        {/* Top accent */}
                        <div style={{
                            position: 'absolute', top: 0, left: 0, right: 0, height: '1px',
                            background: 'linear-gradient(90deg, transparent, rgba(0,229,255,0.5), transparent)',
                        }} />

                        {/* Header */}
                        <div style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '20px 20px 16px',
                            borderBottom: '1px solid rgba(0,229,255,0.06)',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <Bell size={18} color="#00E5FF" />
                                <span style={{ fontSize: '15px', fontWeight: 700, color: '#E8EDF5', letterSpacing: '0.3px' }}>
                                    Notifications
                                </span>
                                {unreadCount > 0 && (
                                    <span style={{
                                        fontSize: '11px', fontWeight: 700, background: '#00E5FF',
                                        color: '#050A14', borderRadius: 20, padding: '1px 7px',
                                    }}>{unreadCount}</span>
                                )}
                            </div>
                            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                                {unreadCount > 0 && (
                                    <button
                                        onClick={markAllRead}
                                        style={{
                                            fontSize: '11px', color: '#4B6080', cursor: 'pointer',
                                            background: 'none', border: 'none', padding: 0,
                                        }}
                                    >
                                        Mark all read
                                    </button>
                                )}
                                <button
                                    onClick={onClose}
                                    style={{
                                        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)',
                                        borderRadius: 8, padding: '5px 6px', cursor: 'pointer', color: '#6B7280',
                                        display: 'flex', alignItems: 'center',
                                    }}
                                >
                                    <X size={15} />
                                </button>
                            </div>
                        </div>

                        {/* Notification list */}
                        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 0' }}>
                            {loading && (
                                <div style={{ textAlign: 'center', padding: 40, color: '#4B6080', fontSize: 13 }}>
                                    Loading...
                                </div>
                            )}

                            {!loading && notifications.length === 0 && (
                                <div style={{
                                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                                    justifyContent: 'center', height: '100%', gap: 10,
                                    color: '#4B6080', paddingTop: 60,
                                }}>
                                    <Bell size={36} opacity={0.2} color="#00E5FF" />
                                    <div style={{ fontSize: 14, fontWeight: 600 }}>No notifications yet</div>
                                    <div style={{ fontSize: 12 }}>Trade activity will appear here</div>
                                </div>
                            )}

                            {!loading && notifications.map((n, i) => {
                                const style = TYPE_STYLE[n.type] || TYPE_STYLE.engine_alert;
                                const Icon = style.icon;
                                const isRead = readIds.has(n.id);

                                return (
                                    <motion.div
                                        key={n.id}
                                        initial={{ opacity: 0, x: 20 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: i * 0.03 }}
                                        onClick={() => setReadIds(prev => new Set([...prev, n.id]))}
                                        style={{
                                            display: 'flex', gap: 12, alignItems: 'flex-start',
                                            padding: '12px 20px',
                                            background: isRead ? 'transparent' : style.bg,
                                            borderBottom: '1px solid rgba(255,255,255,0.03)',
                                            cursor: 'pointer',
                                            transition: 'background 0.2s',
                                            position: 'relative',
                                        }}
                                    >
                                        {/* Unread indicator */}
                                        {!isRead && (
                                            <div style={{
                                                position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)',
                                                width: 4, height: 4, borderRadius: '50%', background: style.color,
                                                boxShadow: `0 0 6px ${style.color}`,
                                            }} />
                                        )}

                                        {/* Icon */}
                                        <div style={{
                                            width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                                            background: style.bg,
                                            border: `1px solid ${style.color}22`,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        }}>
                                            <Icon size={15} color={style.color} />
                                        </div>

                                        {/* Content */}
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{
                                                fontSize: '13px', fontWeight: isRead ? 500 : 700,
                                                color: isRead ? '#6B7280' : '#E8EDF5',
                                                marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                            }}>
                                                {n.title}
                                            </div>
                                            <div style={{ fontSize: '12px', color: '#4B6080', lineHeight: 1.4 }}>
                                                {n.body}
                                            </div>
                                            <div style={{ fontSize: '11px', color: '#374151', marginTop: 4, fontFamily: 'monospace' }}>
                                                {timeAgo(n.time)}
                                            </div>
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </div>

                        {/* Footer */}
                        <div style={{
                            padding: '12px 20px',
                            borderTop: '1px solid rgba(0,229,255,0.06)',
                            textAlign: 'center',
                        }}>
                            <button
                                onClick={fetch_}
                                style={{
                                    fontSize: '12px', color: '#4B6080', background: 'none',
                                    border: 'none', cursor: 'pointer', letterSpacing: '0.5px',
                                }}
                            >
                                ↺ Refresh
                            </button>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}

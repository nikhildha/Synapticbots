'use client';

import { useState, useEffect, useCallback } from 'react';
import { Header } from '@/components/header';
import { BotCard } from '@/components/bot-card';
import {
  Plus, Trash2, Shield, TrendingUp, FlaskConical, Play, Rocket,
  ChevronDown, ChevronUp, Activity
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession } from 'next-auth/react';

/* ═══ Bot Model Definitions ═══ */
const BOT_MODELS = [
  {
    id: 'adaptive',
    name: 'Synaptic Adaptive',
    color: '#22C55E',
    description: 'Auto-adjusts between Conservative, Balanced & Aggressive based on market conditions',
    badge: '🧠',
  },
];

interface BotsClientProps { bots: any[]; sessions?: any[]; perfSummary?: any; }

/* ═══ Inline Performance Section ═══ */
function PerformanceSection() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({ allTimePnl: 0, allTimeRoi: 0, totalSessions: 0, bestSessionPnl: 0 });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/performance', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          setSessions(d.sessions || []);
          setSummary(d.summary || summary);
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const fmt = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2);
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
  const duration = (start: string, end: string | null) => {
    const ms = (end ? new Date(end) : new Date()).getTime() - new Date(start).getTime();
    const days = Math.floor(ms / 86400000);
    const hours = Math.floor((ms % 86400000) / 3600000);
    return days > 0 ? `${days}d ${hours}h` : `${hours}h`;
  };

  if (!loaded) return <div style={{ textAlign: 'center', padding: '24px', color: '#6B7280', fontSize: '13px' }}>Loading performance data...</div>;
  if (sessions.length === 0) return (
    <div style={{ textAlign: 'center', padding: '32px', color: '#6B7280', fontSize: '13px' }}>
      No sessions yet. Start your bot to begin tracking performance.
    </div>
  );

  return (
    <div>
      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '16px' }}>
        {[
          { label: 'All-time PnL', value: `${fmt(summary.allTimePnl)} USDT`, color: summary.allTimePnl >= 0 ? '#22C55E' : '#EF4444' },
          { label: 'All-time ROI', value: `${fmt(summary.allTimeRoi)}%`, color: summary.allTimeRoi >= 0 ? '#22C55E' : '#EF4444' },
          { label: 'Total Sessions', value: String(summary.totalSessions), color: '#D1D5DB' },
          { label: 'Best Session', value: `${fmt(summary.bestSessionPnl)} USDT`, color: summary.bestSessionPnl >= 0 ? '#22C55E' : '#EF4444' },
        ].map(c => (
          <div key={c.label} style={{
            background: 'rgba(17,24,39,0.6)', border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '12px', padding: '14px',
          }}>
            <div style={{ fontSize: '11px', color: '#6B7280', marginBottom: '4px' }}>{c.label}</div>
            <div style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'monospace', color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>
      {/* Session list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {/* Header row */}
        <div style={{
          display: 'grid', gridTemplateColumns: '140px 1fr 80px 80px 90px 90px',
          gap: '8px', padding: '6px 14px', fontSize: '10px', fontWeight: 600,
          color: '#6B7280', textTransform: 'uppercase', letterSpacing: '0.8px',
        }}>
          <span>Status</span>
          <span>Date · Duration</span>
          <span style={{ textAlign: 'right' }}>Trades</span>
          <span style={{ textAlign: 'right' }}>Win Rate</span>
          <span style={{ textAlign: 'right' }}>PnL</span>
          <span style={{ textAlign: 'right' }}>ROI</span>
        </div>
        {sessions.map((s: any) => (
          <div key={s.id} style={{
            background: 'rgba(17,24,39,0.6)', border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '12px', overflow: 'hidden',
          }}>
            <div onClick={() => setExpanded(expanded === s.id ? null : s.id)}
              style={{
                display: 'grid', gridTemplateColumns: '140px 1fr 80px 80px 90px 90px',
                gap: '8px', alignItems: 'center', padding: '10px 14px', cursor: 'pointer',
                fontSize: '13px',
              }}>
              <span style={{
                fontSize: '10px', fontWeight: 600,
                padding: '2px 8px', borderRadius: '4px', width: 'fit-content',
                ...(s.status === 'active'
                  ? { background: 'rgba(34,197,94,0.15)', color: '#22C55E' }
                  : { background: 'rgba(107,114,128,0.15)', color: '#9CA3AF' }),
              }}>
                {s.status === 'active' ? '● Live' : `Run #${s.sessionIndex}`}
              </span>
              <span>{fmtDate(s.startedAt)} <span style={{ fontSize: '11px', color: '#6B7280' }}>· {duration(s.startedAt, s.endedAt)}</span></span>
              <span style={{ textAlign: 'right' }}>{s.totalTrades}</span>
              <span style={{ textAlign: 'right', fontFamily: 'monospace', color: (s.winRate || 0) >= 50 ? '#22C55E' : '#9CA3AF' }}>
                {s.closedTrades > 0 ? `${(s.winRate || 0).toFixed(0)}%` : '—'}
              </span>
              <span style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, color: (s.livePnl || s.totalPnl || 0) >= 0 ? '#22C55E' : '#EF4444' }}>
                {fmt(s.livePnl || s.totalPnl || 0)}
              </span>
              <span style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: '11px', color: (s.liveRoi || s.roi || 0) >= 0 ? '#22C55E' : '#EF4444' }}>
                {fmt(s.liveRoi || s.roi || 0)}%
              </span>
            </div>
            {expanded === s.id && (
              <div style={{
                borderTop: '1px solid rgba(255,255,255,0.06)', padding: '12px 14px',
                display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', fontSize: '12px',
              }}>
                {[
                  { l: 'Closed Trades', v: s.closedTrades },
                  { l: 'Open Trades', v: s.openTrades || 0 },
                  { l: 'Best Trade', v: `${fmt(s.bestTrade || 0)} USDT` },
                  { l: 'Worst Trade', v: `${fmt(s.worstTrade || 0)} USDT` },
                  { l: 'Capital Deployed', v: `$${(s.totalCapital || 0).toFixed(0)}` },
                  { l: 'Bot', v: s.bot?.name || s.name || '-' },
                  { l: 'Exchange', v: s.bot?.exchange || s.exchange || '-' },
                  ...(s.endedAt ? [{ l: 'Ended', v: fmtDate(s.endedAt) }] : []),
                ].map((item, i) => (
                  <div key={i}>
                    <div style={{ fontSize: '10px', color: '#6B7280', marginBottom: '2px' }}>{item.l}</div>
                    <div style={{ fontWeight: 600, color: '#D1D5DB' }}>{item.v}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function BotsClient({ bots: initialBots }: BotsClientProps) {
  const { data: session } = useSession();
  const isAdmin = (session?.user as any)?.role === 'admin';
  const [mounted, setMounted] = useState(false);
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [bots, setBots] = useState(initialBots);
  const [loading, setLoading] = useState(false);

  // Deploy modal state
  const [deployModel, setDeployModel] = useState('adaptive');
  const [deployExchange, setDeployExchange] = useState('binance');
  const [deployMode, setDeployMode] = useState('paper');
  const [deployMaxTrades, setDeployMaxTrades] = useState(25);
  const [deployCapitalPerTrade, setDeployCapitalPerTrade] = useState(100);

  // Verify exchange connection (live mode pre-flight)
  const [verifying, setVerifying] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [verifyBalance, setVerifyBalance] = useState<number | null>(null);

  useEffect(() => { setMounted(true); }, []);

  // Live active trade count from bot-state
  const [liveTradeCount, setLiveTradeCount] = useState(0);
  const [liveTrades, setLiveTrades] = useState<any[]>([]);
  const [allSessions, setAllSessions] = useState<any[]>([]);
  const [perfSummary, setPerfSummary] = useState<any>({ allTimePnl: 0, allTimeRoi: 0, totalSessions: 0, bestSessionPnl: 0 });

  const fetchLiveCount = useCallback(async () => {
    try {
      const res = await fetch('/api/bot-state', { cache: 'no-store' });
      if (res.ok) {
        const d = await res.json();
        const trades = d?.tradebook?.trades || [];
        setLiveTrades(trades);
        setLiveTradeCount(trades.filter((t: any) => (t.status || '').toUpperCase() === 'ACTIVE').length);
      }
    } catch { /* silent */ }
  }, []);

  // Fetch performance sessions
  useEffect(() => {
    fetch('/api/performance', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          setAllSessions(d.sessions || []);
          setPerfSummary(d.summary || perfSummary);
        }
      })
      .catch(() => { });
  }, []);

  useEffect(() => {
    fetchLiveCount();
    const timer = setInterval(fetchLiveCount, 15000);
    return () => clearInterval(timer);
  }, [fetchLiveCount]);

  const handleBotToggle = async (botId: string, currentStatus: boolean) => {
    try {
      const res = await fetch('/api/bots/toggle', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId, isActive: !currentStatus }),
      });
      if (res.ok) window.location.reload();
    } catch (error) { console.error('Error toggling bot:', error); }
  };

  const handleVerifyConnection = async () => {
    setVerifying(true);
    setVerifyStatus('idle');
    setVerifyBalance(null);
    try {
      // Use the user's saved API keys (from SaaS DB) — same as the balance shown in Settings
      const res = await fetch('/api/wallet-balance');
      const data = await res.json();
      const balance = deployExchange === 'coindcx' ? data.coindcx : data.binance;
      const isConnected = deployExchange === 'coindcx' ? data.coindcxConnected : data.binanceConnected;
      // Connected = key saved + balance fetch succeeded (or key saved and balance=0 is still valid)
      if (balance !== null && balance !== undefined) {
        setVerifyStatus('ok');
        setVerifyBalance(balance);
      } else if (isConnected) {
        // Key is saved but live balance fetch failed — treat as connected with unknown balance
        setVerifyStatus('ok');
        setVerifyBalance(null);
      } else {
        setVerifyStatus('fail');
      }
    } catch {
      setVerifyStatus('fail');
    } finally {
      setVerifying(false);
    }
  };

  const handleDeployBot = async () => {
    setLoading(true);
    try {
      const selectedModel = BOT_MODELS.find(m => m.id === deployModel);
      const botName = `Synaptic Marshal — ${selectedModel?.name || 'Synaptic Adaptive'}`;
      const res = await fetch('/api/bots/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: botName,
          exchange: deployExchange,
          mode: deployMode,
          maxTrades: deployMaxTrades,
          capitalPerTrade: deployCapitalPerTrade,
        }),
      });
      if (res.ok) {
        setShowDeployModal(false);
        window.location.reload();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to deploy bot');
      }
    } catch (error) { console.error('Error deploying bot:', error); }
    finally { setLoading(false); }
  };

  const handleDeleteBot = async (botId: string) => {
    if (!confirm('Are you sure you want to delete this bot?')) return;
    try {
      const res = await fetch('/api/bots/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId }),
      });
      if (res.ok) window.location.reload();
    } catch (error) { console.error('Error deleting bot:', error); }
  };

  const getModel = (botName: string) =>
    BOT_MODELS.find(m => botName?.toLowerCase().includes(m.id)) || BOT_MODELS[0];

  if (!mounted) return null;

  return (
    <div className="min-h-screen">
      <Header />
      <main className="pt-24 pb-12 px-4">
        <div className="max-w-7xl mx-auto">

          {/* ═══ SECTION 1: BOT MANAGEMENT ═══ */}
          <div className="flex items-center justify-between mb-6">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
              <h1 className="text-3xl font-bold mb-1">
                <span className="text-gradient">Bot Management</span>
              </h1>
              <p className="text-sm text-[var(--color-text-secondary)]">
                Deploy and manage your automated trading bots
              </p>
            </motion.div>
            <button
              onClick={() => setShowDeployModal(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '10px 20px', borderRadius: '12px', border: 'none',
                background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-dark, #0284c7))',
                color: '#fff',
                fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                transition: 'all 0.2s',
              }}>
              <Rocket size={16} />
              Deploy Bot
            </button>
          </div>

          {/* ── Synaptic Marshal Card (shows when no bots yet) ── */}
          {bots.length === 0 && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              style={{
                background: 'linear-gradient(135deg, rgba(17,24,39,0.8), rgba(30,41,59,0.5))',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(34,197,94,0.15)',
                borderRadius: '16px', padding: '32px', textAlign: 'center', marginBottom: '32px',
              }}>
              <div style={{
                width: '56px', height: '56px', borderRadius: '14px',
                background: 'linear-gradient(135deg, rgba(34,197,94,0.15), rgba(16,185,129,0.1))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 16px',
              }}>
                <Shield size={28} color="#22C55E" />
              </div>
              <h3 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '6px', color: '#E5E7EB' }}>
                Synaptic Marshal
              </h3>
              <p style={{ fontSize: '12px', color: '#6B7280', marginBottom: '6px' }}>
                HMM-Powered Crypto Trading Engine
              </p>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                padding: '4px 12px', borderRadius: '20px', fontSize: '11px',
                background: 'rgba(34,197,94,0.1)',
                color: '#22C55E', fontWeight: 600,
              }}>
                <Activity size={12} /> Deploy your first bot to start trading
              </div>
              <div style={{ marginTop: '20px' }}>
                <button
                  onClick={() => setShowDeployModal(true)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '8px',
                    padding: '12px 28px', borderRadius: '12px', border: 'none',
                    background: 'linear-gradient(135deg, #22C55E, #16A34A)',
                    color: '#fff', fontSize: '14px', fontWeight: 700, cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}>
                  <Rocket size={16} /> Deploy Synaptic Marshal
                </button>
              </div>
            </motion.div>
          )}

          {/* ── Deployed Bots List ── */}
          {bots && bots.length > 0 && (
            <div className="flex flex-col gap-4 mb-12">
              {bots.map((bot) => {
                const botSessions = allSessions.filter((s: any) => s.botId === bot?.id);
                return (
                  <BotCard
                    key={bot?.id}
                    bot={bot}
                    onToggle={handleBotToggle}
                    onDelete={handleDeleteBot}
                    liveTradeCount={liveTradeCount}
                    trades={liveTrades}
                    sessions={botSessions}
                  />
                );
              })}
            </div>
          )}

          {/* ═══ SECTION 2: PERFORMANCE ANALYTICS (Inline) ═══ */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <div style={{
                width: '36px', height: '36px', borderRadius: '10px',
                background: 'rgba(6, 182, 212, 0.15)', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <TrendingUp size={18} color="#06B6D4" />
              </div>
              <div>
                <div style={{ fontSize: '16px', fontWeight: 700, color: '#06B6D4' }}>Performance Analytics</div>
                <div style={{ fontSize: '12px', color: '#6B7280' }}>All-time bot run records, session by session</div>
              </div>
            </div>
            <PerformanceSection />
          </motion.div>

        </div>
      </main>

      {/* ═══ DEPLOY BOT MODAL ═══ */}
      <AnimatePresence>
        {showDeployModal && (
          <div
            style={{
              position: 'fixed', inset: 0, zIndex: 50,
              background: 'rgba(0,0,0,0.6)',
              overflowY: 'auto', WebkitOverflowScrolling: 'touch',
              display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
              padding: '24px 12px',
            }}
            onClick={(e) => { if (e.target === e.currentTarget) setShowDeployModal(false); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              style={{
                background: 'linear-gradient(135deg, rgba(17,24,39,0.98), rgba(30,41,59,0.95))',
                backdropFilter: 'blur(20px)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '20px',
                maxWidth: '520px', width: '100%',
                margin: '0 auto',
                display: 'flex', flexDirection: 'column' as const,
              }}
            >
              {/* ── Modal Header (fixed at top) ── */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: '12px',
                padding: '20px 24px 16px',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                flexShrink: 0,
              }}>
                <div style={{
                  width: '40px', height: '40px', borderRadius: '12px', flexShrink: 0,
                  background: 'linear-gradient(135deg, rgba(34,197,94,0.2), rgba(16,185,129,0.1))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Rocket size={20} color="#22C55E" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#E5E7EB', margin: 0 }}>Deploy Synaptic Marshal</h2>
                  <p style={{ fontSize: '11px', color: '#6B7280', margin: '2px 0 0' }}>Configure and launch your trading bot</p>
                </div>
                <button
                  onClick={() => setShowDeployModal(false)}
                  style={{
                    width: '32px', height: '32px', borderRadius: '8px', border: 'none',
                    background: 'rgba(255,255,255,0.06)', color: '#9CA3AF',
                    fontSize: '18px', cursor: 'pointer', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}
                >✕</button>
              </div>

              {/* ── Scrollable Content ── */}
              <div style={{
                overflowY: 'auto', padding: '16px 24px',
                flex: 1, WebkitOverflowScrolling: 'touch' as any,
              }}>

                {/* Step 1: Select Model */}
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase' as const, letterSpacing: '1.5px', marginBottom: '8px' }}>
                    1. Select Model
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                    {BOT_MODELS.map(model => (
                      <div key={model.id}
                        onClick={() => setDeployModel(model.id)}
                        style={{
                          padding: '12px', borderRadius: '12px', cursor: 'pointer',
                          background: deployModel === model.id ? model.color + '12' : 'rgba(255,255,255,0.03)',
                          border: `2px solid ${deployModel === model.id ? model.color : 'rgba(255,255,255,0.06)'}`,
                          transition: 'all 0.2s', textAlign: 'center' as const,
                        }}>
                        <div style={{ fontSize: '13px', fontWeight: 700, color: deployModel === model.id ? model.color : '#9CA3AF' }}>{model.name}</div>
                        <div style={{ fontSize: '9px', color: '#6B7280', marginTop: '2px', lineHeight: '1.3' }}>{model.description}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Step 2: Select Exchange */}
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase' as const, letterSpacing: '1.5px', marginBottom: '8px' }}>
                    2. Select Exchange
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                    {[
                      { id: 'binance', name: 'Binance', icon: '🔶', desc: 'Largest crypto exchange' },
                      { id: 'coindcx', name: 'CoinDCX', icon: '🇮🇳', desc: "India's crypto exchange" },
                    ].map(ex => (
                      <div key={ex.id}
                        onClick={() => setDeployExchange(ex.id)}
                        style={{
                          padding: '12px', borderRadius: '10px', cursor: 'pointer',
                          background: deployExchange === ex.id ? 'rgba(14,165,233,0.1)' : 'rgba(255,255,255,0.03)',
                          border: `2px solid ${deployExchange === ex.id ? '#0EA5E9' : 'rgba(255,255,255,0.06)'}`,
                          transition: 'all 0.2s', textAlign: 'center' as const,
                        }}>
                        <div style={{ fontSize: '12px', fontWeight: 700, color: deployExchange === ex.id ? '#0EA5E9' : '#9CA3AF' }}>{ex.name}</div>
                        <div style={{ fontSize: '9px', color: '#6B7280', marginTop: '2px' }}>{ex.desc}</div>
                      </div>
                    ))}
                  </div>
                  <p style={{ fontSize: '9px', color: '#4B5563', marginTop: '6px' }}>
                    ℹ️ Make sure your API key is configured in Settings for the selected exchange
                  </p>
                </div>

                {/* Step 3: Trading Mode */}
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase' as const, letterSpacing: '1.5px', marginBottom: '8px' }}>
                    3. Trading Mode
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                    {[
                      { id: 'paper', name: 'Paper Trading', icon: '📝', desc: 'Simulated trades, no real money', color: '#0EA5E9' },
                      { id: 'live', name: 'Live Trading', icon: '💰', desc: 'Real trades with your capital', color: '#EF4444' },
                    ].map(mode => (
                      <div key={mode.id}
                        onClick={() => setDeployMode(mode.id)}
                        style={{
                          padding: '12px', borderRadius: '10px', cursor: 'pointer',
                          background: deployMode === mode.id ? mode.color + '10' : 'rgba(255,255,255,0.03)',
                          border: `2px solid ${deployMode === mode.id ? mode.color : 'rgba(255,255,255,0.06)'}`,
                          transition: 'all 0.2s', textAlign: 'center' as const,
                        }}>
                        <div style={{ fontSize: '12px', fontWeight: 700, color: deployMode === mode.id ? mode.color : '#9CA3AF' }}>{mode.name}</div>
                        <div style={{ fontSize: '9px', color: '#6B7280', marginTop: '2px' }}>{mode.desc}</div>
                      </div>
                    ))}
                  </div>
                  {deployMode === 'live' && (
                    <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column' as const, gap: '6px' }}>
                      <div style={{
                        padding: '8px 10px', borderRadius: '8px',
                        background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
                        fontSize: '10px', color: '#F87171', lineHeight: '1.4',
                      }}>
                        ⚠️ Live trading uses real capital. Ensure your risk settings are configured in Settings.
                      </div>
                      {/* Verify Exchange Connection */}
                      <button
                        onClick={handleVerifyConnection}
                        disabled={verifying}
                        style={{
                          width: '100%', padding: '8px 0', borderRadius: '8px', cursor: verifying ? 'wait' : 'pointer',
                          border: `1px solid ${verifyStatus === 'ok' ? '#22C55E' : verifyStatus === 'fail' ? '#EF4444' : 'rgba(255,255,255,0.12)'}`,
                          background: verifyStatus === 'ok' ? 'rgba(34,197,94,0.1)' : verifyStatus === 'fail' ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.04)',
                          color: verifyStatus === 'ok' ? '#22C55E' : verifyStatus === 'fail' ? '#F87171' : '#9CA3AF',
                          fontSize: '11px', fontWeight: 700, transition: 'all 0.2s',
                          opacity: verifying ? 0.7 : 1,
                        }}
                      >
                        {verifying ? 'Checking connection...' :
                          verifyStatus === 'ok' ? `✓ ${deployExchange === 'coindcx' ? 'CoinDCX' : 'Binance'} Connected${verifyBalance != null ? ` · $${verifyBalance.toFixed(2)} USDT` : ''}` :
                            verifyStatus === 'fail' ? '✗ Connection failed — check API keys' :
                              `Verify ${deployExchange === 'coindcx' ? 'CoinDCX' : 'Binance'} Connection`}
                      </button>
                    </div>
                  )}
                </div>

                {/* Step 4: Trade Settings */}
                <div style={{ marginBottom: '4px' }}>
                  <div style={{ fontSize: '10px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase' as const, letterSpacing: '1.5px', marginBottom: '8px' }}>
                    4. Trade Settings
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '11px', color: '#9CA3AF', marginBottom: '4px', fontWeight: 600 }}>
                        Max Concurrent Trades
                      </label>
                      <input
                        type="number" min={1} max={100}
                        value={deployMaxTrades}
                        onChange={(e) => setDeployMaxTrades(Math.max(1, parseInt(e.target.value) || 1))}
                        style={{
                          width: '100%', padding: '8px 10px', borderRadius: '8px', boxSizing: 'border-box' as const,
                          background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                          color: '#F0F4F8', fontSize: '14px', fontWeight: 600, outline: 'none',
                        }}
                      />
                      <p style={{ fontSize: '9px', color: '#4B5563', marginTop: '3px' }}>
                        Max positions open at the same time
                      </p>
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '11px', color: '#9CA3AF', marginBottom: '4px', fontWeight: 600 }}>
                        Capital Per Trade ($)
                      </label>
                      <input
                        type="number" min={10} max={10000} step={10}
                        value={deployCapitalPerTrade}
                        onChange={(e) => setDeployCapitalPerTrade(Math.max(10, parseInt(e.target.value) || 10))}
                        style={{
                          width: '100%', padding: '8px 10px', borderRadius: '8px', boxSizing: 'border-box' as const,
                          background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                          color: '#F0F4F8', fontSize: '14px', fontWeight: 600, outline: 'none',
                        }}
                      />
                      <p style={{ fontSize: '9px', color: '#4B5563', marginTop: '3px' }}>
                        Amount allocated per trade entry
                      </p>
                    </div>
                  </div>
                  <div style={{
                    marginTop: '8px', padding: '6px 10px', borderRadius: '8px',
                    background: 'rgba(8,145,178,0.08)', border: '1px solid rgba(8,145,178,0.2)',
                    fontSize: '10px', color: '#06B6D4',
                  }}>
                    💡 Max capital exposure: ${deployMaxTrades * deployCapitalPerTrade} ({deployMaxTrades} × ${deployCapitalPerTrade})
                  </div>
                </div>

              </div>

              {/* ── Sticky Action Buttons (always visible) ── */}
              <div style={{
                display: 'flex', gap: '10px',
                padding: '16px 24px 20px',
                borderTop: '1px solid rgba(255,255,255,0.06)',
                flexShrink: 0,
              }}>
                <button
                  onClick={() => setShowDeployModal(false)}
                  style={{
                    flex: 1, padding: '11px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.1)',
                    background: 'rgba(255,255,255,0.05)', color: '#9CA3AF',
                    fontSize: '13px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
                  }}>
                  Cancel
                </button>
                <button
                  onClick={handleDeployBot}
                  disabled={loading}
                  style={{
                    flex: 1, padding: '11px', borderRadius: '10px', border: 'none',
                    background: 'linear-gradient(135deg, #22C55E, #16A34A)',
                    color: '#fff', fontSize: '13px', fontWeight: 700, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                    transition: 'all 0.2s', opacity: loading ? 0.6 : 1,
                  }}>
                  <Rocket size={14} />
                  {loading ? 'Deploying...' : 'Deploy Bot'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style jsx>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}
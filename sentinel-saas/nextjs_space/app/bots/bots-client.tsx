'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Header } from '@/components/header';
import { BotCard } from '@/components/bot-card';
import { SegmentPerformancePanel } from '@/components/segment-performance-panel';
import {
  Rocket, X, Info, ChevronDown, ChevronRight, BookOpen
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import { SEGMENT_KNOWLEDGE } from '@/lib/segment-knowledge';

interface BotsClientProps { bots: any[]; sessions?: any[]; perfSummary?: any; }

export function BotsClient({ bots: initialBots }: BotsClientProps) {
  const [mounted, setMounted] = useState(false);
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [bots, setBots] = useState(initialBots);
  const [loading, setLoading] = useState(false);
  const [togglingBots, setTogglingBots] = useState<Record<string, boolean>>({});
  const [startAllLoading, setStartAllLoading] = useState(false);
  const [stopAllLoading, setStopAllLoading] = useState(false);
  const [deleteAllLoading, setDeleteAllLoading] = useState(false);
  const [deleteAllConfirm, setDeleteAllConfirm] = useState(false);
  const [purgeTradesLoading, setPurgeTradesLoading] = useState(false);
  const [purgeTradesConfirm, setPurgeTradesConfirm] = useState(false);

  /* ── Live state ── */
  const [liveTradeCount, setLiveTradeCount] = useState(0);
  const [tradesByBot, setTradesByBot] = useState<Record<string, any[]>>({});
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [allSessions, setAllSessions] = useState<any[]>([]);
  const [perfSummary, setPerfSummary] = useState<any>({ allTimePnl: 0, allTimeRoi: 0, totalSessions: 0 });
  const [segmentPerf, setSegmentPerf] = useState<any[]>([]);

  /* ── Deploy Wizard State ── */

  
  const [deployExchange, setDeployExchange] = useState('binance');
  const [deployMode, setDeployMode] = useState('paper');
  const [deployMaxTrades, setDeployMaxTrades] = useState(10);
  const [deployCapitalPerTrade, setDeployCapitalPerTrade] = useState(100);
  const [selectedBots, setSelectedBots] = useState<string[]>(['Titan', 'Vanguard', 'Rogue', 'Systematic', 'Momentum', 'Stat Arb']);

  const availableBots = [
    { id: 'Titan', name: 'Titan', subtitle: '(Slow)', icon: '🏛️', color: '#60A5FA', bgRef: 'rgba(59,130,246,0.1)', borderRef: 'rgba(59,130,246,0.5)', desc: 'Full protection mode. BTC chop & momentum veto active. Deploys in clear trends with HMM conviction ≥60%.' },
    { id: 'Vanguard', name: 'Vanguard', subtitle: '(Moderate)', icon: '🛡️', color: '#FCD34D', bgRef: 'rgba(234,179,8,0.1)', borderRef: 'rgba(234,179,8,0.5)', desc: 'BTC sideways veto bypassed — trades during chop. Momentum alignment still enforced.' },
    { id: 'Rogue', name: 'Rogue', subtitle: '(Aggressive)', icon: '⚡', color: '#F87171', bgRef: 'rgba(239,68,68,0.1)', borderRef: 'rgba(239,68,68,0.5)', desc: 'All macro vetoes disabled. Pure HMM execution. Highest risk. Operates in any condition.' },
    { id: 'Systematic', name: 'Pyxis', subtitle: '(Systematic)', icon: '🧭', color: '#60A5FA', bgRef: 'rgba(59,130,246,0.1)', borderRef: 'rgba(59,130,246,0.5)', desc: 'Independent SMA crossover strategy. Runs autonomously on a 1h frequency. Isolated risk (1.5x SL).' },
    { id: 'Momentum', name: 'Axiom', subtitle: '(Momentum)', icon: '📈', color: '#FCD34D', bgRef: 'rgba(234,179,8,0.1)', borderRef: 'rgba(234,179,8,0.5)', desc: 'Fast-cycle MACD/RSI/Bollinger momentum. Runs autonomously on a 15m frequency. Isolated risk (1.2x SL).' },
    { id: 'Stat Arb', name: 'Ratio', subtitle: '(Stat Arb)', icon: '⚖️', color: '#F87171', bgRef: 'rgba(239,68,68,0.1)', borderRef: 'rgba(239,68,68,0.5)', desc: 'Cross-asset rolling return statistical arbitrage. Runs on a 4h frequency. Isolated risk (2.0x SL).' },
  ];
  
  /* ── Intel Drawer State ── */
  const [intelSegmentId, setIntelSegmentId] = useState<string | null>(null);
  const [expandedCoins, setExpandedCoins] = useState<Record<string, boolean>>({});

  useEffect(() => { setMounted(true); }, []);

  const fetchLiveCount = useCallback(async () => {
    if (document.hidden) return;
    try {
      const [stateRes, perfRes, segRes] = await Promise.all([
        fetch('/api/bot-state', { cache: 'no-store' }),
        fetch('/api/performance', { cache: 'no-store' }),
        fetch('/api/performance/segment', { cache: 'no-store' }),
      ]);
      if (stateRes.ok) {
        const d = await stateRes.json();
        const trades = d?.tradebook?.trades || [];
        
        // Group trades by bot ID so BotCard can calculate PnL properly
        const grouped: Record<string, any[]> = {};
        for (const t of trades) {
            const botName = (t.bot_name || t.botName || '').toLowerCase();
            const bId = t.bot_id || t.botId;
            let matchingBot = initialBots.find(b => b.id === bId);
            if (!matchingBot) {
                const modelKeywords = ['adaptive', 'standard', 'conservative', 'aggressive'];
                const tradeModel = modelKeywords.find(k => botName.includes(k));
                matchingBot = initialBots.find(b => {
                    const bName = (b.name || '').toLowerCase();
                    const bModel = modelKeywords.find(k => bName.includes(k));
                    if (tradeModel && bModel) return tradeModel === bModel;
                    return bName.includes(botName) || botName.includes(bName);
                });
            }
            if (matchingBot) {
                if (!grouped[matchingBot.id]) grouped[matchingBot.id] = [];
                grouped[matchingBot.id].push(t);
            }
        }
        setTradesByBot(grouped);
        const cs = d?.multi?.coin_states || {};
        const prices: Record<string, number> = {};
        for (const [sym, state] of Object.entries(cs)) {
          const p = (state as any)?.price;
          if (p && p > 0) prices[sym] = p;
        }
        setLivePrices(prev => ({ ...prev, ...prices }));
        setLiveTradeCount(trades.filter((t: any) => (t.status || '').toUpperCase() === 'ACTIVE').length);
      }
      if (perfRes.ok) {
        const d = await perfRes.json();
        if (d) { setAllSessions(d.sessions || []); setPerfSummary(d.summary || perfSummary); }
      }
      if (segRes.ok) {
        const d = await segRes.json();
        if (d?.segments) setSegmentPerf(d.segments);
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchLiveCount();
    const timer = setInterval(fetchLiveCount, 15000);
    return () => clearInterval(timer);
  }, [fetchLiveCount]);

  const handleBotToggle = async (botId: string, currentStatus: boolean) => {
    if (togglingBots[botId]) return; // prevent double-click
    setTogglingBots(prev => ({ ...prev, [botId]: true }));
    try {
      const res = await fetch('/api/bots/toggle', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId, isActive: !currentStatus }),
      });
      if (res.ok) {
        setBots(prev => prev.map((b: any) => b.id === botId ? { ...b, isActive: !currentStatus } : b));
        fetchLiveCount();
      } else {
        const d = await res.json().catch(() => ({}));
        alert(d.error || 'Failed to toggle bot');
      }
    } catch { alert('Failed to toggle bot. Please try again.'); }
    finally { setTogglingBots(prev => { const n = { ...prev }; delete n[botId]; return n; }); }
  };

  const handleDeployBots = async () => {
    setLoading(true);
    try {
      const allDeployments = availableBots.map(b => ({
        name: `${b.name} ${b.subtitle}`, segment: b.id, coinList: []
      }));
      const deployments = allDeployments.filter(d => selectedBots.includes(d.segment));

      const res = await fetch('/api/bots/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exchange: deployExchange,
          mode: deployMode,
          maxTrades: deployMaxTrades,
          capitalPerTrade: deployCapitalPerTrade,
          deployments,
        }),
      });
      if (res.ok) { setShowDeployModal(false); window.location.reload(); }
      else { const data = await res.json(); alert(data.error || 'Failed to deploy bots'); }
    } catch (error) { console.error('Error deploying bots:', error); }
    finally { setLoading(false); }
  };

  const handleDeleteBot = async (botId: string) => {
    try {
      const res = await fetch('/api/bots/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId }),
      });
      if (res.ok) {
        setBots(prev => prev.filter((b: any) => b.id !== botId));
        fetchLiveCount();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Failed to delete bot. Try stopping it first.');
      }
    } catch { alert('Failed to delete bot. Please try again.'); }
  };

  const handleRetireBot = async (botId: string) => {
    try {
      const res = await fetch('/api/bots/retire', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        // Remove from active grid — it now lives in Segment Performance panel
        setBots(prev => prev.filter((b: any) => b.id !== botId));
        fetchLiveCount();
      } else {
        alert(d.error || 'Failed to retire bot.');
      }
    } catch { alert('Failed to retire bot. Please try again.'); }
  };

  const handleStopAll = async () => {
    setStopAllLoading(true);
    try {
      const res = await fetch('/api/bots/stop-all', { method: 'POST' });
      if (res.ok) window.location.reload();
      else { const d = await res.json(); alert(d.error || 'Failed to stop bots'); }
    } catch { alert('Failed to stop all bots'); }
    finally { setStopAllLoading(false); }
  };

  const handleStartAll = async () => {
    setStartAllLoading(true);
    try {
      const res = await fetch('/api/bots/start-all', { method: 'POST' });
      if (res.ok) window.location.reload();
      else { const d = await res.json(); alert(d.error || 'Failed to start bots'); }
    } catch { alert('Failed to start all bots'); }
    finally { setStartAllLoading(false); }
  };

  const handleDeleteAll = async () => {
    if (!deleteAllConfirm) { setDeleteAllConfirm(true); setTimeout(() => setDeleteAllConfirm(false), 4000); return; }
    setDeleteAllLoading(true);
    try {
      const res = await fetch('/api/bots/delete-all', { method: 'POST' });
      if (res.ok) { setDeleteAllConfirm(false); window.location.reload(); }
      else { const d = await res.json(); alert(d.error || 'Failed to delete bots'); }
    } catch { alert('Failed to delete all bots'); }
    finally { setDeleteAllLoading(false); setDeleteAllConfirm(false); }
  };

  const handlePurgeTrades = async () => {
    if (!purgeTradesConfirm) { setPurgeTradesConfirm(true); setTimeout(() => setPurgeTradesConfirm(false), 4000); return; }
    setPurgeTradesLoading(true);
    try {
      const res = await fetch('/api/admin/purge-trades', { method: 'POST' });
      const d = await res.json();
      if (res.ok) { setPurgeTradesConfirm(false); alert(`✅ Purged ${d.deleted} trades from the database.`); fetchLiveCount(); }
      else { alert(d.error || 'Failed to purge trades'); }
    } catch { alert('Failed to purge trades'); }
    finally { setPurgeTradesLoading(false); setPurgeTradesConfirm(false); }
  };

  const activeBots = bots.filter((b: any) => b?.status !== 'retired');
  const runningBots = activeBots.filter((b: any) => b?.isActive);
  const stoppedBots = activeBots.filter((b: any) => !b?.isActive);

  // Derived Values
  const botMultiplier = selectedBots.length; // deploy selected sum
  const totalMaxExposure = botMultiplier * deployMaxTrades * deployCapitalPerTrade;

  const intelData = useMemo(() => SEGMENT_KNOWLEDGE.find(s => s.id === intelSegmentId), [intelSegmentId]);

  if (!mounted) return null;

  return (
    <div className="min-h-screen">
      <Header />
      <main style={{ paddingTop: 88, paddingBottom: 48, paddingLeft: 16, paddingRight: 16 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>

          {/* ════ BOTS HEADER ════ */}
          <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} style={{ marginBottom: 28 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
              padding: '10px 18px', borderRadius: 'var(--radius-lg)',
              background: 'rgba(13,20,32,0.6)', backdropFilter: 'blur(12px)',
              border: '1px solid var(--color-border)', width: 'fit-content',
            }}>
              <span className="live-dot" style={runningBots.length === 0 ? { background: '#6B7280', boxShadow: 'none', animationPlayState: 'paused' } : {}} />
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: runningBots.length > 0 ? 'var(--color-success)' : 'var(--color-text-muted)', letterSpacing: '0.5px' }}>
                ENGINE {runningBots.length > 0 ? 'RUNNING' : 'IDLE'}
              </span>
              <span style={{ width: 1, height: 14, background: 'var(--color-border)' }} />
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                <strong style={{ color: 'var(--color-text)' }}>{runningBots.length}</strong> active bot{runningBots.length !== 1 ? 's' : ''}
              </span>
              <span style={{ width: 1, height: 14, background: 'var(--color-border)' }} />
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                <strong style={{ color: 'var(--color-info)', fontFamily: 'monospace' }}>{liveTradeCount}</strong> open positions
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <h1 style={{ fontSize: 'var(--text-3xl)', fontWeight: 800, margin: 0, letterSpacing: '-0.03em' }}>
                  <span className="text-gradient">Bots</span>
                </h1>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
                  Deploy, monitor &amp; manage your automated trading bots
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {stoppedBots.length > 0 && (
                  <button onClick={handleStartAll} disabled={startAllLoading} className="btn-ghost" style={{ fontSize: 'var(--text-sm)', padding: '10px 16px', color: '#22C55E', border: '1px solid rgba(34,197,94,0.3)', opacity: startAllLoading ? 0.6 : 1 }}>
                    {startAllLoading ? 'Starting…' : '▶ Start All'}
                  </button>
                )}
                {runningBots.length > 0 && (
                  <button onClick={handleStopAll} disabled={stopAllLoading} className="btn-ghost" style={{ fontSize: 'var(--text-sm)', padding: '10px 16px', color: '#F59E0B', border: '1px solid rgba(245,158,11,0.3)', opacity: stopAllLoading ? 0.6 : 1 }}>
                    {stopAllLoading ? 'Stopping…' : '⏹ Stop All'}
                  </button>
                )}
                {activeBots.length > 0 && (
                  <button onClick={handleDeleteAll} disabled={deleteAllLoading} className="btn-ghost" style={{ fontSize: 'var(--text-sm)', padding: '10px 16px', color: deleteAllConfirm ? '#F87171' : '#EF4444', border: `1px solid ${deleteAllConfirm ? 'rgba(248,113,113,0.5)' : 'rgba(239,68,68,0.25)'}`, opacity: deleteAllLoading ? 0.6 : 1, transition: 'all 0.2s' }}>
                    {deleteAllLoading ? 'Deleting…' : deleteAllConfirm ? '⚠️ Confirm Delete All' : '🗑 Delete All'}
                  </button>
                )}
                <button onClick={handlePurgeTrades} disabled={purgeTradesLoading} className="btn-ghost" style={{ fontSize: 'var(--text-sm)', padding: '10px 16px', color: purgeTradesConfirm ? '#FCD34D' : '#9CA3AF', border: `1px solid ${purgeTradesConfirm ? 'rgba(252,211,77,0.5)' : 'rgba(156,163,175,0.2)'}`, opacity: purgeTradesLoading ? 0.6 : 1, transition: 'all 0.2s' }}>
                  {purgeTradesLoading ? 'Purging…' : purgeTradesConfirm ? '⚠️ Confirm Purge Trades' : '🧹 Purge All Trades'}
                </button>
                <button onClick={() => setShowDeployModal(true)} className="btn-success" style={{ fontSize: 'var(--text-base)', padding: '11px 22px' }}>
                  <Rocket style={{ width: 16, height: 16 }} /> Deploy Launchpad
                </button>
              </div>
            </div>
          </motion.div>

          {/* ════ EMPTY STATE ════ */}
          {activeBots.length === 0 && (
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              style={{
                background: 'linear-gradient(135deg, rgba(17,24,39,0.7), rgba(30,41,59,0.5))',
                backdropFilter: 'blur(12px)', border: '1px solid rgba(34,197,94,0.2)',
                borderRadius: 'var(--radius-xl)', padding: 48, textAlign: 'center',
                marginBottom: 32, boxShadow: 'var(--shadow-card)',
              }}>
              <div style={{
                width: 64, height: 64, borderRadius: 18, margin: '0 auto 20px',
                background: 'linear-gradient(135deg, rgba(34,197,94,0.2), rgba(16,185,129,0.08))', border: '1px solid rgba(34,197,94,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28,
              }}>🧠</div>
              <h3 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, margin: '0 0 8px', color: 'var(--color-text)' }}>No bots deployed yet</h3>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', margin: '0 0 8px' }}>HMM-Powered Crypto Trading Engine</p>
              <button onClick={() => setShowDeployModal(true)} className="btn-success mt-4">
                <Rocket style={{ width: 15, height: 15 }} /> Deploy Your First Bot
              </button>
            </motion.div>
          )}

          {/* ════ BOT ROWS LIST ════ */}
          {activeBots.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 40 }}>
              {activeBots.map((bot, i) => {
                const botSessions = allSessions.filter((s: any) => s.botId === bot?.id);
                const displayTrades = tradesByBot[bot?.id] ?? [];
                return (
                  <motion.div key={bot?.id} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}>
                    <BotCard bot={bot} onToggle={handleBotToggle} onDelete={handleDeleteBot} onRetire={handleRetireBot} liveTradeCount={liveTradeCount} trades={displayTrades} sessions={botSessions} livePrices={livePrices} isToggling={!!togglingBots[bot?.id]} />
                  </motion.div>
                );
              })}
            </div>
          )}

        </div>

        {/* ════ SEGMENT PERFORMANCE PANEL ════ */}
        <SegmentPerformancePanel segments={segmentPerf} />

      </main>

      {/* ════ DEPLOY BOT MODAL (LAUNCHPAD) ════ */}
      <AnimatePresence>
        {showDeployModal && (
          <div
            style={{
              position: 'fixed', inset: 0, zIndex: 50,
              background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '24px 16px',
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.98, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 10 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              style={{
                background: 'linear-gradient(145deg, #0D1420 0%, #111827 100%)',
                border: '1px solid var(--color-border)', borderRadius: 'var(--radius-xl)',
                boxShadow: '0 24px 64px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.04)',
                maxWidth: 900, width: '100%',
                maxHeight: 'calc(100vh - 48px)',
                display: 'flex', overflow: 'hidden'
              }}
            >
              
              {/* Left Side: Configuration Wizard */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
                
                {/* Modal Header */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 14, padding: '20px 24px', borderBottom: '1px solid var(--color-border)',
                }}>
                  <div style={{
                    width: 42, height: 42, borderRadius: 'var(--radius-md)', flexShrink: 0,
                    background: 'linear-gradient(135deg, rgba(34,197,94,0.2), rgba(16,185,129,0.08))',
                    border: '1px solid rgba(34,197,94,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Rocket style={{ width: 20, height: 20, color: '#22C55E' }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>Deploy Launchpad</h2>
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: '2px 0 0' }}>Configure multi-model deployment</p>
                  </div>
                  <button onClick={() => setShowDeployModal(false)} className="btn-ghost" style={{ padding: 6 }}><X size={20} /></button>
                </div>

                <div style={{ overflowY: 'auto', padding: '20px 24px', flex: 1 }}>
                  
                  {/* SIX TIER BOTS — horizontal row selector */}
                  <div style={{ marginBottom: 24 }}>
                    <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--color-text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 12 }}>{selectedBots.length} BOTS WILL BE DEPLOYED</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {availableBots.map(bot => {
                        const selected = selectedBots.includes(bot.id);
                        return (
                          <div key={bot.id} onClick={() => setSelectedBots(prev => prev.includes(bot.id) ? prev.filter(b => b !== bot.id) : [...prev, bot.id])}
                            style={{
                              cursor: 'pointer',
                              display: 'flex', alignItems: 'center', gap: 14,
                              padding: '10px 14px', borderRadius: 'var(--radius-md)',
                              background: selected ? bot.bgRef : 'rgba(255,255,255,0.02)',
                              border: selected ? `1px solid ${bot.borderRef}` : '1px solid var(--color-border)',
                              transition: 'all 0.18s',
                              opacity: selected ? 1 : 0.55,
                            }}
                          >
                            {/* Checkbox indicator */}
                            <div style={{
                              width: 18, height: 18, borderRadius: 5, flexShrink: 0,
                              border: `2px solid ${selected ? bot.color : 'var(--color-border)'}`,
                              background: selected ? bot.color + '30' : 'transparent',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              transition: 'all 0.18s',
                              fontSize: 10,
                            }}>
                              {selected && '✓'}
                            </div>
                            <div style={{ fontSize: 18, flexShrink: 0 }}>{bot.icon}</div>
                            <div style={{ flex: 1 }}>
                              <span style={{ fontWeight: 700, fontSize: 'var(--text-sm)', color: bot.color }}>{bot.name}</span>
                              <span style={{ color: 'var(--color-text-muted)', fontWeight: 400, fontSize: 'var(--text-sm)' }}> {bot.subtitle}</span>
                            </div>
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', lineHeight: 1.4, maxWidth: 280, textAlign: 'right' }}>{bot.desc}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <hr style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '0 0 24px 0' }} />

                  {/* Unified Configuration Strip */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                    <div>
                      <div className="section-title" style={{ marginBottom: 10 }}>Exchange</div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {[{ id: 'binance', name: 'Binance', icon: '🔶' }, { id: 'coindcx', name: 'CoinDCX', icon: '🇮🇳' }].map(ex => (
                          <button key={ex.id} onClick={() => setDeployExchange(ex.id)} style={{
                            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                            padding: '10px 0', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                            background: deployExchange === ex.id ? 'rgba(14,165,233,0.1)' : 'rgba(255,255,255,0.03)',
                            border: `1.5px solid ${deployExchange === ex.id ? '#0EA5E9' : 'var(--color-border)'}`,
                            fontSize: 'var(--text-xs)', fontWeight: 700, color: deployExchange === ex.id ? '#0EA5E9' : 'var(--color-text-secondary)', transition: 'all 0.2s'
                          }}>
                            {ex.icon} {ex.name}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="section-title" style={{ marginBottom: 10 }}>Trading Mode</div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {[{ id: 'paper', name: 'Paper', icon: '📝', color: '#0EA5E9' }, { id: 'live', name: 'Live', icon: '⚡', color: '#EF4444' }].map(m => (
                          <button key={m.id} onClick={() => setDeployMode(m.id)} style={{
                            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                            padding: '10px 0', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                            background: deployMode === m.id ? `${m.color}15` : 'rgba(255,255,255,0.03)',
                            border: `1.5px solid ${deployMode === m.id ? m.color : 'var(--color-border)'}`,
                            fontSize: 'var(--text-xs)', fontWeight: 700, color: deployMode === m.id ? m.color : 'var(--color-text-secondary)', transition: 'all 0.2s'
                          }}>
                            {m.icon} {m.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Capital Limits */}
                  <div style={{ marginTop: 24, padding: 20, borderRadius: 'var(--radius-lg)', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--color-border)' }}>
                    <div className="section-title" style={{ marginBottom: 16 }}>Risk & Capital Parameters</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginBottom: 6 }}>Trades Per Bot</label>
                        <input type="number" min={1} max={100} value={deployMaxTrades} onChange={(e) => setDeployMaxTrades(Math.max(1, parseInt(e.target.value) || 1))} className="input-field" style={{ fontFamily: 'monospace' }} />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginBottom: 6 }}>Capital Per Trade ($)</label>
                        <input type="number" min={10} max={10000} step={10} value={deployCapitalPerTrade} onChange={(e) => setDeployCapitalPerTrade(Math.max(10, parseInt(e.target.value) || 10))} className="input-field" style={{ fontFamily: 'monospace' }} />
                      </div>
                    </div>

                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      marginTop: 16, paddingTop: 16, borderTop: '1px dashed var(--color-border)',
                      fontSize: 'var(--text-sm)', color: 'var(--color-text)',
                    }}>
                      <span style={{ color: 'var(--color-text-secondary)' }}>Maximum Total Exposure</span>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontFamily: 'monospace', fontWeight: 800, color: 'var(--color-info)', fontSize: 18 }}>${totalMaxExposure.toLocaleString()}</span>
                        <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>{selectedBots.length} Bot{selectedBots.length === 1 ? '' : 's'} × {deployMaxTrades} Trades × ${deployCapitalPerTrade}</div>
                      </div>
                    </div>
                  </div>

                </div>

                {/* Footer Controls */}
                <div style={{ display: 'flex', gap: 12, padding: '16px 24px 20px', borderTop: '1px solid var(--color-border)', background: 'rgba(13,20,32,0.8)' }}>
                  <button onClick={() => setShowDeployModal(false)} className="btn-ghost" style={{ flex: 1, padding: '12px 0' }}>Cancel</button>
                  <button onClick={handleDeployBots} disabled={loading || selectedBots.length === 0} className="btn-success" style={{ flex: 2, padding: '12px 0', fontSize: 15, opacity: (loading || selectedBots.length === 0) ? 0.7 : 1 }}>
                    <Rocket style={{ width: 16, height: 16 }} /> {loading ? `Deploying ${selectedBots.length} Bots...` : `Deploy ${selectedBots.length} Bot${selectedBots.length === 1 ? '' : 's'}`}
                  </button>
                </div>
              </div>

              {/* Right Side: Intel Drawer (Sliding Panel) */}
              <AnimatePresence>
                {intelData && (
                  <motion.div
                    initial={{ width: 0, opacity: 0 }}
                    animate={{ width: 340, opacity: 1 }}
                    exit={{ width: 0, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    style={{ borderLeft: '1px solid var(--color-border)', background: '#141D2C', display: 'flex', flexDirection: 'column' }}
                  >
                    <div style={{ padding: '24px 20px', flex: 1, overflowY: 'auto' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 24 }}>{intelData.icon}</span>
                          <div>
                            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{intelData.name}</h3>
                            <span style={{ fontSize: 10, color: 'var(--color-info)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Intel Briefing</span>
                          </div>
                        </div>
                        <button onClick={() => setIntelSegmentId(null)} className="btn-ghost" style={{ padding: 4 }}><X size={16} /></button>
                      </div>

                      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.6, marginBottom: 24 }}>
                        {intelData.description}
                      </p>

                      <div className="section-title" style={{ marginBottom: 12, fontSize: 11, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}><BookOpen size={12}/> Tracked Assets ({intelData.coins.length})</div>
                      
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {intelData.coins.map(coin => {
                          const isExpanded = expandedCoins[coin.symbol];
                          return (
                            <div key={coin.symbol} style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                              <button onClick={() => setExpandedCoins(prev => ({...prev, [coin.symbol]: !prev[coin.symbol]}))}
                                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text)' }}>
                                <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: '#3B82F6' }}>{coin.symbol}</span>
                                {isExpanded ? <ChevronDown size={14} color="var(--color-text-secondary)"/> : <ChevronRight size={14} color="var(--color-text-secondary)"/>}
                              </button>
                              
                              <AnimatePresence>
                                {isExpanded && (
                                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: 'hidden' }}>
                                    <div style={{ padding: '0 12px 12px 12px', fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                                      <div style={{ color: 'var(--color-text)', fontWeight: 600, marginBottom: 4 }}>{coin.name}</div>
                                      {coin.description}
                                      
                                      {coin.people && coin.people.length > 0 && (
                                        <div style={{ marginTop: 10, padding: 8, background: 'rgba(255,255,255,0.03)', borderRadius: 4 }}>
                                          <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 4, textTransform: 'uppercase' }}>Key Figures</div>
                                          {coin.people.map(p => (
                                            <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between' }}>
                                              <span style={{ color: 'var(--color-text)' }}>{p.name} <span style={{ color: 'var(--color-text-muted)', fontSize: 10 }}>({p.role})</span></span>
                                              {p.link && <a href={p.link} target="_blank" rel="noreferrer" style={{ color: 'var(--color-info)' }}>Link</a>}
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                      
                                      {coin.links && coin.links.length > 0 && (
                                        <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                          {coin.links.map(l => (
                                            <a key={l.url} href={l.url} target="_blank" rel="noreferrer" style={{ color: '#3B82F6', textDecoration: 'underline' }}>{l.label}</a>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
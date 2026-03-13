'use client';

import { useState, useEffect, useCallback } from 'react';
import { Header } from '@/components/header';
import { BotCard } from '@/components/bot-card';
import {
  Plus, Trash2, Shield, TrendingUp, FlaskConical, Play, Rocket,
  ChevronDown, ChevronUp, Activity, Archive, Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession } from 'next-auth/react';

/* ═══ Bot Model Definitions — 11 Segment Bots ═══ */
const BOT_MODELS = [
  {
    id: 'adaptive',
    segment: 'ALL',
    name: 'Synaptic Adaptive — ALL',
    color: '#22C55E',
    icon: '🧠',
    tagline: 'All Segments · Heatmap Router · Auto-Regime',
    description: 'Dynamically picks the top 2 hottest market segments each cycle using Institutional 3-Pillar scoring. Best for users who want full market coverage.',
    coins: ['BTC', 'ETH', 'SOL', 'DOGE', 'UNI', 'FET', '...'],
  },
  {
    id: 'adaptive',
    segment: 'L1',
    name: 'L1 Specialist',
    color: '#3B82F6',
    icon: '🔵',
    tagline: 'Layer-1 · BTC · ETH · SOL · SUI',
    description: 'Focused on the largest Layer-1 chains. Stable, high-liquidity assets with deep market structure.',
    coins: ['BTC', 'ETH', 'SOL', 'BNB', 'AVAX', 'SUI'],
  },
  {
    id: 'adaptive',
    segment: 'L2',
    name: 'L2 Specialist',
    color: '#8B5CF6',
    icon: '🟣',
    tagline: 'Layer-2 · ARB · OP · POL · STRK',
    description: 'Targets Ethereum scaling solutions — high beta to ETH with independent catalysts.',
    coins: ['ARB', 'OP', 'POL', 'MNT', 'STRK'],
  },
  {
    id: 'adaptive',
    segment: 'DeFi',
    name: 'DeFi Specialist',
    color: '#10B981',
    icon: '🌊',
    tagline: 'DeFi · UNI · AAVE · CRV · RUNE',
    description: 'Decentralized Finance protocols. Highly reactive to DEX volume and TVL shifts.',
    coins: ['UNI', 'AAVE', 'CRV', 'JUP', 'RUNE'],
  },
  {
    id: 'adaptive',
    segment: 'AI',
    name: 'AI Specialist',
    color: '#06B6D4',
    icon: '🤖',
    tagline: 'AI Tokens · TAO · FET · WLD · AKT',
    description: 'AI/ML narrative tokens. Strong trend-following behavior during AI hype cycles.',
    coins: ['TAO', 'FET', 'INJ', 'WLD', 'AKT'],
  },
  {
    id: 'adaptive',
    segment: 'Meme',
    name: 'Meme Specialist',
    color: '#F97316',
    icon: '🐸',
    tagline: 'Meme · DOGE · PEPE · WIF · BONK',
    description: 'High-volatility meme tokens. Explosive moves — sized conservatively with tight stops.',
    coins: ['DOGE', 'SHIB', 'PEPE', 'WIF', 'BONK'],
  },
  {
    id: 'adaptive',
    segment: 'RWA',
    name: 'RWA Specialist',
    color: '#EAB308',
    icon: '🏦',
    tagline: 'Real World Assets · ONDO · LINK · PENDLE',
    description: 'Real World Asset tokens tracking tokenized bonds, credit, and yield protocols.',
    coins: ['ONDO', 'PENDLE', 'LINK', 'POLYX', 'TRU'],
  },
  {
    id: 'adaptive',
    segment: 'Gaming',
    name: 'Gaming Specialist',
    color: '#EC4899',
    icon: '🎮',
    tagline: 'Gaming/Metaverse · IMX · AXS · SAND',
    description: 'GameFi and metaverse tokens. Trend with gaming narrative cycles and NFT market activity.',
    coins: ['IMX', 'AXS', 'SAND', 'RONIN', 'PIXEL'],
  },
  {
    id: 'adaptive',
    segment: 'DePIN',
    name: 'DePIN Specialist',
    color: '#14B8A6',
    icon: '📡',
    tagline: 'DePIN · FIL · AR · HNT · IOTX',
    description: 'Decentralized Physical Infrastructure Networks — data storage, wireless, IoT.',
    coins: ['FIL', 'AR', 'HNT', 'IOTX'],
  },
  {
    id: 'adaptive',
    segment: 'Modular',
    name: 'Modular Specialist',
    color: '#6366F1',
    icon: '🧩',
    tagline: 'Modular · TIA · DYM',
    description: 'Modular blockchain infrastructure — data availability layers with high growth potential.',
    coins: ['TIA', 'DYM'],
  },
  {
    id: 'adaptive',
    segment: 'Oracles',
    name: 'Oracles Specialist',
    color: '#F43F5E',
    icon: '🔮',
    tagline: 'Oracles · PYTH · TRB · API3',
    description: 'Oracle networks supplying on-chain data feeds. Reactive to DeFi adoption and cross-chain activity.',
    coins: ['PYTH', 'TRB', 'API3'],
  },
];

interface BotsClientProps { bots: any[]; sessions?: any[]; perfSummary?: any; }

export function BotsClient({ bots: initialBots }: BotsClientProps) {
  const { data: session } = useSession();
  const isAdmin = (session?.user as any)?.role === 'admin';
  const [mounted, setMounted] = useState(false);
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [bots, setBots] = useState(initialBots);
  const [loading, setLoading] = useState(false);

  /* ── Deploy modal state ── */
  const [deployModel, setDeployModel] = useState('adaptive');
  const [deploySegment, setDeploySegment] = useState('ALL');
  const [deployExchange, setDeployExchange] = useState('binance');
  const [deployMode, setDeployMode] = useState('paper');
  const [deployMaxTrades, setDeployMaxTrades] = useState(25);
  const [deployCapitalPerTrade, setDeployCapitalPerTrade] = useState(100);
  const [deployLeverage, setDeployLeverage] = useState(20); // for quickscalper
  const [verifying, setVerifying] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [verifyBalance, setVerifyBalance] = useState<number | null>(null);

  /* ── Live state ── */
  const [liveTradeCount, setLiveTradeCount] = useState(0);
  const [liveTrades, setLiveTrades] = useState<any[]>([]);
  const [allSessions, setAllSessions] = useState<any[]>([]);
  const [perfSummary, setPerfSummary] = useState<any>({ allTimePnl: 0, allTimeRoi: 0, totalSessions: 0 });

  useEffect(() => { setMounted(true); }, []);

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

  useEffect(() => {
    fetch('/api/performance', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) { setAllSessions(d.sessions || []); setPerfSummary(d.summary || perfSummary); }
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
    setVerifying(true); setVerifyStatus('idle'); setVerifyBalance(null);
    try {
      const res = await fetch('/api/wallet-balance');
      const data = await res.json();
      const balance = deployExchange === 'coindcx' ? data.coindcx : data.binance;
      const isConnected = deployExchange === 'coindcx' ? data.coindcxConnected : data.binanceConnected;
      if (balance !== null && balance !== undefined) { setVerifyStatus('ok'); setVerifyBalance(balance); }
      else if (isConnected) { setVerifyStatus('ok'); setVerifyBalance(null); }
      else { setVerifyStatus('fail'); }
    } catch { setVerifyStatus('fail'); }
    finally { setVerifying(false); }
  };

  const handleDeployBot = async () => {
    setLoading(true);
    try {
      const selectedModel = BOT_MODELS.find(m => m.id === deployModel && (m as any).segment === deploySegment);
      const res = await fetch('/api/bots/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: selectedModel?.name || 'Synaptic Adaptive — ALL',
          exchange: deployExchange, mode: deployMode,
          maxTrades: deployMaxTrades, capitalPerTrade: deployCapitalPerTrade,
          brainType: deployModel,
          segment: deploySegment,
        }),
      });
      if (res.ok) { setShowDeployModal(false); window.location.reload(); }
      else { const data = await res.json(); alert(data.error || 'Failed to deploy bot'); }
    } catch (error) { console.error('Error deploying bot:', error); }
    finally { setLoading(false); }
  };

  const handleDeleteBot = async (botId: string) => {
    try {
      const res = await fetch('/api/bots/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId }),
      });
      if (res.ok) window.location.reload();
      else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Failed to delete bot. Try stopping it first.');
      }
    } catch { alert('Failed to delete bot. Please try again.'); }
  };

  const activeBots = bots.filter((b: any) => b?.status !== 'retired');
  const runningBots = activeBots.filter((b: any) => b?.isActive);
  const signFmt = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2);

  if (!mounted) return null;

  return (
    <div className="min-h-screen">
      <Header />
      <main style={{ paddingTop: 88, paddingBottom: 48, paddingLeft: 16, paddingRight: 16 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>

          {/* ════ COCKPIT HEADER ════ */}
          <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}
            style={{ marginBottom: 28 }}
          >
            {/* Engine status bar */}
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
              {perfSummary.allTimePnl !== 0 && (
                <>
                  <span style={{ width: 1, height: 14, background: 'var(--color-border)' }} />
                  <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'monospace', fontWeight: 700, color: perfSummary.allTimePnl >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                    {signFmt(perfSummary.allTimePnl)} USDT all-time
                  </span>
                </>
              )}
            </div>

            {/* Title row */}
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <h1 style={{ fontSize: 'var(--text-3xl)', fontWeight: 800, margin: 0, letterSpacing: '-0.03em' }}>
                  <span className="text-gradient">Cockpit</span>
                </h1>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', margin: '4px 0 0' }}>
                  Deploy, monitor &amp; manage your automated trading bots
                </p>
              </div>
              <button
                onClick={() => setShowDeployModal(true)}
                className="btn-success"
                style={{ fontSize: 'var(--text-base)', padding: '11px 22px' }}
              >
                <Rocket style={{ width: 16, height: 16 }} />
                Deploy Bot
              </button>
            </div>
          </motion.div>

          {/* ════ EMPTY STATE ════ */}
          {activeBots.length === 0 && (
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              style={{
                background: 'linear-gradient(135deg, rgba(17,24,39,0.7), rgba(30,41,59,0.5))',
                backdropFilter: 'blur(12px)',
                border: '1px solid rgba(34,197,94,0.2)',
                borderRadius: 'var(--radius-xl)', padding: 48, textAlign: 'center',
                marginBottom: 32, boxShadow: 'var(--shadow-card)',
              }}>
              <div style={{
                width: 64, height: 64, borderRadius: 18, margin: '0 auto 20px',
                background: 'linear-gradient(135deg, rgba(34,197,94,0.2), rgba(16,185,129,0.08))',
                border: '1px solid rgba(34,197,94,0.25)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28,
              }}>🧠</div>
              <h3 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, margin: '0 0 8px', color: 'var(--color-text)' }}>
                No bots deployed yet
              </h3>
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', margin: '0 0 8px' }}>
                HMM-Powered Crypto Trading Engine
              </p>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 24, margin: '20px 0 28px', flexWrap: 'wrap' }}>
                {['Auto regime detection', 'Multi-timeframe HMM', 'Smart risk management'].map(f => (
                  <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                    <span style={{ color: 'var(--color-success)', fontSize: 12 }}>✓</span> {f}
                  </div>
                ))}
              </div>
              <button onClick={() => setShowDeployModal(true)} className="btn-success">
                <Rocket style={{ width: 15, height: 15 }} /> Deploy Your First Bot
              </button>
            </motion.div>
          )}

          {/* ════ BOT CARDS LIST ════ */}
          {activeBots.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 40 }}>
              {activeBots.map((bot, i) => {
                const botSessions = allSessions.filter((s: any) => s.botId === bot?.id);
                const botTrades = liveTrades.filter((t: any) =>
                  (t.bot_id && bot?.id && t.bot_id === bot.id) ||
                  (t.botId && bot?.id && t.botId === bot.id)
                );
                const displayTrades = botTrades.length > 0 ? botTrades : (activeBots.length === 1 ? liveTrades : []);
                return (
                  <motion.div key={bot?.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
                    <BotCard
                      bot={bot}
                      onToggle={handleBotToggle}
                      onDelete={handleDeleteBot}
                      liveTradeCount={liveTradeCount}
                      trades={displayTrades}
                      sessions={botSessions}
                    />
                  </motion.div>
                );
              })}
            </div>
          )}

        </div>
      </main>

      {/* ════ DEPLOY BOT MODAL ════ */}
      <AnimatePresence>
        {showDeployModal && (
          <div
            style={{
              position: 'fixed', inset: 0, zIndex: 50,
              background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '24px 16px',
            }}
            onClick={(e) => { if (e.target === e.currentTarget) setShowDeployModal(false); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              style={{
                background: 'linear-gradient(145deg, #0D1420 0%, #111827 100%)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-xl)',
                boxShadow: '0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)',
                maxWidth: 520, width: '100%',
                maxHeight: 'calc(100vh - 48px)',
                display: 'flex', flexDirection: 'column',
              }}
            >
              {/* Modal Header */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '20px 24px 18px',
                borderBottom: '1px solid var(--color-border)',
              }}>
                <div style={{
                  width: 42, height: 42, borderRadius: 'var(--radius-md)', flexShrink: 0,
                  background: 'linear-gradient(135deg, rgba(34,197,94,0.2), rgba(16,185,129,0.08))',
                  border: '1px solid rgba(34,197,94,0.25)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Rocket style={{ width: 20, height: 20, color: '#22C55E' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>
                    Deploy Synaptic Bot
                  </h2>
                  <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: '2px 0 0' }}>
                    Configure your trading engine
                  </p>
                </div>
                <button
                  onClick={() => setShowDeployModal(false)}
                  style={{
                    width: 32, height: 32, border: 'none', borderRadius: 'var(--radius-sm)',
                    background: 'rgba(255,255,255,0.06)', color: 'var(--color-text-secondary)',
                    fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'background 0.2s',
                  }}
                >✕</button>
              </div>

              {/* Scrollable content */}
              <div style={{ overflowY: 'auto', padding: '20px 24px', flex: 1 }}>

                {/* ── Bot Model Selector — 11 Segment Bots ── */}
                <div style={{ marginBottom: 20 }}>
                  <div className="section-title" style={{ marginBottom: 10 }}>Select Bot Type</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
                    {BOT_MODELS.map(model => {
                      const selected = deployModel === model.id && deploySegment === (model as any).segment;
                      return (
                        <button key={`${model.id}-${(model as any).segment}`}
                          onClick={() => { setDeployModel(model.id); setDeploySegment((model as any).segment); }}
                          style={{
                            padding: '12px 14px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                            background: selected ? `${model.color}12` : 'rgba(255,255,255,0.03)',
                            border: `2px solid ${selected ? model.color : 'var(--color-border)'}`,
                            transition: 'all 0.2s', textAlign: 'left',
                            boxShadow: selected ? `0 0 14px ${model.color}22` : 'none',
                          }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 20, flexShrink: 0 }}>{model.icon}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: selected ? model.color : 'var(--color-text)' }}>
                                  {model.name}
                                </span>
                                {/* Coin tags */}
                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                  {((model as any).coins || []).map((coin: string) => (
                                    <span key={coin} style={{
                                      fontSize: 10, fontWeight: 700, padding: '1px 6px',
                                      borderRadius: 20, fontFamily: 'monospace',
                                      background: selected ? `${model.color}20` : 'rgba(255,255,255,0.06)',
                                      color: selected ? model.color : 'var(--color-text-muted)',
                                      border: `1px solid ${selected ? model.color + '40' : 'var(--color-border)'}`,
                                    }}>{coin}</span>
                                  ))}
                                </div>
                              </div>
                              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>
                                {model.tagline}
                              </div>
                            </div>
                            {selected && (
                              <span style={{ fontSize: 16, color: model.color, flexShrink: 0 }}>✓</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* ── Exchange + Mode (inline 2-col) ── */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                  {/* Exchange */}
                  <div>
                    <div className="section-title" style={{ marginBottom: 10 }}>Exchange</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {[
                        { id: 'binance', name: 'Binance', icon: '🔶', sub: 'Global · Largest' },
                        { id: 'coindcx', name: 'CoinDCX', icon: '🇮🇳', sub: 'India · INR' },
                      ].map(ex => {
                        const sel = deployExchange === ex.id;
                        return (
                          <button key={ex.id} onClick={() => setDeployExchange(ex.id)} style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '10px 12px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                            background: sel ? 'rgba(14,165,233,0.1)' : 'rgba(255,255,255,0.03)',
                            border: `1.5px solid ${sel ? '#0EA5E9' : 'var(--color-border)'}`,
                            transition: 'all 0.2s', textAlign: 'left',
                          }}>
                            <span style={{ fontSize: 16 }}>{ex.icon}</span>
                            <div>
                              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: sel ? '#0EA5E9' : 'var(--color-text)' }}>{ex.name}</div>
                              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{ex.sub}</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Mode */}
                  <div>
                    <div className="section-title" style={{ marginBottom: 10 }}>Trading Mode</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {[
                        { id: 'paper', name: 'Paper', icon: '📝', sub: 'Simulated · No risk', color: '#0EA5E9' },
                        { id: 'live', name: 'Live', icon: '⚡', sub: 'Real capital · Live P&L', color: '#EF4444' },
                      ].map(mode => {
                        const sel = deployMode === mode.id;
                        return (
                          <button key={mode.id} onClick={() => setDeployMode(mode.id)} style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '10px 12px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
                            background: sel ? `${mode.color}10` : 'rgba(255,255,255,0.03)',
                            border: `1.5px solid ${sel ? mode.color : 'var(--color-border)'}`,
                            transition: 'all 0.2s', textAlign: 'left',
                          }}>
                            <span style={{ fontSize: 16 }}>{mode.icon}</span>
                            <div>
                              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: sel ? mode.color : 'var(--color-text)' }}>{mode.name}</div>
                              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{mode.sub}</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* ── Live mode warnings ── */}
                {deployMode === 'live' && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                    style={{ marginBottom: 20, overflow: 'hidden' }}>
                    <div style={{
                      padding: '10px 14px', borderRadius: 'var(--radius-md)',
                      background: 'var(--color-danger-bg)', border: '1px solid rgba(239,68,68,0.25)',
                      fontSize: 'var(--text-xs)', color: '#F87171', lineHeight: 1.5, marginBottom: 8,
                    }}>
                      ⚠️ Live trading uses real capital. Ensure your API keys are set in Settings and risk parameters are configured.
                    </div>
                    <button onClick={handleVerifyConnection} disabled={verifying} style={{
                      width: '100%', padding: '9px 0', borderRadius: 'var(--radius-md)',
                      border: `1px solid ${verifyStatus === 'ok' ? 'rgba(16,185,129,0.4)' : verifyStatus === 'fail' ? 'rgba(239,68,68,0.4)' : 'var(--color-border)'}`,
                      background: verifyStatus === 'ok' ? 'var(--color-success-bg)' : verifyStatus === 'fail' ? 'var(--color-danger-bg)' : 'rgba(255,255,255,0.04)',
                      color: verifyStatus === 'ok' ? 'var(--color-success)' : verifyStatus === 'fail' ? 'var(--color-danger)' : 'var(--color-text-secondary)',
                      fontSize: 'var(--text-sm)', fontWeight: 700, cursor: verifying ? 'wait' : 'pointer',
                      transition: 'all 0.2s', opacity: verifying ? 0.7 : 1,
                    }}>
                      {verifying ? '⏳ Checking connection…' :
                        verifyStatus === 'ok' ? `✓ ${deployExchange === 'coindcx' ? 'CoinDCX' : 'Binance'} Connected${verifyBalance != null ? ` · $${verifyBalance.toFixed(2)} USDT` : ''}` :
                          verifyStatus === 'fail' ? '✗ Connection failed — check API keys' :
                            `Verify ${deployExchange === 'coindcx' ? 'CoinDCX' : 'Binance'} Connection`}
                    </button>
                  </motion.div>
                )}

                {/* ── Segment-specific info strip ── */}
                {deploySegment !== 'ALL' && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                    style={{ marginBottom: 20, overflow: 'hidden' }}>
                    <div style={{
                      padding: '10px 14px', borderRadius: 'var(--radius-md)',
                      background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)',
                      fontSize: 'var(--text-xs)', color: '#86EFAC', lineHeight: 1.5,
                    }}>
                      🎯 <strong>{deploySegment} Specialist</strong> will only scan coins in the {deploySegment} segment,
                      using per-coin optimized HMM features from Likelihood Permutation analysis.
                      Correlation control limits to 1 open position per segment.
                    </div>
                  </motion.div>
                )}


                {/* ── Capital Settings ── */}
                <div style={{ marginBottom: 4 }}>
                  <div className="section-title" style={{ marginBottom: 10 }}>Capital Settings</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginBottom: 5, fontWeight: 600 }}>
                        Max Concurrent Trades
                      </label>
                      <input type="number" min={1} max={100} value={deployMaxTrades}
                        onChange={(e) => setDeployMaxTrades(Math.max(1, parseInt(e.target.value) || 1))}
                        className="input-field"
                        style={{ fontFamily: 'monospace' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginBottom: 5, fontWeight: 600 }}>
                        Capital Per Trade ($)
                      </label>
                      <input type="number" min={10} max={10000} step={10} value={deployCapitalPerTrade}
                        onChange={(e) => setDeployCapitalPerTrade(Math.max(10, parseInt(e.target.value) || 10))}
                        className="input-field"
                        style={{ fontFamily: 'monospace' }}
                      />
                    </div>
                  </div>
                  {/* Max exposure strip */}
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    marginTop: 10, padding: '8px 14px', borderRadius: 'var(--radius-md)',
                    background: 'var(--color-info-bg)', border: '1px solid rgba(6,182,212,0.2)',
                    fontSize: 'var(--text-xs)', color: 'var(--color-info)',
                  }}>
                    <span>Max capital exposure</span>
                    <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 'var(--text-sm)' }}>
                      ${(deployMaxTrades * deployCapitalPerTrade).toLocaleString()}
                      <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: 4 }}>
                        ({deployMaxTrades} × ${deployCapitalPerTrade})
                      </span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div style={{
                display: 'flex', gap: 10,
                padding: '16px 24px 20px',
                borderTop: '1px solid var(--color-border)',
              }}>
                <button onClick={() => setShowDeployModal(false)} className="btn-ghost" style={{ flex: 1, padding: '11px 0' }}>
                  Cancel
                </button>
                <button
                  onClick={handleDeployBot}
                  disabled={loading}
                  className="btn-success"
                  style={{ flex: 1, padding: '11px 0', opacity: loading ? 0.7 : 1, cursor: loading ? 'wait' : 'pointer' }}
                >
                  <Rocket style={{ width: 15, height: 15 }} />
                  {loading ? 'Launching…' : 'Launch Bot'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style jsx>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
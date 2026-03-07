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
    id: 'standard',
    name: 'Standard',
    color: '#22C55E',
    description: 'Balanced risk-reward, full HMM signals',
    badge: '⚡',
  },
  {
    id: 'conservative',
    name: 'Conservative',
    color: '#0EA5E9',
    description: 'Lower risk, tighter stops, moderate leverage',
    badge: '🛡️',
  },
];

interface BotsClientProps { bots: any[]; }

export function BotsClient({ bots: initialBots }: BotsClientProps) {
  const { data: session } = useSession();
  const isAdmin = (session?.user as any)?.role === 'admin';
  const [mounted, setMounted] = useState(false);
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [bots, setBots] = useState(initialBots);
  const [loading, setLoading] = useState(false);

  // Deploy modal state
  const [deployModel, setDeployModel] = useState('standard');
  const [deployExchange, setDeployExchange] = useState('binance');
  const [deployMode, setDeployMode] = useState('paper');
  const [deployMaxTrades, setDeployMaxTrades] = useState(25);
  const [deployCapitalPerTrade, setDeployCapitalPerTrade] = useState(100);

  useEffect(() => { setMounted(true); }, []);

  // Live active trade count from bot-state
  const [liveTradeCount, setLiveTradeCount] = useState(0);
  const fetchLiveCount = useCallback(async () => {
    try {
      const res = await fetch('/api/bot-state', { cache: 'no-store' });
      if (res.ok) {
        const d = await res.json();
        const trades = d?.tradebook?.trades || [];
        setLiveTradeCount(trades.filter((t: any) => (t.status || '').toUpperCase() === 'ACTIVE').length);
      }
    } catch { /* silent */ }
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

  const handleDeployBot = async () => {
    setLoading(true);
    try {
      const selectedModel = BOT_MODELS.find(m => m.id === deployModel);
      const botName = `Synaptic Marshal — ${selectedModel?.name || 'Standard'}`;
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

          {/* ── Deployed Bots Grid ── */}
          {bots && bots.length > 0 && (
            <div className="flex flex-col gap-4 mb-12">
              {bots.map((bot) => {
                const model = getModel(bot?.name || '');
                return (
                  <div key={bot?.id}>
                    {/* Model badge + delete row */}
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      marginBottom: '6px', padding: '0 4px',
                    }}>
                      <span style={{
                        padding: '3px 10px', borderRadius: '8px', fontSize: '10px', fontWeight: 700,
                        color: model.color, background: model.color + '22', letterSpacing: '0.5px',
                      }}>
                        {model.badge} {model.name}
                      </span>
                      <button onClick={() => handleDeleteBot(bot?.id)}
                        title="Delete bot"
                        style={{
                          padding: '4px 8px', borderRadius: '6px',
                          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
                          color: '#EF4444', cursor: 'pointer', fontSize: '11px',
                          display: 'flex', alignItems: 'center', gap: '4px',
                          transition: 'all 0.2s',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.25)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; }}
                      >
                        <Trash2 className="w-3 h-3" /> Delete
                      </button>
                    </div>
                    <BotCard bot={bot} onToggle={handleBotToggle} liveTradeCount={liveTradeCount} />
                  </div>
                );
              })}
            </div>
          )}

          {/* ═══ SECTION 2: PERFORMANCE ═══ */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
            <a href="/performance" style={{ textDecoration: 'none' }}>
              <div style={{
                background: 'rgba(17, 24, 39, 0.7)', backdropFilter: 'blur(12px)',
                border: '1px solid rgba(6, 182, 212, 0.15)', borderRadius: '16px',
                padding: '20px 24px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                transition: 'all 0.2s',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{
                    width: '36px', height: '36px', borderRadius: '10px',
                    background: 'rgba(6, 182, 212, 0.15)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <TrendingUp size={18} color="#06B6D4" />
                  </div>
                  <div>
                    <div style={{ fontSize: '16px', fontWeight: 700, color: '#06B6D4' }}>Performance Analytics</div>
                    <div style={{ fontSize: '12px', color: '#6B7280' }}>View detailed PnL, win rates, and bot performance metrics</div>
                  </div>
                </div>
                <div style={{ fontSize: '20px', color: '#6B7280' }}>→</div>
              </div>
            </a>
          </motion.div>

        </div>
      </main>

      {/* ═══ DEPLOY BOT MODAL ═══ */}
      <AnimatePresence>
        {showDeployModal && (
          <div
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
            onClick={(e) => { if (e.target === e.currentTarget) setShowDeployModal(false); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              style={{
                background: 'linear-gradient(135deg, rgba(17,24,39,0.98), rgba(30,41,59,0.95))',
                backdropFilter: 'blur(20px)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '20px', padding: '32px', maxWidth: '520px', width: '100%',
              }}
            >
              {/* Modal Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
                <div style={{
                  width: '44px', height: '44px', borderRadius: '12px',
                  background: 'linear-gradient(135deg, rgba(34,197,94,0.2), rgba(16,185,129,0.1))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Rocket size={22} color="#22C55E" />
                </div>
                <div>
                  <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#E5E7EB' }}>Deploy Synaptic Marshal</h2>
                  <p style={{ fontSize: '12px', color: '#6B7280' }}>Configure and launch your trading bot</p>
                </div>
              </div>

              {/* Step 1: Select Model */}
              <div style={{ marginBottom: '20px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '10px' }}>
                  1. Select Model
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                  {BOT_MODELS.map(model => (
                    <div key={model.id}
                      onClick={() => setDeployModel(model.id)}
                      style={{
                        flex: 1, padding: '16px', borderRadius: '14px', cursor: 'pointer',
                        background: deployModel === model.id ? model.color + '12' : 'rgba(255,255,255,0.03)',
                        border: `2px solid ${deployModel === model.id ? model.color : 'rgba(255,255,255,0.06)'}`,
                        transition: 'all 0.2s', textAlign: 'center',
                      }}>
                      <div style={{ fontSize: '28px', marginBottom: '8px' }}>{model.badge}</div>
                      <div style={{ fontSize: '14px', fontWeight: 700, color: deployModel === model.id ? model.color : '#9CA3AF' }}>{model.name}</div>
                      <div style={{ fontSize: '10px', color: '#6B7280', marginTop: '4px' }}>{model.description}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Step 2: Select Exchange */}
              <div style={{ marginBottom: '20px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '10px' }}>
                  2. Select Exchange
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                  {[
                    { id: 'binance', name: 'Binance', icon: '🔶', desc: 'Largest crypto exchange' },
                    { id: 'coindcx', name: 'CoinDCX', icon: '🇮🇳', desc: "India's crypto exchange" },
                  ].map(ex => (
                    <div key={ex.id}
                      onClick={() => setDeployExchange(ex.id)}
                      style={{
                        flex: 1, padding: '14px', borderRadius: '12px', cursor: 'pointer',
                        background: deployExchange === ex.id ? 'rgba(14,165,233,0.1)' : 'rgba(255,255,255,0.03)',
                        border: `2px solid ${deployExchange === ex.id ? '#0EA5E9' : 'rgba(255,255,255,0.06)'}`,
                        transition: 'all 0.2s', textAlign: 'center',
                      }}>
                      <div style={{ fontSize: '24px', marginBottom: '6px' }}>{ex.icon}</div>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: deployExchange === ex.id ? '#0EA5E9' : '#9CA3AF' }}>{ex.name}</div>
                      <div style={{ fontSize: '10px', color: '#6B7280', marginTop: '2px' }}>{ex.desc}</div>
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: '10px', color: '#4B5563', marginTop: '6px' }}>
                  ℹ️ Make sure your API key is configured in Settings for the selected exchange
                </p>
              </div>

              {/* Step 3: Trading Mode */}
              <div style={{ marginBottom: '24px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '10px' }}>
                  3. Trading Mode
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                  {[
                    { id: 'paper', name: 'Paper Trading', icon: '📝', desc: 'Simulated trades, no real money', color: '#0EA5E9' },
                    { id: 'live', name: 'Live Trading', icon: '💰', desc: 'Real trades with your capital', color: '#EF4444' },
                  ].map(mode => (
                    <div key={mode.id}
                      onClick={() => setDeployMode(mode.id)}
                      style={{
                        flex: 1, padding: '14px', borderRadius: '12px', cursor: 'pointer',
                        background: deployMode === mode.id ? mode.color + '10' : 'rgba(255,255,255,0.03)',
                        border: `2px solid ${deployMode === mode.id ? mode.color : 'rgba(255,255,255,0.06)'}`,
                        transition: 'all 0.2s', textAlign: 'center',
                      }}>
                      <div style={{ fontSize: '24px', marginBottom: '6px' }}>{mode.icon}</div>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: deployMode === mode.id ? mode.color : '#9CA3AF' }}>{mode.name}</div>
                      <div style={{ fontSize: '10px', color: '#6B7280', marginTop: '2px' }}>{mode.desc}</div>
                    </div>
                  ))}
                </div>
                {deployMode === 'live' && (
                  <div style={{
                    marginTop: '8px', padding: '8px 12px', borderRadius: '8px',
                    background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
                    fontSize: '11px', color: '#F87171',
                  }}>
                    ⚠️ Live trading uses real capital. Ensure your risk settings are configured in Settings.
                  </div>
                )}
              </div>

              {/* Step 4: Trade Limits */}
              <div style={{ marginBottom: '24px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: '10px' }}>
                  4. Trade Settings
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', color: '#9CA3AF', marginBottom: '6px', fontWeight: 600 }}>
                      Max Concurrent Trades
                    </label>
                    <input
                      type="number" min={1} max={100}
                      value={deployMaxTrades}
                      onChange={(e) => setDeployMaxTrades(Math.max(1, parseInt(e.target.value) || 1))}
                      style={{
                        width: '100%', padding: '10px 12px', borderRadius: '10px',
                        background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                        color: '#F0F4F8', fontSize: '14px', fontWeight: 600, outline: 'none',
                      }}
                    />
                    <p style={{ fontSize: '10px', color: '#4B5563', marginTop: '4px' }}>
                      Max positions open at the same time
                    </p>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '12px', color: '#9CA3AF', marginBottom: '6px', fontWeight: 600 }}>
                      Capital Per Trade ($)
                    </label>
                    <input
                      type="number" min={10} max={10000} step={10}
                      value={deployCapitalPerTrade}
                      onChange={(e) => setDeployCapitalPerTrade(Math.max(10, parseInt(e.target.value) || 10))}
                      style={{
                        width: '100%', padding: '10px 12px', borderRadius: '10px',
                        background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                        color: '#F0F4F8', fontSize: '14px', fontWeight: 600, outline: 'none',
                      }}
                    />
                    <p style={{ fontSize: '10px', color: '#4B5563', marginTop: '4px' }}>
                      Amount allocated per trade entry
                    </p>
                  </div>
                </div>
                <div style={{
                  marginTop: '10px', padding: '8px 12px', borderRadius: '8px',
                  background: 'rgba(8,145,178,0.08)', border: '1px solid rgba(8,145,178,0.2)',
                  fontSize: '11px', color: '#06B6D4',
                }}>
                  💡 Max capital exposure: ${deployMaxTrades * deployCapitalPerTrade} ({deployMaxTrades} × ${deployCapitalPerTrade})
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  onClick={() => setShowDeployModal(false)}
                  style={{
                    flex: 1, padding: '12px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)',
                    background: 'rgba(255,255,255,0.05)', color: '#9CA3AF',
                    fontSize: '14px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
                  }}>
                  Cancel
                </button>
                <button
                  onClick={handleDeployBot}
                  disabled={loading}
                  style={{
                    flex: 1, padding: '12px', borderRadius: '12px', border: 'none',
                    background: 'linear-gradient(135deg, #22C55E, #16A34A)',
                    color: '#fff', fontSize: '14px', fontWeight: 700, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                    transition: 'all 0.2s', opacity: loading ? 0.6 : 1,
                  }}>
                  <Rocket size={16} />
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
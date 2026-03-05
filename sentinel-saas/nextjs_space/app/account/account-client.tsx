'use client';

import { useState, useEffect } from 'react';
import { Header } from '@/components/header';
import {
  User, Crown, Calendar, Check, Key, Shield, Sliders,
  Bell, TrendingUp, Coins, Save, CheckCircle, AlertCircle,
  ChevronDown, ChevronUp, Settings
} from 'lucide-react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { format } from 'date-fns';

/* ═══ Default Settings Config ═══ */
const DEFAULT_CONFIG = {
  binanceKey: '', binanceSecret: '',
  coindcxKey: '', coindcxSecret: '',
  topCoinsToScan: 15, maxConcurrentPositions: 10,
  capitalPerTrade: 100, totalCapital: 2500,
  slMultiplier: 0.8, tpMultiplier: 1.0,
  maxLossPerTradePct: -30, minHoldMinutes: 15,
  killSwitchDrawdownPct: -50, takerFee: 0.0005,
  highConfThreshold: 0.80, highConfLeverage: 5,
  medConfThreshold: 0.65, medConfLeverage: 3,
  lowConfThreshold: 0.50, lowConfLeverage: 2,
  trailingSLEnabled: true, trailingSLActivationATR: 1.0, trailingSLDistanceATR: 1.0,
  trailingTPEnabled: true, trailingTPActivationPct: 0.75,
  trailingTPExtensionATR: 1.5, trailingTPMaxExtensions: 3,
  capitalProtectEnabled: true, capitalProtectThreshold: 10,
  telegramEnabled: false, telegramBotToken: '', telegramChatId: '',
  telegramNotifyTrades: true, telegramNotifyAlerts: true, telegramNotifySummary: true,
};
type Config = typeof DEFAULT_CONFIG;

/* ═══ Shared UI Helpers ═══ */
function Section({ icon, title, sub, children, defaultOpen = true }: {
  icon: React.ReactNode; title: string; sub: string;
  children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: '12px' }}>
      <div onClick={() => setOpen(!open)} style={{
        background: 'rgba(17,24,39,0.8)', backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: open ? '16px 16px 0 0' : '16px',
        padding: '16px 20px', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '36px', height: '36px', borderRadius: '10px',
            background: 'rgba(8,145,178,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{icon}</div>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#06B6D4' }}>{title}</div>
            <div style={{ fontSize: '10px', color: '#6B7280' }}>{sub}</div>
          </div>
        </div>
        {open ? <ChevronUp size={16} color="#6B7280" /> : <ChevronDown size={16} color="#6B7280" />}
      </div>
      {open && (
        <div style={{
          background: 'rgba(17,24,39,0.6)', border: '1px solid rgba(255,255,255,0.06)',
          borderTop: 'none', borderRadius: '0 0 16px 16px', padding: '20px',
        }}>{children}</div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', fontSize: '13px',
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '10px', color: '#F0F4F8', outline: 'none',
};

function Field({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <label style={{ fontSize: '11px', fontWeight: 600, color: '#D1D5DB', marginBottom: '4px', display: 'block' }}>
        {label}
        {sub && <span style={{ fontWeight: 400, color: '#6B7280', marginLeft: '6px' }}>{sub}</span>}
      </label>
      {children}
    </div>
  );
}

function NumberInput({ value, onChange, step, min, max, suffix }: {
  value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; suffix?: string;
}) {
  return (
    <div style={{ position: 'relative' }}>
      <input type="number" value={value} onChange={e => onChange(Number(e.target.value))}
        step={step} min={min} max={max} style={inputStyle} />
      {suffix && <span style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', fontSize: '11px', color: '#6B7280' }}>{suffix}</span>}
    </div>
  );
}

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div onClick={() => onChange(!value)} style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', padding: '6px 0' }}>
      <div style={{
        width: '36px', height: '20px', borderRadius: '10px',
        background: value ? '#22C55E' : 'rgba(255,255,255,0.1)',
        position: 'relative', transition: 'background 0.3s',
      }}>
        <div style={{
          width: '16px', height: '16px', borderRadius: '50%', background: '#fff',
          position: 'absolute', top: '2px', left: value ? '18px' : '2px',
          transition: 'left 0.3s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }} />
      </div>
      <span style={{ fontSize: '12px', color: '#D1D5DB' }}>{label}</span>
    </div>
  );
}

function Row2({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>{children}</div>;
}
function Row3({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>{children}</div>;
}

/* ═══ TABS ═══ */
const TABS = [
  { id: 'profile', label: 'Profile', icon: <User size={14} /> },
  { id: 'settings', label: 'Settings', icon: <Settings size={14} /> },
] as const;
type TabId = typeof TABS[number]['id'];

/* ═══ MAIN COMPONENT ═══ */
interface AccountClientProps {
  user: { id: string; name: string; email: string; createdAt: string };
  subscription: {
    tier: string; status: string; coinScans: number;
    trialEndsAt?: string | null; currentPeriodEnd?: string | null;
  } | null;
}

export function AccountClient({ user, subscription }: AccountClientProps) {
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('profile');
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;

  const update = (patch: Partial<Config>) => setConfig(prev => ({ ...prev, ...patch }));

  const handleSave = async () => {
    setSaving(true);
    setMessage({ type: '', text: '' });
    try {
      if (config.binanceKey && config.binanceSecret) {
        await fetch('/api/settings/api-keys', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ exchange: 'binance', apiKey: config.binanceKey, apiSecret: config.binanceSecret }),
        });
      }
      if (config.coindcxKey && config.coindcxSecret) {
        await fetch('/api/settings/api-keys', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ exchange: 'coindcx', apiKey: config.coindcxKey, apiSecret: config.coindcxSecret }),
        });
      }
      setMessage({ type: 'success', text: 'Settings saved successfully!' });
      setTimeout(() => setMessage({ type: '', text: '' }), 4000);
    } catch {
      setMessage({ type: 'error', text: 'Failed to save settings.' });
    } finally { setSaving(false); }
  };

  const getTierDisplay = (tier: string) => {
    if (tier === 'free') return 'Free Trial';
    if (tier === 'pro') return 'Pro';
    if (tier === 'ultra') return 'Ultra';
    return tier;
  };
  const getStatusColor = (status: string) => {
    if (status === 'active') return 'text-[var(--color-success)]';
    if (status === 'trial') return 'text-[var(--color-warning)]';
    return 'text-[var(--color-text-secondary)]';
  };

  return (
    <div className="min-h-screen">
      <Header />
      <main className="pt-24 pb-12 px-4">
        <div className="max-w-4xl mx-auto">

          {/* Header */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
            <h1 className="text-3xl font-bold mb-1"><span className="text-gradient">Account</span></h1>
            <p className="text-[var(--color-text-secondary)]">Manage your profile, subscription, and settings</p>
          </motion.div>

          {/* Tab Bar */}
          <div style={{
            display: 'flex', gap: '4px', marginBottom: '24px', padding: '4px',
            background: 'rgba(17,24,39,0.6)', borderRadius: '14px',
            border: '1px solid rgba(255,255,255,0.06)',
          }}>
            {TABS.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: '8px', padding: '10px 16px', borderRadius: '10px', border: 'none',
                  background: activeTab === tab.id ? 'rgba(8,145,178,0.15)' : 'transparent',
                  color: activeTab === tab.id ? '#06B6D4' : '#6B7280',
                  fontSize: '13px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
                }}>
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>

          {/* ═══ PROFILE TAB ═══ */}
          {activeTab === 'profile' && (
            <>
              {/* Profile Information */}
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                className="card-gradient p-8 rounded-xl mb-6">
                <div className="flex items-center space-x-3 mb-6">
                  <div className="p-3 bg-[var(--color-primary)]/20 rounded-lg">
                    <User className="w-6 h-6 text-[var(--color-primary)]" />
                  </div>
                  <h2 className="text-xl font-bold text-cyan-400">Profile Information</h2>
                </div>
                <div className="space-y-4">
                  <div><label className="text-sm text-[var(--color-text-secondary)]">Full Name</label>
                    <p className="text-lg font-medium">{user?.name ?? 'N/A'}</p></div>
                  <div><label className="text-sm text-[var(--color-text-secondary)]">Email Address</label>
                    <p className="text-lg font-medium">{user?.email ?? 'N/A'}</p></div>
                  <div><label className="text-sm text-[var(--color-text-secondary)]">Member Since</label>
                    <p className="text-lg font-medium">{format(new Date(user?.createdAt ?? new Date()), 'MMMM d, yyyy')}</p></div>
                </div>
              </motion.div>

              {/* Subscription Section */}
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }} className="card-gradient p-8 rounded-xl">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center space-x-3">
                    <div className="p-3 bg-[var(--color-primary)]/20 rounded-lg">
                      <Crown className="w-6 h-6 text-[var(--color-primary)]" />
                    </div>
                    <h2 className="text-xl font-bold text-cyan-400">Subscription</h2>
                  </div>
                  <Link href="/pricing"
                    className="px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg hover:bg-[var(--color-primary-dark)] transition-colors">
                    Upgrade Plan
                  </Link>
                </div>
                {subscription ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 bg-[var(--color-surface)] rounded-lg">
                      <div>
                        <p className="text-sm text-[var(--color-text-secondary)]">Current Plan</p>
                        <p className="text-2xl font-bold text-[var(--color-primary)]">{getTierDisplay(subscription.tier)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-[var(--color-text-secondary)]">Status</p>
                        <p className={`text-lg font-semibold capitalize ${getStatusColor(subscription.status)}`}>{subscription.status}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="p-4 bg-[var(--color-surface)] rounded-lg">
                        <div className="flex items-center space-x-2 mb-2">
                          <Check className="w-5 h-5 text-[var(--color-success)]" />
                          <p className="text-sm text-[var(--color-text-secondary)]">Coin Scans</p>
                        </div>
                        <p className="text-xl font-bold">{subscription.coinScans === 0 ? 'Unlimited' : subscription.coinScans}</p>
                      </div>
                      {subscription.trialEndsAt && subscription.status === 'trial' && (
                        <div className="p-4 bg-[var(--color-surface)] rounded-lg">
                          <div className="flex items-center space-x-2 mb-2">
                            <Calendar className="w-5 h-5 text-[var(--color-warning)]" />
                            <p className="text-sm text-[var(--color-text-secondary)]">Trial Ends</p>
                          </div>
                          <p className="text-xl font-bold">{format(new Date(subscription.trialEndsAt), 'MMM d, yyyy')}</p>
                        </div>
                      )}
                      {subscription.currentPeriodEnd && subscription.status === 'active' && (
                        <div className="p-4 bg-[var(--color-surface)] rounded-lg">
                          <div className="flex items-center space-x-2 mb-2">
                            <Calendar className="w-5 h-5 text-[var(--color-primary)]" />
                            <p className="text-sm text-[var(--color-text-secondary)]">Renews On</p>
                          </div>
                          <p className="text-xl font-bold">{format(new Date(subscription.currentPeriodEnd), 'MMM d, yyyy')}</p>
                        </div>
                      )}
                    </div>
                    {subscription.status === 'trial' && (
                      <div className="mt-6 p-4 bg-[var(--color-warning)]/20 border border-[var(--color-warning)] rounded-lg">
                        <p className="text-sm">
                          Your free trial will end on{' '}
                          <strong>{subscription?.trialEndsAt ? format(new Date(subscription.trialEndsAt), 'MMMM d, yyyy') : 'N/A'}</strong>.
                          Upgrade to continue after your trial ends.
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-[var(--color-text-secondary)] mb-4">No active subscription found</p>
                    <Link href="/pricing"
                      className="inline-block px-6 py-3 bg-[var(--color-primary)] text-white rounded-lg hover:bg-[var(--color-primary-dark)] transition-colors">
                      View Plans
                    </Link>
                  </div>
                )}
              </motion.div>
            </>
          )}

          {/* ═══ SETTINGS TAB ═══ */}
          {activeTab === 'settings' && (
            <>
              {message.text && (
                <div style={{
                  marginBottom: '16px', padding: '12px 16px', borderRadius: '12px',
                  display: 'flex', alignItems: 'center', gap: '10px',
                  background: message.type === 'success' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                  color: message.type === 'success' ? '#22C55E' : '#EF4444',
                  border: `1px solid ${message.type === 'success' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                }}>
                  {message.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>{message.text}</span>
                </div>
              )}

              {/* Exchange Connection */}
              <Section icon={<Key size={16} color="#0EA5E9" />} title="Exchange Connection"
                sub="Binance & CoinDCX API keys · Encrypted AES-256-GCM">
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#D1D5DB', marginBottom: '10px' }}>Binance</div>
                  <Row2>
                    <Field label="API Key"><input type="text" value={config.binanceKey} onChange={e => update({ binanceKey: e.target.value })} style={inputStyle} placeholder="Enter Binance API key" /></Field>
                    <Field label="API Secret"><input type="password" value={config.binanceSecret} onChange={e => update({ binanceSecret: e.target.value })} style={inputStyle} placeholder="Enter Binance API secret" /></Field>
                  </Row2>
                </div>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#D1D5DB', marginBottom: '10px' }}>CoinDCX</div>
                  <Row2>
                    <Field label="API Key"><input type="text" value={config.coindcxKey} onChange={e => update({ coindcxKey: e.target.value })} style={inputStyle} placeholder="Enter CoinDCX API key" /></Field>
                    <Field label="API Secret"><input type="password" value={config.coindcxSecret} onChange={e => update({ coindcxSecret: e.target.value })} style={inputStyle} placeholder="Enter CoinDCX API secret" /></Field>
                  </Row2>
                </div>
              </Section>

              {/* Coin Selection & Capital */}
              <Section icon={<Coins size={16} color="#F59E0B" />} title="Coin Selection & Capital"
                sub="Top coins · Max positions · Capital allocation">
                <Row2>
                  <Field label="Top Coins to Scan"><NumberInput value={config.topCoinsToScan} onChange={v => update({ topCoinsToScan: v })} min={5} max={50} /></Field>
                  <Field label="Max Concurrent Positions"><NumberInput value={config.maxConcurrentPositions} onChange={v => update({ maxConcurrentPositions: v })} min={1} max={30} /></Field>
                </Row2>
                <Row2>
                  <Field label="Capital per Trade" sub="USD"><NumberInput value={config.capitalPerTrade} onChange={v => update({ capitalPerTrade: v })} min={10} suffix="$" /></Field>
                  <Field label="Total Trading Capital" sub="USD"><NumberInput value={config.totalCapital} onChange={v => update({ totalCapital: v })} min={100} suffix="$" /></Field>
                </Row2>
              </Section>

              {/* Risk Management */}
              <Section icon={<Shield size={16} color="#EF4444" />} title="Risk Management"
                sub="SL/TP ATR multipliers · Max loss · Kill switch">
                <Row3>
                  <Field label="SL Multiplier" sub="ATR"><NumberInput value={config.slMultiplier} onChange={v => update({ slMultiplier: v })} step={0.1} min={0.1} /></Field>
                  <Field label="TP Multiplier" sub="ATR"><NumberInput value={config.tpMultiplier} onChange={v => update({ tpMultiplier: v })} step={0.1} min={0.1} /></Field>
                  <Field label="Taker Fee"><NumberInput value={config.takerFee} onChange={v => update({ takerFee: v })} step={0.0001} /></Field>
                </Row3>
                <Row3>
                  <Field label="Max Loss per Trade" sub="%"><NumberInput value={config.maxLossPerTradePct} onChange={v => update({ maxLossPerTradePct: v })} suffix="%" /></Field>
                  <Field label="Min Hold Time" sub="min"><NumberInput value={config.minHoldMinutes} onChange={v => update({ minHoldMinutes: v })} min={0} suffix="min" /></Field>
                  <Field label="Kill Switch DD" sub="%"><NumberInput value={config.killSwitchDrawdownPct} onChange={v => update({ killSwitchDrawdownPct: v })} suffix="%" /></Field>
                </Row3>
              </Section>

              {/* Leverage Tiers */}
              <Section icon={<TrendingUp size={16} color="#22C55E" />} title="Leverage & Confidence Tiers"
                sub="HMM confidence × leverage multipliers">
                {[
                  { label: 'High Confidence', thKey: 'highConfThreshold' as const, lvKey: 'highConfLeverage' as const, color: '#22C55E' },
                  { label: 'Medium Confidence', thKey: 'medConfThreshold' as const, lvKey: 'medConfLeverage' as const, color: '#F59E0B' },
                  { label: 'Low Confidence', thKey: 'lowConfThreshold' as const, lvKey: 'lowConfLeverage' as const, color: '#EF4444' },
                ].map(tier => (
                  <div key={tier.label} style={{
                    display: 'flex', alignItems: 'center', gap: '14px',
                    padding: '10px 14px', marginBottom: '6px', borderRadius: '10px',
                    background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)',
                  }}>
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: tier.color }} />
                    <div style={{ flex: 1, fontSize: '12px', fontWeight: 600, color: '#D1D5DB' }}>{tier.label}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '10px', color: '#6B7280' }}>Threshold:</span>
                      <input type="number" value={config[tier.thKey]} onChange={e => update({ [tier.thKey]: Number(e.target.value) } as any)}
                        step={0.05} min={0} max={1} style={{ ...inputStyle, width: '70px', textAlign: 'center' }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '10px', color: '#6B7280' }}>Leverage:</span>
                      <input type="number" value={config[tier.lvKey]} onChange={e => update({ [tier.lvKey]: Number(e.target.value) } as any)}
                        min={1} max={20} style={{ ...inputStyle, width: '55px', textAlign: 'center' }} />
                      <span style={{ fontSize: '10px', color: '#6B7280' }}>×</span>
                    </div>
                  </div>
                ))}
              </Section>

              {/* Trailing SL/TP */}
              <Section icon={<Sliders size={16} color="#0EA5E9" />} title="Trailing SL/TP"
                sub="Dynamic stop-loss & take-profit · Capital protection">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                  <div>
                    <Toggle value={config.trailingSLEnabled} onChange={v => update({ trailingSLEnabled: v })} label="Trailing Stop-Loss" />
                    {config.trailingSLEnabled && (
                      <div style={{ paddingLeft: '46px', marginTop: '6px' }}>
                        <Field label="Activation ATR"><NumberInput value={config.trailingSLActivationATR} onChange={v => update({ trailingSLActivationATR: v })} step={0.1} /></Field>
                        <Field label="Distance ATR"><NumberInput value={config.trailingSLDistanceATR} onChange={v => update({ trailingSLDistanceATR: v })} step={0.1} /></Field>
                      </div>
                    )}
                  </div>
                  <div>
                    <Toggle value={config.trailingTPEnabled} onChange={v => update({ trailingTPEnabled: v })} label="Trailing Take-Profit" />
                    {config.trailingTPEnabled && (
                      <div style={{ paddingLeft: '46px', marginTop: '6px' }}>
                        <Field label="Activation %"><NumberInput value={config.trailingTPActivationPct} onChange={v => update({ trailingTPActivationPct: v })} step={0.05} /></Field>
                        <Field label="Extension ATR"><NumberInput value={config.trailingTPExtensionATR} onChange={v => update({ trailingTPExtensionATR: v })} step={0.1} /></Field>
                        <Field label="Max Extensions"><NumberInput value={config.trailingTPMaxExtensions} onChange={v => update({ trailingTPMaxExtensions: v })} min={1} max={10} /></Field>
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <Toggle value={config.capitalProtectEnabled} onChange={v => update({ capitalProtectEnabled: v })} label="Capital Protection (lock profits at threshold)" />
                  {config.capitalProtectEnabled && (
                    <div style={{ paddingLeft: '46px', marginTop: '6px' }}>
                      <Field label="Profit Threshold" sub="% of capital"><NumberInput value={config.capitalProtectThreshold} onChange={v => update({ capitalProtectThreshold: v })} suffix="%" /></Field>
                    </div>
                  )}
                </div>
              </Section>

              {/* Telegram */}
              <Section icon={<Bell size={16} color="#8B5CF6" />} title="Telegram Notifications"
                sub="Trade alerts · System alerts · Daily summaries" defaultOpen={false}>
                <Toggle value={config.telegramEnabled} onChange={v => update({ telegramEnabled: v })} label="Enable Telegram Notifications" />
                {config.telegramEnabled && (
                  <div style={{ marginTop: '10px' }}>
                    <Row2>
                      <Field label="Bot Token"><input type="password" value={config.telegramBotToken} onChange={e => update({ telegramBotToken: e.target.value })} style={inputStyle} placeholder="123456:ABC-DEF..." /></Field>
                      <Field label="Chat ID"><input type="text" value={config.telegramChatId} onChange={e => update({ telegramChatId: e.target.value })} style={inputStyle} placeholder="-100123456789" /></Field>
                    </Row2>
                    <div style={{ display: 'flex', gap: '20px', marginTop: '6px' }}>
                      <Toggle value={config.telegramNotifyTrades} onChange={v => update({ telegramNotifyTrades: v })} label="Trade Entries/Exits" />
                      <Toggle value={config.telegramNotifyAlerts} onChange={v => update({ telegramNotifyAlerts: v })} label="System Alerts" />
                      <Toggle value={config.telegramNotifySummary} onChange={v => update({ telegramNotifySummary: v })} label="Daily Summary" />
                    </div>
                  </div>
                )}
              </Section>

              {/* Save Button */}
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
                <button onClick={handleSave} disabled={saving}
                  style={{
                    width: '100%', padding: '14px', borderRadius: '14px', border: 'none',
                    background: 'linear-gradient(135deg, #0891B2, #0EA5E9)',
                    color: '#fff', fontSize: '14px', fontWeight: 700,
                    cursor: saving ? 'wait' : 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                    opacity: saving ? 0.6 : 1, transition: 'opacity 0.3s',
                  }}>
                  <Save size={16} />
                  {saving ? 'Saving...' : 'Save All Settings'}
                </button>
              </motion.div>
            </>
          )}

        </div>
      </main>
    </div>
  );
}
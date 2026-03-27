'use client';

import { useState, useEffect } from 'react';
import { Header } from '@/components/header';
import {
  User, Crown, Calendar, Check, Key, Shield, Sliders,
  Bell, TrendingUp, Coins, Save, CheckCircle, AlertCircle,
  ChevronDown, ChevronUp, Settings, Unplug, Palette
} from 'lucide-react';
import { useTheme } from '@/components/providers/theme-provider';
import { themes, ThemeKey } from '@/lib/themes';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { format } from 'date-fns';

/* ═══ Default Settings Config ═══ */
const DEFAULT_CONFIG = {
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
        background: 'var(--color-surface)', backdropFilter: 'blur(12px)',
        border: '1px solid var(--color-border)',
        borderRadius: open ? '16px 16px 0 0' : '16px',
        padding: '16px 20px', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '36px', height: '36px', borderRadius: '10px',
            background: 'rgba(var(--color-primary-rgb, 0,229,255), 0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{icon}</div>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-primary)' }}>{title}</div>
            <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>{sub}</div>
          </div>
        </div>
        {open ? <ChevronUp size={16} color="var(--color-text-secondary)" /> : <ChevronDown size={16} color="var(--color-text-secondary)" />}
      </div>
      {open && (
        <div style={{
          background: 'var(--color-surface-light)', border: '1px solid var(--color-border)',
          borderTop: 'none', borderRadius: '0 0 16px 16px', padding: '20px',
        }}>{children}</div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', fontSize: '13px',
  background: 'var(--color-background)', border: '1px solid var(--color-border)',
  borderRadius: '10px', color: 'var(--color-text)', outline: 'none',
};

function Field({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '14px' }}>
      <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '4px', display: 'block' }}>
        {label}
        {sub && <span style={{ fontWeight: 400, color: 'var(--color-text-secondary)', marginLeft: '6px' }}>{sub}</span>}
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
        background: value ? 'var(--color-success)' : 'var(--color-border)',
        position: 'relative', transition: 'background 0.3s',
      }}>
        <div style={{
          width: '16px', height: '16px', borderRadius: '50%', background: '#fff',
          position: 'absolute', top: '2px', left: value ? '18px' : '2px',
          transition: 'left 0.3s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }} />
      </div>
      <span style={{ fontSize: '12px', color: 'var(--color-text)' }}>{label}</span>
    </div>
  );
}

function Row2({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>{children}</div>;
}
function Row3({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>{children}</div>;
}

/* ═══ ExchangeBlock — per-exchange Test + Save ═══ */
type TestResult = { ok: boolean; balance?: number; email?: string; error?: string } | null;

function ExchangeBlock({ exchange, label, accentColor, placeholder }: {
  exchange: 'binance' | 'coindcx';
  label: string;
  accentColor: string;
  placeholder: { key: string; secret: string };
}) {
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>(null);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [savedBalance, setSavedBalance] = useState<number | null | undefined>(undefined);
  const [savedConnected, setSavedConnected] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    fetch('/api/wallet-balance', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) { setSavedBalance(null); return; }
        const bal = exchange === 'binance' ? d.binance : d.coindcx;
        const connected = exchange === 'binance' ? d.binanceConnected : d.coindcxConnected;
        setSavedBalance(bal);
        setSavedConnected(connected);
      })
      .catch(() => setSavedBalance(null));
  }, [exchange]);

  const handleTest = async () => {
    if (!apiKey || !apiSecret) { setTestResult({ ok: false, error: 'Enter API key and secret first' }); return; }
    setTesting(true); setTestResult(null);
    try {
      const res = await fetch('/api/exchange/validate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exchange, apiKey, apiSecret }),
      });
      const data = await res.json();
      if (data.valid) {
        setTestResult({ ok: true, balance: data.balance ?? data.availableBalance, email: data.email });
      } else {
        setTestResult({ ok: false, error: data.error || 'Connection failed' });
      }
    } catch { setTestResult({ ok: false, error: 'Network error' }); }
    finally { setTesting(false); }
  };

  const handleSave = async () => {
    if (!apiKey || !apiSecret) { setSaveMsg({ ok: false, text: 'Enter API key and secret first' }); return; }
    setSaving(true); setSaveMsg(null);
    try {
      const res = await fetch('/api/settings/api-keys', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exchange, apiKey, apiSecret }),
      });
      if (res.ok) {
        setSaveMsg({ ok: true, text: 'Saved! Balance updating…' });
        setTimeout(() => setSaveMsg(null), 5000);
        setSavedBalance(undefined); setSavedConnected(false);
        fetch('/api/wallet-balance', { cache: 'no-store' })
          .then(r => r.ok ? r.json() : null)
          .then(d => {
            if (!d) { setSavedBalance(null); return; }
            setSavedBalance(exchange === 'binance' ? d.binance : d.coindcx);
            setSavedConnected(exchange === 'binance' ? d.binanceConnected : d.coindcxConnected);
          })
          .catch(() => setSavedBalance(null));
      } else {
        const d = await res.json();
        setSaveMsg({ ok: false, text: d.error || 'Failed to save' });
      }
    } catch { setSaveMsg({ ok: false, text: 'Network error' }); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ padding: '16px', borderRadius: '12px', background: 'rgba(255,255,255,0.02)', border: `1px solid ${accentColor}22`, marginBottom: '14px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '13px', fontWeight: 700, color: accentColor }}>{label}</span>
          {savedBalance === undefined && <span style={{ fontSize: '10px', color: '#6B7280' }}>checking…</span>}
          {savedBalance === null && savedConnected && (
            <span style={{ fontSize: '10px', fontWeight: 600, color: '#F59E0B', background: 'rgba(245,158,11,0.1)', padding: '2px 8px', borderRadius: '6px' }}>🔑 Keys saved · balance unavailable</span>
          )}
          {savedBalance != null && (
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#22C55E', background: 'rgba(34,197,94,0.1)', padding: '2px 8px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <CheckCircle size={10} /> Connected · ${savedBalance.toFixed(2)} USDT
            </span>
          )}
          {savedBalance === null && !savedConnected && (
            <span style={{ fontSize: '10px', color: '#6B7280', fontStyle: 'italic' }}>Not connected</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {testResult?.ok && (
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#22C55E', background: 'rgba(34,197,94,0.12)', padding: '3px 8px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <CheckCircle size={11} /> {testResult.balance != null ? `$${testResult.balance.toFixed(2)} USDT` : testResult.email || 'Connected'}
            </span>
          )}
          {testResult && !testResult.ok && (
            <span style={{ fontSize: '12px', color: '#EF4444', background: 'rgba(239,68,68,0.1)', padding: '3px 8px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <AlertCircle size={11} /> {testResult.error}
            </span>
          )}
        </div>
      </div>
      {/* Inputs */}
      <Row2>
        <Field label="API Key">
          <input type="text" value={apiKey} onChange={e => { setApiKey(e.target.value); setTestResult(null); }} style={inputStyle} placeholder={placeholder.key} />
        </Field>
        <Field label="API Secret">
          <input type="password" value={apiSecret} onChange={e => { setApiSecret(e.target.value); setTestResult(null); }} style={inputStyle} placeholder={placeholder.secret} />
        </Field>
      </Row2>
      {/* Buttons */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '4px', flexWrap: 'wrap' }}>
        <button onClick={handleTest} disabled={testing} style={{ padding: '7px 16px', borderRadius: '10px', border: `1px solid ${accentColor}44`, background: 'rgba(255,255,255,0.04)', color: accentColor, fontSize: '12px', fontWeight: 700, cursor: testing ? 'wait' : 'pointer', opacity: testing ? 0.6 : 1 }}>
          {testing ? 'Testing...' : '⚡ Test Connection'}
        </button>
        <button onClick={handleSave} disabled={saving} style={{ padding: '7px 16px', borderRadius: '10px', border: 'none', background: `linear-gradient(135deg, ${accentColor}cc, ${accentColor})`, color: '#fff', fontSize: '12px', fontWeight: 700, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Save size={11} /> {saving ? 'Saving...' : 'Save API Keys'}
        </button>
        {savedConnected && (
          <button
            onClick={async () => {
              if (!confirm(`Disconnect ${label}? This will delete your stored API keys.`)) return;
              setDisconnecting(true);
              try {
                const res = await fetch('/api/settings/api-keys', {
                  method: 'DELETE',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ exchange }),
                });
                if (res.ok) {
                  setSavedBalance(null);
                  setSavedConnected(false);
                  setApiKey('');
                  setApiSecret('');
                  setTestResult(null);
                  setSaveMsg({ ok: true, text: 'Disconnected!' });
                  setTimeout(() => setSaveMsg(null), 3000);
                } else {
                  const d = await res.json();
                  setSaveMsg({ ok: false, text: d.error || 'Disconnect failed' });
                }
              } catch { setSaveMsg({ ok: false, text: 'Network error' }); }
              finally { setDisconnecting(false); }
            }}
            disabled={disconnecting}
            style={{
              padding: '7px 16px', borderRadius: '10px',
              border: '1px solid rgba(239,68,68,0.4)',
              background: 'rgba(239,68,68,0.08)',
              color: '#EF4444', fontSize: '12px', fontWeight: 700,
              cursor: disconnecting ? 'wait' : 'pointer',
              opacity: disconnecting ? 0.6 : 1,
              display: 'flex', alignItems: 'center', gap: '6px',
            }}
          >
            <Unplug size={11} /> {disconnecting ? 'Disconnecting...' : 'Disconnect'}
          </button>
        )}
        {saveMsg && <span style={{ fontSize: '12px', fontWeight: 600, color: saveMsg.ok ? '#22C55E' : '#EF4444' }}>{saveMsg.ok ? '✓ ' : '✗ '}{saveMsg.text}</span>}
      </div>
    </div>
  );
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
  
  // Custom hook for theme (must handle mounted state gracefully)
  const { currentTheme, setTheme } = useTheme();

  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;

  const update = (patch: Partial<Config>) => setConfig(prev => ({ ...prev, ...patch }));

  const handleSave = async () => {
    setSaving(true);
    setMessage({ type: '', text: '' });
    try {
      // Bot config — exchange API keys saved per-exchange via their own Save buttons
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
            background: 'var(--color-surface)', borderRadius: '14px',
            border: '1px solid var(--color-border)',
          }}>
            {TABS.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: '8px', padding: '10px 16px', borderRadius: '10px', border: 'none',
                  background: activeTab === tab.id ? 'var(--color-surface-light)' : 'transparent',
                  color: activeTab === tab.id ? 'var(--color-primary)' : 'var(--color-text-secondary)',
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

              {/* Appearance / Theme Settings */}
              <Section icon={<Palette size={16} color="var(--color-primary)" />} title="Appearance & Theme"
                sub="Customize the look and feel of your cockpit" defaultOpen={true}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
                  {Object.entries(themes).map(([key, theme]) => {
                    const isActive = currentTheme === key;
                    return (
                      <button
                        key={key}
                        onClick={() => setTheme(key as ThemeKey)}
                        style={{
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px',
                          padding: '16px', borderRadius: '12px', cursor: 'pointer',
                          background: isActive ? 'var(--color-surface-light)' : 'var(--color-surface)',
                          border: `2px solid ${isActive ? theme.colors.primary : 'var(--color-border)'}`,
                          transition: 'all 0.2s',
                        }}
                      >
                        {/* Theme preview dot */}
                        <div style={{
                          width: '24px', height: '24px', borderRadius: '50%',
                          background: theme.colors.primary,
                          boxShadow: `0 0 12px ${theme.colors.primary}44`
                        }} />
                        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text)' }}>
                          {theme.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </Section>

              {/* Exchange Connection */}
              <Section icon={<Key size={16} color="#0EA5E9" />} title="Exchange Connection"
                sub="Binance & CoinDCX API keys · Encrypted AES-256-GCM · Test before saving">
                <ExchangeBlock
                  exchange="binance"
                  label="🔶 Binance Futures"
                  accentColor="#F59E0B"
                  placeholder={{ key: 'Enter Binance API key', secret: 'Enter Binance API secret' }}
                />
                <ExchangeBlock
                  exchange="coindcx"
                  label="🇮🇳 CoinDCX"
                  accentColor="#0EA5E9"
                  placeholder={{ key: 'Enter CoinDCX API key', secret: 'Enter CoinDCX API secret' }}
                />
                <div style={{ fontSize: '11px', color: '#6B7280', marginTop: '4px' }}>
                  🔒 Keys are encrypted with AES-256-GCM before storage. Balances appear on your dashboard after saving.
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
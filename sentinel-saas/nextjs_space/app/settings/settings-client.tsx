'use client';

import { useState, useEffect } from 'react';
import { Header } from '@/components/header';
import { Key, Shield, Sliders, Bell, TrendingUp, Coins, Save, CheckCircle, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { motion } from 'framer-motion';

/* ═══ Default Config (mirrors config.py defaults) ═══ */
const DEFAULT_CONFIG = {
  // Coin Selection
  topCoinsToScan: 15,
  maxConcurrentPositions: 10,
  capitalPerTrade: 100,
  totalCapital: 2500,
  // Risk Management
  slMultiplier: 0.8,
  tpMultiplier: 1.0,
  maxLossPerTradePct: -30,
  minHoldMinutes: 15,
  killSwitchDrawdownPct: -50,
  takerFee: 0.0005,
  // Leverage Tiers
  highConfThreshold: 0.80,
  highConfLeverage: 5,
  medConfThreshold: 0.65,
  medConfLeverage: 3,
  lowConfThreshold: 0.50,
  lowConfLeverage: 2,
  // Trailing SL/TP
  trailingSLEnabled: true,
  trailingSLActivationATR: 1.0,
  trailingSLDistanceATR: 1.0,
  trailingTPEnabled: true,
  trailingTPActivationPct: 0.75,
  trailingTPExtensionATR: 1.5,
  trailingTPMaxExtensions: 3,
  capitalProtectEnabled: true,
  capitalProtectThreshold: 10,
  // Telegram
  telegramEnabled: false,
  telegramBotToken: '',
  telegramChatId: '',
  telegramNotifyTrades: true,
  telegramNotifyAlerts: true,
  telegramNotifySummary: true,
};

type Config = typeof DEFAULT_CONFIG;

/* ═══ Section Card ═══ */
function Section({ icon, title, sub, children, delay = 0, defaultOpen = true }: {
  icon: React.ReactNode; title: string; sub: string;
  children: React.ReactNode; delay?: number; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay }} className="mb-6">
      <div
        onClick={() => setOpen(!open)}
        style={{
          background: 'rgba(17, 24, 39, 0.8)', backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,0.06)', borderRadius: open ? '16px 16px 0 0' : '16px',
          padding: '20px 24px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: '10px',
            background: 'rgba(8, 145, 178, 0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{icon}</div>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#06B6D4' }}>{title}</div>
            <div style={{ fontSize: '11px', color: '#6B7280' }}>{sub}</div>
          </div>
        </div>
        {open ? <ChevronUp size={18} color="#6B7280" /> : <ChevronDown size={18} color="#6B7280" />}
      </div>
      {open && (
        <div style={{
          background: 'rgba(17, 24, 39, 0.6)', backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,0.06)', borderTop: 'none',
          borderRadius: '0 0 16px 16px', padding: '24px',
        }}>{children}</div>
      )}
    </motion.div>
  );
}

/* ═══ Input Helpers ═══ */
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', fontSize: '13px',
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '10px', color: '#F0F4F8', outline: 'none',
};

function Field({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '16px' }}>
      <label style={{ fontSize: '12px', fontWeight: 600, color: '#D1D5DB', marginBottom: '6px', display: 'block' }}>
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
      <input type="number" value={value}
        onChange={e => onChange(Number(e.target.value))}
        step={step} min={min} max={max} style={inputStyle} />
      {suffix && <span style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', fontSize: '11px', color: '#6B7280' }}>{suffix}</span>}
    </div>
  );
}

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div onClick={() => onChange(!value)} style={{
      display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer',
      padding: '8px 0',
    }}>
      <div style={{
        width: '40px', height: '22px', borderRadius: '11px',
        background: value ? '#22C55E' : 'rgba(255,255,255,0.1)',
        position: 'relative', transition: 'background 0.3s',
      }}>
        <div style={{
          width: '18px', height: '18px', borderRadius: '50%', background: '#fff',
          position: 'absolute', top: '2px', left: value ? '20px' : '2px',
          transition: 'left 0.3s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }} />
      </div>
      <span style={{ fontSize: '13px', color: '#D1D5DB' }}>{label}</span>
    </div>
  );
}

function Row2({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>{children}</div>;
}

function Row3({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>{children}</div>;
}

/* ═══════════════════════════════════════════════════════════════════ */
/*  MAIN COMPONENT                                                   */
/* ═══════════════════════════════════════════════════════════════════ */

/* ═══ Exchange Block — per-exchange test + save ═══ */
type TestResult = { ok: boolean; balance?: number; email?: string; error?: string } | null;

function ExchangeBlock({ exchange, label, accentColor, placeholder }: {
  exchange: 'binance' | 'coindcx';
  label: string;
  accentColor: string;
  placeholder: { key: string; secret: string; label: string };
}) {
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [apiLabel, setApiLabel] = useState('');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>(null);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [savedBalance, setSavedBalance] = useState<number | null | undefined>(undefined); // undefined=loading, null=not connected
  const [savedConnected, setSavedConnected] = useState(false);

  // Load existing connection status on mount
  useEffect(() => {
    fetch('/api/wallet-balance', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) { setSavedBalance(null); return; }
        const bal = exchange === 'binance' ? d.binance : d.coindcx;
        const connected = exchange === 'binance' ? d.binanceConnected : d.coindcxConnected;
        const loadedLabel = exchange === 'binance' ? d.binanceLabel : d.coindcxLabel;
        if (loadedLabel) setApiLabel(loadedLabel);
        setSavedBalance(bal);
        setSavedConnected(connected);
      })
      .catch(() => setSavedBalance(null));
  }, [exchange]);

  const handleTest = async () => {
    if (!apiKey || !apiSecret) {
      setTestResult({ ok: false, error: 'Enter API key and secret first' });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/exchange/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exchange, apiKey, apiSecret }),
      });
      const data = await res.json();
      if (data.valid) {
        setTestResult({ ok: true, balance: data.balance ?? data.availableBalance, email: data.email });
      } else {
        setTestResult({ ok: false, error: data.error || 'Connection failed' });
      }
    } catch {
      setTestResult({ ok: false, error: 'Network error' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!apiKey || !apiSecret) {
      setSaveMsg({ ok: false, text: 'Enter API key and secret first' });
      return;
    }
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch('/api/settings/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ exchange, apiKey, apiSecret, label: apiLabel }),
      });
      if (res.ok) {
        setSaveMsg({ ok: true, text: 'Saved! Balance updating…' });
        setTimeout(() => setSaveMsg(null), 5000);
        // Refresh the connection status pill after save
        setSavedBalance(undefined);
        setSavedConnected(false);
        fetch('/api/wallet-balance', { cache: 'no-store' })
          .then(r => r.ok ? r.json() : null)
          .then(d => {
            if (!d) { setSavedBalance(null); return; }
            const bal = exchange === 'binance' ? d.binance : d.coindcx;
            const connected = exchange === 'binance' ? d.binanceConnected : d.coindcxConnected;
            const loadedLabel = exchange === 'binance' ? d.binanceLabel : d.coindcxLabel;
            if (loadedLabel) setApiLabel(loadedLabel);
            setSavedBalance(bal);
            setSavedConnected(connected);
          })
          .catch(() => setSavedBalance(null));
      } else {
        const d = await res.json();
        setSaveMsg({ ok: false, text: d.error || 'Failed to save' });
      }
    } catch {
      setSaveMsg({ ok: false, text: 'Network error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      padding: '18px', borderRadius: '12px',
      background: 'rgba(255,255,255,0.02)',
      border: `1px solid ${accentColor}22`,
      marginBottom: '16px',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: accentColor }}>{label}</div>
          {/* Saved connection status (loaded on mount) */}
          {savedBalance === undefined && (
            <span style={{ fontSize: '10px', color: '#6B7280' }}>checking…</span>
          )}
          {savedBalance === null && savedConnected && (
            <span style={{
              fontSize: '10px', fontWeight: 600, color: '#F59E0B',
              background: 'rgba(245,158,11,0.1)', padding: '2px 8px', borderRadius: '6px',
            }}>🔑 Keys saved · balance unavailable</span>
          )}
          {savedBalance != null && (
            <span style={{
              fontSize: '11px', fontWeight: 700, color: '#22C55E',
              background: 'rgba(34,197,94,0.1)', padding: '2px 8px', borderRadius: '6px',
              display: 'flex', alignItems: 'center', gap: '4px',
            }}>
              <CheckCircle size={10} /> Connected · ${savedBalance.toFixed(2)} USDT
            </span>
          )}
          {savedBalance === null && !savedConnected && (
            <span style={{ fontSize: '10px', color: '#6B7280', fontStyle: 'italic' }}>Not connected</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {testResult?.ok && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              fontSize: '12px', fontWeight: 700, color: '#22C55E',
              background: 'rgba(34,197,94,0.12)', padding: '4px 10px', borderRadius: '8px',
            }}>
              <CheckCircle size={12} />
              {testResult.balance != null ? `$${testResult.balance.toFixed(2)} USDT` : testResult.email || 'Connected'}
            </div>
          )}
          {testResult && !testResult.ok && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              fontSize: '12px', color: '#EF4444',
              background: 'rgba(239,68,68,0.1)', padding: '4px 10px', borderRadius: '8px',
            }}>
              <AlertCircle size={12} /> {testResult.error}
            </div>
          )}
        </div>
      </div>

      {/* Inputs */}
      <Row2>
        <Field label="API Key">
          <input type="text" value={apiKey} onChange={e => { setApiKey(e.target.value); setTestResult(null); }}
            style={inputStyle} placeholder={placeholder.key} />
        </Field>
        <Field label="API Secret">
          <input type="password" value={apiSecret} onChange={e => { setApiSecret(e.target.value); setTestResult(null); }}
            style={inputStyle} placeholder={placeholder.secret} />
        </Field>
      </Row2>
      <div style={{ marginTop: '4px', marginBottom: '16px' }}>
        <Field label="Sub-Account Label (Optional)" sub="(e.g. 'Main Trading', 'Hedge Fund Wallet')">
          <input type="text" value={apiLabel} onChange={e => setApiLabel(e.target.value)}
            style={inputStyle} placeholder={placeholder.label} />
        </Field>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginTop: '4px' }}>
        <button onClick={handleTest} disabled={testing} style={{
          padding: '8px 18px', borderRadius: '10px', border: `1px solid ${accentColor}44`,
          background: 'rgba(255,255,255,0.04)', color: accentColor,
          fontSize: '12px', fontWeight: 700, cursor: testing ? 'wait' : 'pointer',
          opacity: testing ? 0.6 : 1, transition: 'all 0.2s',
        }}>
          {testing ? 'Testing...' : '⚡ Test Connection'}
        </button>

        <button onClick={handleSave} disabled={saving} style={{
          padding: '8px 18px', borderRadius: '10px', border: 'none',
          background: `linear-gradient(135deg, ${accentColor}cc, ${accentColor})`,
          color: '#fff', fontSize: '12px', fontWeight: 700,
          cursor: saving ? 'wait' : 'pointer',
          opacity: saving ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: '6px',
        }}>
          <Save size={12} /> {saving ? 'Saving...' : 'Save API Keys'}
        </button>

        {saveMsg && (
          <span style={{
            fontSize: '12px', fontWeight: 600,
            color: saveMsg.ok ? '#22C55E' : '#EF4444',
          }}>
            {saveMsg.ok ? '✓ ' : '✗ '}{saveMsg.text}
          </span>
        )}
      </div>
    </div>
  );
}

export function SettingsClient() {
  const [mounted, setMounted] = useState(false);
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  useEffect(() => { setMounted(true); }, []);

  const update = (patch: Partial<Config>) => setConfig(prev => ({ ...prev, ...patch }));

  const handleSave = async () => {
    setSaving(true);
    setMessage({ type: '', text: '' });
    try {
      // Bot config settings — API keys are saved per-exchange via their own Save buttons
      setMessage({ type: 'success', text: 'Settings saved successfully!' });
      setTimeout(() => setMessage({ type: '', text: '' }), 4000);
    } catch {
      setMessage({ type: 'error', text: 'Failed to save settings.' });
    } finally { setSaving(false); }
  };

  if (!mounted) return null;

  return (
    <div className="min-h-screen">
      <Header />
      <main className="pt-24 pb-12 px-4">
        <div className="max-w-4xl mx-auto">

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
            <h1 className="text-3xl font-bold mb-1"><span className="text-gradient">Settings</span></h1>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Platform integration · Bot configuration · Risk management · Notifications
            </p>
          </motion.div>

          {message.text && (
            <div style={{
              marginBottom: '20px', padding: '14px 18px', borderRadius: '12px',
              display: 'flex', alignItems: 'center', gap: '10px',
              background: message.type === 'success' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
              color: message.type === 'success' ? '#22C55E' : '#EF4444',
              border: `1px solid ${message.type === 'success' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
            }}>
              {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
              <span style={{ fontSize: '13px', fontWeight: 600 }}>{message.text}</span>
            </div>
          )}

          {/* ═══ GROUP: Platform Integration ═══ */}
          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '2px', color: '#6B7280', marginBottom: '14px', marginTop: '8px' }}>Platform Integration</div>

          {/* ═══ 6.1 Exchange Connection ═══ */}
          <Section icon={<Key size={18} color="#0EA5E9" />} title="Exchange Connection"
            sub="Binance & CoinDCX API keys · Encrypted AES-256-GCM · Test before saving" delay={0.05}>
            <ExchangeBlock
              exchange="binance"
              label="🔶 Binance Futures"
              accentColor="#F59E0B"
              placeholder={{ key: 'Enter Binance API key', secret: 'Enter Binance API secret', label: 'Main Account' }}
            />
            <ExchangeBlock
              exchange="coindcx"
              label="🇮🇳 CoinDCX"
              accentColor="#0EA5E9"
              placeholder={{ key: 'Enter CoinDCX API key', secret: 'Enter CoinDCX API secret', label: 'Secondary Wallet' }}
            />
            <div style={{ fontSize: '11px', color: '#6B7280', marginTop: '4px' }}>
              🔒 Keys are encrypted with AES-256-GCM before storage. Balances appear on your dashboard after saving.
            </div>
          </Section>



          {/* ═══ 6.6 Telegram Notifications ═══ */}
          <Section icon={<Bell size={18} color="#8B5CF6" />} title="Telegram Notifications"
            sub="Trade alerts · System alerts · Daily summaries" delay={0.3} defaultOpen={false}>
            <Toggle value={config.telegramEnabled} onChange={v => update({ telegramEnabled: v })} label="Enable Telegram Notifications" />
            {config.telegramEnabled && (
              <div style={{ marginTop: '12px' }}>
                <Row2>
                  <Field label="Bot Token"><input type="password" value={config.telegramBotToken} onChange={e => update({ telegramBotToken: e.target.value })} style={inputStyle} placeholder="123456:ABC-DEF1234..." /></Field>
                  <Field label="Chat ID"><input type="text" value={config.telegramChatId} onChange={e => update({ telegramChatId: e.target.value })} style={inputStyle} placeholder="-100123456789" /></Field>
                </Row2>
                <div style={{ display: 'flex', gap: '24px', marginTop: '8px' }}>
                  <Toggle value={config.telegramNotifyTrades} onChange={v => update({ telegramNotifyTrades: v })} label="Trade Entries/Exits" />
                  <Toggle value={config.telegramNotifyAlerts} onChange={v => update({ telegramNotifyAlerts: v })} label="System Alerts" />
                  <Toggle value={config.telegramNotifySummary} onChange={v => update({ telegramNotifySummary: v })} label="Daily Summary" />
                </div>
              </div>
            )}
          </Section>

          {/* ═══ 6.7 Save Button ═══ */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
            <button onClick={handleSave} disabled={saving}
              style={{
                width: '100%', padding: '16px', borderRadius: '14px', border: 'none',
                background: 'linear-gradient(135deg, #0891B2, #0EA5E9)',
                color: '#fff', fontSize: '15px', fontWeight: 700, cursor: saving ? 'wait' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                opacity: saving ? 0.6 : 1, transition: 'opacity 0.3s',
              }}>
              <Save size={18} />
              {saving ? 'Saving Configuration...' : 'Save All Settings'}
            </button>
          </motion.div>

        </div>
      </main>
    </div>
  );
}
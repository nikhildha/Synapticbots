"use client";
// ── SIGNAL BYPASS TOGGLE — EXPERIMENT ONLY ──────────────────────────────────
// Remove this file AND the <SignalBypassToggle /> usage in dashboard-client.tsx
// when bypass testing is complete.
// ────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from "react";
import { toast } from "sonner";

interface BypassState {
  bypass_enabled: boolean;
  bypass_symbol: string;
  bypass_side: "BUY" | "SELL";
  bypass_segment: string;
  bypass_conviction: number;
}

const DEFAULT_STATE: BypassState = {
  bypass_enabled: false,
  bypass_symbol: "BTCUSDT",
  bypass_side: "BUY",
  bypass_segment: "layer1",
  bypass_conviction: 65,
};

// All 40 coins the engine scans
const ALL_COINS = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "AVAXUSDT",
  "ADAUSDT", "DOTUSDT", "LINKUSDT", "LTCUSDT", "NEARUSDT",
  "UNIUSDT", "AAVEUSDT", "MKRUSDT", "COMPUSDT", "SNXUSDT",
  "DOGEUSDT", "SHIBUSDT", "PEPEUSDT", "WIFUSDT", "BONKUSDT",
  "APTUSDT", "SUIUSDT", "ARBUSDT", "OPUSDT", "INJUSDT",
  "STXUSDT", "FILUSDT", "RENDERUSDT", "FETUSDT", "WLDUSDT",
  "IMXUSDT", "MANAUSDT", "SANDUSDT", "AXSUSDT", "GALAUSDT",
  "IOTXUSDT", "HBARUSDT", "XRPUSDT", "XLMUSDT", "ALGOUSDT",
];

const ALL_SEGMENTS = [
  { value: "ALL", label: "ALL (any segment)" },
  { value: "layer1", label: "Layer 1 (BTC, ETH, SOL…)" },
  { value: "defi", label: "DeFi (AAVE, UNI, MKR…)" },
  { value: "meme", label: "Meme (DOGE, SHIB, PEPE…)" },
  { value: "layer2_alt", label: "Layer 2 / Alt-L1 (ARB, OP, APT…)" },
  { value: "ai_depin", label: "AI / DePIN (FET, RENDER, WLD…)" },
  { value: "gaming", label: "Gaming / Metaverse (MANA, SAND, AXS…)" },
  { value: "rwa", label: "RWA / Infra (HBAR, IOTX, XRP…)" },
];

export function SignalBypassToggle() {
  const [state, setState] = useState<BypassState>(DEFAULT_STATE);
  const [draft, setDraft] = useState<BypassState>(DEFAULT_STATE);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Load current bypass state on mount
  useEffect(() => {
    fetch("/api/signal-bypass")
      .then((r) => r.json())
      .then((d) => {
        setState(d);
        setDraft(d);
      })
      .catch(() => {});
  }, []);

  // Enable/disable toggle (immediately saves)
  const toggle = async () => {
    setLoading(true);
    const next = { ...state, bypass_enabled: !state.bypass_enabled };
    try {
      const res = await fetch("/api/signal-bypass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const body = await res.json();
      if (body.ok) {
        setState(next);
        setDraft(next);
        if (next.bypass_enabled) setShowPanel(true);
        toast[next.bypass_enabled ? "warning" : "success"](
          next.bypass_enabled
            ? `⚗️ Bypass ON — ${next.bypass_side} ${next.bypass_symbol}`
            : "Signal Bypass OFF — normal operation resumed"
        );
      } else {
        toast.error("Failed: " + (body.error || "unknown"));
      }
    } catch {
      toast.error("Network error");
    } finally {
      setLoading(false);
    }
  };

  // Update draft locally (not saved yet)
  const updateDraft = (patch: Partial<BypassState>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };

  // Explicit save
  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/signal-bypass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = await res.json();
      if (body.ok) {
        setState(draft);
        setDirty(false);
        toast.success(`✅ Bypass config saved — ${draft.bypass_side} ${draft.bypass_symbol} [${draft.bypass_segment}]`);
      } else {
        toast.error("Save failed: " + (body.error || "unknown"));
      }
    } catch {
      toast.error("Network error saving config");
    } finally {
      setSaving(false);
    }
  };

  const isOn = state.bypass_enabled;

  return (
    <div className="relative" style={{ position: "relative" }}>
      {/* ── Main toggle button + gear icon ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button
          onClick={toggle}
          disabled={loading}
          title="Toggle signal bypass ON/OFF"
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600,
            border: `1px solid ${isOn ? "rgba(245,158,11,0.6)" : "rgba(255,255,255,0.1)"}`,
            background: isOn ? "rgba(245,158,11,0.15)" : "rgba(255,255,255,0.04)",
            color: isOn ? "#FCD34D" : "#9CA3AF",
            cursor: loading ? "wait" : "pointer",
            transition: "all 0.2s",
            boxShadow: isOn ? "0 0 14px rgba(245,158,11,0.25)" : "none",
          }}
        >
          <span style={{ fontSize: 14 }}>{loading ? "⏳" : "⚗️"}</span>
          <span>{isOn ? "Bypass ON" : "Bypass"}</span>
          <span style={{
            width: 7, height: 7, borderRadius: "50%",
            background: isOn ? "#F59E0B" : "#374151",
            boxShadow: isOn ? "0 0 6px #F59E0B" : "none",
            animation: isOn ? "pulse 1s infinite" : "none",
          }} />
        </button>

        {/* Config gear — always visible when bypass is on or panel is open */}
        {(isOn || showPanel) && (
          <button
            onClick={() => setShowPanel((v) => !v)}
            title="Configure bypass"
            style={{
              padding: "6px 8px", borderRadius: 8, fontSize: 13,
              border: "1px solid rgba(255,255,255,0.1)",
              background: showPanel ? "rgba(245,158,11,0.15)" : "rgba(255,255,255,0.04)",
              color: showPanel ? "#FCD34D" : "#6B7280",
              cursor: "pointer",
            }}
          >
            ⚙️
          </button>
        )}
      </div>

      {/* ── Config panel ── */}
      {showPanel && (
        <div
          style={{
            position: "absolute", right: 0, top: "calc(100% + 8px)", zIndex: 9999,
            width: 300, borderRadius: 12,
            border: "1px solid rgba(245,158,11,0.3)",
            background: "rgba(10,13,24,0.98)",
            backdropFilter: "blur(20px)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.6), 0 0 30px rgba(245,158,11,0.08)",
            padding: 16,
          }}
        >
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 16 }}>⚗️</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#FCD34D", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                Bypass Config
              </span>
            </div>
            <button onClick={() => setShowPanel(false)} style={{ color: "#6B7280", background: "none", border: "none", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>✕</button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 12 }}>
            {/* Symbol dropdown */}
            <div>
              <label style={{ color: "#9CA3AF", display: "block", marginBottom: 4, fontWeight: 600 }}>Symbol</label>
              <select
                value={draft.bypass_symbol}
                onChange={(e) => updateDraft({ bypass_symbol: e.target.value })}
                style={{
                  width: "100%", padding: "6px 10px", borderRadius: 8, fontSize: 12,
                  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
                  color: "#fff", cursor: "pointer",
                  outline: "none",
                }}
              >
                <option value="ALL" style={{ background: "#111827", color: "#FCD34D" }}>
                  ★ ALL COINS (broadcast)
                </option>
                {ALL_COINS.map((c) => (
                  <option key={c} value={c} style={{ background: "#111827", color: "#fff" }}>
                    {c.replace("USDT", "")} ({c})
                  </option>
                ))}
              </select>
            </div>

            {/* Side toggle */}
            <div>
              <label style={{ color: "#9CA3AF", display: "block", marginBottom: 4, fontWeight: 600 }}>Side</label>
              <div style={{ display: "flex", gap: 6 }}>
                {(["BUY", "SELL"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => updateDraft({ bypass_side: s })}
                    style={{
                      flex: 1, padding: "6px 0", borderRadius: 8, fontSize: 12, fontWeight: 700,
                      cursor: "pointer", transition: "all 0.15s",
                      border: `1px solid ${draft.bypass_side === s
                        ? s === "BUY" ? "rgba(34,197,94,0.6)" : "rgba(239,68,68,0.6)"
                        : "rgba(255,255,255,0.1)"}`,
                      background: draft.bypass_side === s
                        ? s === "BUY" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)"
                        : "rgba(255,255,255,0.04)",
                      color: draft.bypass_side === s
                        ? s === "BUY" ? "#4ADE80" : "#F87171"
                        : "#6B7280",
                    }}
                  >
                    {s === "BUY" ? "▲ LONG" : "▼ SHORT"}
                  </button>
                ))}
              </div>
            </div>

            {/* Segment dropdown */}
            <div>
              <label style={{ color: "#9CA3AF", display: "block", marginBottom: 4, fontWeight: 600 }}>Segment</label>
              <select
                value={draft.bypass_segment}
                onChange={(e) => updateDraft({ bypass_segment: e.target.value })}
                style={{
                  width: "100%", padding: "6px 10px", borderRadius: 8, fontSize: 12,
                  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
                  color: "#fff", cursor: "pointer",
                  outline: "none",
                }}
              >
                {ALL_SEGMENTS.map((seg) => (
                  <option key={seg.value} value={seg.value} style={{ background: "#111827", color: "#fff" }}>
                    {seg.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Conviction slider */}
            <div>
              <label style={{ color: "#9CA3AF", display: "block", marginBottom: 4, fontWeight: 600 }}>
                Conviction: <span style={{ color: "#fff", fontWeight: 700 }}>{draft.bypass_conviction}</span>
                <span style={{ color: "#6B7280", marginLeft: 4 }}>(leverage gate)</span>
              </label>
              <input
                type="range" min={40} max={100} step={5}
                value={draft.bypass_conviction}
                onChange={(e) => updateDraft({ bypass_conviction: parseInt(e.target.value) })}
                style={{ width: "100%", accentColor: "#F59E0B" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", color: "#6B7280", fontSize: 10, marginTop: 2 }}>
                <span>40 (low)</span><span>70 (med)</span><span>100 (max)</span>
              </div>
            </div>

            {/* Save button */}
            <button
              onClick={save}
              disabled={saving || !dirty}
              style={{
                width: "100%", padding: "8px 0", borderRadius: 8, fontSize: 12, fontWeight: 700,
                cursor: dirty && !saving ? "pointer" : "default",
                border: `1px solid ${dirty ? "rgba(245,158,11,0.5)" : "rgba(255,255,255,0.08)"}`,
                background: dirty ? "rgba(245,158,11,0.18)" : "rgba(255,255,255,0.04)",
                color: dirty ? "#FCD34D" : "#4B5563",
                transition: "all 0.2s",
              }}
            >
              {saving ? "⏳ Saving…" : dirty ? "💾 Save Config" : "✓ Saved"}
            </button>
          </div>

          {/* Footer warning */}
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.08)", fontSize: 10, color: "rgba(245,158,11,0.5)", textAlign: "center" }}>
            ⚠️ EXPERIMENT MODE — disable before production
          </div>
        </div>
      )}
    </div>
  );
}

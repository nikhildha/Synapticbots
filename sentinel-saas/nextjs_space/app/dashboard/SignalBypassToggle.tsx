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

export function SignalBypassToggle() {
  const [state, setState] = useState<BypassState>(DEFAULT_STATE);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Load current bypass state on mount
  useEffect(() => {
    fetch("/api/signal-bypass")
      .then((r) => r.json())
      .then((d) => setState(d))
      .catch(() => {});
  }, []);

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
        toast[next.bypass_enabled ? "warning" : "success"](
          next.bypass_enabled
            ? `⚗️ Signal Bypass ON — ${next.bypass_side} ${next.bypass_symbol}`
            : "Signal Bypass OFF — normal operation resumed"
        );
      } else {
        toast.error("Failed to update bypass: " + (body.error || "unknown"));
      }
    } catch {
      toast.error("Network error updating bypass");
    } finally {
      setLoading(false);
    }
  };

  const updateField = async (patch: Partial<BypassState>) => {
    const next = { ...state, ...patch };
    setState(next);
    try {
      await fetch("/api/signal-bypass", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
    } catch {}
  };

  const isOn = state.bypass_enabled;

  return (
    <div className="relative">
      {/* Main toggle button */}
      <button
        onClick={toggle}
        disabled={loading}
        title="Signal Bypass — Admin Experiment Mode"
        className={`
          flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium
          border transition-all duration-200
          ${isOn
            ? "bg-amber-500/20 border-amber-400/60 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.3)]"
            : "bg-white/5 border-white/10 text-gray-400 hover:border-white/20 hover:text-gray-300"
          }
        `}
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
      >
        <span className={`text-base transition-transform ${loading ? "animate-spin" : ""}`}>⚗️</span>
        <span>{isOn ? "Bypass ON" : "Bypass"}</span>
        {/* LED indicator */}
        <span className={`w-2 h-2 rounded-full ${isOn ? "bg-amber-400 animate-pulse" : "bg-gray-600"}`} />
      </button>

      {/* Expanded config panel */}
      {isOn && (
        <div
          className="absolute right-0 top-full mt-2 z-50 w-72 rounded-xl border border-amber-400/30 bg-[rgba(17,24,39,0.97)] backdrop-blur-xl shadow-2xl p-4"
          onMouseEnter={() => setExpanded(true)}
          onMouseLeave={() => setExpanded(false)}
        >
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base">⚗️</span>
            <span className="text-xs font-bold text-amber-300 uppercase tracking-widest">Bypass Config</span>
          </div>
          <div className="space-y-2.5 text-xs">
            <div>
              <label className="text-gray-400 block mb-1">Symbol</label>
              <input
                type="text"
                value={state.bypass_symbol}
                onChange={(e) => updateField({ bypass_symbol: e.target.value.toUpperCase() })}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white focus:outline-none focus:border-amber-400/50"
                placeholder="BTCUSDT"
              />
            </div>
            <div>
              <label className="text-gray-400 block mb-1">Side</label>
              <div className="flex gap-2">
                {["BUY", "SELL"].map((s) => (
                  <button
                    key={s}
                    onClick={() => updateField({ bypass_side: s as "BUY" | "SELL" })}
                    className={`flex-1 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                      state.bypass_side === s
                        ? s === "BUY"
                          ? "bg-emerald-500/20 border-emerald-400/60 text-emerald-300"
                          : "bg-red-500/20 border-red-400/60 text-red-300"
                        : "bg-white/5 border-white/10 text-gray-400"
                    }`}
                  >
                    {s === "BUY" ? "▲ LONG" : "▼ SHORT"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-gray-400 block mb-1">Segment</label>
              <input
                type="text"
                value={state.bypass_segment}
                onChange={(e) => updateField({ bypass_segment: e.target.value.toLowerCase() })}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-white focus:outline-none focus:border-amber-400/50"
                placeholder="layer1"
              />
            </div>
            <div>
              <label className="text-gray-400 block mb-1">Conviction: <span className="text-white font-semibold">{state.bypass_conviction}</span></label>
              <input
                type="range" min={40} max={100} step={5}
                value={state.bypass_conviction}
                onChange={(e) => updateField({ bypass_conviction: parseInt(e.target.value) })}
                className="w-full accent-amber-400"
              />
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-white/10 text-[10px] text-amber-400/60 text-center">
            ⚠️ EXPERIMENT MODE — disable before production
          </div>
        </div>
      )}
    </div>
  );
}

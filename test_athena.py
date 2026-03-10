#!/usr/bin/env python3
"""
═══════════════════════════════════════════════════════════════════
  🏛️  ATHENA TEST FRAMEWORK
  Standalone CLI to test Athena's Lead Investment Officer decisions
  with real market data + Google Search grounding.
═══════════════════════════════════════════════════════════════════

Usage:
  python3 test_athena.py                      # Test top 5 by volume
  python3 test_athena.py --coins BTCUSDT ETHUSDT ARBUSDT
  python3 test_athena.py --coins DOGEUSDT --side SELL --conviction 75
  python3 test_athena.py --all                # Test top 15
  python3 test_athena.py --report             # Full graded report
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime

# ─── Setup ──────────────────────────────────────────────────────────────────────
os.environ.setdefault("GEMINI_API_KEY", "AIzaSyB3r1L3iWIqM7EBH3BV5U9SscfiAjoOSuE")

import config
from data_pipeline import fetch_klines
from feature_engine import compute_hmm_features, compute_all_features
from hmm_brain import HMMBrain
from coin_scanner import get_top_coins_by_volume

# ─── Colors ─────────────────────────────────────────────────────────────────────
G = "\033[92m"   # Green
R = "\033[91m"   # Red
Y = "\033[93m"   # Yellow
P = "\033[95m"   # Purple
C = "\033[96m"   # Cyan
B = "\033[1m"    # Bold
D = "\033[2m"    # Dim
X = "\033[0m"    # Reset


def get_btc_context():
    """Get BTC regime for macro context."""
    try:
        df = fetch_klines("BTCUSDT", "1h", limit=200)
        if df is None or len(df) < 60:
            return {"regime": "UNKNOWN", "confidence": 0, "price": 0}
        df_hmm = compute_hmm_features(df)
        brain = HMMBrain()
        brain.train(df_hmm)
        if brain.is_trained:
            state, conf = brain.predict(compute_all_features(df))
            return {
                "regime": brain.get_regime_name(state),
                "confidence": conf,
                "price": float(df["close"].iloc[-1]),
            }
    except Exception as e:
        print(f"  {Y}⚠ BTC context error: {e}{X}")
    return {"regime": "UNKNOWN", "confidence": 0, "price": 0}


def analyze_coin(symbol, forced_side=None, forced_conviction=None):
    """Run full HMM + Athena analysis on a single coin."""
    from llm_reasoning import AthenaEngine

    result = {
        "symbol": symbol,
        "status": "PENDING",
        "hmm": {},
        "athena": {},
        "timing": {},
    }

    # 1. Fetch market data
    t0 = time.time()
    df = fetch_klines(symbol, "1h", limit=200)
    if df is None or len(df) < 60:
        result["status"] = "NO_DATA"
        return result

    # 2. Run HMM
    df_feat = compute_all_features(df)
    df_hmm = compute_hmm_features(df)
    brain = HMMBrain()
    brain.train(df_hmm)

    if not brain.is_trained:
        result["status"] = "HMM_FAIL"
        return result

    state, conf = brain.predict(df_feat)
    regime = brain.get_regime_name(state)
    side = forced_side or ("BUY" if state == config.REGIME_BULL else "SELL")

    # Multi-TF conviction (simplified for test)
    conviction = forced_conviction or round(conf * 100, 1)

    result["hmm"] = {
        "regime": regime,
        "confidence": round(conf, 4),
        "side": side,
        "conviction": conviction,
        "price": round(float(df["close"].iloc[-1]), 6),
        "atr": round(float(df["close"].rolling(14).std().iloc[-1] or 0), 6),
        "vol_percentile": round(float(min(conf, 1.0)), 2),
    }
    result["timing"]["hmm_ms"] = int((time.time() - t0) * 1000)

    # 3. Get BTC context
    btc = get_btc_context()

    # 4. Call Athena
    engine = AthenaEngine()
    ctx = {
        "ticker": symbol,
        "side": side,
        "hmm_regime": regime,
        "hmm_confidence": conf,
        "conviction": conviction,
        "tf_agreement": 2,
        "current_price": result["hmm"]["price"],
        "atr": result["hmm"]["atr"],
        "vol_percentile": result["hmm"]["vol_percentile"],
        "btc_regime": btc["regime"],
        "btc_margin": btc.get("confidence", 0),
    }

    t1 = time.time()
    decision = engine.validate_signal(ctx)
    athena_ms = int((time.time() - t1) * 1000)

    result["athena"] = {
        "action": decision.action,
        "confidence": decision.adjusted_confidence,
        "reasoning": decision.reasoning,
        "risk_flags": decision.risk_flags,
        "latency_ms": athena_ms,
    }
    result["timing"]["athena_ms"] = athena_ms
    result["timing"]["total_ms"] = int((time.time() - t0) * 1000)
    result["status"] = "OK"
    return result


def print_decision(result, idx=1):
    """Pretty-print a single Athena decision."""
    sym = result["symbol"]
    status = result["status"]

    if status != "OK":
        print(f"\n  {D}#{idx}{X} {B}{sym}{X}  {R}✗ {status}{X}")
        return

    hmm = result["hmm"]
    ath = result["athena"]
    timing = result["timing"]

    # Action color
    action = ath["action"]
    if action == "EXECUTE":
        ac = G
    elif action == "VETO":
        ac = R
    else:
        ac = Y

    # Side color
    side = hmm["side"]
    sc = G if side == "BUY" else R

    conf_pct = round(ath["confidence"] * 100)
    conf_bar = "█" * (conf_pct // 10) + "░" * (10 - conf_pct // 10)

    print(f"\n  {'━' * 80}")
    print(f"  {B}#{idx}{X}  🏛️ {B}{sym.replace('USDT','')}{X}  "
          f"{ac}{B}{action}{X}  {sc}{B}{'↑ LONG' if side == 'BUY' else '↓ SHORT'}{X}  "
          f"${hmm['price']:,.4f}")
    print(f"  {'─' * 80}")

    # Confidence bar
    print(f"  {D}Confidence{X}  [{C}{conf_bar}{X}] {B}{conf_pct}%{X}  "
          f"{D}|{X}  HMM: {hmm['regime']} ({hmm['confidence']*100:.0f}%)  "
          f"{D}|{X}  Conv: {hmm['conviction']:.0f}/100")

    # Reasoning
    # Parse pipe-separated format
    parts = ath["reasoning"].split(" | ")
    main_reason = parts[0]
    leverage = size = support = resistance = ""
    for p in parts[1:]:
        if p.startswith("Leverage:"): leverage = p.split(":", 1)[1].strip()
        elif p.startswith("Size:"): size = p.split(":", 1)[1].strip()
        elif p.startswith("Support:"): support = p.split(":", 1)[1].strip()
        elif p.startswith("Resistance:"): resistance = p.split(":", 1)[1].strip()

    print(f"\n  {P}📝 Analysis:{X}")
    # Word-wrap at ~75 chars
    words = main_reason.split()
    line = "     "
    for w in words:
        if len(line) + len(w) > 80:
            print(line)
            line = "     "
        line += w + " "
    if line.strip():
        print(line)

    # Metrics
    if leverage or size:
        metrics = []
        if leverage: metrics.append(f"⚡ Leverage: {B}{leverage}{X}")
        if size: metrics.append(f"📊 Size: {B}{size}{X}")
        print(f"\n  {' │ '.join(metrics)}")

    # Support / Resistance
    if support or resistance:
        print(f"\n  {G}▼ Support:{X} {support or '—'}  {D}|{X}  {R}▲ Resistance:{X} {resistance or '—'}")

    # Risk flags
    if ath["risk_flags"]:
        flags = ", ".join(ath["risk_flags"][:5])
        print(f"\n  {Y}⚠ Risks:{X} {flags}")

    # Timing
    print(f"\n  {D}⏱  HMM: {timing['hmm_ms']}ms │ Athena: {timing['athena_ms']}ms │ Total: {timing['total_ms']}ms{X}")


def print_report(results):
    """Print graded summary report."""
    ok = [r for r in results if r["status"] == "OK"]
    if not ok:
        print(f"\n  {R}No successful analyses.{X}")
        return

    executes = [r for r in ok if r["athena"]["action"] == "EXECUTE"]
    vetoes = [r for r in ok if r["athena"]["action"] == "VETO"]
    reduces = [r for r in ok if r["athena"]["action"] == "REDUCE_SIZE"]

    avg_conf = sum(r["athena"]["confidence"] for r in ok) / len(ok)
    avg_latency = sum(r["timing"]["athena_ms"] for r in ok) / len(ok)

    all_flags = []
    for r in ok:
        all_flags.extend(r["athena"].get("risk_flags", []))
    unique_flags = list(set(all_flags))

    print(f"\n{'═' * 84}")
    print(f"  {B}{P}🏛️  ATHENA TEST REPORT{X}  │  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'═' * 84}")
    print(f"  Coins Tested:     {B}{len(results)}{X}")
    print(f"  Successful:       {B}{len(ok)}{X} / {len(results)}")
    print(f"  {G}✅ EXECUTE:{X}        {B}{len(executes)}{X}")
    print(f"  {Y}⚠️  REDUCE:{X}        {B}{len(reduces)}{X}")
    print(f"  {R}🚫 VETO:{X}           {B}{len(vetoes)}{X}")
    print(f"  Avg Confidence:   {B}{avg_conf*100:.0f}%{X}")
    print(f"  Avg Latency:      {B}{avg_latency/1000:.1f}s{X}")
    print(f"{'─' * 84}")

    if executes:
        print(f"\n  {G}{B}EXECUTE — Ready to Trade:{X}")
        for r in executes:
            hmm = r["hmm"]
            ath = r["athena"]
            sc = G if hmm["side"] == "BUY" else R
            print(f"    {sc}{'↑' if hmm['side']=='BUY' else '↓'}{X} {B}{r['symbol'].replace('USDT','')}{X}  "
                  f"conf={ath['confidence']*100:.0f}%  price=${hmm['price']:,.4f}")

    if vetoes:
        print(f"\n  {R}{B}VETO — Do Not Trade:{X}")
        for r in vetoes:
            print(f"    🚫 {B}{r['symbol'].replace('USDT','')}{X}  "
                  f"reason={r['athena']['reasoning'][:80]}...")

    if unique_flags:
        print(f"\n  {Y}{B}Risk Flags Detected:{X}")
        for f in unique_flags[:10]:
            print(f"    ⚠ {f}")

    print(f"\n{'═' * 84}\n")


def main():
    parser = argparse.ArgumentParser(description="🏛️ Athena Test Framework")
    parser.add_argument("--coins", nargs="+", help="Specific coins to test (e.g., BTCUSDT ETHUSDT)")
    parser.add_argument("--all", action="store_true", help="Test top 15 coins by volume")
    parser.add_argument("--top", type=int, default=5, help="Number of top coins to test (default: 5)")
    parser.add_argument("--side", choices=["BUY", "SELL"], help="Force trade direction")
    parser.add_argument("--conviction", type=float, help="Force conviction score (0-100)")
    parser.add_argument("--report", action="store_true", help="Print graded summary report")
    parser.add_argument("--json", action="store_true", help="Output raw JSON")

    args = parser.parse_args()

    print(f"\n{'═' * 84}")
    print(f"  {B}{P}🏛️  ATHENA TEST FRAMEWORK{X}")
    print(f"  {D}Lead Investment Officer · Google Search Grounded · {config.LLM_MODEL}{X}")
    print(f"{'═' * 84}")

    # Get coin list
    if args.coins:
        coins = [c.upper() for c in args.coins]
    elif args.all:
        print(f"\n  {C}Fetching top 15 coins by volume...{X}")
        coins = get_top_coins_by_volume(limit=15)
    else:
        print(f"\n  {C}Fetching top {args.top} coins by volume...{X}")
        coins = get_top_coins_by_volume(limit=args.top)

    print(f"  {D}Testing: {', '.join(coins)}{X}")
    print(f"  {D}Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}{X}")

    # Run analysis
    results = []
    for i, coin in enumerate(coins):
        print(f"\n  {C}⏳ Analyzing {coin}... ({i+1}/{len(coins)}){X}", end="", flush=True)
        result = analyze_coin(coin, forced_side=args.side, forced_conviction=args.conviction)
        results.append(result)

        if not args.json:
            print_decision(result, idx=i + 1)

    # Output
    if args.json:
        print(json.dumps(results, indent=2, default=str))
    elif args.report or len(coins) > 3:
        print_report(results)

    return results


if __name__ == "__main__":
    import logging
    logging.basicConfig(level=logging.WARNING, format="%(message)s")
    main()

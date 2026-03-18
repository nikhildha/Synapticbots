"""
tools/train_phase1.py

Phase 1 GMMHMM Training — 61 high-priority CoinDCX futures coins.

Uses HMMBrain (GMMHMM n_mix=3, n_states=3) — the same model used by the live engine.

Pipeline per coin:
  1. Fetch 2 years of 4h OHLCV from Binance public API
  2. Compute all HMM features (12 features via compute_all_features)
  3. Train HMMBrain on TRAIN period  (Jan 2024 – Aug 2024)
  4. Evaluate forward Sharpe on FWD  period  (Jan 2025 – present)
  5. Assign Tier A / B / C
  6. Append new rows to data/coin_tiers.csv
  7. Print final summary table

Tier rules (forward annualised Sharpe):
  A : fwd_sharpe >= 1.0   → strong regime signal, deploy
  B : fwd_sharpe >= 0.0   → moderate signal, monitor
  C : fwd_sharpe <  0.0   → noisy / adverse, skip

Usage:
  python tools/train_phase1.py
  python tools/train_phase1.py --dry-run      # skip CSV write
  python tools/train_phase1.py --segment L1   # only one segment
"""

import sys
import os
import time
import csv
import argparse
from datetime import datetime

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config
from data_pipeline import _parse_klines_df
from feature_engine import compute_all_features
from hmm_brain import HMMBrain

# ─── Phase 1 Coin List ───────────────────────────────────────────────────────
PHASE1_COINS = {
    "L1": [
        "ADAUSDT", "APTUSDT", "BCHUSDT", "DOTUSDT", "ETCUSDT",
        "HBARUSDT", "ICPUSDT", "KASUSDT", "LTCUSDT", "NEARUSDT",
        "TONUSDT", "TRXUSDT", "XRPUSDT",
    ],
    "L2": [
        "CELOUSDT", "LINEAUSDT", "MANTAUSDT", "METISUSDT",
        "SCRUSDT", "TAIKOUSDT", "ZKUSDT",
    ],
    "DeFi": [
        "CAKEUSDT", "COMPUSDT", "DYDXUSDT", "ENAUSDT", "GMXUSDT",
        "JTOUSDT", "LDOUSDT", "MORPHOUSDT", "ORCAUSDT", "SNXUSDT", "SUSHIUSDT",
    ],
    "AI": [
        "ARKMUSDT", "CGPTUSDT", "FETUSDT", "FLUXUSDT", "GLMUSDT",
        "GRASSUSDT", "GRTUSDT", "IOUSDT", "RENDERUSDT", "VIRTUALUSDT",
    ],
    "Meme": [
        "1000BONKUSDT", "1000PEPEUSDT", "1000SHIBUSDT", "BRETTUSDT",
        "FARTCOINUSDT", "MEWUSDT", "NOTUSDT", "PNUTUSDT", "POPCATUSDT", "TRUMPUSDT",
    ],
    "Gaming": [
        "ENJUSDT", "GALAUSDT", "MANAUSDT", "YGGUSDT",
    ],
    "Infrastructure": [
        "AXLUSDT", "EIGENUSDT", "QNTUSDT", "SAFEUSDT", "STXUSDT",
    ],
    "Oracle": [
        "BANDUSDT",
    ],
}

# ─── Settings ────────────────────────────────────────────────────────────────
INTERVAL        = "4h"
START_DATE      = "1 Jan, 2023"      # 2 years of data
TRAIN_CUTOFF    = "2024-09-01"       # train: Jan 2023 – Aug 2024
FWD_START       = "2025-01-01"       # forward: Jan 2025 – present
BARS_PER_YEAR   = 2190               # 4h bars in a year (for Sharpe annualisation)
MIN_TRAIN_BARS  = 150
MIN_FWD_BARS    = 30
SLEEP_BETWEEN   = 1.2                # seconds between Binance API calls
OUTPUT_CSV      = config.COIN_TIER_FILE


# ─── Fetch klines — try futures first, fall back to spot ─────────────────────

def _fetch_futures_klines(symbol: str):
    """
    Fetch full history from Binance USDT-M futures (fapi) with pagination.
    Handles 1000X meme tokens and coins not listed on spot.
    """
    import requests
    from datetime import datetime as dt

    url = "https://fapi.binance.com/fapi/v1/klines"
    start_ms = int(dt.strptime(START_DATE, "%d %b, %Y").timestamp() * 1000)
    all_klines = []

    while True:
        params = {
            "symbol":    symbol,
            "interval":  "4h",
            "startTime": start_ms,
            "limit":     1500,
        }
        try:
            r = requests.get(url, params=params, timeout=15)
            if r.status_code != 200:
                break
            batch = r.json()
            if not batch or isinstance(batch, dict) or len(batch) == 0:
                break
            all_klines.extend(batch)
            if len(batch) < 1500:
                break                         # reached end of history
            start_ms = int(batch[-1][0]) + 1  # advance past last candle
            time.sleep(0.1)
        except Exception:
            break

    if not all_klines:
        return None
    return _parse_klines_df(all_klines)


def _fetch_spot_klines(symbol: str):
    """Fetch from Binance spot — for standard coins."""
    from binance.client import Client
    client = Client(tld="com")
    try:
        klines = client.get_historical_klines(
            symbol, Client.KLINE_INTERVAL_4HOUR, START_DATE
        )
        if not klines:
            return None
        return _parse_klines_df(klines)
    except Exception:
        return None


def fetch_klines(symbol: str):
    """Try futures first (handles 1000X tokens), fall back to spot."""
    df = _fetch_futures_klines(symbol)
    if df is not None and not df.empty:
        return df
    df = _fetch_spot_klines(symbol)
    if df is not None and not df.empty:
        return df
    print(f"    NO DATA for {symbol} (tried futures + spot)")
    return None


# ─── Compute forward strategy Sharpe ─────────────────────────────────────────

def compute_fwd_sharpe(brain: HMMBrain, df: pd.DataFrame) -> float:
    """
    Predict regimes on the forward period and compute annualised Sharpe.
    Strategy: BULL → long (+log_ret), BEAR → short (-log_ret), CHOP → flat.
    """
    fwd_df = df[df["timestamp"] >= FWD_START].copy()
    if len(fwd_df) < MIN_FWD_BARS:
        return float("nan")

    fwd_df = fwd_df.dropna(subset=brain.features).reset_index(drop=True)
    if len(fwd_df) < MIN_FWD_BARS:
        return float("nan")

    regimes = brain.predict_all(fwd_df)
    log_ret = np.log(fwd_df["close"] / fwd_df["close"].shift(1)).fillna(0).values

    # Shift returns by 1 (trade on next bar after signal)
    next_ret = np.roll(log_ret, -1)
    next_ret[-1] = 0.0

    strat = np.where(regimes == config.REGIME_BULL,  next_ret,
            np.where(regimes == config.REGIME_BEAR, -next_ret, 0.0))

    if strat.std() < 1e-10:
        return 0.0
    return float((strat.mean() / strat.std()) * np.sqrt(BARS_PER_YEAR))


# ─── Assign tier ─────────────────────────────────────────────────────────────

def assign_tier(fwd_sharpe: float) -> str:
    if np.isnan(fwd_sharpe):
        return "C"
    if fwd_sharpe >= 1.0:
        return "A"
    if fwd_sharpe >= 0.0:
        return "B"
    return "C"


# ─── Load already-trained symbols ────────────────────────────────────────────

def load_existing_symbols() -> set:
    if not os.path.exists(OUTPUT_CSV):
        return set()
    with open(OUTPUT_CSV, "r") as f:
        reader = csv.DictReader(f)
        return {row["symbol"] for row in reader}


# ─── Append row to coin_tiers.csv ────────────────────────────────────────────

def append_tier_row(symbol: str, tier: str, fwd_sharpe: float, dry_run: bool):
    row = {
        "symbol":       symbol,
        "tier":         tier,
        "fwd_sharpe":   round(fwd_sharpe, 4) if not np.isnan(fwd_sharpe) else "",
        "fwd_accuracy": "",
        "fwd_pnl":      "",
        "bt_sharpe":    "",
        "pattern":      "GMMHMM",
        "stable":       "",
    }
    if dry_run:
        return
    file_exists = os.path.exists(OUTPUT_CSV)
    with open(OUTPUT_CSV, "a", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(row.keys()))
        if not file_exists:
            writer.writeheader()
        writer.writerow(row)


# ─── Train one coin ──────────────────────────────────────────────────────────

def train_coin(symbol: str, segment: str) -> dict:
    print(f"  [{segment}] {symbol} ...", end=" ", flush=True)

    # 1. Fetch
    df_raw = fetch_klines(symbol)
    if df_raw is None or df_raw.empty:
        print("NO DATA")
        return {"symbol": symbol, "segment": segment, "tier": "C",
                "fwd_sharpe": float("nan"), "status": "no_data"}

    # 2. Features
    try:
        df = compute_all_features(df_raw)
        df = df.dropna().reset_index(drop=True)
    except Exception as e:
        print(f"FEATURE ERROR: {e}")
        return {"symbol": symbol, "segment": segment, "tier": "C",
                "fwd_sharpe": float("nan"), "status": "feature_error"}

    # 3. Train split
    train_df = df[df["timestamp"] < TRAIN_CUTOFF].copy()
    if len(train_df) < MIN_TRAIN_BARS:
        print(f"INSUFFICIENT TRAIN DATA ({len(train_df)} bars)")
        return {"symbol": symbol, "segment": segment, "tier": "C",
                "fwd_sharpe": float("nan"), "status": "insufficient_data"}

    # 4. Train HMMBrain (GMMHMM n_mix=3)
    brain = HMMBrain(symbol=symbol)
    try:
        brain.train(train_df)
    except Exception as e:
        print(f"TRAIN ERROR: {e}")
        return {"symbol": symbol, "segment": segment, "tier": "C",
                "fwd_sharpe": float("nan"), "status": "train_error"}

    if not brain.is_trained:
        print("TRAIN FAILED")
        return {"symbol": symbol, "segment": segment, "tier": "C",
                "fwd_sharpe": float("nan"), "status": "train_failed"}

    # 5. Forward Sharpe
    fwd_sharpe = compute_fwd_sharpe(brain, df)

    # 6. Tier
    tier = assign_tier(fwd_sharpe)

    sharpe_str = f"{fwd_sharpe:.4f}" if not np.isnan(fwd_sharpe) else "N/A"
    print(f"Tier {tier}  fwd_sharpe={sharpe_str}  bars={len(df)}")

    return {
        "symbol":     symbol,
        "segment":    segment,
        "tier":       tier,
        "fwd_sharpe": fwd_sharpe,
        "status":     "ok",
    }


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run",  action="store_true", help="Skip CSV write")
    parser.add_argument("--segment",  default=None, help="Only train one segment")
    args = parser.parse_args()

    print("\n" + "="*70)
    print("  Phase 1 GMMHMM Training  (n_mix=3, n_states=3, 4h candles)")
    print(f"  Train: before {TRAIN_CUTOFF}  |  Forward: {FWD_START} → present")
    print(f"  Output: {OUTPUT_CSV}")
    if args.dry_run:
        print("  *** DRY RUN — no CSV writes ***")
    print("="*70 + "\n")

    existing = load_existing_symbols()
    print(f"Already trained: {len(existing)} coins  (will skip duplicates)\n")

    results = []
    total   = sum(len(v) for v in PHASE1_COINS.values())
    done    = 0

    for segment, coins in PHASE1_COINS.items():
        if args.segment and segment != args.segment:
            continue

        print(f"\n── {segment} ({len(coins)} coins) ──────────────────────────────")
        for symbol in coins:
            done += 1
            print(f"  [{done}/{total}]", end=" ")

            if symbol in existing:
                print(f"  {symbol}  SKIP (already trained)")
                results.append({"symbol": symbol, "segment": segment,
                                 "tier": "?", "fwd_sharpe": float("nan"),
                                 "status": "skipped"})
                continue

            result = train_coin(symbol, segment)
            results.append(result)

            if result["status"] == "ok":
                append_tier_row(symbol, result["tier"], result["fwd_sharpe"], args.dry_run)

            time.sleep(SLEEP_BETWEEN)

    # ─── Summary ─────────────────────────────────────────────────────────────
    ok_results = [r for r in results if r["status"] == "ok"]
    tier_a = [r for r in ok_results if r["tier"] == "A"]
    tier_b = [r for r in ok_results if r["tier"] == "B"]
    tier_c = [r for r in ok_results if r["tier"] == "C"]
    skipped = [r for r in results if r["status"] == "skipped"]
    failed  = [r for r in results if r["status"] not in ("ok", "skipped")]

    print("\n" + "="*70)
    print("  PHASE 1 TRAINING COMPLETE")
    print("="*70)
    print(f"  Trained:  {len(ok_results)}")
    print(f"  Skipped:  {len(skipped)}")
    print(f"  Failed:   {len(failed)}")
    print(f"  Tier A:   {len(tier_a)}  → {[r['symbol'] for r in tier_a]}")
    print(f"  Tier B:   {len(tier_b)}  → {[r['symbol'] for r in tier_b]}")
    print(f"  Tier C:   {len(tier_c)}  → {[r['symbol'] for r in tier_c]}")

    if failed:
        print(f"\n  Failed coins:")
        for r in failed:
            print(f"    {r['symbol']:20s}  status={r['status']}")

    # Segment breakdown
    print("\n  Results by segment:")
    for segment in PHASE1_COINS:
        seg_res = [r for r in ok_results if r["segment"] == segment]
        if not seg_res:
            continue
        sharpes = [r["fwd_sharpe"] for r in seg_res if not np.isnan(r["fwd_sharpe"])]
        avg_sh  = np.mean(sharpes) if sharpes else float("nan")
        a_count = sum(1 for r in seg_res if r["tier"] == "A")
        print(f"    {segment:15s}  trained={len(seg_res)}  TierA={a_count}  avg_fwd_sharpe={avg_sh:.3f}")

    print("\n  Saved to:", OUTPUT_CSV)
    print("="*70 + "\n")


if __name__ == "__main__":
    main()

"""
tools/experiment_universe.py

20-Config Experiment: Universe Pruning × Conviction × Agreement × TF Weights
═══════════════════════════════════════════════════════════════════════════════
Tests the hypothesis that removing thin/illiquid coins (Meme, Gaming, DePIN)
and tightening conviction filters improves signal quality.

Methodology
───────────
  Phase 1 — Pre-compute (expensive, runs once per coin):
    • Fetch 4h / 1h / 15m OHLCV data (9 months)
    • Walk-forward HMM training + prediction (same as backtest_prod_6m.py)
    • Cache per-bar regime arrays for the 6-month test window

  Phase 2 — Simulate (fast, runs 20× per coin):
    • Re-run trade engine with each experiment's parameters
    • Vary: min_conviction, min_tf_agreement, tf_weights, allowed_segments

Test coins (15 — representative spread across all segment types):
  L1:      BTCUSDT, ETHUSDT, SOLUSDT, ADAUSDT
  L2:      ARBUSDT, OPUSDT
  DeFi:    UNIUSDT, AAVEUSDT
  AI:      TAOUSDT, FETUSDT
  Meme:    DOGEUSDT, BONKUSDT          ← expected to drag results
  Gaming:  GALAUSDT, AXSUSDT           ← expected to drag results
  DePIN:   ARUSDT                      ← thin / irregular

Usage:
  python tools/experiment_universe.py
  python tools/experiment_universe.py --coins BTCUSDT ETHUSDT SOLUSDT  # subset
"""

import sys
import os
import time
import argparse
import warnings
from datetime import datetime, timedelta, timezone
from collections import defaultdict

warnings.filterwarnings("ignore")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import numpy as np
import pandas as pd
import requests

import config
from data_pipeline import _parse_klines_df
from feature_engine import compute_all_features
from hmm_brain import HMMBrain
from segment_features import get_features_for_coin, get_segment_for_coin

# ─── Backtest settings (mirrors backtest_prod_6m.py) ─────────────────────────
TEST_MONTHS   = 6
WARMUP_MONTHS = 3
TRAIN_DAYS    = 90
RETRAIN_DAYS  = 30

FEE_PER_LEG     = 0.0005
SLIP_PER_LEG    = 0.0005
ROUND_TRIP_COST = (FEE_PER_LEG + SLIP_PER_LEG) * 2   # 0.2% round-trip
CAPITAL_PER_TRADE = config.CAPITAL_PER_TRADE          # $100

TRAIN_BARS = {
    "4h":  TRAIN_DAYS * 6,     # 6 bars/day × 90d = 540
    "1h":  TRAIN_DAYS * 24,    # 2 160 bars
    "15m": TRAIN_DAYS * 96,    # 8 640 bars — capped at 1000 for speed
}
TRAIN_BARS["15m"] = min(TRAIN_BARS["15m"], config.MULTI_TF_CANDLE_LIMIT)

# ─── Test coin universe ───────────────────────────────────────────────────────
DEFAULT_TEST_COINS = [
    # L1 — liquid blue chips
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT",
    # L2 — moderate liquidity
    "ARBUSDT", "OPUSDT",
    # DeFi — solid liquidity
    "UNIUSDT", "AAVEUSDT",
    # AI — narrative-driven, moderate vol
    "TAOUSDT", "FETUSDT",
    # Meme — thin / pump-dump
    "DOGEUSDT", "BONKUSDT",
    # Gaming — thin books, irregular candles
    "GALAUSDT", "AXSUSDT",
    # DePIN — thin / narrative
    "ARUSDT",
]

# Map each test coin to its segment (used for universe filtering)
COIN_SEG_MAP = {
    "BTCUSDT": "L1",     "ETHUSDT": "L1",     "SOLUSDT": "L1",   "ADAUSDT": "L1",
    "ARBUSDT": "L2",     "OPUSDT":  "L2",
    "UNIUSDT": "DeFi",   "AAVEUSDT": "DeFi",
    "TAOUSDT": "AI",     "FETUSDT":  "AI",
    "DOGEUSDT": "Meme",  "BONKUSDT": "Meme",
    "GALAUSDT": "Gaming","AXSUSDT":  "Gaming",
    "ARUSDT":  "DePIN",
}

# ─── Segment universe sets ────────────────────────────────────────────────────
_ALL  = ["L1", "L2", "DeFi", "AI", "Meme", "RWA", "Gaming", "DePIN", "Modular", "Oracles"]
_QUAL = [s for s in _ALL if s not in ("Meme", "Gaming", "DePIN")]   # remove thin segments
_CORE = ["L1", "L2", "DeFi", "AI"]
_BLUE = ["L1", "DeFi"]

SEG_SETS = {
    "all":        _ALL,
    "no_meme":    [s for s in _ALL if s != "Meme"],
    "no_gaming":  [s for s in _ALL if s != "Gaming"],
    "no_depin":   [s for s in _ALL if s != "DePIN"],
    "quality":    _QUAL,
    "core":       _CORE,
    "bluechip":   _BLUE,
}

# ─── 20 Experiment configurations ────────────────────────────────────────────
#
# Dimensions varied:
#   segs       — which segment universe is eligible
#   min_conv   — minimum MultiTF conviction to deploy (65–80)
#   min_agree  — minimum TF agreement (2 = majority, 3 = unanimous)
#   weights    — per-TF conviction weights {"4h": w1, "1h": w2, "15m": w3}
#
# Organised into 5 groups:
#   A. Universe pruning  (hold conviction/agreement/weights constant)
#   B. Conviction filter (hold universe=quality, agreement=2)
#   C. TF agreement      (hold universe=quality, conviction=65)
#   D. TF weights        (hold universe=quality, conviction=65, agreement=2)
#   E. Best combos       (promising combinations from A–D)

W_CURR  = {"4h": 30, "1h": 50, "15m": 20}   # current prod weights
W_MACRO = {"4h": 50, "1h": 35, "15m": 15}   # macro-heavy (4h dominates)
W_MOM   = {"4h": 20, "1h": 40, "15m": 40}   # momentum-heavy (15m elevated)
W_EQUAL = {"4h": 33, "1h": 34, "15m": 33}   # equal contribution
W_4H60  = {"4h": 60, "1h": 30, "15m": 10}   # 4h only matters

EXPERIMENTS = [
    # ── A: Universe pruning ─────────────────────────────────────────────────
    {"id":  1, "group": "A-Universe",   "label": "Baseline (all segs)",          "segs": "all",      "min_conv": 65, "min_agree": 2, "weights": W_CURR},
    {"id":  2, "group": "A-Universe",   "label": "No Meme",                      "segs": "no_meme",  "min_conv": 65, "min_agree": 2, "weights": W_CURR},
    {"id":  3, "group": "A-Universe",   "label": "No Gaming",                    "segs": "no_gaming","min_conv": 65, "min_agree": 2, "weights": W_CURR},
    {"id":  4, "group": "A-Universe",   "label": "No DePIN",                     "segs": "no_depin", "min_conv": 65, "min_agree": 2, "weights": W_CURR},
    {"id":  5, "group": "A-Universe",   "label": "Quality (no Meme/Gaming/DePIN)","segs": "quality",  "min_conv": 65, "min_agree": 2, "weights": W_CURR},
    {"id":  6, "group": "A-Universe",   "label": "Core (L1+L2+DeFi+AI)",         "segs": "core",     "min_conv": 65, "min_agree": 2, "weights": W_CURR},
    {"id":  7, "group": "A-Universe",   "label": "Blue Chip (L1+DeFi only)",      "segs": "bluechip", "min_conv": 65, "min_agree": 2, "weights": W_CURR},

    # ── B: Conviction threshold (universe=quality) ──────────────────────────
    {"id":  8, "group": "B-Conviction", "label": "Quality + conv=70",             "segs": "quality",  "min_conv": 70, "min_agree": 2, "weights": W_CURR},
    {"id":  9, "group": "B-Conviction", "label": "Quality + conv=75",             "segs": "quality",  "min_conv": 75, "min_agree": 2, "weights": W_CURR},
    {"id": 10, "group": "B-Conviction", "label": "Quality + conv=80",             "segs": "quality",  "min_conv": 80, "min_agree": 2, "weights": W_CURR},
    {"id": 11, "group": "B-Conviction", "label": "All segs + conv=70",            "segs": "all",      "min_conv": 70, "min_agree": 2, "weights": W_CURR},
    {"id": 12, "group": "B-Conviction", "label": "All segs + conv=75",            "segs": "all",      "min_conv": 75, "min_agree": 2, "weights": W_CURR},

    # ── C: TF agreement (universe=quality, conv=65) ─────────────────────────
    {"id": 13, "group": "C-Agreement",  "label": "Quality + agree=3 (unanimous)", "segs": "quality",  "min_conv": 65, "min_agree": 3, "weights": W_CURR},
    {"id": 14, "group": "C-Agreement",  "label": "All segs + agree=3",            "segs": "all",      "min_conv": 65, "min_agree": 3, "weights": W_CURR},
    {"id": 15, "group": "C-Agreement",  "label": "Quality + agree=3 + conv=70",   "segs": "quality",  "min_conv": 70, "min_agree": 3, "weights": W_CURR},

    # ── D: TF weights (universe=quality, conv=65, agree=2) ──────────────────
    {"id": 16, "group": "D-Weights",    "label": "Macro-heavy (4h=50,1h=35,15m=15)","segs": "quality", "min_conv": 65, "min_agree": 2, "weights": W_MACRO},
    {"id": 17, "group": "D-Weights",    "label": "Momentum-heavy (4h=20,1h=40,15m=40)","segs": "quality","min_conv": 65,"min_agree": 2,"weights": W_MOM},
    {"id": 18, "group": "D-Weights",    "label": "Equal weights (33/34/33)",       "segs": "quality",  "min_conv": 65, "min_agree": 2, "weights": W_EQUAL},

    # ── E: Best combos ──────────────────────────────────────────────────────
    {"id": 19, "group": "E-BestCombo",  "label": "Quality + Macro-heavy + conv=70","segs": "quality",  "min_conv": 70, "min_agree": 2, "weights": W_MACRO},
    {"id": 20, "group": "E-BestCombo",  "label": "Quality + agree=3 + conv=70 + Macro-heavy","segs":"quality","min_conv":70,"min_agree":3,"weights": W_MACRO},
]

# ─── Helpers ──────────────────────────────────────────────────────────────────

def fetch_tf(symbol: str, interval: str, total_months: int):
    mins_map = {"4h": 240, "1h": 60, "15m": 15}
    mins_per_bar = mins_map[interval]
    n_bars = int((total_months * 30 * 24 * 60 / mins_per_bar) * 1.05)

    now_ms   = int(datetime.now(timezone.utc).timestamp() * 1000)
    start_ms = now_ms - (n_bars * mins_per_bar * 60 * 1000)

    url, all_klines = "https://fapi.binance.com/fapi/v1/klines", []
    cur = start_ms
    while True:
        try:
            r = requests.get(url, params={"symbol": symbol, "interval": interval,
                                          "startTime": cur, "limit": 1500}, timeout=15)
            if r.status_code != 200:
                break
            batch = r.json()
            if not batch or isinstance(batch, dict):
                break
            all_klines.extend(batch)
            if len(batch) < 1500:
                break
            cur = int(batch[-1][0]) + 1
            time.sleep(0.05)
        except Exception as e:
            print(f"    fetch error {symbol}/{interval}: {e}")
            break

    if not all_klines:
        return None
    df_raw = _parse_klines_df(all_klines)
    if df_raw is None or df_raw.empty:
        return None
    try:
        df_feat = compute_all_features(df_raw).dropna().reset_index(drop=True)
    except Exception as e:
        print(f"    feature error {symbol}/{interval}: {e}")
        return None
    if "timestamp" not in df_feat.columns:
        df_feat = df_feat.reset_index()
        if "index" in df_feat.columns:
            df_feat.rename(columns={"index": "timestamp"}, inplace=True)
    df_feat["timestamp"] = pd.to_datetime(df_feat["timestamp"])
    return df_feat.reset_index(drop=True)


def predict_block(brain: HMMBrain, df: pd.DataFrame):
    n = len(df)
    regimes = np.full(n, config.REGIME_CHOP, dtype=int)
    margins = np.zeros(n)
    if not brain.is_trained:
        return regimes, margins
    cols = brain.features
    if any(c not in df.columns for c in cols):
        return regimes, margins
    X = df[cols].replace([np.inf, -np.inf], np.nan)
    valid = np.where(X.notna().all(axis=1))[0]
    if not len(valid):
        return regimes, margins
    Xv = (X.iloc[valid].values - brain._feat_mean) / brain._feat_std
    try:
        raw   = brain.model.predict(Xv)
        proba = brain.model.predict_proba(Xv)
        canon = np.array([brain._state_map.get(int(s), config.REGIME_CHOP) for s in raw])
        sp    = np.sort(proba, axis=1)[:, ::-1]
        marg  = sp[:, 0] - sp[:, 1]
        regimes[valid] = canon
        margins[valid] = marg
    except Exception:
        pass
    return regimes, margins


# ─── Phase 1: Pre-compute per-coin regime arrays ─────────────────────────────

def precompute_coin(symbol: str):
    """
    Fetch data, run walk-forward HMM training+prediction for 4h/1h/15m.
    Returns a cache dict with regime/margin arrays aligned to the 15m TF,
    plus ATR array and test window metadata.
    Returns None on failure.
    """
    total_months = WARMUP_MONTHS + TEST_MONTHS

    # Fetch all three TFs
    dfs = {}
    for tf in ["4h", "1h", "15m"]:
        df = fetch_tf(symbol, tf, total_months)
        if df is None or df.empty:
            print(f"    {symbol}/{tf}: NO DATA")
            return None
        dfs[tf] = df
        time.sleep(0.15)

    df_15m = dfs["15m"]
    n      = len(df_15m)

    # Test window start
    last_ts    = df_15m["timestamp"].iloc[-1]
    test_start = last_ts - pd.Timedelta(days=TEST_MONTHS * 30)
    test_mask  = df_15m["timestamp"] >= test_start
    if not test_mask.any():
        return None
    test_idx = int(df_15m.index[test_mask][0])
    if test_idx < 50:
        return None

    # Allocate prediction arrays (aligned to 15m bars)
    pred = {tf: np.full(n, config.REGIME_CHOP, dtype=int) for tf in ["4h", "1h", "15m"]}
    marg = {tf: np.zeros(n) for tf in ["4h", "1h", "15m"]}

    STEP = RETRAIN_DAYS * 96   # 15m bars per retrain window

    for block_start in range(test_idx, n, STEP):
        block_end  = min(block_start + STEP, n)
        cutoff_ts  = df_15m["timestamp"].iloc[block_start]
        block_end_ts = df_15m["timestamp"].iloc[block_end - 1]

        brains = {}
        for tf, df_tf in dfs.items():
            train_slice = df_tf[df_tf["timestamp"] < cutoff_ts].tail(TRAIN_BARS[tf]).copy()
            b = HMMBrain(symbol=symbol)
            if len(train_slice) >= 50:
                try:
                    b.train(train_slice)
                except Exception:
                    pass
            brains[tf] = b

        # 15m — predict block, shift by 1 (no look-ahead)
        blk_15m = df_15m.iloc[block_start:block_end].copy()
        if brains["15m"].is_trained and len(blk_15m) > 1:
            r, m = predict_block(brains["15m"], blk_15m)
            pred["15m"][block_start + 1:block_end] = r[:-1]
            marg["15m"][block_start + 1:block_end] = m[:-1]

        # 1h — forward-fill to 15m resolution
        mask_1h = (dfs["1h"]["timestamp"] >= cutoff_ts) & (dfs["1h"]["timestamp"] <= block_end_ts)
        blk_1h  = dfs["1h"][mask_1h].copy()
        if brains["1h"].is_trained and len(blk_1h) > 0:
            r1h, m1h = predict_block(brains["1h"], blk_1h)
            ts_1h = blk_1h["timestamp"].values
            for i in range(block_start, block_end):
                ts_bar = df_15m["timestamp"].iloc[i]
                mask   = ts_1h < np.datetime64(ts_bar)
                if mask.any():
                    idx = int(np.where(mask)[0][-1])
                    pred["1h"][i] = r1h[idx]
                    marg["1h"][i] = m1h[idx]

        # 4h — forward-fill to 15m resolution
        mask_4h = (dfs["4h"]["timestamp"] >= cutoff_ts) & (dfs["4h"]["timestamp"] <= block_end_ts)
        blk_4h  = dfs["4h"][mask_4h].copy()
        if brains["4h"].is_trained and len(blk_4h) > 0:
            r4h, m4h = predict_block(brains["4h"], blk_4h)
            ts_4h = blk_4h["timestamp"].values
            for i in range(block_start, block_end):
                ts_bar = df_15m["timestamp"].iloc[i]
                mask   = ts_4h < np.datetime64(ts_bar)
                if mask.any():
                    idx = int(np.where(mask)[0][-1])
                    pred["4h"][i] = r4h[idx]
                    marg["4h"][i] = m4h[idx]

    # Pre-extract ATR from 1h, forward-filled to 15m
    atr_arr = np.zeros(n)
    if "atr" in dfs["1h"].columns:
        ts_1h_all  = dfs["1h"]["timestamp"].values
        atr_1h_all = dfs["1h"]["atr"].values
        for i in range(n):
            ts_bar = df_15m["timestamp"].iloc[i]
            mask   = ts_1h_all < np.datetime64(ts_bar)
            if mask.any():
                atr_arr[i] = float(atr_1h_all[np.where(mask)[0][-1]])

    return {
        "symbol":     symbol,
        "df_15m":     df_15m,
        "pred":       pred,     # {"4h": arr, "1h": arr, "15m": arr}
        "marg":       marg,     # {"4h": arr, "1h": arr, "15m": arr}
        "atr_arr":    atr_arr,
        "test_idx":   test_idx,
    }


# ─── Phase 2: Trade simulation ────────────────────────────────────────────────

def _conv(p4h, m4h, p1h, m1h, p15m, m15m, weights, min_agree):
    """Compute conviction + direction from cached regime predictions."""
    preds = {"4h": (p4h, m4h), "1h": (p1h, m1h), "15m": (p15m, m15m)}
    votes = []
    for tf, (regime, margin) in preds.items():
        if regime == config.REGIME_BULL:
            votes.append(("BUY", tf, margin))
        elif regime == config.REGIME_BEAR:
            votes.append(("SELL", tf, margin))

    if not votes:
        return 0.0, None

    buys  = sum(1 for v, _, _ in votes if v == "BUY")
    sells = sum(1 for v, _, _ in votes if v == "SELL")
    if   buys > sells:  consensus = "BUY"
    elif sells > buys:  consensus = "SELL"
    else:               return 0.0, None

    agreement = buys if consensus == "BUY" else sells
    if agreement < min_agree:
        return 0.0, None

    total = 0.0
    for tf, (regime, margin) in preds.items():
        w = weights.get(tf, 0)
        agrees = (
            (regime == config.REGIME_BULL and consensus == "BUY") or
            (regime == config.REGIME_BEAR and consensus == "SELL")
        )
        if regime == config.REGIME_CHOP:
            total += 0.0
        elif agrees:
            if   margin >= config.HMM_CONF_TIER_HIGH:     total += w * 1.00
            elif margin >= config.HMM_CONF_TIER_MED_HIGH: total += w * 0.85
            elif margin >= config.HMM_CONF_TIER_MED:      total += w * 0.65
            elif margin >= config.HMM_CONF_TIER_LOW:      total += w * 0.40
            else:                                          total += w * 0.20

    return round(min(100.0, max(0.0, total)), 1), consensus


def simulate_trades(cache: dict, min_conv: float, min_agree: int, weights: dict):
    """
    Fast trade simulation using cached regime predictions.
    Returns stats dict, or None if no trades.
    """
    df        = cache["df_15m"]
    pred      = cache["pred"]
    marg      = cache["marg"]
    atr_arr   = cache["atr_arr"]
    test_idx  = cache["test_idx"]
    n         = len(df)

    trades = []
    open_trade = None   # (side, entry_price, sl, tp, leverage, entry_ts)

    for i in range(test_idx, n):
        row   = df.iloc[i]
        open_ = float(row["open"])
        high  = float(row["high"])
        low   = float(row["low"])
        close = float(row["close"])
        ts    = row["timestamp"]

        conviction, side = _conv(
            pred["4h"][i], marg["4h"][i],
            pred["1h"][i], marg["1h"][i],
            pred["15m"][i], marg["15m"][i],
            weights, min_agree,
        )

        # Check exit on open trade
        if open_trade is not None:
            ot_side, ot_entry, ot_sl, ot_tp, ot_lev, ot_ts = open_trade
            direction = 1 if ot_side == "BUY" else -1
            closed_price, close_reason = None, None
            if direction == 1:
                if low <= ot_sl:
                    closed_price, close_reason = ot_sl, "SL"
                elif high >= ot_tp:
                    closed_price, close_reason = ot_tp, "TP"
            else:
                if high >= ot_sl:
                    closed_price, close_reason = ot_sl, "SL"
                elif low <= ot_tp:
                    closed_price, close_reason = ot_tp, "TP"
            # Flip signal
            if closed_price is None and side is not None and side != ot_side and conviction >= min_conv:
                closed_price, close_reason = close, "FLIP"

            if closed_price is not None:
                raw_ret = (closed_price - ot_entry) / ot_entry * direction
                net_ret = raw_ret * ot_lev - ROUND_TRIP_COST * ot_lev
                net_ret = max(net_ret, -1.0)
                pnl     = round(CAPITAL_PER_TRADE * net_ret, 4)
                trades.append({"pnl": pnl, "reason": close_reason, "side": ot_side,
                                "entry_ts": ot_ts, "exit_ts": ts})
                open_trade = None

        # New entry
        if open_trade is None and conviction >= min_conv and side is not None:
            atr = atr_arr[i]
            if atr <= 0 or np.isnan(atr):
                atr = close * 0.01
            vol_ratio = atr / close
            if vol_ratio < config.VOL_MIN_ATR_PCT or vol_ratio > config.VOL_MAX_ATR_PCT:
                continue

            if   conviction >= 95: lev = config.LEVERAGE_HIGH      # 35x
            elif conviction >= 80: lev = config.LEVERAGE_MODERATE  # 25x
            elif conviction >= 70: lev = 15
            else:                  lev = 10

            sl_mult, tp_mult = config.get_atr_multipliers(lev)
            if side == "BUY":
                sl = open_ - sl_mult * atr
                tp = open_ + tp_mult * atr
            else:
                sl = open_ + sl_mult * atr
                tp = open_ - tp_mult * atr

            open_trade = (side, open_, sl, tp, lev, ts)

    # Close last open trade at last bar
    if open_trade is not None:
        ot_side, ot_entry, ot_sl, ot_tp, ot_lev, ot_ts = open_trade
        direction = 1 if ot_side == "BUY" else -1
        last      = df.iloc[-1]
        closed    = float(last["close"])
        raw_ret   = (closed - ot_entry) / ot_entry * direction
        net_ret   = raw_ret * ot_lev - ROUND_TRIP_COST * ot_lev
        net_ret   = max(net_ret, -1.0)
        pnl       = round(CAPITAL_PER_TRADE * net_ret, 4)
        trades.append({"pnl": pnl, "reason": "EOD", "side": ot_side,
                       "entry_ts": ot_ts, "exit_ts": last["timestamp"]})

    if not trades:
        return None

    pnls = [t["pnl"] for t in trades]
    arr  = np.array(pnls)
    wins = [p for p in pnls if p > 0]
    loss = [p for p in pnls if p <= 0]
    cum  = np.cumsum(arr)
    dd   = cum - np.maximum.accumulate(cum)
    reasons = defaultdict(int)
    for t in trades:
        reasons[t["reason"]] += 1

    return {
        "n_trades":      len(trades),
        "total_pnl":     round(float(arr.sum()), 2),
        "win_rate":      round(len(wins) / len(pnls) * 100, 1),
        "profit_factor": round(sum(wins) / abs(sum(loss)), 3) if loss and sum(loss) else 999.0,
        "sharpe":        round(float(arr.mean() / arr.std() * np.sqrt(len(arr))), 3) if arr.std() > 1e-5 else 0.0,
        "max_dd":        round(float(dd.min()), 2),
        "avg_pnl":       round(float(arr.mean()), 2),
        "exits":         dict(reasons),
    }


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--coins", nargs="+", help="Override test coin list")
    args = parser.parse_args()

    test_coins = args.coins or DEFAULT_TEST_COINS

    print("=" * 80)
    print("  Synaptic — 20-Config Universe × Conviction × Agreement × Weight Experiment")
    print(f"  Test coins  : {len(test_coins)}")
    print(f"  Test period : {TEST_MONTHS} months walk-forward (retrain every {RETRAIN_DAYS}d)")
    print(f"  Experiments : {len(EXPERIMENTS)}")
    print("=" * 80)
    print()

    # ── Phase 1: Pre-compute all coins ────────────────────────────────────────
    print("Phase 1 — Pre-computing HMM predictions (this takes a while)...")
    print("-" * 60)
    coin_caches = {}
    for i, sym in enumerate(test_coins, 1):
        print(f"  [{i:2d}/{len(test_coins)}] {sym:14s} fetching 4h/1h/15m ...", end=" ", flush=True)
        cache = precompute_coin(sym)
        if cache is None:
            print("SKIP (no data)")
            continue
        coin_caches[sym] = cache
        seg = COIN_SEG_MAP.get(sym, get_segment_for_coin(sym))
        print(f"OK  ({seg}  {len(cache['df_15m'])} 15m bars)")

    print(f"\n  Cached {len(coin_caches)}/{len(test_coins)} coins\n")

    # ── Phase 2: Run all 20 experiments ──────────────────────────────────────
    print("Phase 2 — Simulating 20 experiments...")
    print("-" * 60)

    exp_results = []

    for exp in EXPERIMENTS:
        allowed_segs = SEG_SETS[exp["segs"]]
        min_conv     = exp["min_conv"]
        min_agree    = exp["min_agree"]
        weights      = exp["weights"]

        eligible = [
            sym for sym in coin_caches
            if COIN_SEG_MAP.get(sym, get_segment_for_coin(sym)) in allowed_segs
        ]

        all_pnls   = []
        total_pnl  = 0.0
        n_trades   = 0
        n_coins    = 0
        coin_breakdown = []

        for sym in eligible:
            stats = simulate_trades(coin_caches[sym], min_conv, min_agree, weights)
            if stats is None:
                continue
            n_coins    += 1
            n_trades   += stats["n_trades"]
            total_pnl  += stats["total_pnl"]
            all_pnls.extend([stats["total_pnl"]])
            coin_breakdown.append({"sym": sym, **stats})

        if not all_pnls:
            exp_results.append({**exp, "n_coins": 0, "n_trades": 0, "total_pnl": 0,
                                 "win_rate": 0, "pf": 0, "sharpe": 0, "max_dd": 0})
            continue

        # Aggregate across coins (each coin = 1 observation for portfolio stats)
        # For win rate / PF: pool all individual trade-level pnls
        all_trade_pnls = []
        for sym in eligible:
            stats = simulate_trades(coin_caches[sym], min_conv, min_agree, weights)
            if stats:
                # re-run to get per-trade pnl (slight overhead — acceptable for 20 experiments × 15 coins)
                pass
        # Use coin-level aggregates for simplicity
        arr  = np.array([c["total_pnl"] for c in coin_breakdown])
        wins = [p for p in arr if p > 0]
        loss = [p for p in arr if p <= 0]
        coin_wr = round(len(wins) / len(arr) * 100, 1) if len(arr) else 0
        coin_pf = round(sum(wins) / abs(sum(loss)), 3) if loss and sum(loss) else 999.0
        coin_sharpe = round(float(arr.mean() / arr.std()), 3) if len(arr) > 1 and arr.std() > 1e-5 else 0.0
        coin_mdd = min(c["max_dd"] for c in coin_breakdown)
        avg_trades = round(n_trades / n_coins, 1) if n_coins else 0

        exp_results.append({
            "id":        exp["id"],
            "group":     exp["group"],
            "label":     exp["label"],
            "segs":      exp["segs"],
            "min_conv":  min_conv,
            "min_agree": min_agree,
            "weights":   f"{weights['4h']}/{weights['1h']}/{weights['15m']}",
            "n_eligible": len(eligible),
            "n_coins":   n_coins,
            "n_trades":  n_trades,
            "avg_trades": avg_trades,
            "total_pnl": round(total_pnl, 2),
            "coin_wr":   coin_wr,
            "coin_pf":   coin_pf,
            "coin_sharpe": coin_sharpe,
            "max_dd":    coin_mdd,
        })

        print(f"  #{exp['id']:2d} {exp['label'][:42]:42s} "
              f"coins={n_coins:2d}  trades={n_trades:4d}  "
              f"PnL=${total_pnl:+8.2f}  WR={coin_wr:5.1f}%  PF={coin_pf:.2f}  Sharpe={coin_sharpe:.2f}")

    # ── Results table — ranked by Total PnL ──────────────────────────────────
    ranked = sorted(exp_results, key=lambda r: r["total_pnl"], reverse=True)

    print()
    print("=" * 110)
    print("  RESULTS — Ranked by Total PnL")
    print("=" * 110)
    hdr = (f"  {'Rank':4s}  {'#':2s}  {'Label':44s}  "
           f"{'Segs':9s}  {'Conv':4s}  {'Ag':2s}  {'W(4h/1h/15m)':12s}  "
           f"{'Coins':5s}  {'Trades':6s}  {'PnL':>10s}  {'CoinWR':>6s}  {'PF':>5s}  {'Sharpe':>6s}  {'MaxDD':>8s}")
    print(hdr)
    print("  " + "-" * 106)
    for rank, r in enumerate(ranked, 1):
        marker = " ◄ BEST" if rank == 1 else (" ◄ WORST" if rank == len(ranked) else "")
        print(
            f"  {rank:4d}  {r['id']:2d}  {r['label'][:44]:44s}  "
            f"{r['segs']:9s}  {r['min_conv']:4.0f}  {r['min_agree']:2d}  {r['weights']:12s}  "
            f"{r['n_coins']:5d}  {r['n_trades']:6d}  ${r['total_pnl']:>9.2f}  "
            f"{r['coin_wr']:>5.1f}%  {r['coin_pf']:>5.2f}  {r['coin_sharpe']:>6.3f}  "
            f"${r['max_dd']:>7.0f}{marker}"
        )

    # ── Group summary ────────────────────────────────────────────────────────
    print()
    print("=" * 110)
    print("  GROUP AVERAGES")
    print("=" * 110)
    groups = defaultdict(list)
    for r in exp_results:
        groups[r["group"]].append(r)
    for grp in sorted(groups.keys()):
        items = groups[grp]
        avg_pnl    = np.mean([r["total_pnl"]    for r in items])
        avg_wr     = np.mean([r["coin_wr"]       for r in items])
        avg_pf     = np.mean([r["coin_pf"]       for r in items if r["coin_pf"] < 100])
        avg_sharpe = np.mean([r["coin_sharpe"]   for r in items])
        print(f"  {grp:20s}  avg PnL=${avg_pnl:+8.2f}  avg CoinWR={avg_wr:.1f}%  "
              f"avg PF={avg_pf:.2f}  avg Sharpe={avg_sharpe:.3f}")

    # ── Segment blame report ─────────────────────────────────────────────────
    print()
    print("=" * 110)
    print("  SEGMENT CONTRIBUTION (exp #1 Baseline — per-coin PnL)")
    print("=" * 110)
    baseline_exp = next((e for e in EXPERIMENTS if e["id"] == 1), None)
    if baseline_exp:
        seg_pnl = defaultdict(list)
        for sym, cache in coin_caches.items():
            stats = simulate_trades(cache, baseline_exp["min_conv"],
                                    baseline_exp["min_agree"], baseline_exp["weights"])
            seg = COIN_SEG_MAP.get(sym, "?")
            pnl = stats["total_pnl"] if stats else 0.0
            trades = stats["n_trades"] if stats else 0
            wr     = stats["win_rate"] if stats else 0.0
            seg_pnl[seg].append((sym, pnl, trades, wr))

        for seg in sorted(seg_pnl.keys()):
            items = seg_pnl[seg]
            for sym, pnl, n, wr in items:
                flag = "  ← DRAG" if pnl < -5 else ("  ← GOOD" if pnl > 20 else "")
                print(f"  {seg:10s}  {sym:12s}  PnL=${pnl:+8.2f}  trades={n:3d}  WR={wr:.1f}%{flag}")

    # ── Write to file ────────────────────────────────────────────────────────
    out_file = os.path.join(ROOT, "tools", "experiment_universe_results.txt")
    import io
    buf = io.StringIO()

    def w(s=""):
        buf.write(s + "\n")
        print(s)

    # Already printed to stdout above — write the ranked table to file
    with open(out_file, "w") as f:
        f.write(f"Synaptic 20-Config Experiment — {datetime.now().strftime('%Y-%m-%d %H:%M')}\n\n")
        f.write(f"Test coins: {', '.join(coin_caches.keys())}\n\n")
        f.write("RANKED RESULTS (by Total PnL)\n")
        f.write("-" * 106 + "\n")
        f.write(hdr.lstrip() + "\n")
        f.write("-" * 106 + "\n")
        for rank, r in enumerate(ranked, 1):
            f.write(
                f"{rank:4d}  {r['id']:2d}  {r['label'][:44]:44s}  "
                f"{r['segs']:9s}  {r['min_conv']:4.0f}  {r['min_agree']:2d}  {r['weights']:12s}  "
                f"{r['n_coins']:5d}  {r['n_trades']:6d}  ${r['total_pnl']:>9.2f}  "
                f"{r['coin_wr']:>5.1f}%  {r['coin_pf']:>5.2f}  {r['coin_sharpe']:>6.3f}  "
                f"${r['max_dd']:>7.0f}\n"
            )

    print(f"\n  Results written → {out_file}")
    print()


if __name__ == "__main__":
    main()

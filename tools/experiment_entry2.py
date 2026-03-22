"""
tools/experiment_entry2.py
═══════════════════════════════════════════════════════════════════════════════
Round 3 — Entry Timing Refinement (builds on R2 winners)

Changes from R2 (experiment_entry.py):
  1. Fee correction  — 0.05% per leg (was 0.1%), ROUND_TRIP = 0.14% (was 0.20%)
  2. Coin elimination— FET dropped, new named coin universes (elite4/elite6/quality10)
  3. Wider TP        — testing 1:3, 1:4, 1:5 ratios (R2 had only 1:2 and 1:3)
  4. Ride the Wave   — new exit mode: no TP target, hold until DIR_FLIP (let winners run)
  5. New entries     — pullback_rsi_or_vol (union), strong_vol (zscore>2), vol_then_pullback
  6. Leverage range  — 15/20/25/30x caps tested on best base config

R2 Key findings:
  • Best: 4h+1h direction + pullback_rsi entry → -$27 (near-breakeven, only 33 trades)
  • Fee was biggest drag at 15m execution. Half the fee = potential profitability flip
  • FET alone: -$393 on 7 trades (14% WR) — eliminated
  • DIR_FLIP exit: 37% of exits — essential mechanism, keep it
  • TP only hits 17% of time — TP may be too tight

Groups:
  A (1-6)  : Coin universe — which coins belong in the trade universe
  B (7-12) : TP/SL tuning on elite4 + pullback_rsi + 4h_1h
  C (13-17): Entry trigger variations (new combos)
  D (18-22): Ride-the-Wave (no TP, hold to DIR_FLIP or SL)
  E (23-26): High confidence filter + universe combos
  F (27-28): Novel strategies (vol_then_pullback, strong vol breakout)
"""

import sys
import os
import time
import argparse
import warnings
from datetime import datetime, timezone
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
from segment_features import get_segment_for_coin

# ─── Constants ────────────────────────────────────────────────────────────────
TEST_MONTHS    = 12
WARMUP_MONTHS  = 3
TRAIN_DAYS     = 90
RETRAIN_DAYS   = 30

# Fee: exactly 0.05% per leg (user-specified), no extra slippage
FEE_PER_LEG    = 0.0005   # 0.05% per leg
SLIP_PER_LEG   = 0.0000   # no additional slippage
ROUND_TRIP     = FEE_PER_LEG * 2   # 0.10% RT  (was 0.20% in R2)

CAPITAL        = config.CAPITAL_PER_TRADE    # $100

TRAIN_BARS = {
    "4h":  TRAIN_DAYS * 6,
    "1h":  TRAIN_DAYS * 24,
    "15m": min(TRAIN_DAYS * 96, config.MULTI_TF_CANDLE_LIMIT),
}

OUTPUT_FILE = os.path.join(ROOT, "tools", "experiment_entry2_results.txt")

# ─── Coin Universes ────────────────────────────────────────────────────────────
# Named lists — direct control (no segment filtering)
#
# R2 per-coin results on best config (#10, pullback_rsi, 4h+1h):
#   ARB  +$241  100% WR  ★    AAVE  +$75   50% WR  ★
#   ADA  +$143   75% WR  ★    ETH   +$33   50% WR  ★
#   UNI  -$12    33% WR        BTC  -$27   25% WR
#   SOL  -$42     0% WR        OP   -$44   40% WR
#   FET  -$393   14% WR  ✗ eliminated
#   TAOUSDT, DOGEUSDT, GALAUSDT, ARUSDT — 0 trades in best config
#
COIN_UNIVERSES = {
    # 4 pure winners from R2
    "elite4":       ["ETHUSDT", "ADAUSDT", "ARBUSDT", "AAVEUSDT"],

    # Elite4 + SOL (trending, low setup count), + BTC (benchmark anchor)
    "elite6":       ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT", "ARBUSDT", "AAVEUSDT"],

    # Elite6 + OP, UNI (moderate drag but liquid L2/DeFi) — no FET
    "quality10":    ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT", "ARBUSDT", "OPUSDT",
                     "UNIUSDT", "AAVEUSDT", "TAOUSDT", "ARUSDT"],

    # DeFi + L1 — highest quality, liquid, narrative-driven
    "defi_l1":      ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT", "UNIUSDT", "AAVEUSDT"],

    # Bluechip only — maximum liquidity
    "bluechip":     ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT"],

    # Single-coin focus sanity check
    "eth_arb":      ["ETHUSDT", "ARBUSDT"],
}

COIN_SEG = {
    "BTCUSDT":"L1","ETHUSDT":"L1","SOLUSDT":"L1","ADAUSDT":"L1",
    "ARBUSDT":"L2","OPUSDT":"L2",
    "UNIUSDT":"DeFi","AAVEUSDT":"DeFi",
    "TAOUSDT":"AI","ARUSDT":"DePIN",
}

# ─── Experiment configurations ────────────────────────────────────────────────
# New field: `coins`  — named coin universe (replaces segment-based filter)
# New field: `ride_wave` — True = no TP, hold position until DIR_FLIP or SL
# New field: `strong_dir_margin` — min direction margin (per-experiment overrides)

EXPERIMENTS = [

    # ══ A: Coin Universe Elimination ══════════════════════════════════════════
    # All use: 4h_1h direction, pullback_rsi entry, SL=1.5/TP=4.5, max_lev=25
    # Purpose: Find which coin set maximises profitability

    {"id":  1, "group":"A-Universe", "label":"4h+1h + PullbackRSI | Universe: elite4 (4 winners)",
     "dir":"4h_1h",  "entry":"pullback_rsi", "min_dir_margin":0.05,
     "coins":"elite4",    "sl":1.5, "tp":4.5, "max_lev":25, "ride_wave":False},

    {"id":  2, "group":"A-Universe", "label":"4h+1h + PullbackRSI | Universe: elite6 (+BTC+SOL)",
     "dir":"4h_1h",  "entry":"pullback_rsi", "min_dir_margin":0.05,
     "coins":"elite6",    "sl":1.5, "tp":4.5, "max_lev":25, "ride_wave":False},

    {"id":  3, "group":"A-Universe", "label":"4h+1h + PullbackRSI | Universe: quality10 (no FET)",
     "dir":"4h_1h",  "entry":"pullback_rsi", "min_dir_margin":0.05,
     "coins":"quality10", "sl":1.5, "tp":4.5, "max_lev":25, "ride_wave":False},

    {"id":  4, "group":"A-Universe", "label":"4h+1h + PullbackRSI | Universe: defi_l1",
     "dir":"4h_1h",  "entry":"pullback_rsi", "min_dir_margin":0.05,
     "coins":"defi_l1",   "sl":1.5, "tp":4.5, "max_lev":25, "ride_wave":False},

    {"id":  5, "group":"A-Universe", "label":"4h+1h + PullbackRSI | Universe: bluechip (4 coins)",
     "dir":"4h_1h",  "entry":"pullback_rsi", "min_dir_margin":0.05,
     "coins":"bluechip",  "sl":1.5, "tp":4.5, "max_lev":25, "ride_wave":False},

    {"id":  6, "group":"A-Universe", "label":"4h+1h + VolSurge   | Universe: elite4",
     "dir":"4h_1h",  "entry":"vol_surge",    "min_dir_margin":0.05,
     "coins":"elite4",    "sl":1.5, "tp":4.5, "max_lev":25, "ride_wave":False},

    # ══ B: TP/SL Tuning ═══════════════════════════════════════════════════════
    # Best setup: 4h_1h + pullback_rsi + elite4, vary R:R ratio
    # R2 finding: TP only hit 17% of exits → TP likely too close

    {"id":  7, "group":"B-TPSL", "label":"elite4 + PR | SL=1.5  TP=3.0  (1:2 baseline R2)",
     "dir":"4h_1h",  "entry":"pullback_rsi", "min_dir_margin":0.05,
     "coins":"elite4",    "sl":1.5, "tp":3.0, "max_lev":25, "ride_wave":False},

    {"id":  8, "group":"B-TPSL", "label":"elite4 + PR | SL=1.5  TP=4.5  (1:3)",
     "dir":"4h_1h",  "entry":"pullback_rsi", "min_dir_margin":0.05,
     "coins":"elite4",    "sl":1.5, "tp":4.5, "max_lev":25, "ride_wave":False},

    {"id":  9, "group":"B-TPSL", "label":"elite4 + PR | SL=1.5  TP=6.0  (1:4)",
     "dir":"4h_1h",  "entry":"pullback_rsi", "min_dir_margin":0.05,
     "coins":"elite4",    "sl":1.5, "tp":6.0, "max_lev":25, "ride_wave":False},

    {"id": 10, "group":"B-TPSL", "label":"elite4 + PR | SL=1.5  TP=7.5  (1:5)",
     "dir":"4h_1h",  "entry":"pullback_rsi", "min_dir_margin":0.05,
     "coins":"elite4",    "sl":1.5, "tp":7.5, "max_lev":25, "ride_wave":False},

    {"id": 11, "group":"B-TPSL", "label":"elite4 + PR | SL=2.0  TP=8.0  (1:4 wide SL)",
     "dir":"4h_1h",  "entry":"pullback_rsi", "min_dir_margin":0.05,
     "coins":"elite4",    "sl":2.0, "tp":8.0, "max_lev":25, "ride_wave":False},

    {"id": 12, "group":"B-TPSL", "label":"elite4 + PR | SL=1.0  TP=4.0  (1:4 tight SL)",
     "dir":"4h_1h",  "entry":"pullback_rsi", "min_dir_margin":0.05,
     "coins":"elite4",    "sl":1.0, "tp":4.0, "max_lev":25, "ride_wave":False},

    # ══ C: Entry Trigger Variations ═══════════════════════════════════════════
    # Tested on elite6 + 4h+1h direction + SL=1.5/TP=4.5

    {"id": 13, "group":"C-Entry", "label":"elite6 + pullback_rsi           (R2 winner repro)",
     "dir":"4h_1h",  "entry":"pullback_rsi",         "min_dir_margin":0.05,
     "coins":"elite6",    "sl":1.5, "tp":4.5, "max_lev":25, "ride_wave":False},

    {"id": 14, "group":"C-Entry", "label":"elite6 + vol_surge              (R2 #3 entry)",
     "dir":"4h_1h",  "entry":"vol_surge",             "min_dir_margin":0.05,
     "coins":"elite6",    "sl":1.5, "tp":4.5, "max_lev":25, "ride_wave":False},

    {"id": 15, "group":"C-Entry", "label":"elite6 + pullback_rsi OR vol    (union: more setups)",
     "dir":"4h_1h",  "entry":"pullback_rsi_or_vol",   "min_dir_margin":0.05,
     "coins":"elite6",    "sl":1.5, "tp":4.5, "max_lev":25, "ride_wave":False},

    {"id": 16, "group":"C-Entry", "label":"elite6 + strong_vol (zscore>2.0)",
     "dir":"4h_1h",  "entry":"strong_vol",             "min_dir_margin":0.05,
     "coins":"elite6",    "sl":1.5, "tp":4.5, "max_lev":25, "ride_wave":False},

    {"id": 17, "group":"C-Entry", "label":"elite6 + vol_then_pullback      (vol confirms, then dip-buy)",
     "dir":"4h_1h",  "entry":"vol_then_pullback",      "min_dir_margin":0.05,
     "coins":"elite6",    "sl":1.5, "tp":6.0, "max_lev":25, "ride_wave":False},

    # ══ D: Ride-the-Wave (no TP — let winners run to DIR_FLIP) ════════════════
    # When direction flips, EXIT. When SL is hit, exit.
    # No fixed TP — the trade rides as long as the 4h+1h direction holds.
    # Idea: some of the winning setups likely left money on the table when TP hit.
    #       Removing TP lets the HMM regime carry the trade to its natural end.

    {"id": 18, "group":"D-RideWave", "label":"RIDE WAVE | elite4 + pullback_rsi  SL=2.0",
     "dir":"4h_1h",  "entry":"pullback_rsi", "min_dir_margin":0.05,
     "coins":"elite4",    "sl":2.0, "tp":None, "max_lev":20, "ride_wave":True},

    {"id": 19, "group":"D-RideWave", "label":"RIDE WAVE | elite4 + vol_surge      SL=2.0",
     "dir":"4h_1h",  "entry":"vol_surge",    "min_dir_margin":0.05,
     "coins":"elite4",    "sl":2.0, "tp":None, "max_lev":20, "ride_wave":True},

    {"id": 20, "group":"D-RideWave", "label":"RIDE WAVE | elite4 + PR OR vol      SL=2.0",
     "dir":"4h_1h",  "entry":"pullback_rsi_or_vol", "min_dir_margin":0.05,
     "coins":"elite4",    "sl":2.0, "tp":None, "max_lev":20, "ride_wave":True},

    {"id": 21, "group":"D-RideWave", "label":"RIDE WAVE | elite6 + pullback_rsi  SL=1.5  lev=25",
     "dir":"4h_1h",  "entry":"pullback_rsi", "min_dir_margin":0.05,
     "coins":"elite6",    "sl":1.5, "tp":None, "max_lev":25, "ride_wave":True},

    {"id": 22, "group":"D-RideWave", "label":"RIDE WAVE | elite4 + PR  high conf (margin>0.15)",
     "dir":"4h_1h",  "entry":"pullback_rsi", "min_dir_margin":0.15,
     "coins":"elite4",    "sl":2.0, "tp":None, "max_lev":20, "ride_wave":True},

    # ══ E: Confidence + Universe Combos ═══════════════════════════════════════

    {"id": 23, "group":"E-HighConf", "label":"elite4 + PR  margin>0.10  TP=4.5",
     "dir":"4h_1h",  "entry":"pullback_rsi", "min_dir_margin":0.10,
     "coins":"elite4",    "sl":1.5, "tp":4.5, "max_lev":25, "ride_wave":False},

    {"id": 24, "group":"E-HighConf", "label":"elite4 + PR  margin>0.15  TP=4.5",
     "dir":"4h_1h",  "entry":"pullback_rsi", "min_dir_margin":0.15,
     "coins":"elite4",    "sl":1.5, "tp":4.5, "max_lev":25, "ride_wave":False},

    {"id": 25, "group":"E-HighConf", "label":"elite4 + PR  margin>0.20  TP=6.0",
     "dir":"4h_1h",  "entry":"pullback_rsi", "min_dir_margin":0.20,
     "coins":"elite4",    "sl":1.5, "tp":6.0, "max_lev":25, "ride_wave":False},

    {"id": 26, "group":"E-HighConf", "label":"elite6 + vol  margin>0.15  TP=6.0",
     "dir":"4h_1h",  "entry":"vol_surge",    "min_dir_margin":0.15,
     "coins":"elite6",    "sl":1.5, "tp":6.0, "max_lev":25, "ride_wave":False},

    # ══ F: Novel Strategies ═══════════════════════════════════════════════════

    # "Momentum Sniper": vol_then_pullback on elite4 with wider TP, high confidence
    # Logic: big volume surge shows institutional interest → wait for pullback → enter
    {"id": 27, "group":"F-Novel", "label":"SNIPER: vol_confirm→pullback_rsi  margin>0.10  TP=8×",
     "dir":"4h_1h",  "entry":"vol_then_pullback",  "min_dir_margin":0.10,
     "coins":"elite4",    "sl":2.0, "tp":8.0, "max_lev":20, "ride_wave":False},

    # "Trend Rider": Enter on vol_surge only (momentum), ride to DIR_FLIP, tight SL
    # Logic: vol_surge = momentum entry, direction flip = natural exit
    {"id": 28, "group":"F-Novel", "label":"TREND RIDER: strong_vol → ride to DIR_FLIP  elite4",
     "dir":"4h_1h",  "entry":"strong_vol",          "min_dir_margin":0.10,
     "coins":"elite4",    "sl":1.5, "tp":None, "max_lev":20, "ride_wave":True},
]

assert len(EXPERIMENTS) == 28, f"Expected 28, got {len(EXPERIMENTS)}"
assert len({e["id"] for e in EXPERIMENTS}) == 28, "Duplicate IDs"


# ─── Data fetch ───────────────────────────────────────────────────────────────

def fetch_tf(symbol: str, interval: str, total_months: int):
    mins_map = {"4h": 240, "1h": 60, "15m": 15}
    mins_per_bar = mins_map[interval]
    n_bars = int((total_months * 30 * 24 * 60 / mins_per_bar) * 1.1)
    now_ms   = int(datetime.now(timezone.utc).timestamp() * 1000)
    start_ms = now_ms - n_bars * mins_per_bar * 60 * 1000
    url, klines = "https://fapi.binance.com/fapi/v1/klines", []
    cur = start_ms
    while True:
        try:
            r = requests.get(url, params={"symbol": symbol, "interval": interval,
                                          "startTime": cur, "limit": 1500}, timeout=20)
            if r.status_code != 200:
                break
            batch = r.json()
            if not batch or isinstance(batch, dict):
                break
            klines.extend(batch)
            if len(batch) < 1500:
                break
            cur = int(batch[-1][0]) + 1
            time.sleep(0.06)
        except Exception as e:
            print(f"    {symbol}/{interval}: {e}")
            break
    if not klines:
        return None
    df_raw = _parse_klines_df(klines)
    if df_raw is None or df_raw.empty:
        return None
    try:
        df = compute_all_features(df_raw).dropna().reset_index(drop=True)
    except Exception as e:
        print(f"    feature error {symbol}/{interval}: {e}")
        return None
    if "timestamp" not in df.columns:
        df = df.reset_index()
        if "index" in df.columns:
            df.rename(columns={"index": "timestamp"}, inplace=True)
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    return df.reset_index(drop=True)


def predict_block(brain: HMMBrain, df: pd.DataFrame):
    n = len(df)
    regimes = np.full(n, config.REGIME_CHOP, dtype=int)
    margins = np.zeros(n)
    if not brain.is_trained or any(c not in df.columns for c in brain.features):
        return regimes, margins
    X = df[brain.features].replace([np.inf, -np.inf], np.nan)
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


# ─── Phase 1: Pre-compute ─────────────────────────────────────────────────────

def precompute_coin(symbol: str):
    total = WARMUP_MONTHS + TEST_MONTHS
    dfs = {}
    for tf in ["4h", "1h", "15m"]:
        df = fetch_tf(symbol, tf, total)
        if df is None or df.empty:
            print(f"    {symbol}/{tf}: NO DATA")
            return None
        dfs[tf] = df
        time.sleep(0.12)

    last_ts       = dfs["15m"]["timestamp"].iloc[-1]
    test_start_ts = last_ts - pd.Timedelta(days=TEST_MONTHS * 30)

    n_blocks = int((TEST_MONTHS * 30) / RETRAIN_DAYS) + 2
    cutoffs  = [test_start_ts + pd.Timedelta(days=i * RETRAIN_DAYS)
                for i in range(n_blocks + 1)]

    preds = {tf: {"regime": np.full(len(dfs[tf]), config.REGIME_CHOP, dtype=int),
                  "margin": np.zeros(len(dfs[tf]))}
             for tf in ["4h", "1h", "15m"]}

    for blk_i, cutoff in enumerate(cutoffs[:-1]):
        next_cut = cutoffs[blk_i + 1]
        brains = {}
        for tf, df_tf in dfs.items():
            train_data = df_tf[df_tf["timestamp"] < cutoff].tail(TRAIN_BARS[tf]).copy()
            b = HMMBrain(symbol=symbol)
            if len(train_data) >= 50:
                try:
                    b.train(train_data)
                except Exception:
                    pass
            brains[tf] = b

        for tf, df_tf in dfs.items():
            mask = (df_tf["timestamp"] >= cutoff) & (df_tf["timestamp"] < next_cut)
            idx  = np.where(mask)[0]
            if not len(idx) or not brains[tf].is_trained:
                continue
            r, m = predict_block(brains[tf], df_tf.iloc[idx].copy())
            if len(idx) > 1:
                preds[tf]["regime"][idx[1:]] = r[:-1]
                preds[tf]["margin"][idx[1:]] = m[:-1]

    return {"symbol": symbol, "dfs": dfs, "preds": preds, "test_start_ts": test_start_ts}


# ─── Regime / feature lookup ───────────────────────────────────────────────────

def _regime_at(pred_dict, df_tf, ts):
    idx = int(np.searchsorted(df_tf["timestamp"].values, np.datetime64(ts), side="right")) - 1
    if idx < 0:
        return config.REGIME_CHOP, 0.0
    return int(pred_dict["regime"][idx]), float(pred_dict["margin"][idx])


def _atr_at(dfs, ts):
    df = dfs["1h"]
    idx = int(np.searchsorted(df["timestamp"].values, np.datetime64(ts), side="right")) - 1
    if idx < 0 or "atr" not in df.columns:
        return None
    v = float(df["atr"].iloc[idx])
    return v if (v > 0 and not np.isnan(v)) else None


# ─── Direction functions ───────────────────────────────────────────────────────

def _dir_4h(p4h, m4h, p1h, m1h, p15m, m15m):
    if p4h == config.REGIME_BULL:  return "BUY",  m4h
    if p4h == config.REGIME_BEAR:  return "SELL", m4h
    return None, 0.0

def _dir_1h(p4h, m4h, p1h, m1h, p15m, m15m):
    if p1h == config.REGIME_BULL:  return "BUY",  m1h
    if p1h == config.REGIME_BEAR:  return "SELL", m1h
    return None, 0.0

def _dir_4h_1h(p4h, m4h, p1h, m1h, p15m, m15m):
    if p4h == config.REGIME_BULL and p1h == config.REGIME_BULL:
        return "BUY",  (m4h + m1h) / 2
    if p4h == config.REGIME_BEAR and p1h == config.REGIME_BEAR:
        return "SELL", (m4h + m1h) / 2
    return None, 0.0

def _dir_4h_soft(p4h, m4h, p1h, m1h, p15m, m15m):
    if p4h == config.REGIME_BULL and p1h != config.REGIME_BEAR:
        return "BUY",  m4h
    if p4h == config.REGIME_BEAR and p1h != config.REGIME_BULL:
        return "SELL", m4h
    return None, 0.0

def _dir_4h_1h_15m(p4h, m4h, p1h, m1h, p15m, m15m):
    if p4h == config.REGIME_BULL == p1h == p15m:
        return "BUY",  (m4h + m1h + m15m) / 3
    if p4h == config.REGIME_BEAR == p1h == p15m:
        return "SELL", (m4h + m1h + m15m) / 3
    return None, 0.0

DIRECTION_FNS = {
    "4h":        _dir_4h,
    "1h":        _dir_1h,
    "4h_1h":     _dir_4h_1h,
    "4h_soft":   _dir_4h_soft,
    "4h_1h_15m": _dir_4h_1h_15m,
}


# ─── Entry trigger functions ───────────────────────────────────────────────────

def _entry_immediate(df, i, pred15m, side):
    return True

def _entry_flip(df, i, pred15m, side):
    if i < 1: return False
    curr = pred15m["regime"][i]
    prev = pred15m["regime"][i - 1]
    if side == "BUY":  return curr == config.REGIME_BULL and prev != config.REGIME_BULL
    return curr == config.REGIME_BEAR and prev != config.REGIME_BEAR

def _entry_pullback(df, i, pred15m, side):
    if i < 2: return False
    c0 = pred15m["regime"][i]
    c1 = pred15m["regime"][i - 1]
    c2 = pred15m["regime"][i - 2]
    if side == "BUY":
        return c0 == config.REGIME_BULL and c1 == config.REGIME_CHOP and c2 == config.REGIME_BULL
    return c0 == config.REGIME_BEAR and c1 == config.REGIME_CHOP and c2 == config.REGIME_BEAR

def _entry_vwap(df, i, pred15m, side):
    if i < 2 or "vwap_dist" not in df.columns: return False
    curr_vd = float(df["vwap_dist"].iloc[i - 1])
    prev_vd = float(df["vwap_dist"].iloc[i - 2])
    if side == "BUY":  return curr_vd > 0 and prev_vd <= 0
    return curr_vd < 0 and prev_vd >= 0

def _entry_rsi_dip(df, i, pred15m, side, rsi_long=40, rsi_short=60):
    if i < 2 or "rsi" not in df.columns: return False
    curr_rsi = float(df["rsi"].iloc[i - 1])
    prev_rsi = float(df["rsi"].iloc[i - 2])
    if side == "BUY":  return curr_rsi > rsi_long and prev_rsi <= rsi_long
    return curr_rsi < rsi_short and prev_rsi >= rsi_short

def _entry_vol_surge(df, i, pred15m, side, thresh=1.5):
    if i < 1 or "vol_zscore" not in df.columns: return False
    vz  = float(df["vol_zscore"].iloc[i - 1])
    reg = pred15m["regime"][i - 1]
    if side == "BUY":  return vz > thresh and reg == config.REGIME_BULL
    return vz > thresh and reg == config.REGIME_BEAR

def _entry_strong_vol(df, i, pred15m, side):
    """Stricter volume surge: vol_zscore > 2.0 (stronger institutional signal)."""
    return _entry_vol_surge(df, i, pred15m, side, thresh=2.0)

def _entry_bb_break(df, i, pred15m, side, squeeze_thresh=0.3, lookback=4):
    if i < lookback or "bb_width_norm" not in df.columns: return False
    curr_bb  = float(df["bb_width_norm"].iloc[i - 1])
    prev_bbs = [float(df["bb_width_norm"].iloc[i - 1 - j]) for j in range(1, lookback)]
    was_squeezing = all(b < squeeze_thresh for b in prev_bbs)
    is_expanding  = curr_bb > max(prev_bbs) * 1.1
    reg = pred15m["regime"][i - 1]
    if side == "BUY":  return was_squeezing and is_expanding and reg == config.REGIME_BULL
    return was_squeezing and is_expanding and reg == config.REGIME_BEAR

def _entry_liq_vac(df, i, pred15m, side, lv_thresh=0.5):
    if i < 1 or "liquidity_vacuum" not in df.columns: return False
    lv  = float(df["liquidity_vacuum"].iloc[i - 1])
    reg = pred15m["regime"][i - 1]
    if side == "BUY":  return lv > lv_thresh and reg == config.REGIME_BULL
    return lv > lv_thresh and reg == config.REGIME_BEAR

def _entry_pullback_and_rsi(df, i, pred15m, side):
    """Pullback pattern AND RSI confirming oversold recovery."""
    return _entry_pullback(df, i, pred15m, side) and _entry_rsi_dip(df, i, pred15m, side)

def _entry_pullback_rsi_or_vol(df, i, pred15m, side):
    """Pullback+RSI OR Volume Surge — more opportunities while keeping quality."""
    return _entry_pullback_and_rsi(df, i, pred15m, side) or _entry_vol_surge(df, i, pred15m, side)

def _entry_vol_then_pullback(df, i, pred15m, side, lookback=6):
    """
    Two-step momentum entry:
    Step 1: Volume surge happened in the last `lookback` bars (institutional interest)
    Step 2: Now a pullback+RSI re-entry fires (buy the dip after the vol surge)
    """
    if not _entry_pullback_and_rsi(df, i, pred15m, side):
        return False
    for lag in range(2, lookback + 2):
        j = i - lag
        if j >= 0 and _entry_vol_surge(df, j, pred15m, side):
            return True
    return False

ENTRY_FNS = {
    "immediate":           _entry_immediate,
    "flip":                _entry_flip,
    "pullback":            _entry_pullback,
    "vwap":                _entry_vwap,
    "rsi_dip":             _entry_rsi_dip,
    "vol_surge":           _entry_vol_surge,
    "strong_vol":          _entry_strong_vol,
    "bb_break":            _entry_bb_break,
    "liq_vac":             _entry_liq_vac,
    "pullback_rsi":        _entry_pullback_and_rsi,
    "pullback_rsi_or_vol": _entry_pullback_rsi_or_vol,
    "vol_then_pullback":   _entry_vol_then_pullback,
}


# ─── Phase 2: Trade simulation ─────────────────────────────────────────────────

def simulate_trades(cache: dict, exp: dict):
    dfs          = cache["dfs"]
    preds        = cache["preds"]
    test_start   = cache["test_start_ts"]
    df_15m       = dfs["15m"]
    pred_15m     = preds["15m"]

    dir_fn       = DIRECTION_FNS[exp["dir"]]
    entry_fn     = ENTRY_FNS[exp["entry"]]
    min_margin   = exp["min_dir_margin"]
    sl_mult      = exp["sl"]
    tp_mult      = exp.get("tp")          # None = ride-the-wave mode
    max_lev      = exp["max_lev"]
    ride_wave    = exp.get("ride_wave", False)

    ts_15m   = df_15m["timestamp"].values
    test_arr = np.where(ts_15m >= np.datetime64(test_start))[0]
    if not len(test_arr):
        return None
    test_idx = int(test_arr[0])

    trades     = []
    open_trade = None

    for i in range(test_idx, len(df_15m)):
        row   = df_15m.iloc[i]
        ts    = row["timestamp"]
        open_ = float(row["open"])
        high  = float(row["high"])
        low   = float(row["low"])
        close = float(row["close"])

        p4h,  m4h  = _regime_at(preds["4h"],  dfs["4h"],  ts)
        p1h,  m1h  = _regime_at(preds["1h"],  dfs["1h"],  ts)
        p15m, m15m = pred_15m["regime"][i], pred_15m["margin"][i]

        direction, dir_margin = dir_fn(p4h, m4h, p1h, m1h, p15m, m15m)
        if direction is not None and float(dir_margin) < min_margin:
            direction = None

        # ── Exit logic ────────────────────────────────────────────────────────
        if open_trade is not None:
            ot_side, ot_entry, ot_sl, ot_tp, ot_lev, ot_ts = open_trade
            d  = 1 if ot_side == "BUY" else -1
            ep = None
            er = None

            # SL check (always active)
            if d == 1:
                if low  <= ot_sl:  ep, er = ot_sl, "SL"
            else:
                if high >= ot_sl:  ep, er = ot_sl, "SL"

            # TP check (only if not ride-wave)
            if ep is None and not ride_wave and ot_tp is not None:
                if d == 1:
                    if high >= ot_tp: ep, er = ot_tp, "TP"
                else:
                    if low  <= ot_tp: ep, er = ot_tp, "TP"

            # Direction flip exit (active in both modes)
            if ep is None and direction is not None and direction != ot_side:
                ep, er = close, "DIR_FLIP"

            if ep is not None:
                raw = (ep - ot_entry) / ot_entry * d
                net = max(raw * ot_lev - ROUND_TRIP * ot_lev, -1.0)
                pnl = round(CAPITAL * net, 4)
                trades.append({"pnl": pnl, "reason": er, "side": ot_side,
                                "lev": ot_lev, "entry_ts": ot_ts, "exit_ts": ts})
                open_trade = None

        # ── Entry logic ───────────────────────────────────────────────────────
        if open_trade is None and direction is not None:
            if entry_fn(df_15m, i, pred_15m, direction):
                atr = _atr_at(dfs, ts)
                if atr is None:
                    atr = close * 0.01
                vol_ratio = atr / close if close > 0 else 0
                if vol_ratio < config.VOL_MIN_ATR_PCT or vol_ratio > config.VOL_MAX_ATR_PCT:
                    continue

                if   dir_margin >= 0.30: lev = min(25, max_lev)
                elif dir_margin >= 0.20: lev = min(20, max_lev)
                elif dir_margin >= 0.10: lev = min(15, max_lev)
                else:                    lev = min(10, max_lev)

                if direction == "BUY":
                    sl = open_ - sl_mult * atr
                    tp = (open_ + tp_mult * atr) if tp_mult is not None else None
                else:
                    sl = open_ + sl_mult * atr
                    tp = (open_ - tp_mult * atr) if tp_mult is not None else None

                open_trade = (direction, open_, sl, tp, lev, ts)

    # Close open trade at period end
    if open_trade is not None:
        ot_side, ot_entry, ot_sl, ot_tp, ot_lev, ot_ts = open_trade
        d = 1 if ot_side == "BUY" else -1
        last = df_15m.iloc[-1]
        raw  = (float(last["close"]) - ot_entry) / ot_entry * d
        net  = max(raw * ot_lev - ROUND_TRIP * ot_lev, -1.0)
        trades.append({"pnl": round(CAPITAL * net, 4), "reason": "EOD",
                       "side": ot_side, "lev": ot_lev,
                       "entry_ts": ot_ts, "exit_ts": last["timestamp"]})

    if not trades:
        return None

    pnls = np.array([t["pnl"] for t in trades])
    wins = pnls[pnls > 0]
    loss = pnls[pnls <= 0]
    cum  = np.cumsum(pnls)
    dd   = cum - np.maximum.accumulate(cum)
    exits = defaultdict(int)
    for t in trades:
        exits[t["reason"]] += 1

    return {
        "n_trades":  len(trades),
        "total_pnl": round(float(pnls.sum()), 2),
        "win_rate":  round(len(wins) / len(pnls) * 100, 1),
        "pf":        round(float(wins.sum()) / abs(float(loss.sum())), 3) if len(loss) and loss.sum() != 0 else 999.0,
        "sharpe":    round(float(pnls.mean() / pnls.std() * np.sqrt(len(pnls))), 3) if pnls.std() > 1e-5 else 0.0,
        "max_dd":    round(float(dd.min()), 2),
        "avg_pnl":   round(float(pnls.mean()), 2),
        "avg_lev":   round(float(np.mean([t["lev"] for t in trades])), 1),
        "exits":     dict(exits),
        "trades":    trades,
    }


# ─── Report ────────────────────────────────────────────────────────────────────

ROADMAP = """
╔══════════════════════════════════════════════════════════════════════════════╗
║        SYNAPTIC QUANT — EXPERIMENTATION ROADMAP                             ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  COMPLETED                                                                   ║
║  Round 1 — experiment_multistrat.py                                         ║
║    50 configs: Scalp/Sniper/Swing/Position/Momentum/Volume archetypes       ║
║    Finding: Only 1h-sniper w/ 3-TF unanimous profitable. 15m = fee death.  ║
║                                                                              ║
║  Round 2 — experiment_entry.py                                              ║
║    30 configs: Direction TF vs Entry TF separation concept                  ║
║    Finding: 4h+1h direction + pullback_rsi = -$27 (near-breakeven)         ║
║             17% TP hit rate → TP too tight. FET is a drag coin.            ║
║                                                                              ║
║  Round 3 — experiment_entry2.py  ← YOU ARE HERE                            ║
║    28 configs: Fee fix, coin elimination, wider TP, ride-the-wave           ║
║    Targets: Find first consistently profitable config                       ║
║                                                                              ║
║  PLANNED                                                                     ║
║  Round 4 — experiment_portfolio.py                                          ║
║    Multi-coin portfolio: allocate capital across top 3-5 winning coins      ║
║    Test: equal weight vs conviction-weighted allocation                      ║
║    Test: position sizing (Kelly fraction, fixed fractional, volatility adj) ║
║                                                                              ║
║  Round 5 — experiment_live_shadow.py                                        ║
║    Paper-trade the winning config in real-time (forward test)               ║
║    Run alongside live engine for 4-6 weeks before deploying                 ║
║                                                                              ║
║  Round 6 — engine_integration.py                                            ║
║    Apply best direction+entry+universe to main.py production engine         ║
║    Add: DIR_FLIP exit hook, pullback_rsi entry gate, coin whitelist         ║
╚══════════════════════════════════════════════════════════════════════════════╝

  ELIMINATION CRITERIA DEVELOPED SO FAR
  ───────────────────────────────────────
  Coin level:
    ✗ FET — 14% WR, -$393 on 7 trades (AI sector momentum unreliable)
    ✗ GALA — 0 qualifying setups in 12 months (too choppy)
    ✗ DOGE — 0 qualifying setups (meme price action != HMM-friendly)
    ✗ BONK — no 4h futures data on Binance
    ? SOL — 0% WR in best R2 config but high liquidity — testing with wider TP
    ? BTC — dragging (-$27 in best config) but needed as market anchor

  Config level:
    ✗ 1h direction alone — catastrophic (-$47k avg, 7,960 trades/yr fee drag)
    ✗ Immediate entry — worst in every group, 7,700+ trades/year
    ✗ RSI dip alone — overcrowded signal, fires too often, low precision
    ✗ Flip entry — too many false signals, creates churn
    ✗ 15m exec < 1h exec — fee drag at high leverage is fatal (proven R1)
    ✓ pullback_rsi — most selective, 33 trades/yr, near-breakeven at 0.2% fee
    ✓ DIR_FLIP exit — essential, 37% of exits, prevents runaway losses
    ✓ 4h+1h agreement — strongest direction filter, lowest false signals

  R:R / TP insights:
    ✗ 1:2 TP (3×ATR) — only 17% TP hit rate, leaving money on the table
    ? 1:3 to 1:5 — testing now
    ? Ride-to-DIR_FLIP — removes TP ceiling, lets trend carry the trade
"""


def write_report(results, ranked, elapsed):
    W = 120
    lines = []
    h = lambda s: lines.append(s)

    h("=" * W)
    h("  SYNAPTIC QUANT LAB — ROUND 3 ENTRY TIMING REFINEMENT")
    h(f"  Fee: {FEE_PER_LEG*100:.2f}% per leg + {SLIP_PER_LEG*100:.2f}% slip = {ROUND_TRIP*100:.2f}% RT  "
      f"(R2 was 0.20% RT)")
    h(f"  Period: 12-month walk-forward  |  Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    h("=" * W)
    h("")
    h(f"  {'Rk':>3}  {'#':>2}  {'Group':<16}  {'Label':<55}  {'Dir':<10}  {'Ent':<18}  "
      f"{'Coins':<7}  {'SL/TP':<8}  {'Lev':>4}  {'Trd':>5}  {'T/c':>5}  "
      f"{'PnL':>10}  {'TWR':>6}  {'TPF':>6}  {'TSh':>7}  {'MDD':>8}")
    h("  " + "─" * (W - 2))

    for rk, r in enumerate(ranked, 1):
        tp_str = f"{r['sl']:.1f}/{r['tp']:.1f}" if r.get("tp") else f"{r['sl']:.1f}/wave"
        tag = ""
        if r["total_pnl"] > 0:
            tag = "  ★ PROFIT"
        elif r["total_pnl"] > -500:
            tag = "  ~ NEAR"
        h(f"  {rk:>3}  {r['id']:>2}  {r['group']:<16}  {r['label'][:55]:<55}  "
          f"{r['dir']:<10}  {r['entry']:<18}  "
          f"{r['coins']:<7}  {tp_str:<8}  {r['max_lev']:>4}  "
          f"{r.get('n_coins',0):>2}  {r['n_trades']:>5}  {r.get('tpc',0):>5.0f}  "
          f"${r['total_pnl']:>9.2f}  {r.get('trade_wr',0):>5.1f}%  "
          f"{r.get('trade_pf',0):>6.2f}  {r.get('trade_sh',0):>7.3f}  "
          f"${r.get('max_dd',0):>7.0f}{tag}")

    h("")
    h("=" * 80)
    h("  GROUP AVERAGES")
    h("=" * 80)
    groups = defaultdict(list)
    for r in ranked:
        groups[r["group"]].append(r)
    for g, rs in sorted(groups.items()):
        best = max(rs, key=lambda x: x["total_pnl"])
        avg_pnl = sum(r["total_pnl"] for r in rs) / len(rs)
        avg_twr = sum(r.get("trade_wr", 0) for r in rs) / len(rs)
        avg_sh  = sum(r.get("trade_sh", 0) for r in rs) / len(rs)
        avg_tr  = sum(r["n_trades"] for r in rs) / len(rs)
        h(f"  {g:<18}  n={len(rs)}  avgPnL=${avg_pnl:>9.2f}  "
          f"avgTWR={avg_twr:.1f}%  avgSh={avg_sh:.3f}  "
          f"avgTrades={avg_tr:.0f}  best=#{best['id']} ${best['total_pnl']:+.2f}")

    h("")
    h("=" * 80)
    h("  ENTRY TYPE ANALYSIS (avg across direction modes)")
    h("=" * 80)
    by_entry = defaultdict(list)
    for r in ranked:
        by_entry[r["entry"]].append(r)
    for etype, rs in sorted(by_entry.items(), key=lambda x: sum(r["total_pnl"] for r in x[1]) / len(x[1]), reverse=True):
        best = max(rs, key=lambda x: x["total_pnl"])
        avg_pnl = sum(r["total_pnl"] for r in rs) / len(rs)
        avg_tr  = sum(r["n_trades"] for r in rs) / len(rs)
        avg_twr = sum(r.get("trade_wr", 0) for r in rs) / len(rs)
        h(f"  {etype:<22}  n={len(rs)}  avgPnL=${avg_pnl:>9.2f}  "
          f"avgTWR={avg_twr:.1f}%  avgTrades={avg_tr:.0f}  "
          f"best=#{best['id']} ${best['total_pnl']:+.2f}")

    h("")
    h("=" * 80)
    h("  UNIVERSE ANALYSIS")
    h("=" * 80)
    by_coins = defaultdict(list)
    for r in ranked:
        by_coins[r["coins"]].append(r)
    for cu, rs in sorted(by_coins.items(), key=lambda x: sum(r["total_pnl"] for r in x[1]) / len(x[1]), reverse=True):
        best = max(rs, key=lambda x: x["total_pnl"])
        avg_pnl = sum(r["total_pnl"] for r in rs) / len(rs)
        h(f"  {cu:<12}  n={len(rs)}  avgPnL=${avg_pnl:>9.2f}  best=#{best['id']} ${best['total_pnl']:+.2f}")

    h("")
    h("=" * 80)
    h("  EXIT REASON BREAKDOWN (all experiments combined)")
    h("=" * 80)
    all_exits = defaultdict(int)
    total_ex  = 0
    for r in ranked:
        for reason, cnt in r.get("exits", {}).items():
            all_exits[reason] += cnt
            total_ex += cnt
    for reason, cnt in sorted(all_exits.items(), key=lambda x: -x[1]):
        pct = cnt / total_ex * 100 if total_ex else 0
        h(f"  {reason:<14}  {cnt:>6}  ({pct:.1f}%)")

    h("")
    h("=" * 80)
    h("  PER-COIN BREAKDOWN — Best Experiment")
    h("=" * 80)
    best_r = ranked[0] if ranked else None
    if best_r:
        h(f"  Best: #{best_r['id']} — {best_r['label']}")
        h(f"  Direction: {best_r['dir']}  |  Entry: {best_r['entry']}  |  Universe: {best_r['coins']}")
        h("")
        coin_results = sorted(best_r.get("coin_stats", []),
                               key=lambda x: x["total_pnl"], reverse=True)
        for cs in coin_results:
            sym  = cs["sym"]
            seg  = COIN_SEG.get(sym, "?")
            star = "★ BEST" if cs["total_pnl"] > 0 else "✗ DRAG" if cs["total_pnl"] < -50 else ""
            h(f"  {sym:<12}  [{seg:<6}]  PnL=${cs['total_pnl']:>+8.2f}  "
              f"trades={cs['n_trades']:>4}  WR={cs['win_rate']:>5.1f}%  "
              f"PF={cs['pf']:>6.2f}  Sharpe={cs['sharpe']:>6.2f}  "
              f"exits={cs['exits']}  {star}")

    h("")
    h("=" * 80)
    h("  TOP 5 CONFIGURATIONS")
    h("=" * 80)
    h("")
    for rk, r in enumerate(ranked[:5], 1):
        tp_display = f"{r['tp']:.1f}×ATR" if r.get("tp") else "DIR_FLIP only (ride wave)"
        h(f"  #{rk}  Exp {r['id']} — {r['label']}")
        h(f"      Direction : {r['dir']}  |  Entry trigger : {r['entry']}  "
          f"|  Min dir margin : {r['min_dir_margin']}")
        h(f"      Universe  : {r['coins']}  |  SL={r['sl']:.1f}×ATR  TP={tp_display}  "
          f"|  Max lev: {r['max_lev']}x (avg {r.get('avg_lev', 0):.1f}x)")
        h(f"      PnL       : ${r['total_pnl']:.2f}  |  Trade WR: {r.get('trade_wr', 0):.1f}%  "
          f"|  PF: {r.get('trade_pf', 0):.3f}  |  Sharpe: {r.get('trade_sh', 0):.3f}")
        h(f"      Trades    : {r['n_trades']} total  ({r.get('tpc', 0):.0f}/coin)  "
          f"|  Exit breakdown: {r.get('exits', {})}")
        h("")

    h("")
    h("=" * W)
    h(ROADMAP)
    h("=" * W)
    h(f"  Elapsed: {elapsed:.1f}s")
    h("")

    text = "\n".join(lines)
    with open(OUTPUT_FILE, "w") as f:
        f.write(text)
    return text


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--coins", nargs="+")
    args = parser.parse_args()

    t0 = time.time()

    # Collect all unique coins across all experiments
    if args.coins:
        all_coins = args.coins
    else:
        all_coins_set = set()
        for exp in EXPERIMENTS:
            all_coins_set.update(COIN_UNIVERSES[exp["coins"]])
        all_coins = sorted(all_coins_set)

    print("=" * 90)
    print("  Synaptic Quant Lab — Round 3 Entry Refinement (28 configs)")
    print(f"  Fee: {FEE_PER_LEG*100:.2f}%/leg + {SLIP_PER_LEG*100:.2f}% slip = {ROUND_TRIP*100:.2f}% RT  (R2=0.20%)")
    print(f"  Coins: {len(all_coins)}  |  Window: {TEST_MONTHS}m walk-forward  |  Retrain: every {RETRAIN_DAYS}d")
    print(f"  Universes: {sorted(COIN_UNIVERSES.keys())}")
    print("=" * 90)
    print()

    # ═══ Phase 1 ═════════════════════════════════════════════════════════════
    print("━━━ Phase 1 — Pre-computing HMM regime predictions ━━━")
    caches = {}
    for i, sym in enumerate(all_coins, 1):
        print(f"  [{i:2d}/{len(all_coins)}] {sym:14s} ...", end=" ", flush=True)
        c = precompute_coin(sym)
        if c is None:
            print("SKIP")
            continue
        caches[sym] = c
        seg = COIN_SEG.get(sym, "?")
        print(f"OK [{seg:6s}]  4h={len(c['dfs']['4h']):4d}  1h={len(c['dfs']['1h']):5d}  15m={len(c['dfs']['15m']):6d}")

    print(f"\n  Precomputed {len(caches)}/{len(all_coins)} coins\n")

    # ═══ Phase 2 ═════════════════════════════════════════════════════════════
    print("━━━ Phase 2 — Simulating 28 experiments ━━━")
    print()

    results = []
    for exp in EXPERIMENTS:
        universe  = COIN_UNIVERSES[exp["coins"]]
        eligible  = [s for s in universe if s in caches]
        ride_flag = "WAVE" if exp.get("ride_wave") else ""

        coin_stats = []
        for sym in eligible:
            st = simulate_trades(caches[sym], exp)
            if st:
                coin_stats.append({"sym": sym, **st})

        if not coin_stats:
            print(f"  #{exp['id']:2d} {exp['label'][:55]:55s} NO TRADES")
            results.append({**exp, "n_coins":0, "n_trades":0, "total_pnl":0,
                             "trade_wr":0, "trade_pf":0, "trade_sh":0,
                             "max_dd":0, "avg_lev":0, "tpc":0, "coin_stats":[]})
            continue

        all_trade_pnls = []
        all_exits      = defaultdict(int)
        for cs in coin_stats:
            all_trade_pnls.extend([t["pnl"] for t in cs["trades"]])
            for reason, cnt in cs["exits"].items():
                all_exits[reason] += cnt

        tp_arr   = np.array(all_trade_pnls)
        t_wins   = tp_arr[tp_arr > 0]
        t_loss   = tp_arr[tp_arr <= 0]
        trade_wr = round(len(t_wins) / len(tp_arr) * 100, 1) if len(tp_arr) else 0
        trade_pf = round(float(t_wins.sum()) / abs(float(t_loss.sum())), 3) if len(t_loss) and t_loss.sum() != 0 else 999.0
        trade_sh = round(float(tp_arr.mean() / tp_arr.std() * np.sqrt(len(tp_arr))), 3) if tp_arr.std() > 1e-5 else 0.0

        cp_arr    = np.array([cs["total_pnl"] for cs in coin_stats])
        total_pnl = round(float(cp_arr.sum()), 2)
        n_trades  = sum(cs["n_trades"] for cs in coin_stats)
        tpc       = round(n_trades / len(coin_stats), 0)
        avg_lev   = round(np.mean([cs["avg_lev"] for cs in coin_stats]), 1)
        max_dd    = sum(cs["max_dd"] for cs in coin_stats)

        r = {**exp,
             "n_coins": len(coin_stats), "n_trades": n_trades, "tpc": tpc,
             "total_pnl": total_pnl,
             "trade_wr": trade_wr, "trade_pf": trade_pf, "trade_sh": trade_sh,
             "max_dd": round(max_dd, 2), "avg_lev": avg_lev,
             "exits": dict(all_exits), "coin_stats": coin_stats}
        results.append(r)

        tag = "★ PROFIT" if total_pnl > 0 else ("~ NEAR" if total_pnl > -300 else "")
        print(
            f"  #{exp['id']:2d} [{exp['group']:<14}] {exp['entry']:<22} "
            f"dir={exp['dir']:<10}  {exp['coins']:<10}  {ride_flag:<4}  "
            f"coins={len(coin_stats):2d}  trades={n_trades:>5}({tpc:4.0f}/c)  "
            f"PnL=${total_pnl:>+9.2f}  "
            f"WR={trade_wr:5.1f}%  PF={trade_pf:.2f}  Sh={trade_sh:.2f}  {tag}"
        )

    # ═══ REPORT ══════════════════════════════════════════════════════════════
    ranked  = sorted([r for r in results if r.get("n_trades", 0) > 0],
                     key=lambda r: r["total_pnl"], reverse=True)
    elapsed = time.time() - t0

    print()
    print("=" * 90)
    text = write_report(results, ranked, elapsed)

    # Print summary table
    print()
    for line in text.split("\n")[:80]:
        print(line)

    print()
    print(f"  Report written → {OUTPUT_FILE}")
    print("=" * 90)


if __name__ == "__main__":
    main()

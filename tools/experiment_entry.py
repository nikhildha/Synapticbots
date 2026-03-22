"""
tools/experiment_entry.py
═══════════════════════════════════════════════════════════════════════════════
Multi-Timeframe Entry Timing Experiment — 30 Configurations

Core idea (separation of concerns):
  DIRECTION TF  — higher timeframe(s) that determine *which way* to trade
                  4h or 4h+1h must agree → only then consider a trade
  ENTRY TF      — 15m bars scanned for *precise entry moment*
                  Various entry triggers tested: regime flip, VWAP reclaim,
                  RSI dip, BB squeeze, volume surge, liquidity vacuum, combos

Previous finding (experiment_multistrat):
  • Every 15m "enter on conviction" strategy lost money → fee drag at high leverage
  • Only winner: 1h sniper with 3-TF unanimous agreement
  • Root cause: entering mid-move with no timing → immediately chased, stopped out

What this experiment tests:
  Use 4h (or 4h+1h) to establish direction first, then wait for 15m to give a
  precise, low-risk entry point before pulling the trigger.

Direction modes:
  4h          — 4h regime alone determines BULL/BEAR
  1h          — 1h regime alone
  4h_1h       — both 4h AND 1h must agree (strongest filter)
  4h_soft     — 4h sets direction, 1h must not oppose (CHOP ok)
  4h_1h_15m   — all 3 TFs must align simultaneously (ultra-strict)

Entry triggers (all on 15m, features from previous bar to avoid look-ahead):
  immediate   — no timing filter, enter as soon as direction is set (baseline)
  flip        — 15m regime just flipped to match direction (fresh momentum)
  pullback    — 15m was matching, pulled back to CHOP, now re-confirmed (dip-buy)
  vwap        — price just crossed back to the favorable side of VWAP
  rsi_dip     — RSI was oversold (<40 for longs, >60 for shorts), now recovering
  vol_surge   — unusual volume (vol_zscore > 1.5) confirming direction
  bb_break    — BB was squeezing (low width), now expanding in direction
  liq_vac     — liquidity vacuum present (thin book, fast move expected)
  flip_vwap   — flip AND VWAP reclaim simultaneously (double condition)
  pullback_rsi— pullback re-entry AND RSI confirming recovery

Exit logic:
  Primary  : SL or TP hit (ATR-based)
  Secondary: Direction TF reverses (4h flips from BULL to BEAR — exit the trade)

Usage:
  python tools/experiment_entry.py
  python tools/experiment_entry.py --coins BTCUSDT ETHUSDT SOLUSDT AAVEUSDT
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
FEE_PER_LEG    = 0.0005
SLIP_PER_LEG   = 0.0005
ROUND_TRIP     = (FEE_PER_LEG + SLIP_PER_LEG) * 2
CAPITAL        = config.CAPITAL_PER_TRADE    # $100

TRAIN_BARS = {
    "4h":  TRAIN_DAYS * 6,
    "1h":  TRAIN_DAYS * 24,
    "15m": min(TRAIN_DAYS * 96, config.MULTI_TF_CANDLE_LIMIT),
}

OUTPUT_FILE = os.path.join(ROOT, "tools", "experiment_entry_results.txt")

# ─── Test coins ───────────────────────────────────────────────────────────────
DEFAULT_TEST_COINS = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT",   # L1
    "ARBUSDT", "OPUSDT",                           # L2
    "UNIUSDT", "AAVEUSDT",                         # DeFi
    "TAOUSDT", "FETUSDT",                          # AI
    "DOGEUSDT",                                    # Meme (1 representative)
    "GALAUSDT",                                    # Gaming (1 representative)
    "ARUSDT",                                      # DePIN (1 representative)
]

COIN_SEG = {
    "BTCUSDT":"L1","ETHUSDT":"L1","SOLUSDT":"L1","ADAUSDT":"L1",
    "ARBUSDT":"L2","OPUSDT":"L2",
    "UNIUSDT":"DeFi","AAVEUSDT":"DeFi",
    "TAOUSDT":"AI","FETUSDT":"AI",
    "DOGEUSDT":"Meme","GALAUSDT":"Gaming","ARUSDT":"DePIN",
}

SEG_SETS = {
    "all":      ["L1","L2","DeFi","AI","Meme","Gaming","DePIN"],
    "quality":  ["L1","L2","DeFi","AI"],
    "core":     ["L1","L2","DeFi","AI"],
    "bluechip": ["L1","DeFi"],
    "l1_only":  ["L1"],
}

# ─── Experiment configurations ────────────────────────────────────────────────
#
# dir           : which TFs determine direction
# entry         : 15m entry timing trigger
# min_dir_margin: minimum HMM margin on direction TF (filters weak signals)
# sl / tp       : ATR multipliers for stop-loss / take-profit
# max_lev       : leverage cap
# segs          : universe filter

EXPERIMENTS = [

    # ══ A: 4h+1h Direction, All Entry Types ══════════════════════════════════
    # Baseline: immediate entry on direction signal (no timing filter)
    {"id":  1, "group":"A-4h1h-Entry", "label":"Direction:4h+1h  Entry:Immediate (baseline)",
     "dir":"4h_1h",     "entry":"immediate",    "min_dir_margin":0.05,
     "segs":"quality",  "sl":1.5, "tp":3.0, "max_lev":25},

    # Fresh 15m regime flip: 15m just turned BULL/BEAR matching direction
    {"id":  2, "group":"A-4h1h-Entry", "label":"Direction:4h+1h  Entry:15m Regime Flip",
     "dir":"4h_1h",     "entry":"flip",         "min_dir_margin":0.05,
     "segs":"quality",  "sl":1.5, "tp":3.0, "max_lev":25},

    # Pullback re-entry: 15m confirmed → CHOP (pullback) → re-confirms direction
    {"id":  3, "group":"A-4h1h-Entry", "label":"Direction:4h+1h  Entry:15m Pullback Re-entry",
     "dir":"4h_1h",     "entry":"pullback",     "min_dir_margin":0.05,
     "segs":"quality",  "sl":1.5, "tp":3.0, "max_lev":25},

    # VWAP reclaim: price crossed back to favorable VWAP side
    {"id":  4, "group":"A-4h1h-Entry", "label":"Direction:4h+1h  Entry:VWAP Reclaim",
     "dir":"4h_1h",     "entry":"vwap",         "min_dir_margin":0.05,
     "segs":"quality",  "sl":1.5, "tp":3.0, "max_lev":25},

    # RSI dip-recovery: RSI < 40 in uptrend (oversold dip), now recovering
    {"id":  5, "group":"A-4h1h-Entry", "label":"Direction:4h+1h  Entry:RSI Dip Recovery",
     "dir":"4h_1h",     "entry":"rsi_dip",      "min_dir_margin":0.05,
     "segs":"quality",  "sl":1.5, "tp":3.0, "max_lev":25},

    # Volume surge: vol_zscore > 1.5 confirming direction
    {"id":  6, "group":"A-4h1h-Entry", "label":"Direction:4h+1h  Entry:Volume Surge",
     "dir":"4h_1h",     "entry":"vol_surge",    "min_dir_margin":0.05,
     "segs":"quality",  "sl":1.5, "tp":3.0, "max_lev":25},

    # BB squeeze breakout: bands contracted, now expanding in direction
    {"id":  7, "group":"A-4h1h-Entry", "label":"Direction:4h+1h  Entry:BB Squeeze Breakout",
     "dir":"4h_1h",     "entry":"bb_break",     "min_dir_margin":0.05,
     "segs":"quality",  "sl":1.5, "tp":3.0, "max_lev":25},

    # Liquidity vacuum: thin order book → price will move fast
    {"id":  8, "group":"A-4h1h-Entry", "label":"Direction:4h+1h  Entry:Liquidity Vacuum",
     "dir":"4h_1h",     "entry":"liq_vac",      "min_dir_margin":0.05,
     "segs":"quality",  "sl":1.5, "tp":3.0, "max_lev":25},

    # Flip + VWAP: regime flip AND price above VWAP simultaneously
    {"id":  9, "group":"A-4h1h-Entry", "label":"Direction:4h+1h  Entry:Flip + VWAP Combo",
     "dir":"4h_1h",     "entry":"flip_vwap",    "min_dir_margin":0.05,
     "segs":"quality",  "sl":1.5, "tp":3.0, "max_lev":25},

    # Pullback + RSI: pullback pattern AND RSI confirming oversold recovery
    {"id": 10, "group":"A-4h1h-Entry", "label":"Direction:4h+1h  Entry:Pullback + RSI Combo",
     "dir":"4h_1h",     "entry":"pullback_rsi", "min_dir_margin":0.05,
     "segs":"quality",  "sl":1.5, "tp":3.0, "max_lev":25},

    # ══ B: 4h Direction Only (macro), Various Entry Types ════════════════════
    {"id": 11, "group":"B-4h-Entry", "label":"Direction:4h Only  Entry:Immediate",
     "dir":"4h",        "entry":"immediate",    "min_dir_margin":0.05,
     "segs":"quality",  "sl":2.0, "tp":4.0, "max_lev":20},

    {"id": 12, "group":"B-4h-Entry", "label":"Direction:4h Only  Entry:15m Regime Flip",
     "dir":"4h",        "entry":"flip",         "min_dir_margin":0.05,
     "segs":"quality",  "sl":2.0, "tp":4.0, "max_lev":20},

    {"id": 13, "group":"B-4h-Entry", "label":"Direction:4h Only  Entry:VWAP Reclaim",
     "dir":"4h",        "entry":"vwap",         "min_dir_margin":0.05,
     "segs":"quality",  "sl":2.0, "tp":4.0, "max_lev":20},

    {"id": 14, "group":"B-4h-Entry", "label":"Direction:4h Only  Entry:RSI Dip",
     "dir":"4h",        "entry":"rsi_dip",      "min_dir_margin":0.05,
     "segs":"quality",  "sl":2.0, "tp":4.0, "max_lev":20},

    {"id": 15, "group":"B-4h-Entry", "label":"Direction:4h Only  Entry:Pullback",
     "dir":"4h",        "entry":"pullback",     "min_dir_margin":0.05,
     "segs":"quality",  "sl":2.0, "tp":4.0, "max_lev":20},

    # ══ C: 1h Direction Only (swing), Various Entry Types ════════════════════
    {"id": 16, "group":"C-1h-Entry", "label":"Direction:1h Only  Entry:Immediate",
     "dir":"1h",        "entry":"immediate",    "min_dir_margin":0.05,
     "segs":"quality",  "sl":1.5, "tp":3.0, "max_lev":25},

    {"id": 17, "group":"C-1h-Entry", "label":"Direction:1h Only  Entry:15m Regime Flip",
     "dir":"1h",        "entry":"flip",         "min_dir_margin":0.05,
     "segs":"quality",  "sl":1.5, "tp":3.0, "max_lev":25},

    {"id": 18, "group":"C-1h-Entry", "label":"Direction:1h Only  Entry:VWAP Reclaim",
     "dir":"1h",        "entry":"vwap",         "min_dir_margin":0.05,
     "segs":"quality",  "sl":1.5, "tp":3.0, "max_lev":25},

    {"id": 19, "group":"C-1h-Entry", "label":"Direction:1h Only  Entry:RSI Dip",
     "dir":"1h",        "entry":"rsi_dip",      "min_dir_margin":0.05,
     "segs":"quality",  "sl":1.5, "tp":3.0, "max_lev":25},

    {"id": 20, "group":"C-1h-Entry", "label":"Direction:1h Only  Entry:Pullback",
     "dir":"1h",        "entry":"pullback",     "min_dir_margin":0.05,
     "segs":"quality",  "sl":1.5, "tp":3.0, "max_lev":25},

    # ══ D: SL/TP Variations on best direction + entry combos ══════════════════
    {"id": 21, "group":"D-RiskMgmt", "label":"4h+1h + Flip  SL=1×ATR  TP=2×ATR (tight)",
     "dir":"4h_1h",     "entry":"flip",         "min_dir_margin":0.05,
     "segs":"quality",  "sl":1.0, "tp":2.0, "max_lev":25},

    {"id": 22, "group":"D-RiskMgmt", "label":"4h+1h + Flip  SL=1.5×ATR  TP=4.5×ATR (1:3)",
     "dir":"4h_1h",     "entry":"flip",         "min_dir_margin":0.05,
     "segs":"quality",  "sl":1.5, "tp":4.5, "max_lev":25},

    {"id": 23, "group":"D-RiskMgmt", "label":"4h+1h + Flip  SL=2×ATR  TP=6×ATR (1:3 wide)",
     "dir":"4h_1h",     "entry":"flip",         "min_dir_margin":0.05,
     "segs":"quality",  "sl":2.0, "tp":6.0, "max_lev":25},

    {"id": 24, "group":"D-RiskMgmt", "label":"4h+1h + VWAP  SL=1×ATR  TP=2×ATR (tight)",
     "dir":"4h_1h",     "entry":"vwap",         "min_dir_margin":0.05,
     "segs":"quality",  "sl":1.0, "tp":2.0, "max_lev":25},

    {"id": 25, "group":"D-RiskMgmt", "label":"4h+1h + VWAP  SL=2×ATR  TP=6×ATR (wide)",
     "dir":"4h_1h",     "entry":"vwap",         "min_dir_margin":0.05,
     "segs":"quality",  "sl":2.0, "tp":6.0, "max_lev":25},

    # ══ E: Direction Confidence + Universe Filters ════════════════════════════
    # High-margin filter: only enter when HMM is very sure about direction
    {"id": 26, "group":"E-Confidence", "label":"4h+1h + Flip  HighConf dir margin>0.15",
     "dir":"4h_1h",     "entry":"flip",         "min_dir_margin":0.15,
     "segs":"quality",  "sl":1.5, "tp":3.0, "max_lev":25},

    {"id": 27, "group":"E-Confidence", "label":"4h+1h + Pullback  HighConf dir margin>0.15",
     "dir":"4h_1h",     "entry":"pullback",     "min_dir_margin":0.15,
     "segs":"quality",  "sl":1.5, "tp":3.0, "max_lev":25},

    # 4h soft: 4h sets direction, 1h just must not oppose
    {"id": 28, "group":"E-Confidence", "label":"Direction:4h Soft (1h neutral ok) + Flip",
     "dir":"4h_soft",   "entry":"flip",         "min_dir_margin":0.05,
     "segs":"quality",  "sl":1.5, "tp":3.0, "max_lev":25},

    # Triple alignment: ALL 3 TFs must be BULL/BEAR simultaneously
    {"id": 29, "group":"E-Confidence", "label":"Direction:ALL 3 TFs Aligned + Immediate",
     "dir":"4h_1h_15m", "entry":"immediate",    "min_dir_margin":0.05,
     "segs":"quality",  "sl":1.5, "tp":3.0, "max_lev":25},

    # Best bluechip combo: 4h+1h direction, pullback entry, wide TP, low leverage
    {"id": 30, "group":"E-Confidence", "label":"4h+1h + Pullback  Bluechip  Wide TP (2×/6×)",
     "dir":"4h_1h",     "entry":"pullback",     "min_dir_margin":0.05,
     "segs":"bluechip", "sl":2.0, "tp":6.0, "max_lev":20},
]

assert len(EXPERIMENTS) == 30

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


# ─── Regime / feature lookup at timestamp ─────────────────────────────────────

def _regime_at(pred_dict, df_tf, ts):
    idx = int(np.searchsorted(df_tf["timestamp"].values, np.datetime64(ts), side="right")) - 1
    if idx < 0:
        return config.REGIME_CHOP, 0.0
    return int(pred_dict["regime"][idx]), float(pred_dict["margin"][idx])


def _atr_at(dfs, ts):
    """ATR from 1h TF (standard reference)."""
    df = dfs["1h"]
    idx = int(np.searchsorted(df["timestamp"].values, np.datetime64(ts), side="right")) - 1
    if idx < 0 or "atr" not in df.columns:
        return None
    v = float(df["atr"].iloc[idx])
    return v if (v > 0 and not np.isnan(v)) else None


# ─── Direction functions ───────────────────────────────────────────────────────
# Return (side: "BUY"/"SELL"/None, avg_margin: float)
# min_margin check applied by caller

def _dir_4h(p4h, m4h, p1h, m1h, p15m, m15m):
    if p4h == config.REGIME_BULL:  return "BUY",  m4h
    if p4h == config.REGIME_BEAR:  return "SELL", m4h
    return None, 0.0

def _dir_1h(p4h, m4h, p1h, m1h, p15m, m15m):
    if p1h == config.REGIME_BULL:  return "BUY",  m1h
    if p1h == config.REGIME_BEAR:  return "SELL", m1h
    return None, 0.0

def _dir_4h_1h(p4h, m4h, p1h, m1h, p15m, m15m):
    """Both 4h AND 1h must agree."""
    if p4h == config.REGIME_BULL and p1h == config.REGIME_BULL:
        return "BUY",  (m4h + m1h) / 2
    if p4h == config.REGIME_BEAR and p1h == config.REGIME_BEAR:
        return "SELL", (m4h + m1h) / 2
    return None, 0.0

def _dir_4h_soft(p4h, m4h, p1h, m1h, p15m, m15m):
    """4h sets direction; 1h must not oppose (CHOP is fine)."""
    if p4h == config.REGIME_BULL and p1h != config.REGIME_BEAR:
        return "BUY",  m4h
    if p4h == config.REGIME_BEAR and p1h != config.REGIME_BULL:
        return "SELL", m4h
    return None, 0.0

def _dir_4h_1h_15m(p4h, m4h, p1h, m1h, p15m, m15m):
    """All 3 TFs must agree (ultra-strict)."""
    if p4h == config.REGIME_BULL == p1h == p15m:
        return "BUY",  (m4h + m1h + m15m) / 3
    if p4h == config.REGIME_BEAR == p1h == p15m:
        return "SELL", (m4h + m1h + m15m) / 3
    return None, 0.0

DIRECTION_FNS = {
    "4h":       _dir_4h,
    "1h":       _dir_1h,
    "4h_1h":    _dir_4h_1h,
    "4h_soft":  _dir_4h_soft,
    "4h_1h_15m":_dir_4h_1h_15m,
}


# ─── Entry trigger functions ───────────────────────────────────────────────────
# Receive: (df_15m, bar_index i, pred_15m, direction)
# Use features from bar i-1 to avoid look-ahead on the entry bar
# Return: True (enter at bar i open) / False (wait)

def _entry_immediate(df, i, pred15m, side):
    return True   # no timing filter — baseline

def _entry_flip(df, i, pred15m, side):
    """15m regime just flipped to match direction."""
    if i < 1:
        return False
    curr = pred15m["regime"][i]
    prev = pred15m["regime"][i - 1]
    if side == "BUY":
        return curr == config.REGIME_BULL and prev != config.REGIME_BULL
    return curr == config.REGIME_BEAR and prev != config.REGIME_BEAR

def _entry_pullback(df, i, pred15m, side):
    """15m confirmed direction → pulled back to CHOP → re-confirmed (dip-buy pattern)."""
    if i < 2:
        return False
    c0 = pred15m["regime"][i]     # current: back to direction
    c1 = pred15m["regime"][i - 1] # previous: CHOP (the pullback)
    c2 = pred15m["regime"][i - 2] # two bars ago: was in direction
    if side == "BUY":
        return (c0 == config.REGIME_BULL
                and c1 == config.REGIME_CHOP
                and c2 == config.REGIME_BULL)
    return (c0 == config.REGIME_BEAR
            and c1 == config.REGIME_CHOP
            and c2 == config.REGIME_BEAR)

def _entry_vwap(df, i, pred15m, side):
    """Price just crossed to favorable side of VWAP (use bar i-1 values)."""
    if i < 1 or "vwap_dist" not in df.columns:
        return False
    curr_vd = float(df["vwap_dist"].iloc[i - 1])   # feature from previous bar
    if i < 2:
        return False
    prev_vd = float(df["vwap_dist"].iloc[i - 2])
    if side == "BUY":
        return curr_vd > 0 and prev_vd <= 0    # just crossed above VWAP
    return curr_vd < 0 and prev_vd >= 0         # just crossed below VWAP

def _entry_rsi_dip(df, i, pred15m, side, rsi_long=40, rsi_short=60):
    """RSI was in extreme zone, now recovering back through threshold."""
    if i < 1 or "rsi" not in df.columns:
        return False
    curr_rsi = float(df["rsi"].iloc[i - 1])
    if i < 2:
        return False
    prev_rsi = float(df["rsi"].iloc[i - 2])
    if side == "BUY":
        return curr_rsi > rsi_long and prev_rsi <= rsi_long    # just recovered from oversold
    return curr_rsi < rsi_short and prev_rsi >= rsi_short       # just recovered from overbought

def _entry_vol_surge(df, i, pred15m, side, thresh=1.5):
    """Unusual volume in direction of trade (vol_zscore > thresh)."""
    if i < 1 or "vol_zscore" not in df.columns:
        return False
    vz   = float(df["vol_zscore"].iloc[i - 1])
    reg  = pred15m["regime"][i - 1]
    if side == "BUY":
        return vz > thresh and reg == config.REGIME_BULL
    return vz > thresh and reg == config.REGIME_BEAR

def _entry_bb_break(df, i, pred15m, side, squeeze_thresh=0.3, lookback=4):
    """BB was squeezing (low bb_width_norm), now expanding in direction."""
    if i < lookback or "bb_width_norm" not in df.columns:
        return False
    curr_bb = float(df["bb_width_norm"].iloc[i - 1])
    prev_bbs = [float(df["bb_width_norm"].iloc[i - 1 - j]) for j in range(1, lookback)]
    was_squeezing = all(b < squeeze_thresh for b in prev_bbs)
    is_expanding  = curr_bb > max(prev_bbs) * 1.1   # at least 10% wider than recent max
    reg = pred15m["regime"][i - 1]
    if side == "BUY":
        return was_squeezing and is_expanding and reg == config.REGIME_BULL
    return was_squeezing and is_expanding and reg == config.REGIME_BEAR

def _entry_liq_vac(df, i, pred15m, side, lv_thresh=0.5):
    """Liquidity vacuum present — thin order book, fast move expected."""
    if i < 1 or "liquidity_vacuum" not in df.columns:
        return False
    lv  = float(df["liquidity_vacuum"].iloc[i - 1])
    reg = pred15m["regime"][i - 1]
    if side == "BUY":
        return lv > lv_thresh and reg == config.REGIME_BULL
    return lv > lv_thresh and reg == config.REGIME_BEAR

def _entry_flip_and_vwap(df, i, pred15m, side):
    """Regime flip AND VWAP reclaim simultaneously."""
    return _entry_flip(df, i, pred15m, side) and _entry_vwap(df, i, pred15m, side)

def _entry_pullback_and_rsi(df, i, pred15m, side):
    """Pullback pattern AND RSI confirming oversold recovery."""
    return _entry_pullback(df, i, pred15m, side) and _entry_rsi_dip(df, i, pred15m, side)

ENTRY_FNS = {
    "immediate":    _entry_immediate,
    "flip":         _entry_flip,
    "pullback":     _entry_pullback,
    "vwap":         _entry_vwap,
    "rsi_dip":      _entry_rsi_dip,
    "vol_surge":    _entry_vol_surge,
    "bb_break":     _entry_bb_break,
    "liq_vac":      _entry_liq_vac,
    "flip_vwap":    _entry_flip_and_vwap,
    "pullback_rsi": _entry_pullback_and_rsi,
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
    tp_mult      = exp["tp"]
    max_lev      = exp["max_lev"]

    ts_15m = df_15m["timestamp"].values
    test_arr = np.where(ts_15m >= np.datetime64(test_start))[0]
    if not len(test_arr):
        return None
    test_idx = int(test_arr[0])

    trades     = []
    open_trade = None   # (side, entry, sl, tp, lev, entry_ts)
    last_dir   = None   # track direction for reversal exits

    for i in range(test_idx, len(df_15m)):
        row   = df_15m.iloc[i]
        ts    = row["timestamp"]
        open_ = float(row["open"])
        high  = float(row["high"])
        low   = float(row["low"])
        close = float(row["close"])

        # ── Get current regimes from all 3 TFs ───────────────────────────────
        p4h,  m4h  = _regime_at(preds["4h"],  dfs["4h"],  ts)
        p1h,  m1h  = _regime_at(preds["1h"],  dfs["1h"],  ts)
        p15m, m15m = pred_15m["regime"][i], pred_15m["margin"][i]

        # ── Determine direction ───────────────────────────────────────────────
        direction, dir_margin = dir_fn(p4h, m4h, p1h, m1h, p15m, m15m)
        if direction is not None and float(dir_margin) < min_margin:
            direction = None   # weak HMM confidence — ignore

        # ── Exit logic ───────────────────────────────────────────────────────
        if open_trade is not None:
            ot_side, ot_entry, ot_sl, ot_tp, ot_lev, ot_ts = open_trade
            d  = 1 if ot_side == "BUY" else -1
            ep = None
            er = None

            if d == 1:
                if low  <= ot_sl:  ep, er = ot_sl, "SL"
                elif high >= ot_tp: ep, er = ot_tp, "TP"
            else:
                if high >= ot_sl:  ep, er = ot_sl, "SL"
                elif low  <= ot_tp: ep, er = ot_tp, "TP"

            # Direction reversal exit: direction TF flipped against us
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
            # Check entry trigger condition
            if entry_fn(df_15m, i, pred_15m, direction):
                atr = _atr_at(dfs, ts)
                if atr is None:
                    atr = close * 0.01
                vol_ratio = atr / close if close > 0 else 0
                if vol_ratio < config.VOL_MIN_ATR_PCT or vol_ratio > config.VOL_MAX_ATR_PCT:
                    continue

                # Conviction-based leverage (capped at max_lev)
                # Use dir_margin as proxy for signal strength
                if   dir_margin >= 0.30: lev = min(25, max_lev)
                elif dir_margin >= 0.20: lev = min(20, max_lev)
                elif dir_margin >= 0.10: lev = min(15, max_lev)
                else:                    lev = min(10, max_lev)

                if direction == "BUY":
                    sl = open_ - sl_mult * atr
                    tp = open_ + tp_mult * atr
                else:
                    sl = open_ + sl_mult * atr
                    tp = open_ - tp_mult * atr

                open_trade = (direction, open_, sl, tp, lev, ts)

    # Close any open trade at end
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


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--coins", nargs="+")
    args = parser.parse_args()
    test_coins = args.coins or DEFAULT_TEST_COINS

    print("=" * 90)
    print("  Synaptic Quant Lab — Multi-TF Entry Timing Experiment (30 configs)")
    print(f"  Concept : Higher TF = direction  |  15m = precise entry timing")
    print(f"  Test coins: {len(test_coins)}   |  Test window: {TEST_MONTHS} months walk-forward")
    print("=" * 90)
    print()

    # ═══ Phase 1 ═════════════════════════════════════════════════════════════
    print("━━━ Phase 1 — Pre-computing HMM regime predictions ━━━")
    caches = {}
    for i, sym in enumerate(test_coins, 1):
        print(f"  [{i:2d}/{len(test_coins)}] {sym:14s} ...", end=" ", flush=True)
        c = precompute_coin(sym)
        if c is None:
            print("SKIP")
            continue
        caches[sym] = c
        seg = COIN_SEG.get(sym, "?")
        print(f"OK [{seg:7s}]  4h={len(c['dfs']['4h']):4d}  1h={len(c['dfs']['1h']):5d}  15m={len(c['dfs']['15m']):6d}")

    print(f"\n  Precomputed {len(caches)}/{len(test_coins)} coins\n")

    # ═══ Phase 2 ═════════════════════════════════════════════════════════════
    print("━━━ Phase 2 — Simulating 30 experiments ━━━")
    print()

    results = []
    for exp in EXPERIMENTS:
        allowed  = SEG_SETS[exp["segs"]]
        eligible = [s for s in caches if COIN_SEG.get(s, "?") in allowed]

        coin_stats = []
        for sym in eligible:
            st = simulate_trades(caches[sym], exp)
            if st:
                coin_stats.append({"sym": sym, **st})

        if not coin_stats:
            print(f"  #{exp['id']:2d} {exp['label'][:55]:55s} NO TRADES")
            results.append({**exp, "n_coins":0, "n_trades":0, "total_pnl":0,
                             "trade_wr":0, "coin_wr":0, "pf":0, "sharpe":0,
                             "max_dd":0, "avg_lev":0, "tpc":0, "coin_stats":[]})
            continue

        # Trade-level aggregates
        all_trade_pnls = []
        all_exits      = defaultdict(int)
        for c in coin_stats:
            all_trade_pnls.extend([t["pnl"] for t in c["trades"]])
            for reason, cnt in c["exits"].items():
                all_exits[reason] += cnt

        tp_arr  = np.array(all_trade_pnls)
        t_wins  = tp_arr[tp_arr > 0]
        t_loss  = tp_arr[tp_arr <= 0]
        trade_wr = round(len(t_wins) / len(tp_arr) * 100, 1) if len(tp_arr) else 0
        trade_pf = round(float(t_wins.sum()) / abs(float(t_loss.sum())), 3) if len(t_loss) and t_loss.sum() != 0 else 999.0
        trade_sh = round(float(tp_arr.mean() / tp_arr.std() * np.sqrt(len(tp_arr))), 3) if tp_arr.std() > 1e-5 else 0.0

        # Coin-level aggregates
        cp_arr = np.array([c["total_pnl"] for c in coin_stats])
        c_wins = cp_arr[cp_arr > 0]
        c_loss = cp_arr[cp_arr <= 0]
        coin_wr = round(len(c_wins) / len(cp_arr) * 100, 1)
        total_pnl = round(float(cp_arr.sum()), 2)
        n_trades  = sum(c["n_trades"] for c in coin_stats)
        tpc       = round(n_trades / len(coin_stats), 0)
        avg_lev   = round(np.mean([c["avg_lev"] for c in coin_stats]), 1)
        max_dd    = sum(c["max_dd"] for c in coin_stats)

        r = {**exp,
             "n_coins": len(coin_stats), "n_trades": n_trades, "tpc": tpc,
             "total_pnl": total_pnl,
             "trade_wr": trade_wr, "coin_wr": coin_wr,
             "trade_pf": trade_pf, "trade_sh": trade_sh,
             "max_dd": round(max_dd, 2), "avg_lev": avg_lev,
             "exits": dict(all_exits), "coin_stats": coin_stats}
        results.append(r)

        profitable = "★ PROFIT" if total_pnl > 0 else ""
        print(
            f"  #{exp['id']:2d} [{exp['group']:14s}] {exp['entry']:12s} "
            f"dir={exp['dir']:10s}  coins={len(coin_stats):2d}  "
            f"trades={n_trades:5d}({tpc:4.0f}/c)  "
            f"PnL=${total_pnl:+9.2f}  "
            f"T_WR={trade_wr:5.1f}%  PF={trade_pf:.2f}  Sh={trade_sh:.2f}  {profitable}"
        )

    # ═══ REPORT ══════════════════════════════════════════════════════════════
    ranked = sorted([r for r in results if r.get("n_trades", 0) > 0],
                    key=lambda r: r["total_pnl"], reverse=True)

    lines = []
    def log(s=""):
        lines.append(s)
        print(s)

    print()
    log("=" * 120)
    log("  SYNAPTIC QUANT LAB — MULTI-TF ENTRY TIMING EXPERIMENT RESULTS")
    log(f"  Direction TF separates trend from entry — 15m for precise entry timing")
    log(f"  Period: {TEST_MONTHS}-month walk-forward  |  Coins: {', '.join(caches.keys())}")
    log(f"  Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    log("=" * 120)

    # ── Full ranked table ─────────────────────────────────────────────────────
    log()
    log("  RANKED BY TOTAL PnL")
    log(f"  {'Rk':>3}  {'#':>2}  {'Group':15s}  {'Label':50s}  "
        f"{'Dir':10s}  {'Ent':12s}  {'Mm':>4}  {'SL/TP':>7}  {'Lev':>3}  "
        f"{'Cn':>3}  {'Trd':>5}  {'T/c':>4}  "
        f"{'PnL':>10}  {'TWR':>5}  {'TPF':>5}  {'TSh':>5}  {'MDD':>8}")
    log("  " + "─" * 116)

    for rank, r in enumerate(ranked, 1):
        star = " ★" if r["total_pnl"] > 0 else ""
        log(
            f"  {rank:>3}  {r['id']:>2}  {r['group']:15s}  {r['label'][:50]:50s}  "
            f"{r['dir']:10s}  {r['entry']:12s}  {r['min_dir_margin']:>4.2f}  "
            f"{r['sl']:.1f}/{r['tp']:.1f}  {r['max_lev']:>3}  "
            f"{r['n_coins']:>3}  {r['n_trades']:>5}  {r['tpc']:>4.0f}  "
            f"${r['total_pnl']:>9.2f}  {r.get('trade_wr',0):>4.1f}%  "
            f"{r.get('trade_pf',0):>5.2f}  {r.get('trade_sh',0):>5.2f}  "
            f"${r['max_dd']:>7.0f}{star}"
        )

    # ── Group summary ─────────────────────────────────────────────────────────
    log()
    log("=" * 100)
    log("  GROUP AVERAGES")
    log("=" * 100)
    groups = defaultdict(list)
    for r in results:
        if r.get("n_trades", 0) > 0:
            groups[r["group"]].append(r)

    for grp in sorted(groups.keys()):
        items = groups[grp]
        best  = max(items, key=lambda x: x["total_pnl"])
        log(f"  {grp:16s}  n={len(items)}  "
            f"avgPnL=${np.mean([r['total_pnl'] for r in items]):+9.2f}  "
            f"avgTWR={np.mean([r.get('trade_wr',0) for r in items]):.1f}%  "
            f"avgPF={np.mean([r.get('trade_pf',0) for r in items if r.get('trade_pf',0)<100]):.2f}  "
            f"avgSh={np.mean([r.get('trade_sh',0) for r in items]):.3f}  "
            f"avgTrades={np.mean([r['n_trades'] for r in items]):.0f}  "
            f"best=#{best['id']} ${best['total_pnl']:+.2f}")

    # ── Entry type analysis ───────────────────────────────────────────────────
    log()
    log("=" * 100)
    log("  ENTRY TYPE ANALYSIS (avg across all direction modes)")
    log("=" * 100)
    entries = defaultdict(list)
    for r in results:
        if r.get("n_trades", 0) > 0:
            entries[r["entry"]].append(r)

    for etype in sorted(entries.keys()):
        items = entries[etype]
        best  = max(items, key=lambda x: x["total_pnl"])
        log(f"  {etype:14s}  n={len(items)}  "
            f"avgPnL=${np.mean([r['total_pnl'] for r in items]):+9.2f}  "
            f"avgTWR={np.mean([r.get('trade_wr',0) for r in items]):.1f}%  "
            f"avgTrades={np.mean([r['n_trades'] for r in items]):.0f}  "
            f"best=#{best['id']} ${best['total_pnl']:+.2f}")

    # ── Direction mode analysis ───────────────────────────────────────────────
    log()
    log("=" * 100)
    log("  DIRECTION MODE ANALYSIS")
    log("=" * 100)
    dirs = defaultdict(list)
    for r in results:
        if r.get("n_trades", 0) > 0:
            dirs[r["dir"]].append(r)

    for dmode in sorted(dirs.keys()):
        items = dirs[dmode]
        best  = max(items, key=lambda x: x["total_pnl"])
        log(f"  {dmode:12s}  n={len(items)}  "
            f"avgPnL=${np.mean([r['total_pnl'] for r in items]):+9.2f}  "
            f"avgTWR={np.mean([r.get('trade_wr',0) for r in items]):.1f}%  "
            f"avgTrades={np.mean([r['n_trades'] for r in items]):.0f}  "
            f"best=#{best['id']} ${best['total_pnl']:+.2f}")

    # ── Exit reason breakdown (all experiments combined) ──────────────────────
    log()
    log("=" * 100)
    log("  EXIT REASON BREAKDOWN (all experiments combined)")
    log("=" * 100)
    all_exits = defaultdict(int)
    for r in results:
        for reason, cnt in r.get("exits", {}).items():
            all_exits[reason] += cnt
    total_exit = sum(all_exits.values())
    for reason, cnt in sorted(all_exits.items(), key=lambda x: -x[1]):
        log(f"  {reason:12s}  {cnt:6d}  ({cnt/total_exit*100:.1f}%)")

    # ── Per-coin breakdown for best experiment ────────────────────────────────
    best_exp = ranked[0] if ranked else None
    if best_exp and best_exp.get("coin_stats"):
        log()
        log("=" * 100)
        log(f"  PER-COIN BREAKDOWN — Best Experiment #{best_exp['id']}: {best_exp['label']}")
        log("=" * 100)
        for c in sorted(best_exp["coin_stats"], key=lambda x: -x["total_pnl"]):
            seg  = COIN_SEG.get(c["sym"], "?")
            flag = " ★ BEST" if c["total_pnl"] > 20 else (" ✗ DRAG" if c["total_pnl"] < -20 else "")
            log(f"  {c['sym']:12s} [{seg:7s}]  PnL=${c['total_pnl']:+8.2f}  "
                f"trades={c['n_trades']:4d}  WR={c['win_rate']:5.1f}%  "
                f"PF={c['pf']:.2f}  Sharpe={c['sharpe']:.2f}  "
                f"exits={c['exits']}{flag}")

    # ── Top 5 recommendations ─────────────────────────────────────────────────
    log()
    log("=" * 100)
    log("  TOP 5 CONFIGURATIONS — Entry Timing Recommendations")
    log("=" * 100)
    for rank, r in enumerate(ranked[:5], 1):
        log(f"\n  #{rank}  Exp {r['id']} — {r['label']}")
        log(f"      Direction : {r['dir']}  |  Entry trigger : {r['entry']}  "
            f"|  Min dir margin : {r['min_dir_margin']}")
        log(f"      Universe  : {r['segs']}  |  SL={r['sl']}×ATR  TP={r['tp']}×ATR  "
            f"|  Max lev: {r['max_lev']}x (avg {r['avg_lev']}x)")
        log(f"      PnL       : ${r['total_pnl']:+.2f}  "
            f"|  Trade WR: {r.get('trade_wr',0):.1f}%  "
            f"|  PF: {r.get('trade_pf',0):.2f}  "
            f"|  Sharpe: {r.get('trade_sh',0):.3f}")
        log(f"      Trades    : {r['n_trades']} total  ({r['tpc']:.0f}/coin)  "
            f"|  Exit breakdown: {r.get('exits', {})}")

    log()
    log("=" * 120)

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"\n  Report written → {OUTPUT_FILE}\n")


if __name__ == "__main__":
    main()

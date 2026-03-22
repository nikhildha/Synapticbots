"""
tools/experiment_multistrat.py
═══════════════════════════════════════════════════════════════════════════════
50-Config Multi-Strategy Experiment
Quant Research: Universe × Conviction × Agreement × TF Weights × Execution TF
               × SL/TP Multiplier × Leverage × Strategy Archetype

Strategy archetypes tested:
  Scalp    — 15m execution, tight SL/TP (0.5–0.8× ATR), 35x leverage
             Fast in/out, high frequency, momentum-responsive
  Sniper   — 15m or 1h execution, unanimous 3-TF agreement, conv≥75+
             Few but high-quality entries, let winners run
  Swing    — 1h execution, 1:2–1:4 R:R, moderate leverage
             Hold through noise, ride the directional move
  Position — 4h execution, macro-driven, low leverage (10–15x)
             Trend following on liquid L1 coins only
  Momentum — 15m/1h exec, 15m-heavy TF weights, catch breakout surges
  Volume   — quality coins, 1h-dominant weights, volume-responsive entries
  Combo    — synthesised best-of-breed from each group

Key hypotheses:
  H1 — Removing thin coins (Meme/Gaming/DePIN) improves signal quality
  H2 — Requiring 3-TF unanimous agreement reduces false signals
  H3 — Scalp strategies generate more trades but lower average PnL per trade
  H4 — Position strategies have high per-trade PnL but low trade count
  H5 — Momentum weights (15m dominant) outperform on trending markets
  H6 — Swing (1h exec) provides the best Sharpe of the three exec TFs
  H7 — Conviction ≥70 is the optimal threshold (filters noise, keeps flow)

Architecture
────────────
  Phase 1: Pre-compute (slow, run once per coin)
    • Fetch 4h + 1h + 15m OHLCV for 15 representative coins
    • Independent walk-forward HMM training per TF (retrain every 30 days)
    • Cache per-bar regime + margin arrays at each TF's native resolution
    • No cross-TF interpolation in precompute — done at simulation time

  Phase 2: Simulate (fast — uses cached predictions)
    • Walk through exec_tf bars in the 12-month test window
    • For each bar: timestamp-lookup regimes from all 3 TFs
    • Apply experiment-specific conviction / SL-TP / leverage parameters
    • Record trades and compute aggregate stats

Test coins (15 representative):
  L1      : BTCUSDT ETHUSDT SOLUSDT ADAUSDT
  L2      : ARBUSDT OPUSDT
  DeFi    : UNIUSDT AAVEUSDT
  AI      : TAOUSDT FETUSDT
  Meme    : DOGEUSDT BONKUSDT    ← expected drag
  Gaming  : GALAUSDT AXSUSDT     ← expected drag
  DePIN   : ARUSDT               ← expected drag

Usage:
  python tools/experiment_multistrat.py
  python tools/experiment_multistrat.py --coins BTCUSDT ETHUSDT SOLUSDT
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
from segment_features import get_features_for_coin, get_segment_for_coin

# ─── Global backtest settings ─────────────────────────────────────────────────
TEST_MONTHS   = 12    # 12 months covers a full bull+bear cycle
WARMUP_MONTHS = 3     # initial training warmup (data before test window)
TRAIN_DAYS    = 90    # rolling HMM training window
RETRAIN_DAYS  = 30    # calendar-based retrain interval

FEE_PER_LEG     = 0.0005                         # 0.05% commission
SLIP_PER_LEG    = 0.0005                         # 0.05% slippage
ROUND_TRIP_COST = (FEE_PER_LEG + SLIP_PER_LEG) * 2
CAPITAL         = config.CAPITAL_PER_TRADE       # $100 per trade

# Bars per training window per TF
TRAIN_BARS = {
    "4h":  TRAIN_DAYS * 6,                               # 540 bars
    "1h":  TRAIN_DAYS * 24,                              # 2 160 bars
    "15m": min(TRAIN_DAYS * 96, config.MULTI_TF_CANDLE_LIMIT),  # capped at 1000
}

# ATR source per execution TF (use one step above for cleaner signal)
ATR_SOURCE = {"15m": "1h", "1h": "1h", "4h": "4h"}

OUTPUT_FILE = os.path.join(ROOT, "tools", "experiment_multistrat_results.txt")

# ─── Test coin universe ───────────────────────────────────────────────────────
DEFAULT_TEST_COINS = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT",   # L1
    "ARBUSDT", "OPUSDT",                           # L2
    "UNIUSDT", "AAVEUSDT",                         # DeFi
    "TAOUSDT", "FETUSDT",                          # AI
    "DOGEUSDT", "BONKUSDT",                        # Meme
    "GALAUSDT", "AXSUSDT",                         # Gaming
    "ARUSDT",                                      # DePIN
]

COIN_SEG = {
    "BTCUSDT": "L1",  "ETHUSDT": "L1",   "SOLUSDT": "L1",  "ADAUSDT": "L1",
    "ARBUSDT": "L2",  "OPUSDT":  "L2",
    "UNIUSDT": "DeFi","AAVEUSDT": "DeFi",
    "TAOUSDT": "AI",  "FETUSDT":  "AI",
    "DOGEUSDT": "Meme","BONKUSDT": "Meme",
    "GALAUSDT": "Gaming","AXSUSDT": "Gaming",
    "ARUSDT":  "DePIN",
}

# ─── Segment universe sets ────────────────────────────────────────────────────
_ALL  = ["L1","L2","DeFi","AI","Meme","RWA","Gaming","DePIN","Modular","Oracles"]
_QUAL = [s for s in _ALL if s not in ("Meme","Gaming","DePIN")]
SEG_SETS = {
    "all":       _ALL,
    "no_meme":   [s for s in _ALL if s != "Meme"],
    "no_gaming": [s for s in _ALL if s != "Gaming"],
    "quality":   _QUAL,                            # L1+L2+DeFi+AI+RWA+Modular+Oracles
    "core":      ["L1","L2","DeFi","AI"],
    "bluechip":  ["L1","DeFi"],
    "l1_only":   ["L1"],
}

# ─── TF weight presets ────────────────────────────────────────────────────────
W_CURR  = {"4h":30, "1h":50, "15m":20}   # prod default
W_MACRO = {"4h":50, "1h":35, "15m":15}   # 4h dominates — macro trend
W_MOM   = {"4h":15, "1h":35, "15m":50}   # 15m dominates — momentum / scalp
W_EQUAL = {"4h":33, "1h":34, "15m":33}   # balanced contribution
W_4H    = {"4h":70, "1h":20, "15m":10}   # near 4h-only — position trading
W_VOL   = {"4h":20, "1h":50, "15m":30}   # 1h dominant, 15m volume-responsive

# ─── 50 Experiment configurations ────────────────────────────────────────────
#
# Field reference:
#   id        : experiment number
#   group     : strategy archetype (for group-level summary)
#   label     : human-readable description
#   segs      : universe key (maps to SEG_SETS)
#   exec_tf   : execution timeframe ("15m", "1h", "4h")
#   weights   : multi-TF conviction weights
#   min_conv  : minimum conviction to deploy (0–100)
#   min_agree : minimum TFs agreeing on direction (2 or 3)
#   sl_mult   : ATR multiplier for stop-loss
#   tp_mult   : ATR multiplier for take-profit
#   max_lev   : maximum leverage cap (conviction bands are also capped)

EXPERIMENTS = [

    # ══ A: UNIVERSE BASELINE (15m, current weights, std R:R) ════════════════
    {"id":  1, "group":"A-Universe", "label":"Baseline — all segs",
     "segs":"all",      "exec_tf":"15m","weights":W_CURR, "min_conv":65,"min_agree":2,"sl_mult":1.0,"tp_mult":2.0,"max_lev":35},
    {"id":  2, "group":"A-Universe", "label":"No Meme",
     "segs":"no_meme",  "exec_tf":"15m","weights":W_CURR, "min_conv":65,"min_agree":2,"sl_mult":1.0,"tp_mult":2.0,"max_lev":35},
    {"id":  3, "group":"A-Universe", "label":"No Gaming",
     "segs":"no_gaming","exec_tf":"15m","weights":W_CURR, "min_conv":65,"min_agree":2,"sl_mult":1.0,"tp_mult":2.0,"max_lev":35},
    {"id":  4, "group":"A-Universe", "label":"Quality (no Meme/Gaming/DePIN)",
     "segs":"quality",  "exec_tf":"15m","weights":W_CURR, "min_conv":65,"min_agree":2,"sl_mult":1.0,"tp_mult":2.0,"max_lev":35},
    {"id":  5, "group":"A-Universe", "label":"Core (L1+L2+DeFi+AI)",
     "segs":"core",     "exec_tf":"15m","weights":W_CURR, "min_conv":65,"min_agree":2,"sl_mult":1.0,"tp_mult":2.0,"max_lev":35},
    {"id":  6, "group":"A-Universe", "label":"Blue Chip (L1+DeFi)",
     "segs":"bluechip", "exec_tf":"15m","weights":W_CURR, "min_conv":65,"min_agree":2,"sl_mult":1.0,"tp_mult":2.0,"max_lev":35},
    {"id":  7, "group":"A-Universe", "label":"Quality + conv=70",
     "segs":"quality",  "exec_tf":"15m","weights":W_CURR, "min_conv":70,"min_agree":2,"sl_mult":1.0,"tp_mult":2.0,"max_lev":35},

    # ══ B: SCALP (15m exec, tight SL/TP, ride momentum) ════════════════════
    {"id":  8, "group":"B-Scalp", "label":"Scalp — tight (SL=0.5, TP=1.0)",
     "segs":"quality",  "exec_tf":"15m","weights":W_CURR, "min_conv":65,"min_agree":2,"sl_mult":0.5,"tp_mult":1.0,"max_lev":35},
    {"id":  9, "group":"B-Scalp", "label":"Scalp — standard (SL=0.8, TP=1.6)",
     "segs":"quality",  "exec_tf":"15m","weights":W_CURR, "min_conv":65,"min_agree":2,"sl_mult":0.8,"tp_mult":1.6,"max_lev":35},
    {"id": 10, "group":"B-Scalp", "label":"Scalp — wide TP (SL=0.5, TP=2.0)",
     "segs":"quality",  "exec_tf":"15m","weights":W_CURR, "min_conv":65,"min_agree":2,"sl_mult":0.5,"tp_mult":2.0,"max_lev":35},
    {"id": 11, "group":"B-Scalp", "label":"Scalp — high conv (tight, conv=75)",
     "segs":"quality",  "exec_tf":"15m","weights":W_CURR, "min_conv":75,"min_agree":2,"sl_mult":0.5,"tp_mult":1.0,"max_lev":35},
    {"id": 12, "group":"B-Scalp", "label":"Scalp — unanimous (agree=3, tight)",
     "segs":"quality",  "exec_tf":"15m","weights":W_CURR, "min_conv":75,"min_agree":3,"sl_mult":0.5,"tp_mult":1.0,"max_lev":35},
    {"id": 13, "group":"B-Scalp", "label":"Scalp — liquid only (bluechip)",
     "segs":"bluechip", "exec_tf":"15m","weights":W_CURR, "min_conv":65,"min_agree":2,"sl_mult":0.5,"tp_mult":1.0,"max_lev":35},
    {"id": 14, "group":"B-Scalp", "label":"Scalp — momentum weights",
     "segs":"quality",  "exec_tf":"15m","weights":W_MOM,  "min_conv":65,"min_agree":2,"sl_mult":0.5,"tp_mult":1.5,"max_lev":35},

    # ══ C: SNIPER (very selective, high precision, let winners run) ══════════
    {"id": 15, "group":"C-Sniper", "label":"Sniper — classic (agree=3, conv=75, std)",
     "segs":"quality",  "exec_tf":"15m","weights":W_CURR, "min_conv":75,"min_agree":3,"sl_mult":1.0,"tp_mult":2.0,"max_lev":35},
    {"id": 16, "group":"C-Sniper", "label":"Sniper — wide R:R 1:3 (agree=3, conv=75)",
     "segs":"quality",  "exec_tf":"15m","weights":W_CURR, "min_conv":75,"min_agree":3,"sl_mult":1.5,"tp_mult":4.5,"max_lev":35},
    {"id": 17, "group":"C-Sniper", "label":"Sniper — very high conv=80 (agree=3)",
     "segs":"quality",  "exec_tf":"15m","weights":W_CURR, "min_conv":80,"min_agree":3,"sl_mult":1.0,"tp_mult":2.0,"max_lev":35},
    {"id": 18, "group":"C-Sniper", "label":"Sniper — macro weights (agree=3, conv=75)",
     "segs":"quality",  "exec_tf":"15m","weights":W_MACRO,"min_conv":75,"min_agree":3,"sl_mult":1.5,"tp_mult":3.0,"max_lev":35},
    {"id": 19, "group":"C-Sniper", "label":"Sniper — blue chip only (agree=3, conv=75)",
     "segs":"bluechip", "exec_tf":"15m","weights":W_CURR, "min_conv":75,"min_agree":3,"sl_mult":1.0,"tp_mult":2.0,"max_lev":35},
    {"id": 20, "group":"C-Sniper", "label":"Sniper — 1h exec (agree=3, conv=75)",
     "segs":"quality",  "exec_tf":"1h", "weights":W_CURR, "min_conv":75,"min_agree":3,"sl_mult":1.5,"tp_mult":3.0,"max_lev":25},
    {"id": 21, "group":"C-Sniper", "label":"Sniper — core (agree=3, conv=70)",
     "segs":"core",     "exec_tf":"15m","weights":W_CURR, "min_conv":70,"min_agree":3,"sl_mult":1.0,"tp_mult":2.0,"max_lev":35},

    # ══ D: SWING (1h execution, medium hold, ride directional moves) ═════════
    {"id": 22, "group":"D-Swing", "label":"Swing — standard 1:2 (1h exec)",
     "segs":"quality",  "exec_tf":"1h", "weights":W_CURR, "min_conv":65,"min_agree":2,"sl_mult":1.0,"tp_mult":2.0,"max_lev":25},
    {"id": 23, "group":"D-Swing", "label":"Swing — wide 1:3 (1h exec)",
     "segs":"quality",  "exec_tf":"1h", "weights":W_CURR, "min_conv":65,"min_agree":2,"sl_mult":1.5,"tp_mult":4.5,"max_lev":25},
    {"id": 24, "group":"D-Swing", "label":"Swing — very wide 1:4 (1h exec)",
     "segs":"quality",  "exec_tf":"1h", "weights":W_CURR, "min_conv":65,"min_agree":2,"sl_mult":1.5,"tp_mult":6.0,"max_lev":20},
    {"id": 25, "group":"D-Swing", "label":"Swing — macro-heavy weights (1h exec)",
     "segs":"quality",  "exec_tf":"1h", "weights":W_MACRO,"min_conv":65,"min_agree":2,"sl_mult":1.5,"tp_mult":3.0,"max_lev":25},
    {"id": 26, "group":"D-Swing", "label":"Swing — conv=70 (1h exec)",
     "segs":"quality",  "exec_tf":"1h", "weights":W_CURR, "min_conv":70,"min_agree":2,"sl_mult":1.5,"tp_mult":3.0,"max_lev":25},
    {"id": 27, "group":"D-Swing", "label":"Swing — sniper mode (1h, agree=3, conv=70)",
     "segs":"quality",  "exec_tf":"1h", "weights":W_CURR, "min_conv":70,"min_agree":3,"sl_mult":2.0,"tp_mult":4.0,"max_lev":25},
    {"id": 28, "group":"D-Swing", "label":"Swing — core only (1h exec, 1:3)",
     "segs":"core",     "exec_tf":"1h", "weights":W_CURR, "min_conv":65,"min_agree":2,"sl_mult":1.5,"tp_mult":4.5,"max_lev":25},

    # ══ E: POSITION (4h execution, macro trend following, low leverage) ══════
    {"id": 29, "group":"E-Position", "label":"Position — standard (4h exec, bluechip)",
     "segs":"bluechip", "exec_tf":"4h", "weights":W_CURR, "min_conv":65,"min_agree":2,"sl_mult":2.0,"tp_mult":4.0,"max_lev":15},
    {"id": 30, "group":"E-Position", "label":"Position — wide 1:3 (4h exec, bluechip)",
     "segs":"bluechip", "exec_tf":"4h", "weights":W_CURR, "min_conv":65,"min_agree":2,"sl_mult":2.0,"tp_mult":6.0,"max_lev":15},
    {"id": 31, "group":"E-Position", "label":"Position — macro dominant (4h=70wt)",
     "segs":"bluechip", "exec_tf":"4h", "weights":W_4H,   "min_conv":65,"min_agree":2,"sl_mult":2.0,"tp_mult":4.0,"max_lev":15},
    {"id": 32, "group":"E-Position", "label":"Position — L1 only (4h exec)",
     "segs":"l1_only",  "exec_tf":"4h", "weights":W_CURR, "min_conv":60,"min_agree":2,"sl_mult":2.0,"tp_mult":4.0,"max_lev":10},
    {"id": 33, "group":"E-Position", "label":"Position — patient 1:4 (L1, 4h exec, 10x)",
     "segs":"l1_only",  "exec_tf":"4h", "weights":W_4H,   "min_conv":60,"min_agree":2,"sl_mult":2.5,"tp_mult":10.0,"max_lev":10},

    # ══ F: MOMENTUM (15m or 1h, 15m-heavy weights, breakout/surge entries) ══
    {"id": 34, "group":"F-Momentum", "label":"Momentum — fast 15m (15m dom weights)",
     "segs":"quality",  "exec_tf":"15m","weights":W_MOM,  "min_conv":65,"min_agree":2,"sl_mult":0.7,"tp_mult":2.1,"max_lev":35},
    {"id": 35, "group":"F-Momentum", "label":"Momentum — standard (equal weights, conv=70)",
     "segs":"quality",  "exec_tf":"15m","weights":W_EQUAL,"min_conv":70,"min_agree":2,"sl_mult":1.0,"tp_mult":2.0,"max_lev":25},
    {"id": 36, "group":"F-Momentum", "label":"Momentum — 1h exec (mom weights)",
     "segs":"quality",  "exec_tf":"1h", "weights":W_MOM,  "min_conv":65,"min_agree":2,"sl_mult":1.0,"tp_mult":3.0,"max_lev":25},
    {"id": 37, "group":"F-Momentum", "label":"Momentum — aggressive (very tight SL, wide TP)",
     "segs":"quality",  "exec_tf":"15m","weights":W_MOM,  "min_conv":65,"min_agree":2,"sl_mult":0.5,"tp_mult":2.5,"max_lev":35},
    {"id": 38, "group":"F-Momentum", "label":"Momentum — sniper (mom wts, agree=3, conv=70)",
     "segs":"quality",  "exec_tf":"15m","weights":W_MOM,  "min_conv":70,"min_agree":3,"sl_mult":0.7,"tp_mult":2.1,"max_lev":35},
    {"id": 39, "group":"F-Momentum", "label":"Momentum — swing TP (1h, mom, 1:5)",
     "segs":"quality",  "exec_tf":"1h", "weights":W_MOM,  "min_conv":65,"min_agree":2,"sl_mult":1.0,"tp_mult":5.0,"max_lev":20},

    # ══ G: VOLUME-BASED (1h-dominant weights, liquid coins) ══════════════════
    {"id": 40, "group":"G-Volume", "label":"Volume — breakout (vol weights, conv=70)",
     "segs":"quality",  "exec_tf":"15m","weights":W_VOL,  "min_conv":70,"min_agree":2,"sl_mult":0.8,"tp_mult":1.6,"max_lev":35},
    {"id": 41, "group":"G-Volume", "label":"Volume — swing (1h exec, vol weights)",
     "segs":"quality",  "exec_tf":"1h", "weights":W_VOL,  "min_conv":65,"min_agree":2,"sl_mult":1.5,"tp_mult":4.5,"max_lev":20},
    {"id": 42, "group":"G-Volume", "label":"Volume — momentum combo (vol+mom, 15m)",
     "segs":"quality",  "exec_tf":"15m","weights":W_MOM,  "min_conv":65,"min_agree":2,"sl_mult":1.0,"tp_mult":3.0,"max_lev":30},
    {"id": 43, "group":"G-Volume", "label":"Volume — liquid only (bluechip, vol weights)",
     "segs":"bluechip", "exec_tf":"15m","weights":W_VOL,  "min_conv":65,"min_agree":2,"sl_mult":0.8,"tp_mult":1.6,"max_lev":35},
    {"id": 44, "group":"G-Volume", "label":"Volume — conservative (quality, wide SL, conv=70)",
     "segs":"quality",  "exec_tf":"15m","weights":W_VOL,  "min_conv":70,"min_agree":2,"sl_mult":1.5,"tp_mult":4.5,"max_lev":20},

    # ══ H: BEST COMBO (synthesised from A–G) ══════════════════════════════════
    {"id": 45, "group":"H-Combo", "label":"Combo — Sniper+Swing (1h, quality, agree=3, conv=75)",
     "segs":"quality",  "exec_tf":"1h", "weights":W_CURR, "min_conv":75,"min_agree":3,"sl_mult":1.5,"tp_mult":4.5,"max_lev":25},
    {"id": 46, "group":"H-Combo", "label":"Combo — Scalp+Momentum (15m, mom wts, tight)",
     "segs":"quality",  "exec_tf":"15m","weights":W_MOM,  "min_conv":70,"min_agree":2,"sl_mult":0.5,"tp_mult":1.5,"max_lev":35},
    {"id": 47, "group":"H-Combo", "label":"Combo — Position+Patient (4h, L1, macro, 1:4)",
     "segs":"l1_only",  "exec_tf":"4h", "weights":W_4H,   "min_conv":60,"min_agree":2,"sl_mult":2.5,"tp_mult":10.0,"max_lev":10},
    {"id": 48, "group":"H-Combo", "label":"Combo — Swing+Macro (1h, quality, macro, conv=70)",
     "segs":"quality",  "exec_tf":"1h", "weights":W_MACRO, "min_conv":70,"min_agree":2,"sl_mult":2.0,"tp_mult":6.0,"max_lev":20},
    {"id": 49, "group":"H-Combo", "label":"Combo — Balanced (1h, quality, equal, conv=70, agree=3)",
     "segs":"quality",  "exec_tf":"1h", "weights":W_EQUAL, "min_conv":70,"min_agree":3,"sl_mult":1.5,"tp_mult":4.5,"max_lev":20},
    {"id": 50, "group":"H-Combo", "label":"Combo — Ultra-Sniper (15m, bluechip, agree=3, conv=80, macro)",
     "segs":"bluechip", "exec_tf":"15m","weights":W_MACRO, "min_conv":80,"min_agree":3,"sl_mult":1.5,"tp_mult":3.0,"max_lev":35},
]

assert len(EXPERIMENTS) == 50, f"Expected 50 experiments, got {len(EXPERIMENTS)}"

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


# ─── HMM block prediction ──────────────────────────────────────────────────────

def predict_block(brain: HMMBrain, df: pd.DataFrame):
    n = len(df)
    regimes = np.full(n, config.REGIME_CHOP, dtype=int)
    margins = np.zeros(n)
    if not brain.is_trained:
        return regimes, margins
    if any(c not in df.columns for c in brain.features):
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


# ─── Phase 1: Pre-compute per-coin regime arrays ──────────────────────────────

def precompute_coin(symbol: str):
    """
    Fetch data, run independent walk-forward HMM for each TF.
    Returns a cache dict with:
      dfs   : {"4h": df, "1h": df, "15m": df}
      preds : {"4h": {"regime": arr, "margin": arr}, ...}
      test_start_ts : pd.Timestamp
    """
    total_months = WARMUP_MONTHS + TEST_MONTHS

    dfs = {}
    for tf in ["4h", "1h", "15m"]:
        df = fetch_tf(symbol, tf, total_months)
        if df is None or df.empty:
            print(f"    {symbol}/{tf}: NO DATA")
            return None
        dfs[tf] = df
        time.sleep(0.15)

    # Test window: last TEST_MONTHS from most recent bar
    # Use the 15m TF as the reference (most granular)
    last_bar_ts   = dfs["15m"]["timestamp"].iloc[-1]
    test_start_ts = last_bar_ts - pd.Timedelta(days=TEST_MONTHS * 30)

    # Calendar-based retrain cutoffs (every RETRAIN_DAYS)
    n_blocks = int((TEST_MONTHS * 30) / RETRAIN_DAYS) + 2
    retrain_cutoffs = [
        test_start_ts + pd.Timedelta(days=i * RETRAIN_DAYS)
        for i in range(n_blocks + 1)
    ]

    # Allocate prediction arrays at each TF's native length
    preds = {}
    for tf, df_tf in dfs.items():
        n = len(df_tf)
        preds[tf] = {
            "regime": np.full(n, config.REGIME_CHOP, dtype=int),
            "margin": np.zeros(n),
        }

    # Walk-forward: same calendar cutoffs applied to all TFs
    for blk_i, cutoff_ts in enumerate(retrain_cutoffs[:-1]):
        next_cutoff = retrain_cutoffs[blk_i + 1]

        # Train one brain per TF on data < cutoff_ts
        brains = {}
        for tf, df_tf in dfs.items():
            train_data = df_tf[df_tf["timestamp"] < cutoff_ts].tail(TRAIN_BARS[tf]).copy()
            b = HMMBrain(symbol=symbol)
            if len(train_data) >= 50:
                try:
                    b.train(train_data)
                except Exception:
                    pass
            brains[tf] = b

        # Predict on each TF's block [cutoff_ts, next_cutoff)
        for tf, df_tf in dfs.items():
            block_mask = (df_tf["timestamp"] >= cutoff_ts) & (df_tf["timestamp"] < next_cutoff)
            block_idx  = np.where(block_mask)[0]
            if not len(block_idx) or not brains[tf].is_trained:
                continue
            block_df = df_tf.iloc[block_idx].copy()
            r, m = predict_block(brains[tf], block_df)
            # 1-bar look-ahead shift (use previous bar's prediction on current bar)
            if len(block_idx) > 1:
                preds[tf]["regime"][block_idx[1:]] = r[:-1]
                preds[tf]["margin"][block_idx[1:]] = m[:-1]

    return {
        "symbol":       symbol,
        "dfs":          dfs,
        "preds":        preds,
        "test_start_ts": test_start_ts,
    }


# ─── Phase 2: Trade simulation ─────────────────────────────────────────────────

def _regime_at(pred_dict, df_tf, ts):
    """Return (regime, margin) for the last bar in df_tf before timestamp ts."""
    ts_arr = df_tf["timestamp"].values
    idx = int(np.searchsorted(ts_arr, np.datetime64(ts), side="right")) - 1
    if idx < 0:
        return config.REGIME_CHOP, 0.0
    return int(pred_dict["regime"][idx]), float(pred_dict["margin"][idx])


def _atr_at(dfs, exec_tf, ts):
    """Return ATR from the appropriate source TF at the last bar before ts."""
    src_tf = ATR_SOURCE[exec_tf]
    df = dfs[src_tf]
    if "atr" not in df.columns:
        return None
    ts_arr = df["timestamp"].values
    idx = int(np.searchsorted(ts_arr, np.datetime64(ts), side="right")) - 1
    if idx < 0:
        return None
    v = float(df["atr"].iloc[idx])
    return v if (v > 0 and not np.isnan(v)) else None


def _conviction(p4h, m4h, p1h, m1h, p15m, m15m, weights, min_agree):
    """Replicate MultiTFHMMBrain.get_conviction() with per-experiment weights."""
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


def simulate_trades(cache: dict, exp: dict):
    """
    Walk-through trade simulation using cached regime predictions.
    Returns stats dict or None if no trades.
    """
    exec_tf   = exp["exec_tf"]
    df_exec   = cache["dfs"][exec_tf]
    preds     = cache["preds"]
    dfs       = cache["dfs"]
    test_ts   = cache["test_start_ts"]

    min_conv  = exp["min_conv"]
    min_agree = exp["min_agree"]
    weights   = exp["weights"]
    sl_mult   = exp["sl_mult"]
    tp_mult   = exp["tp_mult"]
    max_lev   = exp["max_lev"]

    # Locate test window start in exec_tf
    ts_exec = df_exec["timestamp"].values
    test_idx_arr = np.where(ts_exec >= np.datetime64(test_ts))[0]
    if not len(test_idx_arr):
        return None
    test_idx = int(test_idx_arr[0])

    trades = []
    open_trade = None   # (side, entry, sl, tp, lev, entry_ts)

    for i in range(test_idx, len(df_exec)):
        row   = df_exec.iloc[i]
        ts    = row["timestamp"]
        open_ = float(row["open"])
        high  = float(row["high"])
        low   = float(row["low"])
        close = float(row["close"])

        # Multi-TF conviction at this timestamp
        p4h,  m4h  = _regime_at(preds["4h"],  dfs["4h"],  ts)
        p1h,  m1h  = _regime_at(preds["1h"],  dfs["1h"],  ts)
        p15m, m15m = _regime_at(preds["15m"], dfs["15m"], ts)

        conviction, side = _conviction(p4h, m4h, p1h, m1h, p15m, m15m, weights, min_agree)

        # ── Check exit on open trade ──────────────────────────────────────────
        if open_trade is not None:
            ot_side, ot_entry, ot_sl, ot_tp, ot_lev, ot_ts = open_trade
            direction  = 1 if ot_side == "BUY" else -1
            exit_price = None
            exit_reason = None

            if direction == 1:    # LONG
                if low  <= ot_sl:  exit_price, exit_reason = ot_sl,  "SL"
                elif high >= ot_tp: exit_price, exit_reason = ot_tp, "TP"
            else:                  # SHORT
                if high >= ot_sl:  exit_price, exit_reason = ot_sl,  "SL"
                elif low  <= ot_tp: exit_price, exit_reason = ot_tp, "TP"

            # Flip: opposing conviction signal
            if exit_price is None and side is not None and side != ot_side and conviction >= min_conv:
                exit_price, exit_reason = close, "FLIP"

            if exit_price is not None:
                raw_ret = (exit_price - ot_entry) / ot_entry * direction
                net_ret = raw_ret * ot_lev - ROUND_TRIP_COST * ot_lev
                net_ret = max(net_ret, -1.0)
                pnl     = round(CAPITAL * net_ret, 4)
                trades.append({
                    "pnl": pnl, "reason": exit_reason, "side": ot_side,
                    "lev": ot_lev, "entry_ts": ot_ts, "exit_ts": ts,
                })
                open_trade = None

        # ── New entry ─────────────────────────────────────────────────────────
        if open_trade is None and conviction >= min_conv and side is not None:
            atr = _atr_at(dfs, exec_tf, ts)
            if atr is None:
                atr = close * 0.01

            vol_ratio = atr / close if close > 0 else 0
            if vol_ratio < config.VOL_MIN_ATR_PCT or vol_ratio > config.VOL_MAX_ATR_PCT:
                continue

            # Conviction-based leverage (capped at max_lev)
            if   conviction >= 95: lev = min(35, max_lev)
            elif conviction >= 80: lev = min(25, max_lev)
            elif conviction >= 70: lev = min(15, max_lev)
            else:                  lev = min(10, max_lev)

            if side == "BUY":
                sl = open_ - sl_mult * atr
                tp = open_ + tp_mult * atr
            else:
                sl = open_ + sl_mult * atr
                tp = open_ - tp_mult * atr

            open_trade = (side, open_, sl, tp, lev, ts)

    # Close any open trade at last bar
    if open_trade is not None:
        ot_side, ot_entry, ot_sl, ot_tp, ot_lev, ot_ts = open_trade
        direction = 1 if ot_side == "BUY" else -1
        last = df_exec.iloc[-1]
        closed = float(last["close"])
        raw_ret = (closed - ot_entry) / ot_entry * direction
        net_ret = max(raw_ret * ot_lev - ROUND_TRIP_COST * ot_lev, -1.0)
        pnl     = round(CAPITAL * net_ret, 4)
        trades.append({"pnl": pnl, "reason": "EOD", "side": ot_side,
                       "lev": ot_lev, "entry_ts": ot_ts, "exit_ts": last["timestamp"]})

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
        "pf":        round(float(wins.sum()) / float(abs(loss.sum())), 3) if len(loss) and loss.sum() != 0 else 999.0,
        "sharpe":    round(float(pnls.mean() / pnls.std() * np.sqrt(len(pnls))), 3) if pnls.std() > 1e-5 else 0.0,
        "max_dd":    round(float(dd.min()), 2),
        "avg_pnl":   round(float(pnls.mean()), 2),
        "avg_lev":   round(float(np.mean([t["lev"] for t in trades])), 1),
        "exits":     dict(exits),
    }


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--coins", nargs="+", help="Override test coin list")
    args = parser.parse_args()

    test_coins = args.coins or DEFAULT_TEST_COINS

    print("=" * 90)
    print("  Synaptic Quant Lab — 50-Config Multi-Strategy Experiment")
    print(f"  Test coins  : {len(test_coins)}")
    print(f"  Test window : {TEST_MONTHS} months walk-forward  |  retrain every {RETRAIN_DAYS}d")
    print(f"  Execution TFs tested : 15m (scalp/sniper/momentum)  1h (swing)  4h (position)")
    print(f"  Experiments : {len(EXPERIMENTS)}")
    print("=" * 90)
    print()

    # ═══ PHASE 1: Pre-compute ════════════════════════════════════════════════
    print("━━━ Phase 1 — Pre-computing HMM predictions per coin ━━━")
    print(f"    Fetching {len(test_coins)} coins × 3 TFs, running walk-forward training...")
    print()

    caches = {}
    for i, sym in enumerate(test_coins, 1):
        print(f"  [{i:2d}/{len(test_coins)}] {sym:14s} ...", end=" ", flush=True)
        cache = precompute_coin(sym)
        if cache is None:
            print("SKIP")
            continue
        caches[sym] = cache
        seg = COIN_SEG.get(sym, "?")
        bars_15m = len(cache["dfs"]["15m"])
        bars_1h  = len(cache["dfs"]["1h"])
        bars_4h  = len(cache["dfs"]["4h"])
        print(f"OK  [{seg:7s}]  4h={bars_4h:4d}  1h={bars_1h:5d}  15m={bars_15m:6d} bars")

    print(f"\n  Precomputed {len(caches)}/{len(test_coins)} coins\n")

    # ═══ PHASE 2: Run all 50 experiments ════════════════════════════════════
    print("━━━ Phase 2 — Simulating 50 experiments ━━━")
    print()

    results = []

    for exp in EXPERIMENTS:
        allowed = SEG_SETS[exp["segs"]]
        eligible = [s for s in caches if COIN_SEG.get(s, "?") in allowed]

        coin_stats = []
        for sym in eligible:
            st = simulate_trades(caches[sym], exp)
            if st:
                coin_stats.append({"sym": sym, **st})

        if not coin_stats:
            results.append({**exp, "n_eligible": len(eligible), "n_coins": 0,
                             "n_trades": 0, "total_pnl": 0, "win_rate": 0,
                             "pf": 0, "sharpe": 0, "max_dd": 0,
                             "avg_pnl": 0, "avg_lev": 0, "trades_per_coin": 0})
            print(f"  #{exp['id']:2d} [{exp['group']:12s}] {exp['label'][:40]:40s} NO TRADES")
            continue

        # Aggregate across coins
        all_pnls   = np.array([c["total_pnl"] for c in coin_stats])
        total_pnl  = float(all_pnls.sum())
        n_trades   = sum(c["n_trades"] for c in coin_stats)
        wins       = all_pnls[all_pnls > 0]
        loss       = all_pnls[all_pnls <= 0]
        coin_wr    = round(len(wins) / len(all_pnls) * 100, 1)
        coin_pf    = round(float(wins.sum()) / float(abs(loss.sum())), 3) if len(loss) and loss.sum() != 0 else 999.0
        coin_sh    = round(float(all_pnls.mean() / all_pnls.std()), 3) if all_pnls.std() > 1e-5 else 0.0
        max_dd_sum = sum(c["max_dd"] for c in coin_stats)
        avg_lev    = round(float(np.mean([c["avg_lev"] for c in coin_stats])), 1)
        tpc        = round(n_trades / len(coin_stats), 1)

        results.append({
            "id": exp["id"], "group": exp["group"], "label": exp["label"],
            "segs": exp["segs"], "exec_tf": exp["exec_tf"],
            "weights": f"{exp['weights']['4h']}/{exp['weights']['1h']}/{exp['weights']['15m']}",
            "min_conv": exp["min_conv"], "min_agree": exp["min_agree"],
            "sl_tp": f"{exp['sl_mult']:.1f}/{exp['tp_mult']:.1f}",
            "max_lev": exp["max_lev"],
            "n_eligible": len(eligible), "n_coins": len(coin_stats),
            "n_trades": n_trades, "trades_per_coin": tpc,
            "total_pnl": round(total_pnl, 2),
            "coin_wr": coin_wr, "coin_pf": coin_pf, "coin_sharpe": coin_sh,
            "max_dd_sum": round(max_dd_sum, 2), "avg_lev": avg_lev,
            "coin_breakdown": coin_stats,
        })

        pnl_str = f"${total_pnl:+8.2f}"
        print(
            f"  #{exp['id']:2d} [{exp['group']:12s}] {exp['label'][:38]:38s} "
            f"exec={exp['exec_tf']:3s}  coins={len(coin_stats):2d}  "
            f"trades={n_trades:4d} ({tpc:.0f}/c)  "
            f"PnL={pnl_str}  WR={coin_wr:5.1f}%  PF={coin_pf:.2f}  Sh={coin_sh:.2f}"
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
    log("  SYNAPTIC QUANT LAB — 50-CONFIG MULTI-STRATEGY BACKTEST RESULTS")
    log(f"  Period: {TEST_MONTHS}-month walk-forward  |  Coins: {', '.join(caches.keys())}")
    log(f"  Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    log("=" * 120)

    # ── Full ranked table ─────────────────────────────────────────────────────
    log()
    log("  RANKED BY TOTAL PnL (all experiments)")
    log(f"  {'Rk':>3}  {'#':>2}  {'Group':13s}  {'Label':40s}  {'ETF':3s}  "
        f"{'Segs':9s}  {'CV':>3}  {'Ag':>2}  {'SL/TP':>7s}  {'Lev':>3s}  "
        f"{'Cns':>3}  {'Trd':>4}  {'T/c':>4}  {'PnL':>10s}  {'CWR':>5s}  "
        f"{'CPF':>5s}  {'CSh':>5s}  {'MDD':>8s}")
    log("  " + "─" * 116)

    for rank, r in enumerate(ranked, 1):
        stars = " ★★★" if rank <= 3 else (" ✗✗✗" if rank > len(ranked) - 3 else "")
        log(
            f"  {rank:>3}  {r['id']:>2}  {r['group']:13s}  {r['label'][:40]:40s}  "
            f"{r['exec_tf']:3s}  {r['segs']:9s}  {r['min_conv']:>3.0f}  {r['min_agree']:>2}  "
            f"{r['sl_tp']:>7s}  {r['max_lev']:>3}  "
            f"{r['n_coins']:>3}  {r['n_trades']:>4}  {r['trades_per_coin']:>4.0f}  "
            f"${r['total_pnl']:>9.2f}  {r['coin_wr']:>4.1f}%  "
            f"{r['coin_pf']:>5.2f}  {r['coin_sharpe']:>5.3f}  "
            f"${r['max_dd_sum']:>7.0f}{stars}"
        )

    # ── Group summary ─────────────────────────────────────────────────────────
    log()
    log("=" * 90)
    log("  GROUP SUMMARY — Average metrics per strategy archetype")
    log("=" * 90)
    log(f"  {'Group':15s}  {'Exps':>5}  {'AvgPnL':>10s}  {'AvgWR':>6s}  "
        f"{'AvgPF':>6s}  {'AvgSharpe':>9s}  {'AvgTrades':>9s}  {'Best#':>6s}")
    log("  " + "─" * 80)

    groups = defaultdict(list)
    for r in results:
        if r.get("n_trades", 0) > 0:
            groups[r["group"]].append(r)

    for grp in sorted(groups.keys()):
        items = groups[grp]
        avg_pnl  = np.mean([r["total_pnl"] for r in items])
        avg_wr   = np.mean([r["coin_wr"] for r in items])
        valid_pf = [r["coin_pf"] for r in items if r["coin_pf"] < 100]
        avg_pf   = np.mean(valid_pf) if valid_pf else 0
        avg_sh   = np.mean([r["coin_sharpe"] for r in items])
        avg_tr   = np.mean([r["n_trades"] for r in items])
        best     = max(items, key=lambda x: x["total_pnl"])
        log(f"  {grp:15s}  {len(items):>5}  ${avg_pnl:>9.2f}  {avg_wr:>5.1f}%  "
            f"{avg_pf:>6.2f}  {avg_sh:>9.3f}  {avg_tr:>9.0f}  #{best['id']:>4}")

    # ── Per-exec-TF summary ───────────────────────────────────────────────────
    log()
    log("=" * 90)
    log("  EXECUTION TF BREAKDOWN")
    log("=" * 90)
    for etf in ["15m", "1h", "4h"]:
        items = [r for r in results if r.get("exec_tf") == etf and r.get("n_trades", 0) > 0]
        if not items:
            continue
        avg_pnl = np.mean([r["total_pnl"] for r in items])
        avg_sh  = np.mean([r["coin_sharpe"] for r in items])
        avg_tr  = np.mean([r["n_trades"] for r in items])
        best    = max(items, key=lambda x: x["total_pnl"])
        worst   = min(items, key=lambda x: x["total_pnl"])
        log(f"  {etf:3s}  ({len(items):2d} exps)  "
            f"avg PnL=${avg_pnl:+8.2f}  avg Sharpe={avg_sh:.3f}  avg trades={avg_tr:.0f}  "
            f"best=#{best['id']} ${best['total_pnl']:+.2f}  worst=#{worst['id']} ${worst['total_pnl']:+.2f}")

    # ── Conviction threshold analysis ─────────────────────────────────────────
    log()
    log("=" * 90)
    log("  CONVICTION THRESHOLD ANALYSIS (quality/core/bluechip, 15m exec only)")
    log("=" * 90)
    for cv in [60, 65, 70, 75, 80]:
        items = [r for r in results
                 if r.get("min_conv") == cv
                 and r.get("exec_tf") == "15m"
                 and r.get("segs") in ("quality", "core", "bluechip")
                 and r.get("n_trades", 0) > 0]
        if not items:
            continue
        avg_pnl = np.mean([r["total_pnl"] for r in items])
        avg_sh  = np.mean([r["coin_sharpe"] for r in items])
        avg_tr  = np.mean([r["n_trades"] for r in items])
        avg_wr  = np.mean([r["coin_wr"] for r in items])
        log(f"  conv={cv:2d}  ({len(items):2d} exps)  "
            f"avg PnL=${avg_pnl:+8.2f}  avg WR={avg_wr:.1f}%  "
            f"avg Sharpe={avg_sh:.3f}  avg trades/run={avg_tr:.0f}")

    # ── Segment blame (baseline vs no-meme/gaming) ────────────────────────────
    log()
    log("=" * 90)
    log("  SEGMENT CONTRIBUTION — Baseline (#1) per-coin PnL decomposition")
    log("=" * 90)
    baseline = next((r for r in results if r["id"] == 1), None)
    if baseline and "coin_breakdown" in baseline:
        seg_groups = defaultdict(list)
        for c in baseline["coin_breakdown"]:
            seg = COIN_SEG.get(c["sym"], "?")
            seg_groups[seg].append(c)
        for seg in sorted(seg_groups.keys()):
            coins = seg_groups[seg]
            seg_pnl = sum(c["total_pnl"] for c in coins)
            log(f"\n  {seg} (total ${seg_pnl:+.2f})")
            for c in sorted(coins, key=lambda x: x["total_pnl"], reverse=True):
                flag = "  ← DRAG" if c["total_pnl"] < -10 else ("  ← BEST" if c["total_pnl"] > 30 else "")
                log(f"    {c['sym']:12s}  PnL=${c['total_pnl']:+8.2f}  "
                    f"trades={c['n_trades']:3d}  WR={c['win_rate']:5.1f}%  "
                    f"PF={c['pf']:.2f}  Sharpe={c['sharpe']:.2f}{flag}")

    # ── Top 5 recommendations ─────────────────────────────────────────────────
    log()
    log("=" * 90)
    log("  TOP 5 CONFIGURATIONS — Recommendation for live deployment")
    log("=" * 90)
    top5 = ranked[:5]
    for i, r in enumerate(top5, 1):
        wt = r["weights"]
        log(f"\n  #{i}  Experiment {r['id']} — {r['label']}")
        log(f"      Exec TF   : {r['exec_tf']}  |  Universe : {r['segs']}  |  Coins: {r['n_coins']}")
        log(f"      Conviction: {r['min_conv']}  |  Agreement: {r['min_agree']}/3  |  Weights: {wt} (4h/1h/15m)")
        log(f"      SL/TP     : {r['sl_tp']}× ATR  |  Max Lev: {r['max_lev']}x  |  Avg Lev: {r['avg_lev']}x")
        log(f"      PnL       : ${r['total_pnl']:+.2f}  |  Win Rate: {r['coin_wr']:.1f}%  "
            f"|  PF: {r['coin_pf']:.2f}  |  Sharpe: {r['coin_sharpe']:.3f}")
        log(f"      Trades    : {r['n_trades']} total  ({r['trades_per_coin']:.0f}/coin)")

    log()
    log("=" * 120)

    # ─── Write to file ─────────────────────────────────────────────────────────
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"\n  Full report written → {OUTPUT_FILE}\n")


if __name__ == "__main__":
    main()

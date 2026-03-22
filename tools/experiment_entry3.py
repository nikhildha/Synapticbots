"""
tools/experiment_entry3.py
═══════════════════════════════════════════════════════════════════════════════
Round 4 — Drilling to Consistent Profitability

R3 Findings:
  ✓ WINNER: strong_vol (zscore>2.0) + 4h_1h + elite6 → +$479 (PF=1.027)
  ✓ vol_then_pullback PF=1.417 but only 8 trades — too sparse
  ✗ Ride-the-Wave all negative — TP ceiling is protecting profits, keep it
  ✗ ADA drag (-$615) and BTC drag (-$109) on the winner
  ✗ Wide TP (7.5×ATR) → 16% WR, too far to reach
  → Exit SL=61%, DIR_FLIP=28%, TP=11% — need to tighten SL or widen TP more

Quant Lead Hypotheses for R4:
  1. Drop ADA+BTC → core4 {ETH,SOL,ARB,AAVE} should push PnL to +$1,200+
  2. Stronger vol threshold (zscore>2.5) filters even more noise
  3. Multi-bar vol (2 consecutive z>2 bars) = sustained institutional flow
  4. Vol + VWAP reclaim together = breakout + support confirmed
  5. Score-based entry (vol=2pts + vwap=1pt + pullback=1pt, need ≥2) → precision
  6. Breakeven stop: once +2×ATR profit, move SL to entry → risk-free trade
  7. Trailing stop: SL trails at high-2×ATR — let winners run, protect gains
  8. LONG only: crypto is structurally biased long — eliminate short-side noise
  9. New coins: LINK (oracle/DeFi, strong vol patterns), LDO (liquid, vol surges)
 10. Asymmetric R:R: LONG=1:4, SHORT=1:2.5 (longs run further in crypto)
 11. 4h-strong direction (margin>0.20): only enter in decisive macro trends
 12. Time stop: exit after 24h if flat → free up capital, avoid dead weight

Groups:
  A (1-6)   : Coin surgery on strong_vol winner — find optimal universe
  B (7-12)  : TP/SL tuning on core4 + strong_vol
  C (13-18) : Entry signal refinement (stronger vol, score, combos)
  D (19-22) : Direction mode tuning
  E (23-26) : Long-only / directional bias
  F (27-32) : Exit innovations (breakeven, trailing, time stop)
  G (33-35) : Grand combo — best coin + best entry + best exit stacked
"""

import sys, os, time, argparse, warnings
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

# ─── Constants ────────────────────────────────────────────────────────────────
TEST_MONTHS  = 12
WARMUP_MONTHS = 3
TRAIN_DAYS   = 90
RETRAIN_DAYS = 30
FEE_PER_LEG  = 0.0005      # 0.05% per leg (user-confirmed)
ROUND_TRIP   = FEE_PER_LEG * 2   # 0.10% RT
CAPITAL      = config.CAPITAL_PER_TRADE  # $100

TRAIN_BARS = {
    "4h":  TRAIN_DAYS * 6,
    "1h":  TRAIN_DAYS * 24,
    "15m": min(TRAIN_DAYS * 96, config.MULTI_TF_CANDLE_LIMIT),
}

OUTPUT_FILE = os.path.join(ROOT, "tools", "experiment_entry3_results.txt")

# ─── Coin Universes ────────────────────────────────────────────────────────────
# R3 per-coin on best config (strong_vol, elite6):
#   AAVE  +$821   ★    ETH  +$186  ★    SOL  +$183  ★    ARB  +$12   ★
#   BTC   -$109   ✗    ADA  -$615  ✗
#
COIN_UNIVERSES = {
    # Core 4 — pure R3 winners, no drag
    "core4":    ["ETHUSDT", "SOLUSDT", "ARBUSDT", "AAVEUSDT"],

    # Top 2 only — highest PF coins
    "top2":     ["ETHUSDT", "AAVEUSDT"],

    # AAVE alone — single-coin focus
    "aave":     ["AAVEUSDT"],

    # Core4 + LINK (oracle/DeFi, strong vol signature)
    "c4_link":  ["ETHUSDT", "SOLUSDT", "ARBUSDT", "AAVEUSDT", "LINKUSDT"],

    # Core4 + LDO (Lido, ETH ecosystem, liquid)
    "c4_ldo":   ["ETHUSDT", "SOLUSDT", "ARBUSDT", "AAVEUSDT", "LDOUSDT"],

    # Full DeFi+L1 (no BTC, ADA, FET, meme) — 8 coins
    "defi8":    ["ETHUSDT", "SOLUSDT", "ARBUSDT", "AAVEUSDT",
                 "LINKUSDT", "LDOUSDT", "UNIUSDT", "OPUSDT"],

    # R3 elite6 (baseline for comparison)
    "elite6":   ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT", "ARBUSDT", "AAVEUSDT"],
}

COIN_SEG = {
    "BTCUSDT":"L1","ETHUSDT":"L1","SOLUSDT":"L1","ADAUSDT":"L1",
    "ARBUSDT":"L2","OPUSDT":"L2",
    "UNIUSDT":"DeFi","AAVEUSDT":"DeFi","LINKUSDT":"DeFi","LDOUSDT":"DeFi",
    "TAOUSDT":"AI","ARUSDT":"DePIN",
}

# ─── Experiments ──────────────────────────────────────────────────────────────
# New fields vs R3:
#   long_only      : True = skip SELL direction (crypto long bias)
#   breakeven_stop : True = once +2×ATR profit, move SL to entry
#   trailing_stop  : True = SL trails at best_price - 2×ATR
#   time_stop_bars : int  = exit after N 15m bars if still open (None=off)
#   asym_rr        : True = LONG uses (sl, tp), SHORT uses (sl*0.67, tp*0.5)

EXPERIMENTS = [

    # ══ A: Coin Surgery ════════════════════════════════════════════════════════
    # R3 winner setup: strong_vol + 4h_1h + SL=1.5 + TP=4.5 + lev=25
    # Vary the coin universe to find optimal set

    {"id":  1, "group":"A-Coins", "label":"CORE4 {ETH,SOL,ARB,AAVE}  strong_vol  1:3",
     "dir":"4h_1h", "entry":"strong_vol", "min_dir_margin":0.05,
     "coins":"core4",   "sl":1.5,"tp":4.5,"max_lev":25,
     "long_only":False,"breakeven_stop":False,"trailing_stop":False,"time_stop_bars":None},

    {"id":  2, "group":"A-Coins", "label":"TOP2  {ETH,AAVE}           strong_vol  1:3",
     "dir":"4h_1h", "entry":"strong_vol", "min_dir_margin":0.05,
     "coins":"top2",    "sl":1.5,"tp":4.5,"max_lev":25,
     "long_only":False,"breakeven_stop":False,"trailing_stop":False,"time_stop_bars":None},

    {"id":  3, "group":"A-Coins", "label":"AAVE ONLY                  strong_vol  1:3",
     "dir":"4h_1h", "entry":"strong_vol", "min_dir_margin":0.05,
     "coins":"aave",    "sl":1.5,"tp":4.5,"max_lev":25,
     "long_only":False,"breakeven_stop":False,"trailing_stop":False,"time_stop_bars":None},

    {"id":  4, "group":"A-Coins", "label":"CORE4 + LINK               strong_vol  1:3",
     "dir":"4h_1h", "entry":"strong_vol", "min_dir_margin":0.05,
     "coins":"c4_link", "sl":1.5,"tp":4.5,"max_lev":25,
     "long_only":False,"breakeven_stop":False,"trailing_stop":False,"time_stop_bars":None},

    {"id":  5, "group":"A-Coins", "label":"CORE4 + LDO                strong_vol  1:3",
     "dir":"4h_1h", "entry":"strong_vol", "min_dir_margin":0.05,
     "coins":"c4_ldo",  "sl":1.5,"tp":4.5,"max_lev":25,
     "long_only":False,"breakeven_stop":False,"trailing_stop":False,"time_stop_bars":None},

    {"id":  6, "group":"A-Coins", "label":"DEFI8 (no BTC/ADA/FET)    strong_vol  1:3",
     "dir":"4h_1h", "entry":"strong_vol", "min_dir_margin":0.05,
     "coins":"defi8",   "sl":1.5,"tp":4.5,"max_lev":25,
     "long_only":False,"breakeven_stop":False,"trailing_stop":False,"time_stop_bars":None},

    # ══ B: TP/SL Tuning (core4 + strong_vol + 4h_1h) ══════════════════════════
    # R3 finding: SL hits 61%, TP only 11% → explore different ratios

    {"id":  7, "group":"B-TPSL", "label":"core4 | SL=1.0  TP=2.5  (1:2.5 tight)",
     "dir":"4h_1h", "entry":"strong_vol", "min_dir_margin":0.05,
     "coins":"core4",   "sl":1.0,"tp":2.5,"max_lev":25,
     "long_only":False,"breakeven_stop":False,"trailing_stop":False,"time_stop_bars":None},

    {"id":  8, "group":"B-TPSL", "label":"core4 | SL=1.5  TP=3.0  (1:2)",
     "dir":"4h_1h", "entry":"strong_vol", "min_dir_margin":0.05,
     "coins":"core4",   "sl":1.5,"tp":3.0,"max_lev":25,
     "long_only":False,"breakeven_stop":False,"trailing_stop":False,"time_stop_bars":None},

    {"id":  9, "group":"B-TPSL", "label":"core4 | SL=1.5  TP=4.5  (1:3) ← R3 winner repro",
     "dir":"4h_1h", "entry":"strong_vol", "min_dir_margin":0.05,
     "coins":"core4",   "sl":1.5,"tp":4.5,"max_lev":25,
     "long_only":False,"breakeven_stop":False,"trailing_stop":False,"time_stop_bars":None},

    {"id": 10, "group":"B-TPSL", "label":"core4 | SL=1.5  TP=6.0  (1:4)",
     "dir":"4h_1h", "entry":"strong_vol", "min_dir_margin":0.05,
     "coins":"core4",   "sl":1.5,"tp":6.0,"max_lev":25,
     "long_only":False,"breakeven_stop":False,"trailing_stop":False,"time_stop_bars":None},

    {"id": 11, "group":"B-TPSL", "label":"core4 | SL=2.0  TP=6.0  (1:3 wide SL)",
     "dir":"4h_1h", "entry":"strong_vol", "min_dir_margin":0.05,
     "coins":"core4",   "sl":2.0,"tp":6.0,"max_lev":25,
     "long_only":False,"breakeven_stop":False,"trailing_stop":False,"time_stop_bars":None},

    {"id": 12, "group":"B-TPSL", "label":"core4 | SL=2.5  TP=7.5  (1:3 very wide)",
     "dir":"4h_1h", "entry":"strong_vol", "min_dir_margin":0.05,
     "coins":"core4",   "sl":2.5,"tp":7.5,"max_lev":20,
     "long_only":False,"breakeven_stop":False,"trailing_stop":False,"time_stop_bars":None},

    # ══ C: Entry Signal Refinement (core4 + 4h_1h + SL=1.5 + TP=4.5) ═════════
    # Idea: strong_vol at z>2.0 works. What about stricter/combined conditions?

    # Stricter vol threshold
    {"id": 13, "group":"C-Entry", "label":"core4 | strong_vol zscore>2.5 (ultra-clean)",
     "dir":"4h_1h", "entry":"strong_vol_25", "min_dir_margin":0.05,
     "coins":"core4",   "sl":1.5,"tp":4.5,"max_lev":25,
     "long_only":False,"breakeven_stop":False,"trailing_stop":False,"time_stop_bars":None},

    # Multi-bar sustained vol: z>2.0 for 2 consecutive 15m bars
    {"id": 14, "group":"C-Entry", "label":"core4 | multi_bar_vol (z>2 for 2 bars sustained)",
     "dir":"4h_1h", "entry":"multi_bar_vol", "min_dir_margin":0.05,
     "coins":"core4",   "sl":1.5,"tp":4.5,"max_lev":25,
     "long_only":False,"breakeven_stop":False,"trailing_stop":False,"time_stop_bars":None},

    # Vol + VWAP reclaim: volume surge AND price above VWAP (breakout confirmed)
    {"id": 15, "group":"C-Entry", "label":"core4 | vol_and_vwap (surge + VWAP cross)",
     "dir":"4h_1h", "entry":"vol_and_vwap", "min_dir_margin":0.05,
     "coins":"core4",   "sl":1.5,"tp":4.5,"max_lev":25,
     "long_only":False,"breakeven_stop":False,"trailing_stop":False,"time_stop_bars":None},

    # Vol + BB expanding: breakout with volume
    {"id": 16, "group":"C-Entry", "label":"core4 | vol_and_bb (surge + BB expanding)",
     "dir":"4h_1h", "entry":"vol_and_bb", "min_dir_margin":0.05,
     "coins":"core4",   "sl":1.5,"tp":4.5,"max_lev":25,
     "long_only":False,"breakeven_stop":False,"trailing_stop":False,"time_stop_bars":None},

    # Score-based: vol(2pts) + vwap(1pt) + pullback(1pt) — need score>=2
    # Means: either (vol alone) OR (vwap+pullback combo) qualifies
    {"id": 17, "group":"C-Entry", "label":"core4 | score>=2: vol(2)+vwap(1)+pullback(1)",
     "dir":"4h_1h", "entry":"score2", "min_dir_margin":0.05,
     "coins":"core4",   "sl":1.5,"tp":4.5,"max_lev":25,
     "long_only":False,"breakeven_stop":False,"trailing_stop":False,"time_stop_bars":None},

    # Tightest: need vol + at least vwap OR pullback (score>=3)
    {"id": 18, "group":"C-Entry", "label":"core4 | score>=3: vol+one_more (ultra selective)",
     "dir":"4h_1h", "entry":"score3", "min_dir_margin":0.05,
     "coins":"core4",   "sl":1.5,"tp":6.0,"max_lev":25,
     "long_only":False,"breakeven_stop":False,"trailing_stop":False,"time_stop_bars":None},

    # ══ D: Direction Mode Tuning (core4 + strong_vol + SL=1.5 + TP=4.5) ═══════

    # 4h-strong: 4h margin > 0.20 (more decisive macro trend)
    {"id": 19, "group":"D-Direction", "label":"core4 | 4h_strong (margin>0.20) + strong_vol",
     "dir":"4h_strong", "entry":"strong_vol", "min_dir_margin":0.20,
     "coins":"core4",   "sl":1.5,"tp":4.5,"max_lev":25,
     "long_only":False,"breakeven_stop":False,"trailing_stop":False,"time_stop_bars":None},

    # Both TFs strong: 4h margin>0.15 AND 1h margin>0.15
    {"id": 20, "group":"D-Direction", "label":"core4 | 4h_1h_both_strong (both >0.15) + sv",
     "dir":"4h_1h_both_strong", "entry":"strong_vol", "min_dir_margin":0.15,
     "coins":"core4",   "sl":1.5,"tp":4.5,"max_lev":25,
     "long_only":False,"breakeven_stop":False,"trailing_stop":False,"time_stop_bars":None},

    # 4h soft: more signals — 1h CHOP is ok
    {"id": 21, "group":"D-Direction", "label":"core4 | 4h_soft (1h neutral ok) + strong_vol",
     "dir":"4h_soft",  "entry":"strong_vol", "min_dir_margin":0.05,
     "coins":"core4",   "sl":1.5,"tp":4.5,"max_lev":25,
     "long_only":False,"breakeven_stop":False,"trailing_stop":False,"time_stop_bars":None},

    # High conviction only
    {"id": 22, "group":"D-Direction", "label":"core4 | 4h_1h margin>0.15 + strong_vol",
     "dir":"4h_1h",    "entry":"strong_vol", "min_dir_margin":0.15,
     "coins":"core4",   "sl":1.5,"tp":4.5,"max_lev":25,
     "long_only":False,"breakeven_stop":False,"trailing_stop":False,"time_stop_bars":None},

    # ══ E: Long-Only / Directional Bias ════════════════════════════════════════
    # Hypothesis: crypto structurally biased long — remove short-side noise
    # Short trades often choppy/mean-reverting; longs ride real trend momentum

    {"id": 23, "group":"E-LongOnly", "label":"core4 | LONG ONLY + strong_vol  SL=1.5/TP=4.5",
     "dir":"4h_1h",    "entry":"strong_vol", "min_dir_margin":0.05,
     "coins":"core4",   "sl":1.5,"tp":4.5,"max_lev":25,
     "long_only":True, "breakeven_stop":False,"trailing_stop":False,"time_stop_bars":None},

    {"id": 24, "group":"E-LongOnly", "label":"core4 | LONG ONLY + strong_vol  SL=1.5/TP=6.0",
     "dir":"4h_1h",    "entry":"strong_vol", "min_dir_margin":0.05,
     "coins":"core4",   "sl":1.5,"tp":6.0,"max_lev":25,
     "long_only":True, "breakeven_stop":False,"trailing_stop":False,"time_stop_bars":None},

    {"id": 25, "group":"E-LongOnly", "label":"defi8 | LONG ONLY + strong_vol  1:3",
     "dir":"4h_1h",    "entry":"strong_vol", "min_dir_margin":0.05,
     "coins":"defi8",   "sl":1.5,"tp":4.5,"max_lev":25,
     "long_only":True, "breakeven_stop":False,"trailing_stop":False,"time_stop_bars":None},

    # Asymmetric R:R: LONG gets 1:3, SHORT gets 1:2 (shorts tighter, longs wider)
    {"id": 26, "group":"E-LongOnly", "label":"core4 | ASYM R:R long=1:3 short=1:2",
     "dir":"4h_1h",    "entry":"strong_vol", "min_dir_margin":0.05,
     "coins":"core4",   "sl":1.5,"tp":4.5,"max_lev":25,
     "long_only":False,"breakeven_stop":False,"trailing_stop":False,"time_stop_bars":None,
     "asym_rr":True},   # LONG tp=4.5, SHORT tp=3.0

    # ══ F: Exit Innovations ════════════════════════════════════════════════════
    # All use: core4 + strong_vol + 4h_1h + SL=1.5 + TP=4.5 as base

    # Breakeven stop: once trade is up 2×ATR, move SL to entry — no loss possible
    {"id": 27, "group":"F-Exit", "label":"core4 | BREAKEVEN STOP (SL→entry at +2×ATR)",
     "dir":"4h_1h",    "entry":"strong_vol", "min_dir_margin":0.05,
     "coins":"core4",   "sl":1.5,"tp":4.5,"max_lev":25,
     "long_only":False,"breakeven_stop":True, "trailing_stop":False,"time_stop_bars":None},

    # Trailing stop: SL moves up with price (high - 2×ATR for longs)
    # Allows unlimited upside while protecting gains
    {"id": 28, "group":"F-Exit", "label":"core4 | TRAILING STOP (SL trails high-2×ATR)",
     "dir":"4h_1h",    "entry":"strong_vol", "min_dir_margin":0.05,
     "coins":"core4",   "sl":1.5,"tp":6.0,"max_lev":25,
     "long_only":False,"breakeven_stop":False,"trailing_stop":True, "time_stop_bars":None},

    # Trailing + no TP ceiling — let winners run indefinitely
    {"id": 29, "group":"F-Exit", "label":"core4 | TRAIL+NO_TP (SL trails, ride to flip)",
     "dir":"4h_1h",    "entry":"strong_vol", "min_dir_margin":0.05,
     "coins":"core4",   "sl":1.5,"tp":None,"max_lev":20,
     "long_only":False,"breakeven_stop":False,"trailing_stop":True, "time_stop_bars":None},

    # Time stop: exit after 24h (96 × 15m bars) if still open — free capital
    {"id": 30, "group":"F-Exit", "label":"core4 | TIME STOP 24h + TP=4.5",
     "dir":"4h_1h",    "entry":"strong_vol", "min_dir_margin":0.05,
     "coins":"core4",   "sl":1.5,"tp":4.5,"max_lev":25,
     "long_only":False,"breakeven_stop":False,"trailing_stop":False,"time_stop_bars":96},

    # Breakeven + Trailing combo
    {"id": 31, "group":"F-Exit", "label":"core4 | BREAKEVEN + TRAILING  TP=6.0",
     "dir":"4h_1h",    "entry":"strong_vol", "min_dir_margin":0.05,
     "coins":"core4",   "sl":1.5,"tp":6.0,"max_lev":25,
     "long_only":False,"breakeven_stop":True, "trailing_stop":True, "time_stop_bars":None},

    # Long-only + breakeven stop (best of both worlds)
    {"id": 32, "group":"F-Exit", "label":"core4 | LONG ONLY + BREAKEVEN  TP=6.0",
     "dir":"4h_1h",    "entry":"strong_vol", "min_dir_margin":0.05,
     "coins":"core4",   "sl":1.5,"tp":6.0,"max_lev":25,
     "long_only":True, "breakeven_stop":True, "trailing_stop":False,"time_stop_bars":None},

    # ══ G: Grand Combo — Stack Best Findings ══════════════════════════════════
    # Winner from each dimension combined

    # Best coins + best entry + long only + breakeven
    {"id": 33, "group":"G-Combo", "label":"COMBO1: core4+strong_vol+LongOnly+Breakeven  TP=4.5",
     "dir":"4h_1h",    "entry":"strong_vol", "min_dir_margin":0.05,
     "coins":"core4",   "sl":1.5,"tp":4.5,"max_lev":25,
     "long_only":True, "breakeven_stop":True, "trailing_stop":False,"time_stop_bars":None},

    # High conviction + multi_bar_vol + breakeven (max quality)
    {"id": 34, "group":"G-Combo", "label":"COMBO2: core4+multi_vol+margin>0.15+Breakeven  TP=6.0",
     "dir":"4h_1h",    "entry":"multi_bar_vol", "min_dir_margin":0.15,
     "coins":"core4",   "sl":1.5,"tp":6.0,"max_lev":25,
     "long_only":False,"breakeven_stop":True, "trailing_stop":False,"time_stop_bars":None},

    # Everything: vol_and_vwap + long only + trailing + high conf (sniper mode)
    {"id": 35, "group":"G-Combo", "label":"COMBO3: SNIPER core4+vol_vwap+LO+Trail+Conf",
     "dir":"4h_1h",    "entry":"vol_and_vwap", "min_dir_margin":0.15,
     "coins":"core4",   "sl":2.0,"tp":6.0,"max_lev":20,
     "long_only":True, "breakeven_stop":True, "trailing_stop":True, "time_stop_bars":None},
]

assert len(EXPERIMENTS) == 35, f"Expected 35 got {len(EXPERIMENTS)}"
assert len({e["id"] for e in EXPERIMENTS}) == 35, "Duplicate IDs"


# ─── Data fetch ───────────────────────────────────────────────────────────────

def fetch_tf(symbol, interval, total_months):
    mins_map = {"4h": 240, "1h": 60, "15m": 15}
    mins_per_bar = mins_map[interval]
    n_bars = int((total_months * 30 * 24 * 60 / mins_per_bar) * 1.1)
    now_ms   = int(datetime.now(timezone.utc).timestamp() * 1000)
    start_ms = now_ms - n_bars * mins_per_bar * 60 * 1000
    klines = []
    cur = start_ms
    while True:
        try:
            r = requests.get("https://fapi.binance.com/fapi/v1/klines",
                             params={"symbol": symbol, "interval": interval,
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


def predict_block(brain, df):
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

def precompute_coin(symbol):
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


# ─── Lookup helpers ────────────────────────────────────────────────────────────

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
    if p4h == config.REGIME_BULL: return "BUY",  m4h
    if p4h == config.REGIME_BEAR: return "SELL", m4h
    return None, 0.0

def _dir_1h(p4h, m4h, p1h, m1h, p15m, m15m):
    if p1h == config.REGIME_BULL: return "BUY",  m1h
    if p1h == config.REGIME_BEAR: return "SELL", m1h
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

def _dir_4h_strong(p4h, m4h, p1h, m1h, p15m, m15m):
    """4h only but requires margin > 0.20 (caller enforces via min_dir_margin)."""
    if p4h == config.REGIME_BULL: return "BUY",  m4h
    if p4h == config.REGIME_BEAR: return "SELL", m4h
    return None, 0.0

def _dir_4h_1h_both_strong(p4h, m4h, p1h, m1h, p15m, m15m):
    """4h+1h must agree AND both margins checked via min_dir_margin."""
    if p4h == config.REGIME_BULL and p1h == config.REGIME_BULL:
        return "BUY",  min(m4h, m1h)   # use min — both must be strong
    if p4h == config.REGIME_BEAR and p1h == config.REGIME_BEAR:
        return "SELL", min(m4h, m1h)
    return None, 0.0

DIRECTION_FNS = {
    "4h":               _dir_4h,
    "1h":               _dir_1h,
    "4h_1h":            _dir_4h_1h,
    "4h_soft":          _dir_4h_soft,
    "4h_1h_15m":        _dir_4h_1h_15m,
    "4h_strong":        _dir_4h_strong,
    "4h_1h_both_strong":_dir_4h_1h_both_strong,
}


# ─── Entry triggers ────────────────────────────────────────────────────────────

def _entry_immediate(df, i, p, side):
    return True

def _entry_flip(df, i, p, side):
    if i < 1: return False
    c, v = p["regime"][i], p["regime"][i-1]
    if side == "BUY":  return c == config.REGIME_BULL and v != config.REGIME_BULL
    return c == config.REGIME_BEAR and v != config.REGIME_BEAR

def _entry_pullback(df, i, p, side):
    if i < 2: return False
    c0, c1, c2 = p["regime"][i], p["regime"][i-1], p["regime"][i-2]
    if side == "BUY":
        return c0 == config.REGIME_BULL and c1 == config.REGIME_CHOP and c2 == config.REGIME_BULL
    return c0 == config.REGIME_BEAR and c1 == config.REGIME_CHOP and c2 == config.REGIME_BEAR

def _entry_vwap(df, i, p, side):
    if i < 2 or "vwap_dist" not in df.columns: return False
    c = float(df["vwap_dist"].iloc[i-1])
    v = float(df["vwap_dist"].iloc[i-2])
    if side == "BUY":  return c > 0 and v <= 0
    return c < 0 and v >= 0

def _entry_rsi_dip(df, i, p, side):
    if i < 2 or "rsi" not in df.columns: return False
    c = float(df["rsi"].iloc[i-1])
    v = float(df["rsi"].iloc[i-2])
    if side == "BUY":  return c > 40 and v <= 40
    return c < 60 and v >= 60

def _vol_at(df, i, thresh):
    if i < 1 or "vol_zscore" not in df.columns: return 0.0
    return float(df["vol_zscore"].iloc[i-1])

def _entry_vol_surge(df, i, p, side, thresh=1.5):
    vz  = _vol_at(df, i, thresh)
    reg = p["regime"][i-1] if i > 0 else config.REGIME_CHOP
    if side == "BUY":  return vz > thresh and reg == config.REGIME_BULL
    return vz > thresh and reg == config.REGIME_BEAR

def _entry_strong_vol(df, i, p, side):
    """vol_zscore > 2.0 — institutional-grade volume surge."""
    return _entry_vol_surge(df, i, p, side, thresh=2.0)

def _entry_strong_vol_25(df, i, p, side):
    """vol_zscore > 2.5 — ultra-clean signal."""
    return _entry_vol_surge(df, i, p, side, thresh=2.5)

def _entry_multi_bar_vol(df, i, p, side, thresh=2.0, bars=2):
    """vol_zscore > thresh for `bars` consecutive bars — sustained momentum."""
    if i < bars or "vol_zscore" not in df.columns: return False
    for lag in range(1, bars + 1):
        vz  = float(df["vol_zscore"].iloc[i - lag])
        reg = p["regime"][i - lag]
        ok  = vz > thresh
        if side == "BUY":  ok = ok and reg == config.REGIME_BULL
        else:              ok = ok and reg == config.REGIME_BEAR
        if not ok: return False
    return True

def _entry_vol_and_vwap(df, i, p, side):
    """Volume surge AND VWAP reclaim simultaneously."""
    return _entry_strong_vol(df, i, p, side) and _entry_vwap(df, i, p, side)

def _entry_vol_and_bb(df, i, p, side, squeeze_thresh=0.3, lookback=4):
    """Volume surge AND Bollinger Bands expanding (breakout confirmation)."""
    if not _entry_strong_vol(df, i, p, side): return False
    if i < lookback or "bb_width_norm" not in df.columns: return False
    curr_bb  = float(df["bb_width_norm"].iloc[i-1])
    prev_bbs = [float(df["bb_width_norm"].iloc[i-1-j]) for j in range(1, lookback)]
    was_squeezing = all(b < squeeze_thresh for b in prev_bbs)
    is_expanding  = curr_bb > max(prev_bbs) * 1.1
    reg = p["regime"][i-1]
    if side == "BUY":  return was_squeezing and is_expanding and reg == config.REGIME_BULL
    return was_squeezing and is_expanding and reg == config.REGIME_BEAR

def _entry_pullback_and_rsi(df, i, p, side):
    return _entry_pullback(df, i, p, side) and _entry_rsi_dip(df, i, p, side)

def _entry_vol_then_pullback(df, i, p, side, lookback=6):
    if not _entry_pullback_and_rsi(df, i, p, side): return False
    for lag in range(2, lookback + 2):
        j = i - lag
        if j >= 0 and _entry_vol_surge(df, j, p, side): return True
    return False

def _entry_score_base(df, i, p, side):
    """Score: strong_vol=2pts, vwap=1pt, pullback=1pt, rsi_dip=1pt"""
    score = 0
    if _entry_strong_vol(df, i, p, side): score += 2
    if _entry_vwap(df, i, p, side):       score += 1
    if _entry_pullback(df, i, p, side):   score += 1
    if _entry_rsi_dip(df, i, p, side):    score += 1
    return score

def _entry_score2(df, i, p, side):
    return _entry_score_base(df, i, p, side) >= 2

def _entry_score3(df, i, p, side):
    return _entry_score_base(df, i, p, side) >= 3

ENTRY_FNS = {
    "immediate":          _entry_immediate,
    "flip":               _entry_flip,
    "pullback":           _entry_pullback,
    "vwap":               _entry_vwap,
    "rsi_dip":            _entry_rsi_dip,
    "vol_surge":          _entry_vol_surge,
    "strong_vol":         _entry_strong_vol,
    "strong_vol_25":      _entry_strong_vol_25,
    "multi_bar_vol":      _entry_multi_bar_vol,
    "vol_and_vwap":       _entry_vol_and_vwap,
    "vol_and_bb":         _entry_vol_and_bb,
    "pullback_rsi":       _entry_pullback_and_rsi,
    "vol_then_pullback":  _entry_vol_then_pullback,
    "score2":             _entry_score2,
    "score3":             _entry_score3,
}


# ─── Phase 2: Trade simulation ─────────────────────────────────────────────────

def simulate_trades(cache, exp):
    dfs        = cache["dfs"]
    preds      = cache["preds"]
    test_start = cache["test_start_ts"]
    df_15m     = dfs["15m"]
    pred_15m   = preds["15m"]

    dir_fn     = DIRECTION_FNS[exp["dir"]]
    entry_fn   = ENTRY_FNS[exp["entry"]]
    min_margin = exp["min_dir_margin"]
    sl_mult    = exp["sl"]
    tp_mult    = exp.get("tp")
    max_lev    = exp["max_lev"]
    long_only  = exp.get("long_only", False)
    be_stop    = exp.get("breakeven_stop", False)
    trail_stop = exp.get("trailing_stop", False)
    time_stop  = exp.get("time_stop_bars")
    asym_rr    = exp.get("asym_rr", False)

    ts_15m   = df_15m["timestamp"].values
    test_arr = np.where(ts_15m >= np.datetime64(test_start))[0]
    if not len(test_arr):
        return None
    test_idx = int(test_arr[0])

    trades     = []
    open_trade = None   # dict with keys: side,entry,sl,tp,lev,entry_ts,atr,entry_i

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
        if long_only and direction == "SELL":
            direction = None

        # ── Exit logic ────────────────────────────────────────────────────────
        if open_trade is not None:
            ot = open_trade
            d  = 1 if ot["side"] == "BUY" else -1
            ep = None
            er = None

            # Update trailing stop before checking SL
            if trail_stop:
                trail_dist = 1.5 * ot["atr"]
                if d == 1:
                    new_sl = high - trail_dist
                    if new_sl > ot["sl"]:
                        ot["sl"] = new_sl
                else:
                    new_sl = low + trail_dist
                    if new_sl < ot["sl"]:
                        ot["sl"] = new_sl

            # Move SL to breakeven once in profit by 2×ATR
            if be_stop:
                be_threshold = 2.0 * ot["atr"]
                if d == 1 and close >= ot["entry"] + be_threshold:
                    ot["sl"] = max(ot["sl"], ot["entry"])
                elif d == -1 and close <= ot["entry"] - be_threshold:
                    ot["sl"] = min(ot["sl"], ot["entry"])

            # SL check
            if d == 1:
                if low  <= ot["sl"]: ep, er = ot["sl"], "SL"
            else:
                if high >= ot["sl"]: ep, er = ot["sl"], "SL"

            # TP check
            if ep is None and ot["tp"] is not None:
                if d == 1:
                    if high >= ot["tp"]: ep, er = ot["tp"], "TP"
                else:
                    if low  <= ot["tp"]: ep, er = ot["tp"], "TP"

            # DIR_FLIP exit
            if ep is None and direction is not None and direction != ot["side"]:
                ep, er = close, "DIR_FLIP"

            # Time stop
            if ep is None and time_stop is not None:
                bars_held = i - ot["entry_i"]
                if bars_held >= time_stop:
                    ep, er = close, "TIME"

            if ep is not None:
                raw = (ep - ot["entry"]) / ot["entry"] * d
                net = max(raw * ot["lev"] - ROUND_TRIP * ot["lev"], -1.0)
                trades.append({"pnl": round(CAPITAL * net, 4), "reason": er,
                                "side": ot["side"], "lev": ot["lev"],
                                "entry_ts": ot["entry_ts"], "exit_ts": ts})
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

                # Asymmetric R:R: longs get full TP, shorts get compressed TP
                eff_tp = tp_mult
                if asym_rr and direction == "SELL" and tp_mult is not None:
                    eff_tp = tp_mult * 0.67   # shorts target is 2/3 of long target

                if direction == "BUY":
                    sl = open_ - sl_mult * atr
                    tp = (open_ + eff_tp * atr) if eff_tp is not None else None
                else:
                    sl = open_ + sl_mult * atr
                    tp = (open_ - eff_tp * atr) if eff_tp is not None else None

                open_trade = {
                    "side": direction, "entry": open_, "sl": sl, "tp": tp,
                    "lev": lev, "entry_ts": ts, "atr": atr, "entry_i": i,
                }

    # Close any open position at period end
    if open_trade is not None:
        ot = open_trade
        d  = 1 if ot["side"] == "BUY" else -1
        last = df_15m.iloc[-1]
        raw  = (float(last["close"]) - ot["entry"]) / ot["entry"] * d
        net  = max(raw * ot["lev"] - ROUND_TRIP * ot["lev"], -1.0)
        trades.append({"pnl": round(CAPITAL * net, 4), "reason": "EOD",
                       "side": ot["side"], "lev": ot["lev"],
                       "entry_ts": ot["entry_ts"], "exit_ts": last["timestamp"]})

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
        "avg_lev":   round(float(np.mean([t["lev"] for t in trades])), 1),
        "exits":     dict(exits),
        "trades":    trades,
    }


# ─── Report ────────────────────────────────────────────────────────────────────

def write_report(results, ranked, elapsed):
    W = 130
    lines = []
    h = lambda s: lines.append(s)

    h("=" * W)
    h("  SYNAPTIC QUANT LAB — ROUND 4: DRILLING TO PROFITABILITY")
    h(f"  Fee: {FEE_PER_LEG*100:.2f}%/leg = {ROUND_TRIP*100:.2f}% RT  |  "
      f"Period: 12m walk-forward  |  Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    h("=" * W)
    h("")

    hdr = (f"  {'Rk':>3}  {'#':>2}  {'Group':<14}  {'Label':<56}  "
           f"{'Dir':<18}  {'Ent':<16}  {'Coins':<8}  "
           f"{'SL/TP':<8}  {'Lev':>4}  {'Cn':>2}  {'Trd':>5}  {'T/c':>5}  "
           f"{'PnL':>10}  {'TWR':>6}  {'TPF':>5}  {'TSh':>6}  {'MDD':>8}  Flags")
    h(hdr)
    h("  " + "─" * (W - 2))

    for rk, r in enumerate(ranked, 1):
        tp_str = f"{r['sl']:.1f}/{r['tp']:.1f}" if r.get("tp") else f"{r['sl']:.1f}/wave"
        flags  = ""
        if r.get("long_only"):       flags += "LO "
        if r.get("breakeven_stop"):  flags += "BE "
        if r.get("trailing_stop"):   flags += "TR "
        if r.get("time_stop_bars"):  flags += f"T{r['time_stop_bars']} "
        if r.get("asym_rr"):         flags += "AR "
        tag = "★ PROFIT" if r["total_pnl"] > 0 else ("~ NEAR" if r["total_pnl"] > -200 else "")
        h(f"  {rk:>3}  {r['id']:>2}  {r['group']:<14}  {r['label'][:56]:<56}  "
          f"{r['dir']:<18}  {r['entry']:<16}  {r['coins']:<8}  "
          f"{tp_str:<8}  {r['max_lev']:>4}  {r.get('n_coins',0):>2}  "
          f"{r['n_trades']:>5}  {r.get('tpc',0):>5.0f}  "
          f"${r['total_pnl']:>9.2f}  {r.get('trade_wr',0):>5.1f}%  "
          f"{r.get('trade_pf',0):>5.3f}  {r.get('trade_sh',0):>6.3f}  "
          f"${r.get('max_dd',0):>7.0f}  {flags}{tag}")

    h("")
    h("=" * 80)
    h("  GROUP AVERAGES")
    h("=" * 80)
    groups = defaultdict(list)
    for r in ranked:
        groups[r["group"]].append(r)
    for g, rs in sorted(groups.items()):
        best    = max(rs, key=lambda x: x["total_pnl"])
        avg_pnl = sum(r["total_pnl"] for r in rs) / len(rs)
        avg_twr = sum(r.get("trade_wr", 0) for r in rs) / len(rs)
        avg_sh  = sum(r.get("trade_sh", 0) for r in rs) / len(rs)
        avg_tr  = sum(r["n_trades"] for r in rs) / len(rs)
        h(f"  {g:<18}  n={len(rs)}  avgPnL=${avg_pnl:>9.2f}  "
          f"avgTWR={avg_twr:.1f}%  avgSh={avg_sh:.3f}  avgTrades={avg_tr:.0f}  "
          f"best=#{best['id']} ${best['total_pnl']:+.2f}")

    h("")
    h("=" * 80)
    h("  ENTRY TYPE ANALYSIS")
    h("=" * 80)
    by_entry = defaultdict(list)
    for r in ranked:
        by_entry[r["entry"]].append(r)
    for etype, rs in sorted(by_entry.items(), key=lambda x: sum(r["total_pnl"] for r in x[1]) / len(x[1]), reverse=True):
        best    = max(rs, key=lambda x: x["total_pnl"])
        avg_pnl = sum(r["total_pnl"] for r in rs) / len(rs)
        avg_tr  = sum(r["n_trades"] for r in rs) / len(rs)
        h(f"  {etype:<22}  n={len(rs)}  avgPnL=${avg_pnl:>9.2f}  "
          f"avgTrades={avg_tr:.0f}  best=#{best['id']} ${best['total_pnl']:+.2f}")

    h("")
    h("=" * 80)
    h("  COIN UNIVERSE ANALYSIS")
    h("=" * 80)
    by_coins = defaultdict(list)
    for r in ranked:
        by_coins[r["coins"]].append(r)
    for cu, rs in sorted(by_coins.items(), key=lambda x: sum(r["total_pnl"] for r in x[1]) / len(x[1]), reverse=True):
        best    = max(rs, key=lambda x: x["total_pnl"])
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
    h(f"  PER-COIN — Best Experiment #{ranked[0]['id'] if ranked else 'N/A'}")
    h("=" * 80)
    if ranked:
        best_r = ranked[0]
        h(f"  {best_r['label']}")
        h(f"  Dir={best_r['dir']}  Entry={best_r['entry']}  Coins={best_r['coins']}  "
          f"SL={best_r['sl']}/TP={best_r.get('tp','wave')}  LO={best_r.get('long_only')}  "
          f"BE={best_r.get('breakeven_stop')}  TR={best_r.get('trailing_stop')}")
        h("")
        for cs in sorted(best_r.get("coin_stats", []), key=lambda x: x["total_pnl"], reverse=True):
            sym  = cs["sym"]
            seg  = COIN_SEG.get(sym, "?")
            star = "★" if cs["total_pnl"] > 0 else "✗" if cs["total_pnl"] < -50 else "~"
            h(f"  {sym:<12}  [{seg:<6}]  {star}  PnL=${cs['total_pnl']:>+8.2f}  "
              f"trades={cs['n_trades']:>4}  WR={cs['win_rate']:>5.1f}%  "
              f"PF={cs['pf']:>6.3f}  Sh={cs['sharpe']:>6.3f}  exits={cs['exits']}")

    h("")
    h("=" * 80)
    h("  TOP 10 CONFIGURATIONS")
    h("=" * 80)
    for rk, r in enumerate(ranked[:10], 1):
        tp_d = f"{r['tp']:.1f}×ATR" if r.get("tp") else "DIR_FLIP/TRAIL only"
        flags = []
        if r.get("long_only"): flags.append("LONG-ONLY")
        if r.get("breakeven_stop"): flags.append("BREAKEVEN-STOP")
        if r.get("trailing_stop"): flags.append("TRAILING-STOP")
        if r.get("time_stop_bars"): flags.append(f"TIME-STOP-{r['time_stop_bars']}bars")
        if r.get("asym_rr"): flags.append("ASYM-RR")
        h(f"  #{rk}  [{r['group']}] #{r['id']} — {r['label']}")
        h(f"      Dir={r['dir']}  Entry={r['entry']}  Coins={r['coins']}  "
          f"SL={r['sl']}×ATR  TP={tp_d}  MaxLev={r['max_lev']}x  "
          f"{'  '.join(flags) or 'standard'}")
        h(f"      PnL=${r['total_pnl']:+.2f}  WR={r.get('trade_wr',0):.1f}%  "
          f"PF={r.get('trade_pf',0):.3f}  Sharpe={r.get('trade_sh',0):.3f}  "
          f"Trades={r['n_trades']}({r.get('tpc',0):.0f}/coin)  "
          f"MDD=${r.get('max_dd',0):.0f}")
        h(f"      Exits: {r.get('exits',{})}")
        h("")

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

    if args.coins:
        all_coins = args.coins
    else:
        all_coins_set = set()
        for exp in EXPERIMENTS:
            all_coins_set.update(COIN_UNIVERSES[exp["coins"]])
        all_coins = sorted(all_coins_set)

    print("=" * 90)
    print("  Synaptic Quant Lab — Round 4: Drilling to Profitability (35 configs)")
    print(f"  Fee: {FEE_PER_LEG*100:.2f}%/leg = {ROUND_TRIP*100:.2f}% RT")
    print(f"  Coins: {len(all_coins)}  |  {all_coins}")
    print(f"  New: breakeven_stop, trailing_stop, long_only, time_stop, asym_rr, score entries")
    print("=" * 90)
    print()

    # ─── Phase 1 ─────────────────────────────────────────────────────────────
    print("━━━ Phase 1 — Pre-computing HMM predictions ━━━")
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

    # ─── Phase 2 ─────────────────────────────────────────────────────────────
    print("━━━ Phase 2 — Simulating 35 experiments ━━━")
    print()

    results = []
    for exp in EXPERIMENTS:
        universe = COIN_UNIVERSES[exp["coins"]]
        eligible = [s for s in universe if s in caches]

        coin_stats = []
        for sym in eligible:
            st = simulate_trades(caches[sym], exp)
            if st:
                coin_stats.append({"sym": sym, **st})

        if not coin_stats:
            print(f"  #{exp['id']:2d} [{exp['group']:<14}] NO TRADES")
            results.append({**exp, "n_coins":0, "n_trades":0, "total_pnl":0,
                             "trade_wr":0,"trade_pf":0,"trade_sh":0,
                             "max_dd":0,"avg_lev":0,"tpc":0,"coin_stats":[]})
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

        flags = ""
        if exp.get("long_only"):      flags += "LO "
        if exp.get("breakeven_stop"): flags += "BE "
        if exp.get("trailing_stop"):  flags += "TR "
        if exp.get("asym_rr"):        flags += "AR "
        tag = "★ PROFIT" if total_pnl > 0 else ("~ NEAR" if total_pnl > -200 else "")

        print(
            f"  #{exp['id']:2d} [{exp['group']:<14}] {exp['entry']:<16} "
            f"dir={exp['dir']:<18}  {exp['coins']:<8}  {flags:<8} "
            f"coins={len(coin_stats):2d}  trades={n_trades:>5}({tpc:4.0f}/c)  "
            f"PnL=${total_pnl:>+9.2f}  WR={trade_wr:5.1f}%  PF={trade_pf:.3f}  "
            f"Sh={trade_sh:.3f}  {tag}"
        )

    # ─── Report ───────────────────────────────────────────────────────────────
    ranked  = sorted([r for r in results if r.get("n_trades", 0) > 0],
                     key=lambda r: r["total_pnl"], reverse=True)
    elapsed = time.time() - t0

    print()
    print("=" * 90)
    text = write_report(results, ranked, elapsed)
    for line in text.split("\n")[:100]:
        print(line)

    print()
    print(f"  Report → {OUTPUT_FILE}")
    print("=" * 90)


if __name__ == "__main__":
    main()

"""
tools/experiment_entry4.py
═══════════════════════════════════════════════════════════════════════════════
Round 5 — Precision Tuning on Proven Winners

R4 Findings:
  ✓ #34: multi_bar_vol + BE-stop + TP=6×ATR → +$613 (PF=1.251, Sharpe=0.724)
  ✓ #18: score>=3 (vol+one_confirm) + TP=6×ATR → +$492 (PF=1.379, Sharpe=0.875)
  ✓ #14: multi_bar_vol alone + TP=4.5×ATR → +$94 (PF=1.034)
  ✗ ARB: -$179 drag in every multi_bar_vol config — eliminate
  ✗ Long-only: all negative — short side is essential even in alt markets
  ✗ Trailing stop: cuts winners too early — ATR-fixed TP is better

Round 5 Focus:
  1. Core3 = {ETH, SOL, AAVE} — drop ARB (3× drag across R2/R3/R4)
  2. BE threshold tuning — trigger at +1×, +1.5×, +2×, +2.5× ATR
  3. Entry selectivity ladder — 2-bar, 3-bar multi_vol, score>=3, score>=4
  4. TP/leverage grid on best core3 setup
  5. Stack multi_bar_vol AND score>=3 simultaneously (ultra-filter)
  6. Grand finals: best of every dimension combined

Key Quant Insight (R4 reveal):
  strong_vol alone: highly sensitive to data window — varies $3K+ between runs
  multi_bar_vol: STABLE across runs — sustained 2-bar flow is a more robust signal
  score>=3: STABLE — multi-condition entry is less affected by noise
  → Robustness > PnL maximization at this stage
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
FEE_PER_LEG  = 0.0005
ROUND_TRIP   = FEE_PER_LEG * 2   # 0.10% RT
CAPITAL      = config.CAPITAL_PER_TRADE

TRAIN_BARS = {
    "4h":  TRAIN_DAYS * 6,
    "1h":  TRAIN_DAYS * 24,
    "15m": min(TRAIN_DAYS * 96, config.MULTI_TF_CANDLE_LIMIT),
}

OUTPUT_FILE = os.path.join(ROOT, "tools", "experiment_entry4_results.txt")

# ─── Coin Universes ────────────────────────────────────────────────────────────
# R4 per-coin on best config (multi_bar_vol + BE + TP=6×, core4):
#   SOL  +$592  41.9% WR  PF=1.93  ★★
#   ETH  +$159  50.0% WR  PF=1.62  ★
#   AAVE  +$41  31.2% WR  PF=1.07  ★
#   ARB  -$179  21.4% WR  PF=0.82  ✗ eliminated
#
COIN_UNIVERSES = {
    # Core 3 — R4 winners, no ARB drag
    "core3":    ["ETHUSDT", "SOLUSDT", "AAVEUSDT"],

    # Core 3 + BNB (high liquidity, vol patterns similar to L1)
    "c3_bnb":   ["ETHUSDT", "SOLUSDT", "AAVEUSDT", "BNBUSDT"],

    # Core 3 + OP (L2 alternative to ARB)
    "c3_op":    ["ETHUSDT", "SOLUSDT", "AAVEUSDT", "OPUSDT"],

    # Core 4 with ARB (R4 baseline for comparison)
    "core4":    ["ETHUSDT", "SOLUSDT", "ARBUSDT", "AAVEUSDT"],

    # SOL + AAVE — top 2 from R4 best config
    "sol_aave": ["SOLUSDT", "AAVEUSDT"],

    # SOL only — single-coin star
    "sol":      ["SOLUSDT"],
}

COIN_SEG = {
    "BTCUSDT":"L1","ETHUSDT":"L1","SOLUSDT":"L1","BNBUSDT":"L1",
    "ARBUSDT":"L2","OPUSDT":"L2",
    "UNIUSDT":"DeFi","AAVEUSDT":"DeFi","LINKUSDT":"DeFi",
}

# ─── Experiments ──────────────────────────────────────────────────────────────
# New field: be_thresh_atr — multiplier to trigger breakeven (default 2.0)

EXPERIMENTS = [

    # ══ A: Core3 Surgery ═══════════════════════════════════════════════════════
    # Drop ARB, test {ETH, SOL, AAVE} with proven best setups

    {"id":  1, "group":"A-Core3", "label":"core3 | multi_bar_vol + BE  TP=6.0  ← R4 winner setup",
     "dir":"4h_1h","entry":"multi_bar_vol","min_dir_margin":0.15,
     "coins":"core3","sl":1.5,"tp":6.0,"max_lev":25,
     "long_only":False,"breakeven_stop":True,"be_thresh_atr":2.0,
     "trailing_stop":False,"time_stop_bars":None},

    {"id":  2, "group":"A-Core3", "label":"core3 | score>=3 + BE  TP=6.0  ← R4 #2 setup",
     "dir":"4h_1h","entry":"score3","min_dir_margin":0.05,
     "coins":"core3","sl":1.5,"tp":6.0,"max_lev":25,
     "long_only":False,"breakeven_stop":True,"be_thresh_atr":2.0,
     "trailing_stop":False,"time_stop_bars":None},

    {"id":  3, "group":"A-Core3", "label":"core3 | multi_bar_vol  no BE  TP=6.0",
     "dir":"4h_1h","entry":"multi_bar_vol","min_dir_margin":0.15,
     "coins":"core3","sl":1.5,"tp":6.0,"max_lev":25,
     "long_only":False,"breakeven_stop":False,"be_thresh_atr":None,
     "trailing_stop":False,"time_stop_bars":None},

    {"id":  4, "group":"A-Core3", "label":"core3 | score>=3  no BE  TP=6.0",
     "dir":"4h_1h","entry":"score3","min_dir_margin":0.05,
     "coins":"core3","sl":1.5,"tp":6.0,"max_lev":25,
     "long_only":False,"breakeven_stop":False,"be_thresh_atr":None,
     "trailing_stop":False,"time_stop_bars":None},

    {"id":  5, "group":"A-Core3", "label":"core3 | multi_bar_vol + BE  TP=4.5",
     "dir":"4h_1h","entry":"multi_bar_vol","min_dir_margin":0.15,
     "coins":"core3","sl":1.5,"tp":4.5,"max_lev":25,
     "long_only":False,"breakeven_stop":True,"be_thresh_atr":2.0,
     "trailing_stop":False,"time_stop_bars":None},

    {"id":  6, "group":"A-Core3", "label":"core3 | score>=3 + BE  TP=4.5",
     "dir":"4h_1h","entry":"score3","min_dir_margin":0.05,
     "coins":"core3","sl":1.5,"tp":4.5,"max_lev":25,
     "long_only":False,"breakeven_stop":True,"be_thresh_atr":2.0,
     "trailing_stop":False,"time_stop_bars":None},

    # ══ B: BE Threshold Tuning ═════════════════════════════════════════════════
    # All use: core3 + multi_bar_vol + 4h_1h + SL=1.5 + TP=6.0
    # Question: when should we lock in profit?

    {"id":  7, "group":"B-BETuning", "label":"core3 | BE trigger at +1.0×ATR (fast protect)",
     "dir":"4h_1h","entry":"multi_bar_vol","min_dir_margin":0.15,
     "coins":"core3","sl":1.5,"tp":6.0,"max_lev":25,
     "long_only":False,"breakeven_stop":True,"be_thresh_atr":1.0,
     "trailing_stop":False,"time_stop_bars":None},

    {"id":  8, "group":"B-BETuning", "label":"core3 | BE trigger at +1.5×ATR",
     "dir":"4h_1h","entry":"multi_bar_vol","min_dir_margin":0.15,
     "coins":"core3","sl":1.5,"tp":6.0,"max_lev":25,
     "long_only":False,"breakeven_stop":True,"be_thresh_atr":1.5,
     "trailing_stop":False,"time_stop_bars":None},

    {"id":  9, "group":"B-BETuning", "label":"core3 | BE trigger at +2.0×ATR ← R4 winner",
     "dir":"4h_1h","entry":"multi_bar_vol","min_dir_margin":0.15,
     "coins":"core3","sl":1.5,"tp":6.0,"max_lev":25,
     "long_only":False,"breakeven_stop":True,"be_thresh_atr":2.0,
     "trailing_stop":False,"time_stop_bars":None},

    {"id": 10, "group":"B-BETuning", "label":"core3 | BE trigger at +2.5×ATR (slow, let breathe)",
     "dir":"4h_1h","entry":"multi_bar_vol","min_dir_margin":0.15,
     "coins":"core3","sl":1.5,"tp":6.0,"max_lev":25,
     "long_only":False,"breakeven_stop":True,"be_thresh_atr":2.5,
     "trailing_stop":False,"time_stop_bars":None},

    # score>=3 BE threshold
    {"id": 11, "group":"B-BETuning", "label":"core3 | score>=3 BE at +1.5×ATR",
     "dir":"4h_1h","entry":"score3","min_dir_margin":0.05,
     "coins":"core3","sl":1.5,"tp":6.0,"max_lev":25,
     "long_only":False,"breakeven_stop":True,"be_thresh_atr":1.5,
     "trailing_stop":False,"time_stop_bars":None},

    {"id": 12, "group":"B-BETuning", "label":"core3 | score>=3 BE at +1.0×ATR",
     "dir":"4h_1h","entry":"score3","min_dir_margin":0.05,
     "coins":"core3","sl":1.5,"tp":6.0,"max_lev":25,
     "long_only":False,"breakeven_stop":True,"be_thresh_atr":1.0,
     "trailing_stop":False,"time_stop_bars":None},

    # ══ C: Entry Selectivity Ladder ════════════════════════════════════════════
    # How selective should the entry be?
    # All: core3 + 4h_1h + BE@2×ATR + SL=1.5 + TP=6.0

    # Least selective: single strong bar
    {"id": 13, "group":"C-Selectivity", "label":"core3 | strong_vol (z>2.0, 1 bar)  BE  TP=6",
     "dir":"4h_1h","entry":"strong_vol","min_dir_margin":0.05,
     "coins":"core3","sl":1.5,"tp":6.0,"max_lev":25,
     "long_only":False,"breakeven_stop":True,"be_thresh_atr":2.0,
     "trailing_stop":False,"time_stop_bars":None},

    # 2 consecutive bars (R4 winner)
    {"id": 14, "group":"C-Selectivity", "label":"core3 | multi_bar_vol (z>2, 2 bars)  BE  TP=6",
     "dir":"4h_1h","entry":"multi_bar_vol","min_dir_margin":0.15,
     "coins":"core3","sl":1.5,"tp":6.0,"max_lev":25,
     "long_only":False,"breakeven_stop":True,"be_thresh_atr":2.0,
     "trailing_stop":False,"time_stop_bars":None},

    # 3 consecutive bars (ultra-sustained momentum)
    {"id": 15, "group":"C-Selectivity", "label":"core3 | multi_bar_vol_3 (z>2, 3 bars)  BE  TP=6",
     "dir":"4h_1h","entry":"multi_bar_vol_3","min_dir_margin":0.15,
     "coins":"core3","sl":1.5,"tp":6.0,"max_lev":25,
     "long_only":False,"breakeven_stop":True,"be_thresh_atr":2.0,
     "trailing_stop":False,"time_stop_bars":None},

    # Score-based: vol alone (score>=2)
    {"id": 16, "group":"C-Selectivity", "label":"core3 | score>=2 (vol alone ok)  BE  TP=6",
     "dir":"4h_1h","entry":"score2","min_dir_margin":0.05,
     "coins":"core3","sl":1.5,"tp":6.0,"max_lev":25,
     "long_only":False,"breakeven_stop":True,"be_thresh_atr":2.0,
     "trailing_stop":False,"time_stop_bars":None},

    # Score>=3: vol + one confirm (R4 #2 winner)
    {"id": 17, "group":"C-Selectivity", "label":"core3 | score>=3 (vol+1)  BE  TP=6",
     "dir":"4h_1h","entry":"score3","min_dir_margin":0.05,
     "coins":"core3","sl":1.5,"tp":6.0,"max_lev":25,
     "long_only":False,"breakeven_stop":True,"be_thresh_atr":2.0,
     "trailing_stop":False,"time_stop_bars":None},

    # Score>=4: vol + two confirms (maximum precision)
    {"id": 18, "group":"C-Selectivity", "label":"core3 | score>=4 (vol+2)  BE  TP=6",
     "dir":"4h_1h","entry":"score4","min_dir_margin":0.05,
     "coins":"core3","sl":1.5,"tp":6.0,"max_lev":25,
     "long_only":False,"breakeven_stop":True,"be_thresh_atr":2.0,
     "trailing_stop":False,"time_stop_bars":None},

    # ══ D: TP/Leverage Grid ════════════════════════════════════════════════════
    # All use: core3 + multi_bar_vol + BE@2×ATR + 4h_1h margin>0.15

    {"id": 19, "group":"D-TPLev", "label":"core3 | multi+BE  SL=1.0  TP=3.0  lev=25",
     "dir":"4h_1h","entry":"multi_bar_vol","min_dir_margin":0.15,
     "coins":"core3","sl":1.0,"tp":3.0,"max_lev":25,
     "long_only":False,"breakeven_stop":True,"be_thresh_atr":2.0,
     "trailing_stop":False,"time_stop_bars":None},

    {"id": 20, "group":"D-TPLev", "label":"core3 | multi+BE  SL=1.5  TP=4.5  lev=25",
     "dir":"4h_1h","entry":"multi_bar_vol","min_dir_margin":0.15,
     "coins":"core3","sl":1.5,"tp":4.5,"max_lev":25,
     "long_only":False,"breakeven_stop":True,"be_thresh_atr":2.0,
     "trailing_stop":False,"time_stop_bars":None},

    {"id": 21, "group":"D-TPLev", "label":"core3 | multi+BE  SL=1.5  TP=6.0  lev=25  ← R4 base",
     "dir":"4h_1h","entry":"multi_bar_vol","min_dir_margin":0.15,
     "coins":"core3","sl":1.5,"tp":6.0,"max_lev":25,
     "long_only":False,"breakeven_stop":True,"be_thresh_atr":2.0,
     "trailing_stop":False,"time_stop_bars":None},

    {"id": 22, "group":"D-TPLev", "label":"core3 | multi+BE  SL=1.5  TP=7.5  lev=25",
     "dir":"4h_1h","entry":"multi_bar_vol","min_dir_margin":0.15,
     "coins":"core3","sl":1.5,"tp":7.5,"max_lev":25,
     "long_only":False,"breakeven_stop":True,"be_thresh_atr":2.0,
     "trailing_stop":False,"time_stop_bars":None},

    {"id": 23, "group":"D-TPLev", "label":"core3 | multi+BE  SL=1.5  TP=6.0  lev=15",
     "dir":"4h_1h","entry":"multi_bar_vol","min_dir_margin":0.15,
     "coins":"core3","sl":1.5,"tp":6.0,"max_lev":15,
     "long_only":False,"breakeven_stop":True,"be_thresh_atr":2.0,
     "trailing_stop":False,"time_stop_bars":None},

    {"id": 24, "group":"D-TPLev", "label":"core3 | multi+BE  SL=1.5  TP=6.0  lev=20",
     "dir":"4h_1h","entry":"multi_bar_vol","min_dir_margin":0.15,
     "coins":"core3","sl":1.5,"tp":6.0,"max_lev":20,
     "long_only":False,"breakeven_stop":True,"be_thresh_atr":2.0,
     "trailing_stop":False,"time_stop_bars":None},

    # ══ E: Ultra-Combo — Stack ALL Best Findings ═══════════════════════════════

    # Stack: multi_bar_vol AND score>=3 must BOTH fire (extremely selective)
    {"id": 25, "group":"E-Grand", "label":"ULTRA: multi+score3 BOTH fire + BE + TP=6.0",
     "dir":"4h_1h","entry":"multi_and_score3","min_dir_margin":0.15,
     "coins":"core3","sl":1.5,"tp":6.0,"max_lev":25,
     "long_only":False,"breakeven_stop":True,"be_thresh_atr":2.0,
     "trailing_stop":False,"time_stop_bars":None},

    # Same but wider TP
    {"id": 26, "group":"E-Grand", "label":"ULTRA: multi+score3 BOTH + BE@1.5 + TP=7.5",
     "dir":"4h_1h","entry":"multi_and_score3","min_dir_margin":0.15,
     "coins":"core3","sl":1.5,"tp":7.5,"max_lev":25,
     "long_only":False,"breakeven_stop":True,"be_thresh_atr":1.5,
     "trailing_stop":False,"time_stop_bars":None},

    # SOL-only focus: SOL was +$592 in R4 best config alone
    {"id": 27, "group":"E-Grand", "label":"SOL ONLY | multi_bar_vol + BE@2×ATR  TP=6.0",
     "dir":"4h_1h","entry":"multi_bar_vol","min_dir_margin":0.15,
     "coins":"sol",  "sl":1.5,"tp":6.0,"max_lev":25,
     "long_only":False,"breakeven_stop":True,"be_thresh_atr":2.0,
     "trailing_stop":False,"time_stop_bars":None},

    # SOL+AAVE only
    {"id": 28, "group":"E-Grand", "label":"SOL+AAVE | multi_bar_vol + BE  TP=6.0",
     "dir":"4h_1h","entry":"multi_bar_vol","min_dir_margin":0.15,
     "coins":"sol_aave","sl":1.5,"tp":6.0,"max_lev":25,
     "long_only":False,"breakeven_stop":True,"be_thresh_atr":2.0,
     "trailing_stop":False,"time_stop_bars":None},

    # Best direction: 4h_1h_both_strong was tested, try 4h_strong with multi_bar_vol+BE
    {"id": 29, "group":"E-Grand", "label":"core3 | 4h_strong margin>0.20 + multi+BE  TP=6.0",
     "dir":"4h_strong","entry":"multi_bar_vol","min_dir_margin":0.20,
     "coins":"core3","sl":1.5,"tp":6.0,"max_lev":25,
     "long_only":False,"breakeven_stop":True,"be_thresh_atr":2.0,
     "trailing_stop":False,"time_stop_bars":None},

    # Grand Final: every winner stacked
    {"id": 30, "group":"E-Grand", "label":"FINAL: core3+score3+BE@1.5+TP=6.0+lev=20",
     "dir":"4h_1h","entry":"score3","min_dir_margin":0.10,
     "coins":"core3","sl":1.5,"tp":6.0,"max_lev":20,
     "long_only":False,"breakeven_stop":True,"be_thresh_atr":1.5,
     "trailing_stop":False,"time_stop_bars":None},
]

assert len(EXPERIMENTS) == 30, f"Expected 30 got {len(EXPERIMENTS)}"
assert len({e["id"] for e in EXPERIMENTS}) == 30


# ─── Data fetch ───────────────────────────────────────────────────────────────

def fetch_tf(symbol, interval, total_months):
    mins_map = {"4h": 240, "1h": 60, "15m": 15}
    mins_per_bar = mins_map[interval]
    n_bars = int((total_months * 30 * 24 * 60 / mins_per_bar) * 1.1)
    now_ms   = int(datetime.now(timezone.utc).timestamp() * 1000)
    start_ms = now_ms - n_bars * mins_per_bar * 60 * 1000
    klines, cur = [], start_ms
    while True:
        try:
            r = requests.get("https://fapi.binance.com/fapi/v1/klines",
                             params={"symbol": symbol, "interval": interval,
                                     "startTime": cur, "limit": 1500}, timeout=20)
            if r.status_code != 200: break
            batch = r.json()
            if not batch or isinstance(batch, dict): break
            klines.extend(batch)
            if len(batch) < 1500: break
            cur = int(batch[-1][0]) + 1
            time.sleep(0.06)
        except Exception as e:
            print(f"    {symbol}/{interval}: {e}"); break
    if not klines: return None
    df_raw = _parse_klines_df(klines)
    if df_raw is None or df_raw.empty: return None
    try:
        df = compute_all_features(df_raw).dropna().reset_index(drop=True)
    except Exception as e:
        print(f"    feature error {symbol}/{interval}: {e}"); return None
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
    if not len(valid): return regimes, margins
    Xv = (X.iloc[valid].values - brain._feat_mean) / brain._feat_std
    try:
        raw   = brain.model.predict(Xv)
        proba = brain.model.predict_proba(Xv)
        canon = np.array([brain._state_map.get(int(s), config.REGIME_CHOP) for s in raw])
        sp    = np.sort(proba, axis=1)[:, ::-1]
        marg  = sp[:, 0] - sp[:, 1]
        regimes[valid] = canon
        margins[valid] = marg
    except Exception: pass
    return regimes, margins


# ─── Phase 1: Pre-compute ─────────────────────────────────────────────────────

def precompute_coin(symbol):
    total = WARMUP_MONTHS + TEST_MONTHS
    dfs = {}
    for tf in ["4h", "1h", "15m"]:
        df = fetch_tf(symbol, tf, total)
        if df is None or df.empty:
            print(f"    {symbol}/{tf}: NO DATA"); return None
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
                try: b.train(train_data)
                except Exception: pass
            brains[tf] = b
        for tf, df_tf in dfs.items():
            mask = (df_tf["timestamp"] >= cutoff) & (df_tf["timestamp"] < next_cut)
            idx  = np.where(mask)[0]
            if not len(idx) or not brains[tf].is_trained: continue
            r, m = predict_block(brains[tf], df_tf.iloc[idx].copy())
            if len(idx) > 1:
                preds[tf]["regime"][idx[1:]] = r[:-1]
                preds[tf]["margin"][idx[1:]] = m[:-1]

    return {"symbol": symbol, "dfs": dfs, "preds": preds, "test_start_ts": test_start_ts}


# ─── Lookup helpers ────────────────────────────────────────────────────────────

def _regime_at(pred_dict, df_tf, ts):
    idx = int(np.searchsorted(df_tf["timestamp"].values, np.datetime64(ts), side="right")) - 1
    if idx < 0: return config.REGIME_CHOP, 0.0
    return int(pred_dict["regime"][idx]), float(pred_dict["margin"][idx])

def _atr_at(dfs, ts):
    df  = dfs["1h"]
    idx = int(np.searchsorted(df["timestamp"].values, np.datetime64(ts), side="right")) - 1
    if idx < 0 or "atr" not in df.columns: return None
    v = float(df["atr"].iloc[idx])
    return v if (v > 0 and not np.isnan(v)) else None


# ─── Direction functions ───────────────────────────────────────────────────────

def _dir_4h_1h(p4h, m4h, p1h, m1h, p15m, m15m):
    if p4h == config.REGIME_BULL and p1h == config.REGIME_BULL:
        return "BUY",  (m4h + m1h) / 2
    if p4h == config.REGIME_BEAR and p1h == config.REGIME_BEAR:
        return "SELL", (m4h + m1h) / 2
    return None, 0.0

def _dir_4h_strong(p4h, m4h, p1h, m1h, p15m, m15m):
    if p4h == config.REGIME_BULL: return "BUY",  m4h
    if p4h == config.REGIME_BEAR: return "SELL", m4h
    return None, 0.0

DIRECTION_FNS = {
    "4h_1h":     _dir_4h_1h,
    "4h_strong": _dir_4h_strong,
}


# ─── Entry triggers ────────────────────────────────────────────────────────────

def _vol_zscore_at(df, i):
    if i < 1 or "vol_zscore" not in df.columns: return 0.0
    return float(df["vol_zscore"].iloc[i-1])

def _entry_strong_vol(df, i, p, side, thresh=2.0):
    vz  = _vol_zscore_at(df, i)
    reg = p["regime"][i-1] if i > 0 else config.REGIME_CHOP
    if side == "BUY":  return vz > thresh and reg == config.REGIME_BULL
    return vz > thresh and reg == config.REGIME_BEAR

def _entry_multi_bar_vol(df, i, p, side, thresh=2.0, bars=2):
    """vol_zscore > thresh for `bars` consecutive bars."""
    if i < bars or "vol_zscore" not in df.columns: return False
    for lag in range(1, bars + 1):
        vz  = float(df["vol_zscore"].iloc[i - lag])
        reg = p["regime"][i - lag]
        ok  = vz > thresh
        if side == "BUY":  ok = ok and reg == config.REGIME_BULL
        else:              ok = ok and reg == config.REGIME_BEAR
        if not ok: return False
    return True

def _entry_multi_bar_vol_3(df, i, p, side):
    """3 consecutive bars — ultra-sustained."""
    return _entry_multi_bar_vol(df, i, p, side, thresh=2.0, bars=3)

def _entry_vwap(df, i, p, side):
    if i < 2 or "vwap_dist" not in df.columns: return False
    c = float(df["vwap_dist"].iloc[i-1])
    v = float(df["vwap_dist"].iloc[i-2])
    if side == "BUY":  return c > 0 and v <= 0
    return c < 0 and v >= 0

def _entry_pullback(df, i, p, side):
    if i < 2: return False
    c0, c1, c2 = p["regime"][i], p["regime"][i-1], p["regime"][i-2]
    if side == "BUY":
        return c0 == config.REGIME_BULL and c1 == config.REGIME_CHOP and c2 == config.REGIME_BULL
    return c0 == config.REGIME_BEAR and c1 == config.REGIME_CHOP and c2 == config.REGIME_BEAR

def _entry_rsi_dip(df, i, p, side):
    if i < 2 or "rsi" not in df.columns: return False
    c = float(df["rsi"].iloc[i-1])
    v = float(df["rsi"].iloc[i-2])
    if side == "BUY":  return c > 40 and v <= 40
    return c < 60 and v >= 60

def _score_base(df, i, p, side):
    score = 0
    if _entry_strong_vol(df, i, p, side):  score += 2
    if _entry_vwap(df, i, p, side):        score += 1
    if _entry_pullback(df, i, p, side):    score += 1
    if _entry_rsi_dip(df, i, p, side):     score += 1
    return score

def _entry_score2(df, i, p, side): return _score_base(df, i, p, side) >= 2
def _entry_score3(df, i, p, side): return _score_base(df, i, p, side) >= 3
def _entry_score4(df, i, p, side): return _score_base(df, i, p, side) >= 4

def _entry_multi_and_score3(df, i, p, side):
    """Both multi_bar_vol AND score>=3 must fire — maximum precision."""
    return _entry_multi_bar_vol(df, i, p, side) and _entry_score3(df, i, p, side)

ENTRY_FNS = {
    "strong_vol":        _entry_strong_vol,
    "multi_bar_vol":     _entry_multi_bar_vol,
    "multi_bar_vol_3":   _entry_multi_bar_vol_3,
    "score2":            _entry_score2,
    "score3":            _entry_score3,
    "score4":            _entry_score4,
    "multi_and_score3":  _entry_multi_and_score3,
}


# ─── Phase 2: Simulation ─────────────────────────────────────────────────────

def simulate_trades(cache, exp):
    dfs, preds    = cache["dfs"], cache["preds"]
    test_start    = cache["test_start_ts"]
    df_15m        = dfs["15m"]
    pred_15m      = preds["15m"]

    dir_fn        = DIRECTION_FNS[exp["dir"]]
    entry_fn      = ENTRY_FNS[exp["entry"]]
    min_margin    = exp["min_dir_margin"]
    sl_mult       = exp["sl"]
    tp_mult       = exp.get("tp")
    max_lev       = exp["max_lev"]
    be_stop       = exp.get("breakeven_stop", False)
    be_thresh     = exp.get("be_thresh_atr", 2.0) or 2.0
    trail_stop    = exp.get("trailing_stop", False)
    time_stop     = exp.get("time_stop_bars")
    long_only     = exp.get("long_only", False)

    ts_15m   = df_15m["timestamp"].values
    test_arr = np.where(ts_15m >= np.datetime64(test_start))[0]
    if not len(test_arr): return None
    test_idx = int(test_arr[0])

    trades, open_trade = [], None

    for i in range(test_idx, len(df_15m)):
        row   = df_15m.iloc[i]
        ts    = row["timestamp"]
        open_ = float(row["open"])
        high  = float(row["high"])
        low   = float(row["low"])
        close = float(row["close"])

        p4h, m4h  = _regime_at(preds["4h"],  dfs["4h"],  ts)
        p1h, m1h  = _regime_at(preds["1h"],  dfs["1h"],  ts)
        p15m, m15m = pred_15m["regime"][i], pred_15m["margin"][i]

        direction, dir_margin = dir_fn(p4h, m4h, p1h, m1h, p15m, m15m)
        if direction is not None and float(dir_margin) < min_margin:
            direction = None
        if long_only and direction == "SELL":
            direction = None

        if open_trade is not None:
            ot = open_trade
            d  = 1 if ot["side"] == "BUY" else -1
            ep = er = None

            # Trailing stop update
            if trail_stop:
                trail_d = 1.5 * ot["atr"]
                if d == 1:
                    ns = high - trail_d
                    if ns > ot["sl"]: ot["sl"] = ns
                else:
                    ns = low + trail_d
                    if ns < ot["sl"]: ot["sl"] = ns

            # Breakeven stop: once price moved be_thresh×ATR in our favor
            if be_stop:
                be_level = be_thresh * ot["atr"]
                if d == 1 and close >= ot["entry"] + be_level:
                    ot["sl"] = max(ot["sl"], ot["entry"])
                elif d == -1 and close <= ot["entry"] - be_level:
                    ot["sl"] = min(ot["sl"], ot["entry"])

            # SL
            if d == 1:
                if low  <= ot["sl"]: ep, er = ot["sl"], "SL"
            else:
                if high >= ot["sl"]: ep, er = ot["sl"], "SL"
            # TP
            if ep is None and ot["tp"] is not None:
                if d == 1:
                    if high >= ot["tp"]: ep, er = ot["tp"], "TP"
                else:
                    if low  <= ot["tp"]: ep, er = ot["tp"], "TP"
            # DIR_FLIP
            if ep is None and direction is not None and direction != ot["side"]:
                ep, er = close, "DIR_FLIP"
            # Time stop
            if ep is None and time_stop and (i - ot["entry_i"]) >= time_stop:
                ep, er = close, "TIME"

            if ep is not None:
                raw = (ep - ot["entry"]) / ot["entry"] * d
                net = max(raw * ot["lev"] - ROUND_TRIP * ot["lev"], -1.0)
                trades.append({"pnl": round(CAPITAL * net, 4), "reason": er,
                                "side": ot["side"], "lev": ot["lev"],
                                "entry_ts": ot["entry_ts"], "exit_ts": ts})
                open_trade = None

        if open_trade is None and direction is not None:
            if entry_fn(df_15m, i, pred_15m, direction):
                atr = _atr_at(dfs, ts)
                if atr is None: atr = close * 0.01
                vol_ratio = atr / close if close > 0 else 0
                if vol_ratio < config.VOL_MIN_ATR_PCT or vol_ratio > config.VOL_MAX_ATR_PCT:
                    continue
                if   dir_margin >= 0.30: lev = min(25, max_lev)
                elif dir_margin >= 0.20: lev = min(20, max_lev)
                elif dir_margin >= 0.10: lev = min(15, max_lev)
                else:                    lev = min(10, max_lev)

                if direction == "BUY":
                    sl = open_ - sl_mult * atr
                    tp = (open_ + tp_mult * atr) if tp_mult else None
                else:
                    sl = open_ + sl_mult * atr
                    tp = (open_ - tp_mult * atr) if tp_mult else None

                open_trade = {"side": direction, "entry": open_, "sl": sl, "tp": tp,
                              "lev": lev, "entry_ts": ts, "atr": atr, "entry_i": i}

    if open_trade is not None:
        ot = open_trade
        d  = 1 if ot["side"] == "BUY" else -1
        last = df_15m.iloc[-1]
        raw  = (float(last["close"]) - ot["entry"]) / ot["entry"] * d
        net  = max(raw * ot["lev"] - ROUND_TRIP * ot["lev"], -1.0)
        trades.append({"pnl": round(CAPITAL * net, 4), "reason": "EOD",
                       "side": ot["side"], "lev": ot["lev"],
                       "entry_ts": ot["entry_ts"], "exit_ts": last["timestamp"]})

    if not trades: return None

    pnls = np.array([t["pnl"] for t in trades])
    wins = pnls[pnls > 0]; loss = pnls[pnls <= 0]
    cum  = np.cumsum(pnls)
    dd   = cum - np.maximum.accumulate(cum)
    exits = defaultdict(int)
    for t in trades: exits[t["reason"]] += 1

    return {
        "n_trades":  len(trades),
        "total_pnl": round(float(pnls.sum()), 2),
        "win_rate":  round(len(wins) / len(pnls) * 100, 1),
        "pf":        round(float(wins.sum()) / abs(float(loss.sum())), 3) if len(loss) and loss.sum() != 0 else 999.0,
        "sharpe":    round(float(pnls.mean() / pnls.std() * np.sqrt(len(pnls))), 3) if pnls.std() > 1e-5 else 0.0,
        "max_dd":    round(float(dd.min()), 2),
        "avg_lev":   round(float(np.mean([t["lev"] for t in trades])), 1),
        "exits":     dict(exits), "trades": trades,
    }


# ─── Report ────────────────────────────────────────────────────────────────────

def write_report(results, ranked, elapsed):
    W = 130
    lines = []
    h = lambda s: lines.append(s)

    h("=" * W)
    h("  SYNAPTIC QUANT LAB — ROUND 5: PRECISION TUNING ON PROVEN WINNERS")
    h(f"  Fee: {FEE_PER_LEG*100:.2f}%/leg = {ROUND_TRIP*100:.2f}% RT  |  "
      f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    h(f"  Winners to beat: R4 #34 +$613 (PF=1.251) | R4 #18 +$492 (PF=1.379)")
    h("=" * W)
    h("")

    hdr = (f"  {'Rk':>3}  {'#':>2}  {'Group':<14}  {'Label':<56}  "
           f"{'Entry':<18}  {'Coins':<9}  {'BE':>4}  {'SL/TP':<8}  {'Lev':>4}  "
           f"{'Trd':>5}  {'T/c':>4}  {'PnL':>10}  {'WR':>6}  {'PF':>6}  "
           f"{'Sh':>6}  {'MDD':>8}")
    h(hdr)
    h("  " + "─" * (W - 2))

    for rk, r in enumerate(ranked, 1):
        tp_str = f"{r['sl']:.1f}/{r['tp']:.1f}" if r.get("tp") else f"{r['sl']:.1f}/Flip"
        be_str = f"@{r.get('be_thresh_atr',0):.1f}" if r.get("breakeven_stop") else "off"
        tag    = "★ PROFIT" if r["total_pnl"] > 0 else ("~ NEAR" if r["total_pnl"] > -100 else "")
        h(f"  {rk:>3}  {r['id']:>2}  {r['group']:<14}  {r['label'][:56]:<56}  "
          f"{r['entry']:<18}  {r['coins']:<9}  {be_str:>4}  {tp_str:<8}  "
          f"{r['max_lev']:>4}  {r['n_trades']:>5}  {r.get('tpc',0):>4.0f}  "
          f"${r['total_pnl']:>9.2f}  {r.get('trade_wr',0):>5.1f}%  "
          f"{r.get('trade_pf',0):>6.3f}  {r.get('trade_sh',0):>6.3f}  "
          f"${r.get('max_dd',0):>7.0f}  {tag}")

    h("")
    h("=" * 80)
    h("  GROUP AVERAGES")
    h("=" * 80)
    groups = defaultdict(list)
    for r in ranked: groups[r["group"]].append(r)
    for g, rs in sorted(groups.items()):
        best    = max(rs, key=lambda x: x["total_pnl"])
        avg_pnl = sum(r["total_pnl"] for r in rs) / len(rs)
        avg_pf  = sum(r.get("trade_pf",0) for r in rs) / len(rs)
        avg_sh  = sum(r.get("trade_sh",0) for r in rs) / len(rs)
        h(f"  {g:<18}  n={len(rs)}  avgPnL=${avg_pnl:>9.2f}  "
          f"avgPF={avg_pf:.3f}  avgSh={avg_sh:.3f}  best=#{best['id']} ${best['total_pnl']:+.2f}")

    h("")
    h("=" * 80)
    h("  BE THRESHOLD ANALYSIS")
    h("=" * 80)
    be_configs = [r for r in ranked if r.get("breakeven_stop") and r["entry"] == "multi_bar_vol"]
    for r in sorted(be_configs, key=lambda x: x.get("be_thresh_atr", 0)):
        h(f"  BE@{r.get('be_thresh_atr',0):.1f}×ATR  {r['coins']:<9}  "
          f"PnL=${r['total_pnl']:>+9.2f}  PF={r.get('trade_pf',0):.3f}  "
          f"WR={r.get('trade_wr',0):.1f}%  Trades={r['n_trades']}")

    h("")
    h("=" * 80)
    h("  ENTRY SELECTIVITY LADDER")
    h("=" * 80)
    sel_entries = ["strong_vol","multi_bar_vol","multi_bar_vol_3","score2","score3","score4","multi_and_score3"]
    for en in sel_entries:
        rs = [r for r in ranked if r["entry"] == en]
        if rs:
            best = max(rs, key=lambda x: x["total_pnl"])
            avg_tr = sum(r["n_trades"] for r in rs) / len(rs) / max(r.get("n_coins",1) for r in rs)
            h(f"  {en:<22}  n={len(rs)}  avgTrades/coin={avg_tr:.0f}  "
              f"best=#{best['id']} ${best['total_pnl']:+.2f}  "
              f"PF={best.get('trade_pf',0):.3f}  Sh={best.get('trade_sh',0):.3f}")

    h("")
    h("=" * 80)
    h("  COIN UNIVERSE ANALYSIS")
    h("=" * 80)
    by_coins = defaultdict(list)
    for r in ranked: by_coins[r["coins"]].append(r)
    for cu, rs in sorted(by_coins.items(), key=lambda x: sum(r["total_pnl"] for r in x[1])/len(x[1]), reverse=True):
        best    = max(rs, key=lambda x: x["total_pnl"])
        avg_pnl = sum(r["total_pnl"] for r in rs) / len(rs)
        h(f"  {cu:<10}  n={len(rs)}  avgPnL=${avg_pnl:>9.2f}  best=#{best['id']} ${best['total_pnl']:+.2f}")

    h("")
    h("=" * 80)
    h("  EXIT REASON BREAKDOWN")
    h("=" * 80)
    all_exits, total_ex = defaultdict(int), 0
    for r in ranked:
        for reason, cnt in r.get("exits", {}).items():
            all_exits[reason] += cnt; total_ex += cnt
    for reason, cnt in sorted(all_exits.items(), key=lambda x: -x[1]):
        pct = cnt / total_ex * 100 if total_ex else 0
        h(f"  {reason:<14}  {cnt:>6}  ({pct:.1f}%)")

    h("")
    h("=" * 80)
    h(f"  PER-COIN — Best Config #{ranked[0]['id'] if ranked else 'N/A'}")
    h("=" * 80)
    if ranked:
        r = ranked[0]
        h(f"  {r['label']}")
        h(f"  Entry={r['entry']}  BE={r.get('breakeven_stop')}@{r.get('be_thresh_atr')}×ATR  "
          f"SL={r['sl']}/TP={r.get('tp','Flip')}  Lev={r['max_lev']}x")
        h("")
        for cs in sorted(r.get("coin_stats", []), key=lambda x: x["total_pnl"], reverse=True):
            sym  = cs["sym"]
            seg  = COIN_SEG.get(sym, "?")
            star = "★" if cs["total_pnl"] > 0 else "✗" if cs["total_pnl"] < -50 else "~"
            h(f"  {sym:<12}  [{seg:<6}] {star}  PnL=${cs['total_pnl']:>+8.2f}  "
              f"trades={cs['n_trades']:>4}  WR={cs['win_rate']:>5.1f}%  "
              f"PF={cs['pf']:>6.3f}  Sh={cs['sharpe']:>6.3f}  exits={cs['exits']}")

    h("")
    h("=" * 80)
    h("  TOP 10 CONFIGURATIONS")
    h("=" * 80)
    h("")
    for rk, r in enumerate(ranked[:10], 1):
        be_desc = f"BE@{r.get('be_thresh_atr',0):.1f}×ATR" if r.get("breakeven_stop") else "no BE"
        h(f"  #{rk}  [{r['group']}] #{r['id']} — {r['label']}")
        h(f"      Entry={r['entry']}  Coins={r['coins']}  {be_desc}  "
          f"SL={r['sl']}/TP={r.get('tp','Flip')}×ATR  MaxLev={r['max_lev']}x  "
          f"MinMargin={r['min_dir_margin']}")
        h(f"      PnL=${r['total_pnl']:+.2f}  WR={r.get('trade_wr',0):.1f}%  "
          f"PF={r.get('trade_pf',0):.3f}  Sharpe={r.get('trade_sh',0):.3f}  "
          f"Trades={r['n_trades']}({r.get('tpc',0):.0f}/coin)  MDD=${r.get('max_dd',0):.0f}")
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
    print("  Synaptic Quant Lab — Round 5: Precision Tuning (30 configs)")
    print(f"  Fee: {FEE_PER_LEG*100:.2f}%/leg = {ROUND_TRIP*100:.2f}% RT")
    print(f"  Coins: {len(all_coins)}  {all_coins}")
    print(f"  Focus: core3={{ETH,SOL,AAVE}}, BE threshold tuning, selectivity ladder")
    print("=" * 90)
    print()

    print("━━━ Phase 1 — Pre-computing ━━━")
    caches = {}
    for i, sym in enumerate(all_coins, 1):
        print(f"  [{i:2d}/{len(all_coins)}] {sym:14s} ...", end=" ", flush=True)
        c = precompute_coin(sym)
        if c is None:
            print("SKIP"); continue
        caches[sym] = c
        seg = COIN_SEG.get(sym, "?")
        print(f"OK [{seg:6s}]  4h={len(c['dfs']['4h']):4d}  1h={len(c['dfs']['1h']):5d}  15m={len(c['dfs']['15m']):6d}")
    print(f"\n  Precomputed {len(caches)}/{len(all_coins)} coins\n")

    print("━━━ Phase 2 — Simulating 30 experiments ━━━")
    print()

    results = []
    for exp in EXPERIMENTS:
        universe = COIN_UNIVERSES[exp["coins"]]
        eligible = [s for s in universe if s in caches]

        coin_stats = []
        for sym in eligible:
            st = simulate_trades(caches[sym], exp)
            if st: coin_stats.append({"sym": sym, **st})

        if not coin_stats:
            print(f"  #{exp['id']:2d} [{exp['group']:<14}] NO TRADES")
            results.append({**exp,"n_coins":0,"n_trades":0,"total_pnl":0,
                            "trade_wr":0,"trade_pf":0,"trade_sh":0,"max_dd":0,
                            "avg_lev":0,"tpc":0,"coin_stats":[]})
            continue

        all_pnls = []
        all_exits = defaultdict(int)
        for cs in coin_stats:
            all_pnls.extend([t["pnl"] for t in cs["trades"]])
            for reason, cnt in cs["exits"].items():
                all_exits[reason] += cnt

        tp_arr   = np.array(all_pnls)
        t_wins   = tp_arr[tp_arr > 0]; t_loss = tp_arr[tp_arr <= 0]
        trade_wr = round(len(t_wins) / len(tp_arr) * 100, 1) if len(tp_arr) else 0
        trade_pf = round(float(t_wins.sum()) / abs(float(t_loss.sum())), 3) if len(t_loss) and t_loss.sum() != 0 else 999.0
        trade_sh = round(float(tp_arr.mean() / tp_arr.std() * np.sqrt(len(tp_arr))), 3) if tp_arr.std() > 1e-5 else 0.0

        cp_arr    = np.array([cs["total_pnl"] for cs in coin_stats])
        total_pnl = round(float(cp_arr.sum()), 2)
        n_trades  = sum(cs["n_trades"] for cs in coin_stats)
        tpc       = round(n_trades / len(coin_stats), 0)
        avg_lev   = round(np.mean([cs["avg_lev"] for cs in coin_stats]), 1)
        max_dd    = sum(cs["max_dd"] for cs in coin_stats)

        r = {**exp, "n_coins": len(coin_stats), "n_trades": n_trades, "tpc": tpc,
             "total_pnl": total_pnl, "trade_wr": trade_wr,
             "trade_pf": trade_pf, "trade_sh": trade_sh,
             "max_dd": round(max_dd, 2), "avg_lev": avg_lev,
             "exits": dict(all_exits), "coin_stats": coin_stats}
        results.append(r)

        be_str = f"BE@{exp.get('be_thresh_atr',0):.1f}" if exp.get("breakeven_stop") else "noBE"
        tag    = "★ PROFIT" if total_pnl > 0 else ("~ NEAR" if total_pnl > -100 else "")
        print(f"  #{exp['id']:2d} [{exp['group']:<14}] {exp['entry']:<18} "
              f"{exp['coins']:<9}  {be_str:<7}  "
              f"coins={len(coin_stats)}  trades={n_trades:>4}({tpc:3.0f}/c)  "
              f"PnL=${total_pnl:>+9.2f}  WR={trade_wr:5.1f}%  PF={trade_pf:.3f}  "
              f"Sh={trade_sh:.3f}  {tag}")

    ranked  = sorted([r for r in results if r.get("n_trades",0) > 0],
                     key=lambda r: r["total_pnl"], reverse=True)
    elapsed = time.time() - t0

    print()
    print("=" * 90)
    text = write_report(results, ranked, elapsed)
    for line in text.split("\n")[:90]: print(line)
    print()
    print(f"  Report → {OUTPUT_FILE}")
    print("=" * 90)


if __name__ == "__main__":
    main()

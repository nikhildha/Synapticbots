"""
tools/backtest_prod_6m.py

Prod-faithful 6-month walk-forward backtest — replicates the live Synaptic engine.

Prod-faithful elements:
  ✓ GMMHMM (n_mix=3, diag, min_covar=1e-3) — same model as live engine
  ✓ Per-coin pruned features from segment_features.py
  ✓ MultiTF conviction (1d×20 + 1h×50 + 15m×30, ≥2/3 TF agreement)
  ✓ MIN_CONVICTION_FOR_DEPLOY = 65 (config)
  ✓ Conviction-based leverage: ≥95→35x, ≥80→25x, ≥70→15x
  ✓ ATR-based SL/TP via get_atr_multipliers()
  ✓ Volatility filter (ATR/price 0.3%–6%)
  ✓ 0.05% fee + 0.05% slippage per leg (0.2% round-trip)
  ✓ One position per coin — no pyramiding

Excluded (not backtestable / rare edge-cases):
  • Athena LLM veto
  • BTC flash crash macro veto
  • MAX_CONCURRENT_POSITIONS cap (all eligible coins trade independently)
  • ema_15m_20 pullback entry — use bar open price

Walk-forward protocol:
  • Total data fetched : WARMUP_MONTHS + TEST_MONTHS  (default: 3 + 6 = 9 months)
  • Train window       : last TRAIN_DAYS days (default: 90d) per TF, rolled monthly
  • Test period        : last TEST_MONTHS months from today  (default: 6 months)
  • Retrain every      : RETRAIN_DAYS (default: 30d — monthly)

Usage:
  python tools/backtest_prod_6m.py                           # All Tier A+B coins
  python tools/backtest_prod_6m.py --tier A                  # Tier A only
  python tools/backtest_prod_6m.py --coins BTCUSDT SOLUSDT   # Specific coins
  python tools/backtest_prod_6m.py --dry-run                 # Print only, no file write
"""

import sys
import os
import time
import csv
import argparse
import warnings
from datetime import datetime, timedelta, timezone
from collections import defaultdict

warnings.filterwarnings("ignore")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
import pandas as pd
import requests

import config
from data_pipeline import _parse_klines_df
from feature_engine import compute_all_features
from hmm_brain import HMMBrain
from segment_features import get_features_for_coin

# ─── Settings ─────────────────────────────────────────────────────────────────
TEST_MONTHS     = 6
WARMUP_MONTHS   = 3      # Data before test period used for initial training
TRAIN_DAYS      = 90     # Rolling train window per TF
RETRAIN_DAYS    = 30     # Retrain every N days (monthly)

FEE_PER_LEG     = 0.0005   # 0.05% commission
SLIP_PER_LEG    = 0.0005   # 0.05% slippage estimate
ROUND_TRIP_COST = (FEE_PER_LEG + SLIP_PER_LEG) * 2   # 0.2% round-trip

CAPITAL_PER_TRADE = config.CAPITAL_PER_TRADE   # $100
MIN_CONVICTION    = config.MIN_CONVICTION_FOR_DEPLOY  # 65
TF_WEIGHTS        = config.MULTI_TF_WEIGHTS     # {"1d":20, "1h":50, "15m":30}
TF_MIN_AGREEMENT  = config.MULTI_TF_MIN_AGREEMENT    # 2

# Bars per training window per timeframe
TRAIN_BARS = {
    "1d":  TRAIN_DAYS,
    "1h":  TRAIN_DAYS * 24,
    "5m":  config.MULTI_TF_CANDLE_LIMIT,  # 300 bars (same as prod MULTI_TF_CANDLE_LIMIT)
}

OUTPUT_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "tools", "backtest_prod_6m_results.txt"
)


# ─── Coin loader ──────────────────────────────────────────────────────────────

def load_coins(tier_filter=None, explicit_coins=None):
    if explicit_coins:
        return explicit_coins
    tier_file = config.COIN_TIER_FILE
    if not os.path.exists(tier_file):
        print(f"  ERROR: {tier_file} not found — run tools/train_phase1.py first")
        sys.exit(1)
    coins, seen = [], set()
    with open(tier_file, "r") as f:
        for row in csv.DictReader(f):
            sym  = row["symbol"]
            tier = row.get("tier", "C")
            if sym in seen:
                continue
            seen.add(sym)
            want = [tier_filter] if isinstance(tier_filter, str) else (tier_filter or ["A", "B"])
            if tier in want:
                coins.append(sym)
    return coins


# ─── Binance futures data fetch ───────────────────────────────────────────────

def fetch_tf(symbol: str, interval: str, total_months: int):
    """
    Fetch total_months of OHLCV from Binance USDT-M futures, compute all features.
    Returns DataFrame with feature columns + 'timestamp', or None on failure.
    """
    mins_map = {"1d": 1440, "1h": 60, "5m": 5, "15m": 15}
    mins_per_bar = mins_map[interval]
    n_bars = int((total_months * 30 * 24 * 60 / mins_per_bar) * 1.05)  # 5% buffer

    now_ms    = int(datetime.now(timezone.utc).timestamp() * 1000)
    start_ms  = now_ms - (n_bars * mins_per_bar * 60 * 1000)

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
    # Ensure timestamp column is datetime (not index)
    if "timestamp" not in df_feat.columns:
        df_feat = df_feat.reset_index()
        if "index" in df_feat.columns:
            df_feat.rename(columns={"index": "timestamp"}, inplace=True)
    df_feat["timestamp"] = pd.to_datetime(df_feat["timestamp"])
    return df_feat.reset_index(drop=True)


# ─── MultiTF conviction ───────────────────────────────────────────────────────

def compute_conviction(p1d, m1d, p1h, m1h, p15m, m15m):
    """
    Replicate MultiTFHMMBrain.get_conviction() exactly.
    Returns (conviction: float 0–100, side: str|None, agreement: int).
    """
    preds = {"1d": (p1d, m1d), "1h": (p1h, m1h), "15m": (p15m, m15m)}
    votes = []
    for tf, (regime, margin) in preds.items():
        if regime == config.REGIME_BULL:
            votes.append(("BUY", tf, margin))
        elif regime == config.REGIME_BEAR:
            votes.append(("SELL", tf, margin))

    if not votes:
        return 0.0, None, 0

    buys  = sum(1 for v, _, _ in votes if v == "BUY")
    sells = sum(1 for v, _, _ in votes if v == "SELL")
    if   buys > sells:  consensus = "BUY"
    elif sells > buys:  consensus = "SELL"
    else:               return 0.0, None, 0

    agreement = buys if consensus == "BUY" else sells
    if agreement < TF_MIN_AGREEMENT:
        return 0.0, None, agreement

    total = 0.0
    for tf, (regime, margin) in preds.items():
        w = TF_WEIGHTS.get(tf, 0)
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

    return round(min(100.0, max(0.0, total)), 1), consensus, agreement


# ─── Trade class ──────────────────────────────────────────────────────────────

class Trade:
    __slots__ = [
        "symbol", "side", "direction", "entry_ts", "entry_price",
        "sl_price", "tp_price", "leverage", "status",
        "exit_ts", "exit_price", "pnl",
    ]

    def __init__(self, symbol, side, entry_ts, entry_price, sl_price, tp_price, leverage):
        self.symbol      = symbol
        self.side        = side
        self.direction   = 1 if side == "BUY" else -1
        self.entry_ts    = entry_ts
        self.entry_price = entry_price
        self.sl_price    = sl_price
        self.tp_price    = tp_price
        self.leverage    = leverage
        self.status      = "OPEN"
        self.exit_ts     = None
        self.exit_price  = None
        self.pnl         = None

    def check_exit(self, high, low, close, ts, flip_signal):
        if self.status != "OPEN":
            return False
        if self.direction == 1:   # LONG
            if low  <= self.sl_price:
                return self._close(self.sl_price, ts, "SL")
            if high >= self.tp_price:
                return self._close(self.tp_price, ts, "TP")
        else:                      # SHORT
            if high >= self.sl_price:
                return self._close(self.sl_price, ts, "SL")
            if low  <= self.tp_price:
                return self._close(self.tp_price, ts, "TP")
        if flip_signal:
            return self._close(close, ts, "FLIP")
        return False

    def _close(self, price, ts, reason):
        self.status     = reason
        self.exit_price = price
        self.exit_ts    = ts
        raw_ret = (price - self.entry_price) / self.entry_price * self.direction
        net_ret = raw_ret * self.leverage - ROUND_TRIP_COST * self.leverage
        net_ret = max(net_ret, -1.0)   # cap at liquidation
        self.pnl = round(CAPITAL_PER_TRADE * net_ret, 4)
        return True


# ─── Predict helper ───────────────────────────────────────────────────────────

def predict_block(brain: HMMBrain, df: pd.DataFrame):
    """
    Predict regimes and margin scores for every row in df.
    Returns (regimes np.array, margins np.array) aligned to df's index.
    Rows with NaN features are filled with CHOP/0.0.
    """
    n = len(df)
    regimes = np.full(n, config.REGIME_CHOP, dtype=int)
    margins = np.zeros(n)

    if not brain.is_trained:
        return regimes, margins

    features_cols = brain.features
    missing = [c for c in features_cols if c not in df.columns]
    if missing:
        return regimes, margins

    X = df[features_cols].replace([np.inf, -np.inf], np.nan)
    valid_mask = X.notna().all(axis=1)
    valid_idx  = np.where(valid_mask)[0]

    if len(valid_idx) == 0:
        return regimes, margins

    X_valid = X.iloc[valid_idx].values
    X_scaled = (X_valid - brain._feat_mean) / brain._feat_std

    try:
        raw_states = brain.model.predict(X_scaled)
        proba      = brain.model.predict_proba(X_scaled)
        canon      = np.array([brain._state_map.get(int(s), config.REGIME_CHOP) for s in raw_states])
        sorted_p   = np.sort(proba, axis=1)[:, ::-1]
        marg       = sorted_p[:, 0] - sorted_p[:, 1]
        regimes[valid_idx] = canon
        margins[valid_idx] = marg
    except Exception:
        pass

    return regimes, margins


# ─── Single-coin backtest ─────────────────────────────────────────────────────

def backtest_coin(symbol: str, verbose: bool = False):
    total_months = WARMUP_MONTHS + TEST_MONTHS   # 9 months

    # ── Fetch data ────────────────────────────────────────────────────────────
    # Use actual prod timeframes from config
    MOMENTUM_TF = config.MULTI_TF_TIMEFRAMES[2]   # "5m" (or whatever prod uses)
    BARS_PER_DAY_MOMENTUM = int(24 * 60 / {"5m": 5, "15m": 15}.get(MOMENTUM_TF, 5))

    dfs = {}
    for tf in config.MULTI_TF_TIMEFRAMES:
        df = fetch_tf(symbol, tf, total_months)
        if df is None or df.empty:
            if verbose:
                print(f"    {symbol}/{tf} — NO DATA")
            return None
        dfs[tf] = df
        time.sleep(0.2)

    df_mom = dfs[MOMENTUM_TF]   # momentum TF (5m)
    df_1h  = dfs["1h"]
    df_1d  = dfs["1d"]

    # ── Validate length ───────────────────────────────────────────────────────
    min_needed = (WARMUP_MONTHS * 30 * BARS_PER_DAY_MOMENTUM) + 100
    if len(df_mom) < min_needed:
        if verbose:
            print(f"    {symbol} — TOO SHORT: {len(df_mom)} {MOMENTUM_TF} bars (need {min_needed})")
        return None

    # ── Compute test window boundaries ────────────────────────────────────────
    last_ts        = df_mom["timestamp"].iloc[-1]
    test_start     = last_ts - pd.Timedelta(days=TEST_MONTHS * 30)
    test_mask      = df_mom["timestamp"] >= test_start
    test_idx_start = df_mom.index[test_mask][0] if test_mask.any() else None

    if test_idx_start is None or test_idx_start < 50:
        if verbose:
            print(f"    {symbol} — no valid test window")
        return None

    # ── Walk-forward ──────────────────────────────────────────────────────────
    n_mom    = len(df_mom)
    pred_1d  = np.full(n_mom, config.REGIME_CHOP, dtype=int)
    marg_1d  = np.zeros(n_mom)
    pred_1h  = np.full(n_mom, config.REGIME_CHOP, dtype=int)
    marg_1h  = np.zeros(n_mom)
    pred_mom = np.full(n_mom, config.REGIME_CHOP, dtype=int)
    marg_mom = np.zeros(n_mom)

    STEP_BARS = RETRAIN_DAYS * BARS_PER_DAY_MOMENTUM

    for block_start in range(test_idx_start, n_mom, STEP_BARS):
        block_end = min(block_start + STEP_BARS, n_mom)
        cutoff_ts = df_mom["timestamp"].iloc[block_start]

        # ── Train a brain for each TF on data up to cutoff_ts ─────────────────
        brains = {}
        for tf, df_tf in dfs.items():
            mask_train  = df_tf["timestamp"] < cutoff_ts
            train_slice = df_tf[mask_train].tail(TRAIN_BARS[tf]).copy()
            if len(train_slice) < 50:
                brains[tf] = HMMBrain(symbol=symbol)   # untrained
                continue
            b = HMMBrain(symbol=symbol)
            try:
                b.train(train_slice)
            except Exception:
                pass
            brains[tf] = b

        # ── Predict on the block window ────────────────────────────────────────
        # Momentum TF: predict on block rows, shift by 1 to avoid look-ahead
        block_mom_df = df_mom.iloc[block_start:block_end].copy()
        brain_mom = brains.get(MOMENTUM_TF)
        if brain_mom and brain_mom.is_trained and len(block_mom_df) > 1:
            r, m = predict_block(brain_mom, block_mom_df)
            pred_mom[block_start + 1:block_end] = r[:-1]
            marg_mom[block_start + 1:block_end] = m[:-1]

        # 1h: predict block window, forward-fill to momentum TF resolution
        block_end_ts  = df_mom["timestamp"].iloc[block_end - 1]
        mask_1h_block = (df_1h["timestamp"] >= cutoff_ts) & (df_1h["timestamp"] <= block_end_ts)
        block_1h_df   = df_1h[mask_1h_block].copy()
        if brains.get("1h") and brains["1h"].is_trained and len(block_1h_df) > 0:
            r1h, m1h = predict_block(brains["1h"], block_1h_df)
            ts_1h    = block_1h_df["timestamp"].values
            for i_bar in range(block_start, block_end):
                ts_bar = df_mom["timestamp"].iloc[i_bar]
                mask   = ts_1h < np.datetime64(ts_bar)
                if mask.any():
                    idx = int(np.where(mask)[0][-1])
                    pred_1h[i_bar] = r1h[idx]
                    marg_1h[i_bar] = m1h[idx]

        # 1d: same forward-fill approach
        mask_1d_block = (df_1d["timestamp"] >= cutoff_ts) & (df_1d["timestamp"] <= block_end_ts)
        block_1d_df   = df_1d[mask_1d_block].copy()
        if brains.get("1d") and brains["1d"].is_trained and len(block_1d_df) > 0:
            r1d, m1d_arr = predict_block(brains["1d"], block_1d_df)
            ts_1d = block_1d_df["timestamp"].values
            for i_bar in range(block_start, block_end):
                ts_bar = df_mom["timestamp"].iloc[i_bar]
                mask   = ts_1d < np.datetime64(ts_bar)
                if mask.any():
                    idx = int(np.where(mask)[0][-1])
                    pred_1d[i_bar] = r1d[idx]
                    marg_1d[i_bar] = m1d_arr[idx]

    # ── Pre-extract 1h ATR for SL/TP sizing, forward-filled to momentum TF ────
    atr_arr = np.zeros(n_mom)
    if "atr" in df_1h.columns:
        ts_1h_all  = df_1h["timestamp"].values
        atr_1h_all = df_1h["atr"].values
        for i in range(n_mom):
            ts_bar = df_mom["timestamp"].iloc[i]
            mask   = ts_1h_all < np.datetime64(ts_bar)
            if mask.any():
                atr_arr[i] = float(atr_1h_all[np.where(mask)[0][-1]])

    # ── Simulate trades bar-by-bar on momentum TF ─────────────────────────────
    trades     = []
    open_trade = None

    for i in range(test_idx_start, n_mom):
        row   = df_mom.iloc[i]
        open_ = float(row["open"])
        high  = float(row["high"])
        low   = float(row["low"])
        close = float(row["close"])
        ts    = row["timestamp"]

        conviction, side, agreement = compute_conviction(
            pred_1d[i],  marg_1d[i],
            pred_1h[i],  marg_1h[i],
            pred_mom[i], marg_mom[i],
        )

        # ── Update / close open trade ──────────────────────────────────────────
        if open_trade is not None:
            flip = (
                side is not None
                and side != open_trade.side
                and conviction >= MIN_CONVICTION
            )
            if open_trade.check_exit(high, low, close, ts, flip):
                trades.append(open_trade)
                open_trade = None

        # ── Check new entry ────────────────────────────────────────────────────
        if open_trade is None and conviction >= MIN_CONVICTION and side is not None:
            atr = atr_arr[i]
            if atr <= 0 or np.isnan(atr):
                atr = close * 0.01

            vol_ratio = atr / close
            if vol_ratio < config.VOL_MIN_ATR_PCT or vol_ratio > config.VOL_MAX_ATR_PCT:
                continue

            # Conviction-based leverage (mirrors main.py)
            if   conviction >= 95: lev = config.LEVERAGE_HIGH       # 35x
            elif conviction >= 80: lev = config.LEVERAGE_MODERATE   # 25x
            elif conviction >= 70: lev = 15
            else:                  lev = 10

            sl_mult, tp_mult = config.get_atr_multipliers(lev)

            if side == "BUY":
                sl = open_ - sl_mult * atr
                tp = open_ + tp_mult * atr
            else:
                sl = open_ + sl_mult * atr
                tp = open_ - tp_mult * atr

            open_trade = Trade(
                symbol=symbol, side=side, entry_ts=ts,
                entry_price=open_, sl_price=sl, tp_price=tp, leverage=lev,
            )

    # Close any remaining open trade at last bar
    if open_trade is not None:
        last = df_mom.iloc[-1]
        open_trade._close(float(last["close"]), last["timestamp"], "EOD")
        trades.append(open_trade)

    if not trades:
        return {"symbol": symbol, "trades": [], "n_trades": 0, "total_pnl": 0.0}

    # ── Summary stats ──────────────────────────────────────────────────────────
    pnls = [t.pnl for t in trades if t.pnl is not None]
    n    = len(pnls)
    arr  = np.array(pnls)
    wins = [p for p in pnls if p > 0]
    loss = [p for p in pnls if p <= 0]

    cum = np.cumsum(arr)
    dd  = cum - np.maximum.accumulate(cum)

    exits = defaultdict(int)
    for t in trades:
        exits[t.status] += 1

    return {
        "symbol":        symbol,
        "trades":        trades,
        "n_trades":      n,
        "total_pnl":     round(float(arr.sum()), 2),
        "win_rate":      round(len(wins) / n * 100, 1) if n else 0.0,
        "profit_factor": round(sum(wins) / abs(sum(loss)), 3) if loss and sum(loss) else 999.0,
        "sharpe":        round(float(arr.mean() / arr.std() * np.sqrt(n)), 3) if arr.std() > 1e-5 else 0.0,
        "max_dd":        round(float(dd.min()), 2),
        "avg_pnl":       round(float(arr.mean()), 2),
        "exits":         dict(exits),
    }


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tier",    default=None, help="A, B, or AB (default: A+B)")
    parser.add_argument("--coins",   nargs="+",    help="Run specific coins only")
    parser.add_argument("--dry-run", action="store_true", help="Print results but don't write file")
    args = parser.parse_args()

    tier_filter = args.tier.split(",") if args.tier else ["A", "B"]
    coins = load_coins(tier_filter=tier_filter, explicit_coins=args.coins)

    lines = []
    def log(s=""):
        print(s)
        lines.append(s)

    log("=" * 72)
    log("  Synaptic Engine — Prod-Faithful 6-Month Backtest")
    log(f"  Period   : last {TEST_MONTHS} months (walk-forward, {RETRAIN_DAYS}d retrain)")
    log(f"  Coins    : {len(coins)}  (Tier {tier_filter})")
    log(f"  Model    : GMMHMM (n_mix=3, diag) + per-coin features")
    _tfs_str = " + ".join(f"{tf}×{w}" for tf, w in TF_WEIGHTS.items())
    log(f"  MultiTF  : {_tfs_str}  (min agreement={TF_MIN_AGREEMENT})")
    log(f"  Filters  : conviction≥{MIN_CONVICTION}  |  vol ATR/price {config.VOL_MIN_ATR_PCT*100:.1f}%–{config.VOL_MAX_ATR_PCT*100:.0f}%")
    log(f"  Capital  : ${CAPITAL_PER_TRADE}/trade  |  fee+slip {ROUND_TRIP_COST*100:.2f}% RT")
    log(f"  Leverage : conv≥95→35x  conv≥80→25x  conv≥70→15x  else→10x")
    if args.dry_run:
        log("  *** DRY RUN ***")
    log("=" * 72)
    log()

    results      = []
    failed       = []
    all_trades   = []
    seg_stats    = defaultdict(list)

    for i, symbol in enumerate(coins, 1):
        print(f"[{i:2d}/{len(coins)}] {symbol:20s} ...", end=" ", flush=True)
        res = backtest_coin(symbol, verbose=False)
        if res is None or res["n_trades"] == 0:
            print("SKIP (no data / no trades)")
            failed.append(symbol)
            continue
        results.append(res)
        all_trades.extend(res["trades"])

        # Infer segment from config
        seg = "?"
        for s, coins_in_seg in config.CRYPTO_SEGMENTS.items():
            if symbol in coins_in_seg:
                seg = s
                break
        seg_stats[seg].append(res)

        print(
            f"trades={res['n_trades']:3d}  PnL=${res['total_pnl']:+8.2f}  "
            f"WR={res['win_rate']:5.1f}%  PF={res['profit_factor']:.2f}  "
            f"Sharpe={res['sharpe']:.2f}  MaxDD=${res['max_dd']:+.0f}  "
            f"exits={res['exits']}"
        )

    # ─── Aggregate stats ──────────────────────────────────────────────────────
    if not results:
        log("  No results — check data/coin_tiers.csv and API connectivity.")
        return

    total_pnl    = sum(r["total_pnl"] for r in results)
    total_trades = sum(r["n_trades"]  for r in results)
    all_pnls     = [t.pnl for t in all_trades if t.pnl is not None]
    pnl_arr      = np.array(all_pnls)
    wins         = [p for p in all_pnls if p > 0]
    losses       = [p for p in all_pnls if p <= 0]

    # Portfolio-level max drawdown (cumulative PnL)
    cum      = np.cumsum(pnl_arr)
    dd       = cum - np.maximum.accumulate(cum)
    port_mdd = float(dd.min())

    # Portfolio Sharpe (trade-series)
    port_sharpe = (
        float(pnl_arr.mean() / pnl_arr.std() * np.sqrt(len(pnl_arr)))
        if pnl_arr.std() > 1e-5 else 0.0
    )

    exit_counts = defaultdict(int)
    for t in all_trades:
        if t.pnl is not None:
            exit_counts[t.status] += 1

    log()
    log("=" * 72)
    log("  AGGREGATE PORTFOLIO RESULTS")
    log("=" * 72)
    log(f"  Coins analysed : {len(results):3d}  |  failed: {len(failed)}")
    log(f"  Total trades   : {total_trades:4d}")
    log(f"  Total PnL      : ${total_pnl:+,.2f}")
    log(f"  Win rate       : {len(wins)/len(all_pnls)*100:.1f}%  ({len(wins)} wins / {len(losses)} losses)")
    log(f"  Profit factor  : {sum(wins)/abs(sum(losses)):.3f}" if losses and sum(losses) else "  Profit factor  : inf")
    log(f"  Portfolio Sharpe: {port_sharpe:.3f}")
    log(f"  Portfolio MaxDD: ${port_mdd:+,.2f}")
    log(f"  Exit breakdown : {dict(exit_counts)}")
    log()

    # ─── Per-segment breakdown ────────────────────────────────────────────────
    log("  SEGMENT BREAKDOWN")
    log(f"  {'Segment':15s}  {'Coins':5s}  {'Trades':6s}  {'PnL':>10s}  {'WR':>6s}  {'PF':>5s}  {'Sharpe':>7s}")
    log("  " + "-" * 65)
    for seg in sorted(seg_stats.keys()):
        seg_res = seg_stats[seg]
        s_coins = len(seg_res)
        s_trades = sum(r["n_trades"] for r in seg_res)
        s_pnl    = sum(r["total_pnl"] for r in seg_res)
        s_pnls   = [t.pnl for r in seg_res for t in r["trades"] if t.pnl is not None]
        s_wins   = [p for p in s_pnls if p > 0]
        s_loss   = [p for p in s_pnls if p <= 0]
        s_wr     = len(s_wins) / len(s_pnls) * 100 if s_pnls else 0
        s_pf     = sum(s_wins) / abs(sum(s_loss)) if s_loss and sum(s_loss) else 999.0
        s_arr    = np.array(s_pnls)
        s_sharpe = (float(s_arr.mean() / s_arr.std() * np.sqrt(len(s_arr)))
                    if len(s_arr) > 1 and s_arr.std() > 1e-5 else 0.0)
        log(f"  {seg:15s}  {s_coins:5d}  {s_trades:6d}  ${s_pnl:>9.2f}  {s_wr:>5.1f}%  {s_pf:>5.2f}  {s_sharpe:>7.3f}")

    log()

    # ─── Top / bottom 10 coins by PnL ────────────────────────────────────────
    results_sorted = sorted(results, key=lambda r: r["total_pnl"], reverse=True)
    log("  TOP 10 COINS")
    log(f"  {'Symbol':15s}  {'Trades':6s}  {'PnL':>10s}  {'WR':>6s}  {'PF':>5s}  {'Sharpe':>7s}  {'MaxDD':>8s}")
    log("  " + "-" * 68)
    for r in results_sorted[:10]:
        log(f"  {r['symbol']:15s}  {r['n_trades']:6d}  ${r['total_pnl']:>9.2f}  "
            f"{r['win_rate']:>5.1f}%  {r['profit_factor']:>5.2f}  "
            f"{r['sharpe']:>7.3f}  ${r['max_dd']:>7.0f}")

    log()
    log("  BOTTOM 10 COINS")
    log(f"  {'Symbol':15s}  {'Trades':6s}  {'PnL':>10s}  {'WR':>6s}  {'PF':>5s}  {'Sharpe':>7s}  {'MaxDD':>8s}")
    log("  " + "-" * 68)
    for r in results_sorted[-10:]:
        log(f"  {r['symbol']:15s}  {r['n_trades']:6d}  ${r['total_pnl']:>9.2f}  "
            f"{r['win_rate']:>5.1f}%  {r['profit_factor']:>5.2f}  "
            f"{r['sharpe']:>7.3f}  ${r['max_dd']:>7.0f}")

    log()
    log("=" * 72)

    # ─── Write to file ────────────────────────────────────────────────────────
    if not args.dry_run:
        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        print(f"\n  Results written to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()

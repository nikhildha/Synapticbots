"""
╔══════════════════════════════════════════════════════════════════════════════╗
║                        ALPHA MODULE — SYNAPTIC                              ║
║  Module : alpha/alpha_features.py                                            ║
║  Purpose: Self-contained feature computation for Alpha.                      ║
║           Computes vol_zscore, ATR, log_return, and all HMM features         ║
║           from raw OHLCV DataFrames. Math copied from feature_engine.py      ║
║           but WITHOUT importing it (feature_engine imports config which      ║
║           we must not touch).                                                ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  ISOLATION CONTRACT                                                          ║
║  ✗ DO NOT import feature_engine, config, or any root module.                ║
║  ✓ Only imports: numpy, pandas                                               ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

import warnings
import numpy as np
import pandas as pd

warnings.filterwarnings("ignore", category=RuntimeWarning)


# ── ATR ───────────────────────────────────────────────────────────────────────

def compute_atr(df: pd.DataFrame, length: int = 14) -> pd.Series:
    """
    Wilder Average True Range. Identical formula to feature_engine.compute_atr().
    Returns a Series aligned to df.index.
    """
    high = df["high"]
    low  = df["low"]
    prev_close = df["close"].shift(1)

    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low  - prev_close).abs(),
    ], axis=1).max(axis=1)

    return tr.ewm(alpha=1 / length, min_periods=length, adjust=False).mean()


# ── Vol Z-Score ───────────────────────────────────────────────────────────────

def compute_vol_zscore(df: pd.DataFrame, lookback: int = 24) -> pd.Series:
    """
    Z-score of volume vs rolling mean/std over `lookback` bars.
    Clipped to ±5. Formula matches feature_engine.compute_hmm_features().
    """
    vol_sma = df["volume"].rolling(lookback).mean()
    vol_std = df["volume"].rolling(lookback).std().replace(0, np.nan)
    return ((df["volume"] - vol_sma) / vol_std).fillna(0).clip(-5, 5)


# ── All HMM features ──────────────────────────────────────────────────────────

def compute_all_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Add all Alpha HMM features to a copy of df.
    Input:  raw OHLCV DataFrame with columns [open, high, low, close, volume]
    Output: same DataFrame with additional feature columns added.

    Features added:
      log_return, volatility, volume_change, vol_zscore,
      liquidity_vacuum, amihud_illiquidity, volume_trend_intensity,
      exhaustion_tail, vwap_dist, bb_width_norm, atr, swing_l, swing_h

    NaN rows (first ~24 rows) are dropped before returning.
    """
    df = df.copy()

    # ── close guard (avoid log(0)) ────────────────────────────────────────────
    close_safe = df["close"].replace(0, np.nan)

    # ── log_return ────────────────────────────────────────────────────────────
    df["log_return"] = np.log(close_safe / close_safe.shift(1)).clip(-5, 5)

    # ── volatility (intrabar range) ───────────────────────────────────────────
    df["volatility"] = (df["high"] - df["low"]) / close_safe

    # ── volume_change ─────────────────────────────────────────────────────────
    df["volume_change"] = (
        np.log(df["volume"] / df["volume"].shift(1).replace(0, np.nan))
        .fillna(0).clip(-3, 3)
    )

    # ── vol_zscore ────────────────────────────────────────────────────────────
    df["vol_zscore"] = compute_vol_zscore(df, lookback=24)

    # ── ATR (14-period Wilder) ────────────────────────────────────────────────
    df["atr"] = compute_atr(df, length=14)

    # ── liquidity_vacuum ──────────────────────────────────────────────────────
    atr_pct = (df["atr"] / close_safe).replace(0, np.nan)
    df["liquidity_vacuum"] = (
        (df["log_return"].abs() / atr_pct)
        .fillna(0).replace([np.inf, -np.inf], 0).clip(0, 5)
    )
    if df["liquidity_vacuum"].std() < 1e-6:
        df["liquidity_vacuum"] += np.random.normal(0, 1e-6, len(df))

    # ── exhaustion_tail ───────────────────────────────────────────────────────
    body       = (df["close"] - df["open"]).abs().replace(0, 1e-8)
    upper_wick = df["high"] - df[["open", "close"]].max(axis=1)
    lower_wick = df[["open", "close"]].min(axis=1) - df["low"]
    wick_skew  = (lower_wick - upper_wick) / body
    df["exhaustion_tail"] = (
        (wick_skew * df["vol_zscore"].clip(0, 5))
        .fillna(0).clip(-10, 10)
    )
    if df["exhaustion_tail"].std() < 1e-6:
        df["exhaustion_tail"] += np.random.normal(0, 1e-6, len(df))

    # ── amihud_illiquidity ────────────────────────────────────────────────────
    dollar_vol = (close_safe * df["volume"]).replace(0, np.nan)
    df["amihud_illiquidity"] = (
        (df["log_return"].abs() / dollar_vol)
        .fillna(0).replace([np.inf, -np.inf], 0)
        * 1e8
    ).clip(0, 10)

    # ── volume_trend_intensity ────────────────────────────────────────────────
    vol_ema5  = df["volume"].ewm(span=5,  adjust=False).mean()
    vol_ema20 = df["volume"].ewm(span=20, adjust=False).mean()
    df["volume_trend_intensity"] = (
        (vol_ema5 / vol_ema20.replace(0, np.nan)).fillna(1.0).clip(0, 5)
    )

    # ── vwap_dist ─────────────────────────────────────────────────────────────
    typical   = (df["high"] + df["low"] + df["close"]) / 3
    vwap_roll = (
        (typical * df["volume"]).rolling(20).sum()
        / df["volume"].rolling(20).sum().replace(0, np.nan)
    )
    df["vwap_dist"] = (
        ((df["close"] - vwap_roll) / vwap_roll.replace(0, np.nan))
        .fillna(0).clip(-0.5, 0.5)
    )

    # ── bb_width_norm ─────────────────────────────────────────────────────────
    bb_mid = df["close"].rolling(20).mean()
    bb_std = df["close"].rolling(20).std()
    df["bb_width_norm"] = (
        ((bb_mid + 2 * bb_std) - (bb_mid - 2 * bb_std))
        / bb_mid.replace(0, np.nan)
    ).fillna(0).clip(0, 1)

    # ── swing levels ──────────────────────────────────────────────────────────
    df["swing_l"] = df["low"].rolling(10, min_periods=1).min()
    df["swing_h"] = df["high"].rolling(10, min_periods=1).max()

    # ── RSI (14) ──────────────────────────────────────────────────────────────
    delta    = df["close"].diff()
    gain     = delta.where(delta > 0, 0.0)
    loss     = -delta.where(delta < 0, 0.0)
    avg_gain = gain.ewm(alpha=1/14, min_periods=14, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1/14, min_periods=14, adjust=False).mean()
    rs       = avg_gain / avg_loss.replace(0, np.nan)
    df["rsi"] = (100.0 - (100.0 / (1.0 + rs))).fillna(50)

    # Drop NaN rows from rolling windows (first ~24 rows)
    df = df.dropna(subset=["vol_zscore", "atr", "log_return"]).reset_index(drop=True)

    return df

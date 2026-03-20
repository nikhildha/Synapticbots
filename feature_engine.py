"""
Project Regime-Master — Feature Engine
Computes HMM input features and technical indicators (RSI, Bollinger, ATR).
"""
import numpy as np
import pandas as pd
import logging

import config

logger = logging.getLogger("FeatureEngine")


# ─── HMM Features ───────────────────────────────────────────────────────────────

def compute_hmm_features(df, btc_df=None):
    """
    Add HMM-ready institutional flow features to an OHLCV DataFrame.

    Adds:
      - log_return
      - volatility
      - volume_change
      - vol_zscore      : Z-score of volume vs 24-period SMA
      - rel_strength_btc: Asset Return - BTC Return (requires `btc_df`)
    """
    df = df.copy()
    # Guard: replace zero close prices to avoid log(0) = -inf / RuntimeWarning
    close_safe = df["close"].replace(0, np.nan)
    df["log_return"] = np.log(close_safe / close_safe.shift(1)).clip(-5, 5)
    df["volatility"] = (df["high"] - df["low"]) / df["close"]
    df["volume_change"] = np.log(df["volume"] / df["volume"].shift(1).replace(0, np.nan))
    df["volume_change"] = df["volume_change"].fillna(0).clip(-3, 3)

    # 2. Volume Z-Score
    vol_sma = df["volume"].rolling(24).mean()
    vol_std = df["volume"].rolling(24).std().replace(0, np.nan)
    df["vol_zscore"] = ((df["volume"] - vol_sma) / vol_std).fillna(0).clip(-5, 5)

    # 4. Relative Strength vs BTC
    if btc_df is not None and not btc_df.empty:
        # Align lengths if mismatched
        min_len = min(len(df), len(btc_df))
        asset_ret = df["close"].iloc[-min_len:].pct_change().fillna(0).values
        btc_ret = btc_df["close"].iloc[-min_len:].pct_change().fillna(0).values
        rs = asset_ret - btc_ret
        
        df_rs = np.zeros(len(df))
        df_rs[-min_len:] = rs
        df["rel_strength_btc"] = df_rs + np.random.normal(0, 1e-6, len(df)) # Jitter to prevent singular matrix
    else:
        df["rel_strength_btc"] = np.random.normal(0, 1e-6, len(df))
        
    # 6. Liquidity Vacuum (Range Expansion Velocity)
    # Absolute close-to-close return divided by the 14-period ATR
    # High values mean price moved through air pockets
    atr_14 = compute_atr(df, 14)
    # Guard: replace zero/NaN ATR to avoid inf in division
    atr_pct = (atr_14 / df["close"].replace(0, np.nan)).replace(0, np.nan)
    df["liquidity_vacuum"] = (df["log_return"].abs() / atr_pct).fillna(0).replace([np.inf, -np.inf], 0).clip(0, 5)
    if df["liquidity_vacuum"].std() < 1e-6: df["liquidity_vacuum"] += np.random.normal(0, 1e-6, len(df))

    # 7. Exhaustion Tail
    # Wick size relative to body size, multiplied by volume z-score
    body = (df["close"] - df["open"]).abs()
    # Replace 0 body with a tiny number to prevent inf
    body = body.replace(0, 1e-8)
    upper_wick = df["high"] - df[["open", "close"]].max(axis=1)
    lower_wick = df[["open", "close"]].min(axis=1) - df["low"]
    
    # + if lower wick is huge (bullish rejection), - if upper wick is huge (bearish rejection)
    wick_skew = (lower_wick - upper_wick) / body
    # Only matters if volume is abnormally high
    df["exhaustion_tail"] = (wick_skew * df["vol_zscore"].clip(0, 5)).fillna(0).clip(-10, 10)
    if df["exhaustion_tail"].std() < 1e-6: df["exhaustion_tail"] += np.random.normal(0, 1e-6, len(df))

    # 9. Amihud Illiquidity (Price Impact per unit of volume)
    # Guard: dollar_volume=0 or NaN produces inf — replace before dividing
    dollar_volume = (df["close"] * df["volume"]).replace(0, np.nan)
    df["amihud_illiquidity"] = (df["log_return"].abs() / dollar_volume).fillna(0).replace([np.inf, -np.inf], 0)
    df["amihud_illiquidity"] = (df["amihud_illiquidity"] * 1e8).clip(0, 10)

    # 10. Volume Trend Intensity
    vol_ema_short = df["volume"].ewm(span=5, adjust=False).mean()
    vol_ema_long = df["volume"].ewm(span=20, adjust=False).mean()
    df["volume_trend_intensity"] = (vol_ema_short / vol_ema_long.replace(0, np.nan)).fillna(1.0).clip(0, 5)

    # swing_l/swing_h: rolling(10) leaves first 9 rows as NaN → back-fill with own row
    df["swing_l"] = df["low"].rolling(10, min_periods=1).min()
    df["swing_h"] = df["high"].rolling(10, min_periods=1).max()

    # ── vwap_dist & bb_width_norm ──────────────────────────────────────────────
    # These are required by segment_features.get_features_for_coin() for every coin.
    # They MUST be computed here (not only in compute_indicators) so that the HMM
    # training path — which calls compute_hmm_features() directly — always has them.
    # Previously missing here caused "[vwap_dist, bb_width_norm] not in index" →
    # HMM training failure → 0% confidence for all coins.

    # VWAP distance: how far close is from 20-period VWAP (clipped ±50%)
    vwap_typical = (df["high"] + df["low"] + df["close"]) / 3
    vwap_rolling = (vwap_typical * df["volume"]).rolling(20).sum() / \
                   df["volume"].rolling(20).sum().replace(0, np.nan)
    df["vwap_dist"] = ((df["close"] - vwap_rolling) / vwap_rolling.replace(0, np.nan)
                       ).fillna(0).clip(-0.5, 0.5)

    # Bollinger Band width (normalised by mid-band): proxy for volatility regime
    bb_mid   = df["close"].rolling(20).mean()
    bb_std   = df["close"].rolling(20).std()
    bb_upper = bb_mid + 2 * bb_std
    bb_lower = bb_mid - 2 * bb_std
    df["bb_width_norm"] = ((bb_upper - bb_lower) / bb_mid.replace(0, np.nan)
                           ).fillna(0).clip(0, 1)

    return df


# ─── Technical Indicators ───────────────────────────────────────────────────────

def compute_rsi(series, length=None):
    """
    Compute Relative Strength Index.
    
    Parameters
    ----------
    series : pd.Series of close prices
    length : int, default from config.RSI_LENGTH
    
    Returns
    -------
    pd.Series
    """
    length = length or config.RSI_LENGTH
    delta = series.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = -delta.where(delta < 0, 0.0)

    avg_gain = gain.ewm(alpha=1 / length, min_periods=length, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / length, min_periods=length, adjust=False).mean()

    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100.0 - (100.0 / (1.0 + rs))
    return rsi


def compute_bollinger_bands(series, length=None, std=None):
    """
    Compute Bollinger Bands.
    
    Returns
    -------
    (middle, upper, lower) — each a pd.Series
    """
    length = length or config.BB_LENGTH
    std = std or config.BB_STD

    middle = series.rolling(window=length).mean()
    rolling_std = series.rolling(window=length).std()
    upper = middle + (rolling_std * std)
    lower = middle - (rolling_std * std)

    return middle, upper, lower


def compute_atr(df, length=14):
    """
    Compute Average True Range.
    
    Parameters
    ----------
    df : pd.DataFrame with 'high', 'low', 'close'
    length : int
    
    Returns
    -------
    pd.Series
    """
    high = df["high"]
    low = df["low"]
    prev_close = df["close"].shift(1)

    tr1 = high - low
    tr2 = (high - prev_close).abs()
    tr3 = (low - prev_close).abs()

    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    atr = tr.ewm(alpha=1 / length, min_periods=length, adjust=False).mean()
    return atr



def compute_indicators(df):
    """
    Add all technical indicators to an OHLCV DataFrame.

    Adds: rsi, bb_upper, bb_middle, bb_lower, atr

    Returns
    -------
    pd.DataFrame (copy with new columns)
    """
    df = df.copy()

    df["rsi"] = compute_rsi(df["close"])
    df["bb_middle"], df["bb_upper"], df["bb_lower"] = compute_bollinger_bands(df["close"])
    df["bb_width_norm"] = ((df["bb_upper"] - df["bb_lower"]) / df["bb_middle"].replace(0, np.nan)).fillna(0).clip(0, 1)
    df["atr"] = compute_atr(df)

    vwap = compute_vwap(df, window=20)
    df["vwap_dist"] = ((df["close"] - vwap) / vwap.replace(0, np.nan)).fillna(0).clip(-0.5, 0.5)

    return df



def compute_ema(series, length):
    """Compute Exponential Moving Average."""
    return series.ewm(span=length, adjust=False).mean()


def compute_trend(df):
    """
    Determine trend direction using EMA 20/50 crossover + price position.
    Returns: 'UP', 'DOWN', or 'FLAT'
    """
    close = df["close"]
    ema_20 = compute_ema(close, 20)
    ema_50 = compute_ema(close, 50)

    last_close = float(close.iloc[-1])
    last_ema20 = float(ema_20.iloc[-1])
    last_ema50 = float(ema_50.iloc[-1])

    if last_ema20 > last_ema50 and last_close > last_ema20:
        return "UP"
    elif last_ema20 < last_ema50 and last_close < last_ema20:
        return "DOWN"
    return "FLAT"


def compute_vwap(df, window=20):
    """
    Compute rolling VWAP (Volume Weighted Average Price).
    
    Returns pd.Series of VWAP values.
    """
    typical = (df["high"] + df["low"] + df["close"]) / 3
    cum_tp_vol = (typical * df["volume"]).rolling(window).sum()
    cum_vol = df["volume"].rolling(window).sum()
    return cum_tp_vol / cum_vol.replace(0, np.nan)


def compute_all_features(df):
    """
    Convenience: computes BOTH HMM features AND technical indicators.
    """
    df = compute_hmm_features(df)
    df = compute_indicators(df)
    
    return df



# ─── Synthetic Data Generator (for testing) ─────────────────────────────────────

def generate_synthetic_data(n=500, seed=42):
    """
    Generate synthetic OHLCV data for smoke-testing HMM training.
    Simulates 3 regimes: uptrend, downtrend, and sideways.
    """
    rng = np.random.RandomState(seed)
    
    # Build a price series with embedded regimes
    prices = [100.0]
    for i in range(1, n):
        phase = i / n
        if phase < 0.33:
            # Uptrend
            drift = 0.002
            vol = 0.01
        elif phase < 0.66:
            # Downtrend
            drift = -0.003
            vol = 0.02
        else:
            # Sideways
            drift = 0.0
            vol = 0.005
        
        ret = drift + vol * rng.randn()
        prices.append(prices[-1] * np.exp(ret))
    
    prices = np.array(prices)
    
    # Build synthetic OHLCV
    df = pd.DataFrame({
        "timestamp": pd.date_range("2024-01-01", periods=n, freq="1h"),
        "open":   prices * (1 + rng.uniform(-0.003, 0.003, n)),
        "high":   prices * (1 + rng.uniform(0.001, 0.015, n)),
        "low":    prices * (1 - rng.uniform(0.001, 0.015, n)),
        "close":  prices,
        "volume": rng.uniform(100, 5000, n),
    })
    
    return df

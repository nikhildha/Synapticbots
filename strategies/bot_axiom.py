"""
bot_axiom.py — Axiom (Momentum) Strategy Bot Signal Generator

Logic source: bitcoin-momentum-trading/feature_engineering.py
Strategy:     MACD crossover + RSI trend filter + Bollinger Band breakout + ADX strength
              Applied across all 32 Synaptic coins on 15m candles.
              (Original repo was BTC-only — we generalize to all coins)
Coin universe: All 32 Synaptic coins
"""
import logging
import numpy as np
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import config

logger = logging.getLogger("Axiom")

# ─── Coin Universe ────────────────────────────────────────────────────────────
# Repo: BTC-only (MACD/RSI/BB/ATR/ADX). We apply same indicators to all 32 coins.
COIN_UNIVERSE = sorted(set(
    coin for coins in config.CRYPTO_SEGMENTS.values() for coin in coins
))

CANDLE_INTERVAL = "15m"
MIN_CANDLES     = 35    # Need at least 35 candles for MACD(26) + signal(9)

# MACD params (same as feature_engineering.py)
MACD_FAST   = 12
MACD_SLOW   = 26
MACD_SIGNAL = 9

# RSI
RSI_PERIOD  = 14

# Bollinger Bands
BB_PERIOD   = 20
BB_STD      = 2.0

# ADX (trend strength — from source repo)
ADX_PERIOD  = 14
ADX_MIN     = 20    # Only take signals when ADX ≥ 20 (trending market)


def _ema(values: np.ndarray, period: int) -> np.ndarray:
    """Exponential moving average."""
    k = 2.0 / (period + 1)
    ema = np.zeros_like(values, dtype=float)
    ema[0] = values[0]
    for i in range(1, len(values)):
        ema[i] = values[i] * k + ema[i - 1] * (1 - k)
    return ema


def _macd(closes: np.ndarray) -> tuple:
    """Returns (macd_line, signal_line) arrays."""
    fast = _ema(closes, MACD_FAST)
    slow = _ema(closes, MACD_SLOW)
    macd_line = fast - slow
    signal_line = _ema(macd_line, MACD_SIGNAL)
    return macd_line, signal_line


def _rsi(closes: np.ndarray, period: int = RSI_PERIOD) -> float:
    if len(closes) < period + 1:
        return 50.0
    deltas = np.diff(closes[-(period + 1):])
    gains  = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)
    avg_gain = gains.mean()
    avg_loss = losses.mean()
    if avg_loss == 0:
        return 100.0
    return 100.0 - (100.0 / (1.0 + avg_gain / avg_loss))


def _bollinger(closes: np.ndarray) -> tuple:
    """Returns (upper, mid, lower) for the last candle."""
    window = closes[-BB_PERIOD:]
    mid    = window.mean()
    std    = window.std()
    return mid + BB_STD * std, mid, mid - BB_STD * std


def _atr(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int = 14) -> float:
    """Average True Range."""
    if len(closes) < period + 1:
        return float(closes[-1]) * 0.01
    tr = np.maximum(
        highs[-period:] - lows[-period:],
        np.abs(highs[-period:] - closes[-(period + 1):-1])
    )
    return float(tr.mean())


def _adx(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int = ADX_PERIOD) -> float:
    """Simplified Average Directional Index (trend strength 0-100)."""
    if len(closes) < period + 2:
        return 0.0
    h, l, c = highs[-(period + 2):], lows[-(period + 2):], closes[-(period + 2):]
    tr_list, dm_plus, dm_minus = [], [], []
    for i in range(1, len(c)):
        tr = max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1]))
        up = h[i] - h[i - 1]
        down = l[i - 1] - l[i]
        tr_list.append(tr)
        dm_plus.append(up if up > down and up > 0 else 0)
        dm_minus.append(down if down > up and down > 0 else 0)
    atr_avg = np.mean(tr_list) or 1e-9
    di_plus = np.mean(dm_plus) / atr_avg * 100
    di_minus = np.mean(dm_minus) / atr_avg * 100
    denom = di_plus + di_minus or 1e-9
    return abs(di_plus - di_minus) / denom * 100


def get_signals(kline_cache: dict, current_prices: dict) -> list:
    """
    Generate BUY/SELL signals using MACD + RSI + Bollinger + ADX.
    Matches the indicator set from bitcoin-momentum-trading/feature_engineering.py.
    """
    signals = []

    for sym in COIN_UNIVERSE:
        try:
            candles = kline_cache.get(sym, [])
            if len(candles) < MIN_CANDLES:
                continue

            if hasattr(candles, "iloc"):
                closes = candles["close"].values.astype(float)
                highs  = candles["high"].values.astype(float)
                lows   = candles["low"].values.astype(float)
            else:
                closes = np.array([float(c["close"]) for c in candles])
                highs  = np.array([float(c["high"])  for c in candles])
                lows   = np.array([float(c["low"])   for c in candles])

            # ── Indicators ───────────────────────────────────────────────────
            macd_line, signal_line = _macd(closes)
            rsi_val = _rsi(closes)
            bb_upper, bb_mid, bb_lower = _bollinger(closes)
            atr_val = _atr(highs, lows, closes)
            adx_val = _adx(highs, lows, closes)
            price   = current_prices.get(sym, float(closes[-1]))

            # ── BUY Conditions (from feature_engineering.py pattern) ──────────
            # MACD cross above signal + RSI > 50 (uptrend) + ADX ≥ 20 (trending)
            macd_cross_up = macd_line[-1] > signal_line[-1] and macd_line[-2] <= signal_line[-2]
            bull_conditions = [
                macd_cross_up,
                rsi_val > 50,
                price > bb_mid,      # price above BB midline (bullish)
                adx_val >= ADX_MIN,  # trend is strong enough
            ]
            bull_score = sum(bull_conditions)

            if bull_score >= 3:  # at least 3 of 4 conditions met
                conviction = 60 + bull_score * 7
                signals.append({
                    "symbol": sym, "side": "BUY",
                    "conviction": min(conviction, 88),
                    "strategy": "Axiom",
                    "candle_interval": CANDLE_INTERVAL,
                    "price": price,
                    "atr": atr_val,
                    "reason": f"MACD cross, RSI={rsi_val:.1f}, ADX={adx_val:.1f}, score={bull_score}/4",
                })
                logger.info("📈 [Axiom] BUY %s — score=%d/4 RSI=%.1f ADX=%.1f", sym, bull_score, rsi_val, adx_val)

            # ── SELL Conditions ───────────────────────────────────────────────
            macd_cross_dn = macd_line[-1] < signal_line[-1] and macd_line[-2] >= signal_line[-2]
            bear_conditions = [
                macd_cross_dn,
                rsi_val < 50,
                price < bb_mid,
                adx_val >= ADX_MIN,
            ]
            bear_score = sum(bear_conditions)

            if bear_score >= 3:
                conviction = 60 + bear_score * 6
                signals.append({
                    "symbol": sym, "side": "SELL",
                    "conviction": min(conviction, 84),
                    "strategy": "Axiom",
                    "candle_interval": CANDLE_INTERVAL,
                    "price": price,
                    "atr": atr_val,
                    "reason": f"MACD cross dn, RSI={rsi_val:.1f}, ADX={adx_val:.1f}, score={bear_score}/4",
                })
                logger.info("📉 [Axiom] SELL %s — score=%d/4 RSI=%.1f ADX=%.1f", sym, bear_score, rsi_val, adx_val)

        except Exception as e:
            logger.debug("[Axiom] Error processing %s: %s", sym, e)

    logger.info("[Axiom] Scan complete — %d signals from %d coins", len(signals), len(COIN_UNIVERSE))
    return signals

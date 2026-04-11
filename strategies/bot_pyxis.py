"""
bot_pyxis.py — Pyxis (Systematic) Strategy Bot Signal Generator

Logic source: systematic-crypto-strategy/classproject_brianplotnik.ipynb
Strategy:     SMA 20/50 crossover + RSI filter on 1h candles
Coin universe: All 32 Synaptic coins (repo used all Binance USDT pairs)
"""
import logging
import numpy as np
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import config

logger = logging.getLogger("Pyxis")

# ─── Coin Universe ────────────────────────────────────────────────────────────
# From repo: all Binance USDT pairs. We use all Synaptic coins as the universe.
COIN_UNIVERSE = sorted(set(
    coin for coins in config.CRYPTO_SEGMENTS.values() for coin in coins
))

CANDLE_INTERVAL = "1h"
SMA_FAST        = 20
SMA_SLOW        = 50
RSI_PERIOD      = 14
RSI_BUY_MAX     = 65    # Don't buy overbought coins
RSI_SELL_MIN    = 35    # Don't short oversold coins
MIN_CANDLES     = 60    # Need at least 60 candles for reliable SMA50


def _compute_rsi(closes: np.ndarray, period: int = 14) -> float:
    """Compute RSI for the last candle."""
    if len(closes) < period + 1:
        return 50.0
    deltas = np.diff(closes[-(period + 1):])
    gains  = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)
    avg_gain = gains.mean()
    avg_loss = losses.mean()
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def get_signals(kline_cache: dict, current_prices: dict) -> list:
    """
    Generate BUY/SELL signals for all coins in universe.

    Args:
        kline_cache: dict[symbol -> list of OHLCV dicts with keys 'open','high','low','close','volume']
        current_prices: dict[symbol -> float]

    Returns:
        list of signal dicts:
        [{"symbol": "ETHUSDT", "side": "BUY", "conviction": 72, "strategy": "Pyxis",
          "candle_interval": "1h", "price": 3200.0, "atr": 48.5}]
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

            # ── SMA Crossover ────────────────────────────────────────────────
            sma_fast_now  = closes[-SMA_FAST:].mean()
            sma_slow_now  = closes[-SMA_SLOW:].mean()
            sma_fast_prev = closes[-(SMA_FAST + 1):-1].mean()
            sma_slow_prev = closes[-(SMA_SLOW + 1):-1].mean()

            # ── RSI ──────────────────────────────────────────────────────────
            rsi = _compute_rsi(closes, RSI_PERIOD)

            # ── ATR proxy (14-period) ────────────────────────────────────────
            tr = np.maximum(
                highs[-15:] - lows[-15:],
                np.abs(highs[-15:] - np.roll(closes[-15:], 1))
            )
            atr = float(tr[1:].mean())

            price = current_prices.get(sym, float(closes[-1]))

            # ── BUY Signal: Golden Cross + RSI not overbought ────────────────
            golden_cross = sma_fast_now > sma_slow_now and sma_fast_prev <= sma_slow_prev
            if golden_cross and rsi < RSI_BUY_MAX:
                # Conviction scaled by how far fast > slow (0-100)
                spread_pct = (sma_fast_now - sma_slow_now) / sma_slow_now * 100
                conviction = min(90, 65 + int(spread_pct * 10))
                signals.append({
                    "symbol": sym, "side": "BUY",
                    "conviction": conviction,
                    "strategy": "Pyxis",
                    "candle_interval": CANDLE_INTERVAL,
                    "price": price,
                    "atr": atr,
                    "reason": f"SMA{SMA_FAST}/SMA{SMA_SLOW} golden cross, RSI={rsi:.1f}",
                })
                logger.info("📈 [Pyxis] BUY %s — conv=%d RSI=%.1f", sym, conviction, rsi)

            # ── SELL Signal: Death Cross + RSI not oversold ─────────────────
            death_cross = sma_fast_now < sma_slow_now and sma_fast_prev >= sma_slow_prev
            if death_cross and rsi > RSI_SELL_MIN:
                spread_pct = (sma_slow_now - sma_fast_now) / sma_slow_now * 100
                conviction = min(85, 60 + int(spread_pct * 10))
                signals.append({
                    "symbol": sym, "side": "SELL",
                    "conviction": conviction,
                    "strategy": "Pyxis",
                    "candle_interval": CANDLE_INTERVAL,
                    "price": price,
                    "atr": atr,
                    "reason": f"SMA{SMA_FAST}/SMA{SMA_SLOW} death cross, RSI={rsi:.1f}",
                })
                logger.info("📉 [Pyxis] SELL %s — conv=%d RSI=%.1f", sym, conviction, rsi)

        except Exception as e:
            logger.debug("[Pyxis] Error processing %s: %s", sym, e)

    logger.info("[Pyxis] Scan complete — %d signals generated from %d coins",
                len(signals), len(COIN_UNIVERSE))
    return signals

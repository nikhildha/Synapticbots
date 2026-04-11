"""
bot_ratio.py — Ratio (Stat Arb) Strategy Bot Signal Generator

Logic source: Statistical-Arbitrage-Reversal-and-Momentum-Strategies/src/signal_generator.py
Strategy:     Cross-asset rolling return ranking.
              LONG bottom quartile (mean reversion), SHORT top quartile (momentum exit).
              Uses dual signal: momentum (60d) + reversal (14d) for composite ranking.
Coin universe: 12 coins from repo's default universe (all overlap with Synaptic's 32)
"""
import logging
import numpy as np
import sys
import os
from typing import Dict, List

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import config

logger = logging.getLogger("Ratio")

# ─── Coin Universe ────────────────────────────────────────────────────────────
# From repo's StatArbitrageStrategy.__init__ default symbols list (12 coins):
COIN_UNIVERSE = [
    "BTCUSDT", "ETHUSDT", "ADAUSDT", "BNBUSDT",
    "XRPUSDT", "SOLUSDT", "DOGEUSDT",             # MATICUSDT removed — delisted
    "LINKUSDT", "UNIUSDT", "AAVEUSDT", "ATOMUSDT",
]

# If we don't have 8+ of these, fall back to all 32 Synaptic coins
ALL_32 = sorted(set(coin for coins in config.CRYPTO_SEGMENTS.values() for coin in coins))

CANDLE_INTERVAL = "1d"   # Daily returns for statistical ranking
MIN_DAYS        = 65     # Need at least 65 daily candles for 60d momentum window

# Signal parameters (from signal_generator.py)
MOMENTUM_WINDOWS = [14, 30, 60]   # Days for rolling return calculation
LONG_QUARTILE    = 0.25           # Bottom 25% → potential BUY (reversal)
SHORT_QUARTILE   = 0.75           # Top 25% → potential SELL (momentum fade)
MIN_CONVICTION   = 62             # Minimum conviction to emit signal


def _compute_rolling_returns(price_series: np.ndarray, window: int) -> np.ndarray:
    """Compute rolling window return for a price series."""
    if len(price_series) < window + 1:
        return np.array([np.nan])
    returns = []
    for i in range(window, len(price_series)):
        ret = (price_series[i] - price_series[i - window]) / price_series[i - window]
        returns.append(ret)
    return np.array(returns)


def _atr_from_candles(candles, period: int = 14) -> float:
    if len(candles) < period + 1:
        if hasattr(candles, "iloc"):
            return float(candles["close"].iloc[-1]) * 0.015
        return float(candles[-1]["close"]) * 0.015
        
    if hasattr(candles, "iloc"):
        highs  = candles["high"].values[-period:].astype(float)
        lows   = candles["low"].values[-period:].astype(float)
        closes = candles["close"].values[-(period + 1):-1].astype(float)
    else:
        highs  = np.array([float(c["high"])  for c in candles[-period:]])
        lows   = np.array([float(c["low"])   for c in candles[-period:]])
        closes = np.array([float(c["close"]) for c in candles[-(period + 1):-1]])
    
    tr = np.maximum(highs - lows, np.abs(highs - closes))
    return float(tr.mean())


def get_signals(kline_cache: dict, current_prices: dict) -> list:
    """
    Generate cross-asset stat-arb signals using rolling return ranking.
    Implements the SignalGenerator logic from the source repo.

    Strategy:
    1. Compute rolling 14d, 30d, 60d returns for each coin
    2. Rank all coins by composite return score
    3. Bottom quartile → BUY (mean reversion signal)
    4. Top quartile → SELL (momentum exhaustion signal)
    """

    # ── Determine active universe ─────────────────────────────────────────────
    available = [s for s in COIN_UNIVERSE if len(kline_cache.get(s, [])) >= MIN_DAYS]
    if len(available) < 6:
        # Fall back to all 32 Synaptic coins
        available = [s for s in ALL_32 if len(kline_cache.get(s, [])) >= MIN_DAYS]
        logger.info("[Ratio] Using extended universe (%d coins)", len(available))
    else:
        logger.info("[Ratio] Using primary 12-coin universe (%d available)", len(available))

    if len(available) < 4:
        logger.warning("[Ratio] Not enough coins with sufficient history — skipping cycle")
        return []

    # ── Compute composite rolling return score per coin ───────────────────────
    scores: Dict[str, float] = {}
    atrs:   Dict[str, float] = {}

    for sym in available:
        candles = kline_cache[sym]
        if hasattr(candles, "iloc"):
            closes = candles["close"].values.astype(float)
        else:
            closes  = np.array([float(c["close"]) for c in candles])
        atrs[sym] = _atr_from_candles(candles)

        # Composite: average of normalized returns across windows
        window_scores = []
        for w in MOMENTUM_WINDOWS:
            roll_ret = _compute_rolling_returns(closes, w)
            if len(roll_ret) > 0 and not np.isnan(roll_ret[-1]):
                window_scores.append(roll_ret[-1])
        if window_scores:
            scores[sym] = float(np.mean(window_scores))

    if len(scores) < 4:
        logger.warning("[Ratio] Not enough scoring data — skipping")
        return []

    # ── Rank and select quartiles ─────────────────────────────────────────────
    ranked = sorted(scores.items(), key=lambda x: x[1])  # ascending: worst → best
    n = len(ranked)
    q1_cutoff = int(n * LONG_QUARTILE)   # Bottom 25%
    q3_cutoff = int(n * SHORT_QUARTILE)  # Top 75%

    long_candidates  = [sym for sym, _ in ranked[:q1_cutoff]]   # laggards → BUY
    short_candidates = [sym for sym, _ in ranked[q3_cutoff:]]   # leaders → SELL

    signals = []

    # ── BUY Signals (reversal: laggards expected to mean-revert up) ────────────
    for sym in long_candidates:
        score = scores[sym]
        df = kline_cache[sym]
        backup_price = float(df["close"].iloc[-1]) if hasattr(df, "iloc") else float(df[-1]["close"])
        price = current_prices.get(sym, backup_price)

        # Conviction: lower the negative return, higher the reversal potential
        raw_conviction = MIN_CONVICTION + min(25, int(abs(score) * 150))
        signals.append({
            "symbol": sym, "side": "BUY",
            "conviction": min(raw_conviction, 85),
            "strategy": "Ratio",
            "candle_interval": CANDLE_INTERVAL,
            "price": price,
            "atr": atrs.get(sym, price * 0.015),
            "reason": f"StatArb reversal: composite_return={score:.3f}, rank=bottom{LONG_QUARTILE*100:.0f}%",
        })
        logger.info("📈 [Ratio] BUY %s — composite_ret=%.3f (laggard reversal)", sym, score)

    # ── SELL Signals (momentum fade: leaders expected to revert down) ──────────
    for sym in short_candidates:
        score = scores[sym]
        df = kline_cache[sym]
        backup_price = float(df["close"].iloc[-1]) if hasattr(df, "iloc") else float(df[-1]["close"])
        price = current_prices.get(sym, backup_price)

        raw_conviction = MIN_CONVICTION + min(20, int(abs(score) * 120))
        signals.append({
            "symbol": sym, "side": "SELL",
            "conviction": min(raw_conviction, 80),
            "strategy": "Ratio",
            "candle_interval": CANDLE_INTERVAL,
            "price": price,
            "atr": atrs.get(sym, price * 0.015),
            "reason": f"StatArb momentum fade: composite_return={score:.3f}, rank=top{(1-SHORT_QUARTILE)*100:.0f}%",
        })
        logger.info("📉 [Ratio] SELL %s — composite_ret=%.3f (momentum fade)", sym, score)

    logger.info("[Ratio] Scan complete — %d LONG, %d SHORT signals from %d coins",
                len(long_candidates), len(short_candidates), len(available))
    return signals

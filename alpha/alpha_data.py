"""
╔══════════════════════════════════════════════════════════════════════════════╗
║                        ALPHA MODULE — SYNAPTIC                              ║
║  Module : alpha/alpha_data.py                                                ║
║  Purpose: Data access layer for Alpha. Fetches Bybit OHLCV data via the     ║
║           shared disk cache (tools/data_cache.py) and enriches it with      ║
║           Alpha features. This is the ONLY permitted cross-reference to      ║
║           shared infrastructure — read-only, no side effects.               ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  ISOLATION CONTRACT                                                          ║
║  ✓ May call tools.data_cache.load_all_tf() — read-only                      ║
║  ✓ May read data_cache/*.parquet — never writes to them                     ║
║  ✗ NEVER calls data_pipeline, Binance API, or any root module               ║
║  ✗ NEVER writes to data/ (root data directory)                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

import sys
import os
import time
import requests
import pandas as pd
from typing import Optional

# Add project root to path so we can import tools.data_cache (read-only utility)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.data_cache import load_all_tf_incremental  # noqa: E402 — read-only, no side effects

from alpha.alpha_config import (
    ALPHA_COINS, ALPHA_EXCHANGE,
    ALPHA_BYBIT_BASE_URL, ALPHA_BYBIT_INTERVALS,
)
from alpha.alpha_features import compute_all_features
from alpha.alpha_logger import get_logger

logger = get_logger("data")


def get_data(symbol: str) -> Optional[dict[str, pd.DataFrame]]:
    """
    Fetch and enrich OHLCV data for a single Alpha coin.

    Returns:
        {"4h": df, "1h": df, "15m": df} — each DataFrame has all Alpha features applied.
        None if fetch fails.

    Data source: Bybit disk cache via tools/data_cache.load_all_tf().
    Exchange: bybit only — never binance.
    """
    try:
        raw = load_all_tf_incremental(symbol, exchange=ALPHA_EXCHANGE)
        if raw is None:
            logger.warning("No data returned for %s from cache", symbol)
            return None

        enriched = {}
        for tf, df in raw.items():
            if df is None or df.empty:
                logger.warning("%s %s: empty DataFrame from cache", symbol, tf)
                return None
            enriched[tf] = compute_all_features(df)
            logger.debug("%s %s: %d rows after feature computation", symbol, tf, len(enriched[tf]))

        return enriched

    except Exception as e:
        logger.error("get_data(%s) failed: %s", symbol, e, exc_info=True)
        return None


def get_all_alpha_data() -> dict[str, Optional[dict[str, pd.DataFrame]]]:
    """
    Fetch enriched data for all ALPHA_COINS.

    Returns:
        {symbol: {"4h": df, "1h": df, "15m": df}} for successful fetches.
        Missing/failed coins are excluded (not None — just absent from dict).

    Skips failures gracefully so one bad coin never blocks the others.
    Uses incremental refresh — appends only new Bybit bars each call.
    """
    result = {}
    for symbol in ALPHA_COINS:
        data = get_data(symbol)
        if data is not None:
            result[symbol] = data
        else:
            logger.warning("Skipping %s — data unavailable this cycle", symbol)
    return result


def get_latest_price(symbol: str) -> Optional[float]:
    """
    Fetch current Bybit mark price for a symbol via REST.
    Used only for paper/live entry fills — not for signal computation.

    Returns:
        float price, or None on failure.
    """
    url = f"{ALPHA_BYBIT_BASE_URL}/v5/market/tickers"
    params = {"category": "linear", "symbol": symbol}
    try:
        resp = requests.get(url, params=params, timeout=5)
        resp.raise_for_status()
        data = resp.json()
        if data.get("retCode") == 0:
            tickers = data.get("result", {}).get("list", [])
            if tickers:
                price = float(tickers[0].get("markPrice") or tickers[0].get("lastPrice", 0))
                if price > 0:
                    return price
        logger.warning("get_latest_price(%s): unexpected response %s", symbol, data.get("retMsg"))
        return None
    except Exception as e:
        logger.error("get_latest_price(%s) failed: %s", symbol, e)
        return None

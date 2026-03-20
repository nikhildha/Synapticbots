"""
Project Regime-Master — Data Pipeline
Fetches multi-timeframe OHLCV data.
  • Paper mode → Binance (REST, testnet-safe)
  • Live mode  → CoinDCX Futures (REST)
"""
import pandas as pd
import logging

import config

logger = logging.getLogger("DataPipeline")


# ═══════════════════════════════════════════════════════════════════════════════
# BINANCE CLIENT (Paper Trading)
# ═══════════════════════════════════════════════════════════════════════════════

_binance_client = None


def _get_binance_client():
    """Lazy-init the Binance client (paper trading only)."""
    global _binance_client
    if _binance_client is None:
        from binance.client import Client
        _binance_client = Client(
            api_key=config.BINANCE_API_KEY,
            api_secret=config.BINANCE_API_SECRET,
            testnet=config.TESTNET,
        )
        mode = "TESTNET" if config.TESTNET else "PRODUCTION"
        logger.info("Binance client initialized (%s).", mode)
    return _binance_client


INTERVAL_MAP = {
    "1m":  "1m",
    "3m":  "3m",
    "5m":  "5m",
    "15m": "15m",
    "30m": "30m",
    "1h":  "1h",
    "4h":  "4h",
    "1d":  "1d",
    "1w":  "1w",
}


# ═══════════════════════════════════════════════════════════════════════════════
# BINANCE FETCHERS
# ═══════════════════════════════════════════════════════════════════════════════

_KLINE_COLUMNS = [
    "timestamp", "open", "high", "low", "close", "volume",
    "close_time", "quote_av", "trades", "tb_base_av", "tb_quote_av", "ignore",
]

def _get_binance_interval(interval):
    """Map string interval to Binance client constant."""
    from binance.client import Client as BClient
    binance_map = {
        "1m": BClient.KLINE_INTERVAL_1MINUTE,   "3m": BClient.KLINE_INTERVAL_3MINUTE,
        "5m": BClient.KLINE_INTERVAL_5MINUTE,    "15m": BClient.KLINE_INTERVAL_15MINUTE,
        "30m": BClient.KLINE_INTERVAL_30MINUTE,  "1h": BClient.KLINE_INTERVAL_1HOUR,
        "4h": BClient.KLINE_INTERVAL_4HOUR,      "1d": BClient.KLINE_INTERVAL_1DAY,
        "1w": BClient.KLINE_INTERVAL_1WEEK,
    }
    return binance_map.get(interval, interval)


def _parse_klines_df(klines):
    """Convert raw Binance klines list to a clean OHLCV DataFrame."""
    df = pd.DataFrame(klines, columns=_KLINE_COLUMNS)
    numeric_cols = ["open", "high", "low", "close", "volume"]
    df[numeric_cols] = df[numeric_cols].astype(float)
    df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms")
    df = df[["timestamp", "open", "high", "low", "close", "volume"]].copy()
    df.reset_index(drop=True, inplace=True)
    return df


def _fetch_klines_binance(symbol, interval, limit=500):
    """Fetch spot candlesticks from Binance."""
    client = _get_binance_client()
    binance_interval = _get_binance_interval(interval)
    try:
        klines = client.get_klines(symbol=symbol, interval=binance_interval, limit=limit)
    except Exception as e:
        logger.error("Binance fetch %s %s failed: %s", symbol, interval, e)
        return None
    if not klines:
        return None
    df = _parse_klines_df(klines)
    logger.debug("Binance: %d candles for %s %s.", len(df), symbol, interval)
    return df


def _fetch_futures_klines_binance(symbol, interval, limit=500):
    """Fetch futures candlesticks from Binance."""
    client = _get_binance_client()
    binance_interval = _get_binance_interval(interval)
    try:
        klines = client.futures_klines(symbol=symbol, interval=binance_interval, limit=limit)
    except Exception as e:
        logger.error("Binance futures fetch %s %s failed: %s", symbol, interval, e)
        return None
    if not klines:
        return None
    return _parse_klines_df(klines)


def _get_current_price_binance(symbol):
    """Get current price from Binance."""
    client = _get_binance_client()
    try:
        ticker = client.get_symbol_ticker(symbol=symbol)
        return float(ticker["price"])
    except Exception as e:
        logger.error("Binance price fetch for %s: %s", symbol, e)
        return None


# ═══════════════════════════════════════════════════════════════════════════════
# COINDCX FETCHERS
# ═══════════════════════════════════════════════════════════════════════════════

def _fetch_klines_coindcx(symbol, interval, limit=500):
    """
    Fetch candlesticks from CoinDCX Futures.
    Accepts Binance-style symbol (BTCUSDT), converts internally.
    """
    import coindcx_client as cdx
    pair = cdx.to_coindcx_pair(symbol)
    return cdx.get_candlesticks(pair, interval, limit=limit)


def _get_current_price_coindcx(symbol):
    """Get current price from CoinDCX. Accepts Binance-style symbol."""
    import coindcx_client as cdx
    pair = cdx.to_coindcx_pair(symbol)
    return cdx.get_current_price(pair)


# ═══════════════════════════════════════════════════════════════════════════════
# UNIFIED PUBLIC API (auto-routes by mode)
# ═══════════════════════════════════════════════════════════════════════════════

def fetch_klines(symbol, interval, limit=500):
    """
    Fetch historical candlestick data.

    Paper mode → Binance (primary, broad altcoin coverage)
    Live mode  → CoinDCX (primary), fallback to Binance if coin not listed
    """
    if config.PAPER_TRADE:
        return _fetch_klines_binance(symbol, interval, limit)
    else:
        try:
            return _fetch_klines_coindcx(symbol, interval, limit)
        except Exception as e:
            logger.warning("CoinDCX klines failed for %s, falling back to Binance: %s", symbol, e)
            return _fetch_klines_binance(symbol, interval, limit)


def fetch_futures_klines(symbol, interval, limit=500):
    """
    Fetch futures candlestick data.

    Paper mode → Binance Futures
    Live mode  → CoinDCX Futures, fallback to Binance
    """
    if config.PAPER_TRADE:
        return _fetch_futures_klines_binance(symbol, interval, limit)
    else:
        try:
            return _fetch_klines_coindcx(symbol, interval, limit)
        except Exception as e:
            logger.warning("CoinDCX futures failed for %s, falling back to Binance: %s", symbol, e)
            return _fetch_futures_klines_binance(symbol, interval, limit)


def get_multi_timeframe_data(symbol=None, limit=500):
    """
    Fetch 15m, 1h, and 4h candles for a symbol.

    Returns
    -------
    dict: {'15m': DataFrame, '1h': DataFrame, '4h': DataFrame}
    Any timeframe that fails returns None.
    """
    symbol = symbol or config.PRIMARY_SYMBOL

    data = {
        config.TIMEFRAME_EXECUTION:     fetch_klines(symbol, config.TIMEFRAME_EXECUTION, limit),
        config.TIMEFRAME_CONFIRMATION:  fetch_klines(symbol, config.TIMEFRAME_CONFIRMATION, limit),
        config.TIMEFRAME_MACRO:         fetch_klines(symbol, config.TIMEFRAME_MACRO, limit),
    }

    success = sum(1 for v in data.values() if v is not None)
    logger.info("Multi-TF fetch for %s: %d/%d timeframes OK.", symbol, success, len(data))
    return data


def get_current_price(symbol=None):
    """Get the latest price for a symbol.

    Paper mode → Binance
    Live mode  → CoinDCX, fallback to Binance
    """
    symbol = symbol or config.PRIMARY_SYMBOL
    if config.PAPER_TRADE:
        return _get_current_price_binance(symbol)
    try:
        return _get_current_price_coindcx(symbol)
    except Exception as e:
        logger.warning("CoinDCX price failed for %s, falling back to Binance: %s", symbol, e)
        return _get_current_price_binance(symbol)


def compute_market_structure(symbol: str) -> dict:
    """
    Compute key price-structure levels for Athena's context:
        PDH / PDL  — Previous Day High / Low  (24h ago candles)
        PWH / PWL  — Previous Week High / Low  (7d lookback)
        VWAP       — 24-bar volume-weighted average price (1h bars)
        dist_vwap_pct — % distance of current price from VWAP
        swing_high_3/5 — most recent fractal swing high (3-bar / 5-bar)
        swing_low_3/5  — most recent fractal swing low
        ath_7d / atl_7d — 7-day range extremes
    Returns empty dict on any error (Athena degrades gracefully).
    """
    try:
        df = fetch_klines(symbol, "1h", limit=200)
        if df is None or len(df) < 48:
            return {}

        df = df.copy()
        for col in ("open", "high", "low", "close", "volume"):
            df[col] = df[col].astype(float)

        current_price = float(df["close"].iloc[-1])

        # PDH / PDL — 24 bars before the most-recent 24 bars
        prev_day = df.iloc[-48:-24]
        pdh = float(prev_day["high"].max()) if len(prev_day) > 0 else None
        pdl = float(prev_day["low"].min())  if len(prev_day) > 0 else None

        # PWH / PWL — bars from ~7 days ago up to yesterday
        prev_week = df.iloc[-168:-24] if len(df) >= 168 else df.iloc[:-24]
        pwh = float(prev_week["high"].max()) if len(prev_week) > 0 else None
        pwl = float(prev_week["low"].min())  if len(prev_week) > 0 else None

        # VWAP — 24-bar rolling (last 24 h)
        last_24 = df.iloc[-24:]
        tp = (last_24["high"] + last_24["low"] + last_24["close"]) / 3
        vol_sum = last_24["volume"].sum()
        vwap_val = float((tp * last_24["volume"]).sum() / vol_sum) if vol_sum > 0 else current_price
        dist_vwap_pct = round(((current_price - vwap_val) / vwap_val) * 100, 2)

        # Fractal swing detection on last 60 bars
        def _swing_high(bars, n=3):
            for i in range(len(bars) - n - 1, n - 1, -1):
                if all(bars["high"].iloc[i] > bars["high"].iloc[i - j] and
                       bars["high"].iloc[i] > bars["high"].iloc[i + j]
                       for j in range(1, n + 1)):
                    return round(float(bars["high"].iloc[i]), 6)
            return None

        def _swing_low(bars, n=3):
            for i in range(len(bars) - n - 1, n - 1, -1):
                if all(bars["low"].iloc[i] < bars["low"].iloc[i - j] and
                       bars["low"].iloc[i] < bars["low"].iloc[i + j]
                       for j in range(1, n + 1)):
                    return round(float(bars["low"].iloc[i]), 6)
            return None

        recent = df.iloc[-60:]
        sh3 = _swing_high(recent, n=3)
        sl3 = _swing_low(recent,  n=3)
        sh5 = _swing_high(recent, n=5)
        sl5 = _swing_low(recent,  n=5)

        # 7d extremes
        last_7d = df.iloc[-168:] if len(df) >= 168 else df
        ath_7d = float(last_7d["high"].max())
        atl_7d = float(last_7d["low"].min())

        return {
            "pdh":           pdh,
            "pdl":           pdl,
            "pwh":           pwh,
            "pwl":           pwl,
            "vwap":          round(vwap_val, 6),
            "dist_vwap_pct": dist_vwap_pct,
            "swing_high_3":  sh3,
            "swing_low_3":   sl3,
            "swing_high_5":  sh5,
            "swing_low_5":   sl5,
            "ath_7d":        round(ath_7d, 6),
            "atl_7d":        round(atl_7d, 6),
        }

    except Exception as e:
        logger.debug("compute_market_structure failed for %s: %s", symbol, e)
        return {}

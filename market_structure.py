"""
Market Structure Analyzer — Synaptic Engine
Fetches 15-minute OHLCV data for BTC, ETH, SOL, and AVAX,
then uses the configured LLM (GPT-4o) to produce a 5-9 sentence
market structure summary. Output is written to data/market_structure.json.
Designed to be called from main.py or run standalone every 15 minutes.
"""

import os
import json
import time
import logging
import traceback
from datetime import datetime, timezone
from typing import Optional

import requests

import config

logger = logging.getLogger(__name__)

MARKET_STRUCTURE_FILE = os.path.join(config.DATA_DIR, "market_structure.json")

MACRO_TICKERS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "AVAXUSDT"]
TICKER_DISPLAY = {"BTCUSDT": "BTC", "ETHUSDT": "ETH", "SOLUSDT": "SOL", "AVAXUSDT": "AVAX"}
TIMEFRAME = "15m"
CANDLE_LIMIT = 100   # 100 × 15m = 25 hours of context


# ─── Data Fetching ────────────────────────────────────────────────────────────

def fetch_ohlcv(symbol: str, interval: str = TIMEFRAME, limit: int = CANDLE_LIMIT) -> list:
    """Fetch Binance OHLCV candles for a symbol."""
    url = "https://api.binance.com/api/v3/klines"
    params = {"symbol": symbol, "interval": interval, "limit": limit}
    try:
        r = requests.get(url, params=params, timeout=10)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.warning(f"[MarketStructure] Failed to fetch OHLCV for {symbol}: {e}")
        return []


def fetch_24h_stats(symbol: str) -> dict:
    """Fetch 24-hour stats from Binance for a symbol."""
    try:
        r = requests.get(
            "https://api.binance.com/api/v3/ticker/24hr",
            params={"symbol": symbol},
            timeout=8,
        )
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.warning(f"[MarketStructure] Failed 24h stats for {symbol}: {e}")
        return {}


def summarize_candles(symbol: str, candles: list) -> dict:
    """Compute quick technical summary from raw OHLCV data."""
    if not candles:
        return {}
    closes = [float(c[4]) for c in candles]
    highs  = [float(c[2]) for c in candles]
    lows   = [float(c[3]) for c in candles]
    vols   = [float(c[5]) for c in candles]

    def ema(data, period):
        k = 2 / (period + 1)
        val = data[0]
        for p in data[1:]:
            val = p * k + val * (1 - k)
        return val

    last   = closes[-1]
    ema8   = ema(closes, 8)
    ema21  = ema(closes, 21)
    ema55  = ema(closes, 55)
    high5  = max(highs[-20:])
    low5   = min(lows[-20:])
    avg_vol = sum(vols) / len(vols)
    last_vol = vols[-1]
    vol_ratio = round(last_vol / avg_vol, 2) if avg_vol else 1.0

    trend = "UPTREND" if ema8 > ema21 > ema55 else "DOWNTREND" if ema8 < ema21 < ema55 else "SIDEWAYS"

    return {
        "symbol": symbol,
        "price": round(last, 6),
        "ema8": round(ema8, 6),
        "ema21": round(ema21, 6),
        "ema55": round(ema55, 6),
        "recent_high": round(high5, 6),
        "recent_low": round(low5, 6),
        "volume_ratio": vol_ratio,
        "trend": trend,
    }


# ─── LLM Prompt ──────────────────────────────────────────────────────────────

def build_prompt(summaries: list, stats_map: dict) -> str:
    lines = []
    for s in summaries:
        sym = s["symbol"]
        st = stats_map.get(sym, {})
        chg = st.get("priceChangePercent", "?")
        vol_usd = float(st.get("quoteVolume", 0)) / 1e9
        lines.append(
            f"• {TICKER_DISPLAY.get(sym, sym)}: ${s['price']:,} | 24h Change: {chg}% | "
            f"Vol: ${vol_usd:.2f}B | Trend (15m EMAs): {s['trend']} | "
            f"EMA8={s['ema8']:,} EMA21={s['ema21']:,} EMA55={s['ema55']:,} | "
            f"Recent High={s['recent_high']:,} Low={s['recent_low']:,} | VolRatio={s['volume_ratio']}x"
        )

    ticker_block = "\n".join(lines)
    return f"""You are a senior quant analyst. Analyze the 15-minute market structure for the following four crypto assets:

{ticker_block}

Provide a 5-9 sentence institutional-grade market structure summary covering:
1. BTC dominance and macro direction (bullish/bearish/ranging)
2. ETH structure relative to BTC (leading, lagging, or diverging)
3. SOL momentum and key price levels
4. AVAX Layer-1 network signal and capital rotation cues
5. Overall risk-on vs risk-off sentiment and any notable correlations or divergences across the four assets

Be specific about price action, key levels, and actionable context for an algorithmic crypto trading system. Do NOT include disclaimers or boilerplate. Output ONLY the market structure paragraph."""


def call_llm(prompt: str) -> Optional[str]:
    """Call OpenAI GPT-4o with the market structure prompt."""
    api_key = config.LLM_API_KEY
    if not api_key:
        logger.warning("[MarketStructure] LLM_API_KEY not set, skipping LLM call.")
        return None
    try:
        import openai
        client = openai.OpenAI(api_key=api_key)
        resp = client.chat.completions.create(
            model=config.LLM_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=600,
            timeout=config.LLM_TIMEOUT_SECONDS,
        )
        return resp.choices[0].message.content.strip()
    except Exception as e:
        logger.error(f"[MarketStructure] LLM call failed: {e}")
        return None


# ─── Main Entry Point ─────────────────────────────────────────────────────────

def run_market_structure_analysis() -> dict:
    """
    Perform full market structure analysis for BTC/ETH/SOL/AVAX.
    Returns the result dict and also writes it to MARKET_STRUCTURE_FILE.
    """
    logger.info("[MarketStructure] Starting 15m market structure analysis…")
    summaries = []
    stats_map = {}

    for sym in MACRO_TICKERS:
        candles = fetch_ohlcv(sym)
        summary = summarize_candles(sym, candles)
        if summary:
            summaries.append(summary)
        stats = fetch_24h_stats(sym)
        stats_map[sym] = stats
        time.sleep(0.2)  # gentle rate limiting

    # Build ticker info for frontend (prices + 24h change)
    tickers = []
    for sym in MACRO_TICKERS:
        st = stats_map.get(sym, {})
        tickers.append({
            "symbol": sym,
            "display": TICKER_DISPLAY.get(sym, sym),
            "price": float(st.get("lastPrice", 0)),
            "change_pct": float(st.get("priceChangePercent", 0)),
            "open_price": float(st.get("openPrice", 0)),
            "high_24h": float(st.get("highPrice", 0)),
            "low_24h": float(st.get("lowPrice", 0)),
            "volume_usd": float(st.get("quoteVolume", 0)),
        })

    llm_summary = None
    if summaries:
        prompt = build_prompt(summaries, stats_map)
        llm_summary = call_llm(prompt)

    result = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "tickers": tickers,
        "technical_summaries": summaries,
        "llm_summary": llm_summary or "Market structure analysis unavailable — LLM not configured.",
        "timeframe": TIMEFRAME,
    }

    try:
        with open(MARKET_STRUCTURE_FILE, "w") as f:
            json.dump(result, f)
        logger.info("[MarketStructure] Written to market_structure.json")
    except Exception as e:
        logger.error(f"[MarketStructure] Failed to write JSON: {e}")

    return result


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    r = run_market_structure_analysis()
    print(json.dumps(r, indent=2))

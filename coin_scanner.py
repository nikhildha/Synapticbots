"""
Project Regime-Master — Coin Scanner
Fetches top coins by 24h trading volume and runs HMM regime analysis.
  • Paper mode → Binance tickers
  • Live mode  → CoinDCX Futures instruments
"""
import json
import logging
import os
import time
from datetime import datetime

import pandas as pd
import numpy as np

import config
from data_pipeline import fetch_klines, _get_binance_client
from feature_engine import compute_hmm_features, compute_all_features
from hmm_brain import HMMBrain

logger = logging.getLogger("CoinScanner")

# ─── Path for multi-coin state ──────────────────────────────────────────────────
SCANNER_STATE_FILE = os.path.join(config.DATA_DIR, "scanner_state.json")

# ─── Coins to exclude (no data, wrapped tokens, low liquidity) ───────────────
COIN_EXCLUDE = {
    "EURUSDT", "WBTCUSDT", "USDCUSDT", "TUSDUSDT", "BUSDUSDT",
    "USTUSDT", "DAIUSDT", "FDUSDUSDT", "CVCUSDT", "USD1USDT",
}

# ─── Minimum 24h quote volume to qualify (reduces from 50 → 15 high-liquid coins) ─
# $15M ensures only genuinely liquid, tight-spread futures qualify on Binance US scale.
# This cuts HMM training time by ~70% vs scanning 50 coins.
MIN_QUOTE_VOLUME_USD = 15_000_000 if not config.TESTNET else 0  # Ignore volume limit on testnet

# ─── Dynamic exclusion list (auto-learned from insufficient data) ───────────
COIN_EXCLUSION_FILE = os.path.join(config.DATA_DIR, "coin_exclusions.json")
_dynamic_exclusions: set = set()


def _load_dynamic_exclusions():
    """Load dynamic exclusion list from disk."""
    global _dynamic_exclusions
    try:
        if os.path.exists(COIN_EXCLUSION_FILE):
            with open(COIN_EXCLUSION_FILE, "r") as f:
                data = json.load(f)
            _dynamic_exclusions = set(data.get("excluded_coins", []))
            logger.info("Loaded %d dynamically excluded coins.", len(_dynamic_exclusions))
    except Exception as e:
        logger.warning("Failed to load coin exclusions: %s", e)


def _save_dynamic_exclusions():
    """Persist dynamic exclusion list to disk."""
    try:
        with open(COIN_EXCLUSION_FILE, "w") as f:
            json.dump({
                "excluded_coins": sorted(_dynamic_exclusions),
                "count": len(_dynamic_exclusions),
                "last_updated": datetime.utcnow().isoformat() + "Z",
            }, f, indent=2)
    except Exception as e:
        logger.warning("Failed to save coin exclusions: %s", e)


def auto_exclude_coin(symbol: str, reason: str = "insufficient_data"):
    """Add a coin to the dynamic exclusion list (persisted across restarts)."""
    global _dynamic_exclusions
    if symbol not in _dynamic_exclusions:
        _dynamic_exclusions.add(symbol)
        _save_dynamic_exclusions()
        logger.info("⚠️  Auto-excluded %s (%s). Total exclusions: %d",
                    symbol, reason, len(_dynamic_exclusions))


def get_all_exclusions() -> set:
    """Return combined static + dynamic exclusion set."""
    _load_dynamic_exclusions()
    return COIN_EXCLUDE | _dynamic_exclusions


# ─── Coin tier cache (loaded once from data/coin_tiers.csv) ──────────────────
_coin_tiers: dict = {}   # symbol → {"tier": "A"|"B"|"C", "pattern": str}

def _load_coin_tiers():
    """Load coin tier classifications from disk (Tier A/B/C from calibration experiment)."""
    global _coin_tiers
    if _coin_tiers or not os.path.exists(config.COIN_TIER_FILE):
        return
    try:
        df = pd.read_csv(config.COIN_TIER_FILE)
        for _, row in df.iterrows():
            _coin_tiers[row["symbol"]] = {
                "tier":    row.get("tier", "B"),
                "pattern": row.get("pattern", "RANDOM"),
            }
        logger.info("Loaded coin tiers: %d Tier A, %d Tier B, %d Tier C.",
                    sum(1 for v in _coin_tiers.values() if v["tier"] == "A"),
                    sum(1 for v in _coin_tiers.values() if v["tier"] == "B"),
                    sum(1 for v in _coin_tiers.values() if v["tier"] == "C"))
    except Exception as e:
        logger.warning("Could not load coin tiers from %s: %s", config.COIN_TIER_FILE, e)


def reload_coin_tiers():
    """Force-reload coin tiers from disk (clears cache first). Called after weekly reclassify."""
    global _coin_tiers
    _coin_tiers = {}
    _load_coin_tiers()
    logger.info("Coin tiers reloaded from disk.")


def get_tier_a_whitelist() -> list:
    """Return list of Tier A symbols (stable forward Sharpe ≥ 1.0)."""
    _load_coin_tiers()
    return [sym for sym, info in _coin_tiers.items() if info["tier"] == "A"]


def get_coin_tier(symbol: str) -> str:
    """Return 'A', 'B', or 'C' tier for a symbol. Returns 'B' if unknown."""
    _load_coin_tiers()
    return _coin_tiers.get(symbol, {}).get("tier", "B")


ROTATION_STATE_FILE = os.path.join(config.DATA_DIR, "segment_rotation.json")

def _load_rotation_state():
    if os.path.exists(ROTATION_STATE_FILE):
        try:
            with open(ROTATION_STATE_FILE, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "last_shortlist_time": 0,
        "master_shortlist": {}
    }

def _save_rotation_state(state):
    try:
        with open(ROTATION_STATE_FILE, "w") as f:
            json.dump(state, f, indent=2)
    except Exception as e:
        logger.error("Failed to save rotation state: %s", e)

def _get_segment_coins_binance(segment_coins, limit=5):
    """Fetch top coins for a specific segment from Binance by 24h volume."""
    client = _get_binance_client()
    try:
        tickers = client.get_ticker()
    except Exception as e:
        logger.error("Failed to fetch Binance tickers: %s", e)
        return [config.PRIMARY_SYMBOL]

    exclude_keywords = ("UP", "DOWN", "BULL", "BEAR")
    exclusions = get_all_exclusions()
    
    usdt_tickers = [
        t for t in tickers
        if t["symbol"] in segment_coins
        and not any(kw in t["symbol"] for kw in exclude_keywords)
        and t["symbol"] not in exclusions
        # Dropped MIN_QUOTE_VOLUME_USD filter here to ensure segment coins can be found even if volume drops across the board
    ]
    usdt_tickers.sort(key=lambda t: float(t.get("quoteVolume", 0)), reverse=True)
    return [t["symbol"] for t in usdt_tickers[:limit]]

def _get_segment_coins_coindcx(segment_coins, limit=5):
    """Fetch top coins for a specific segment from CoinDCX Futures by 24h volume."""
    import coindcx_client as cdx

    instruments = cdx.get_active_instruments()
    if not instruments:
        return [config.PRIMARY_SYMBOL]

    prices = cdx.get_current_prices()
    exclusions = get_all_exclusions()

    scored = []
    for inst in instruments:
        binance_sym = cdx.from_coindcx_pair(inst)
        if binance_sym in segment_coins and binance_sym not in exclusions:
            volume = float(prices.get(inst, {}).get("v", 0))
            scored.append((binance_sym, volume))

    scored.sort(key=lambda x: x[1], reverse=True)
    return [sym for sym, vol in scored[:limit]]

def update_hourly_shortlist(limit=2):
    _load_coin_tiers()
    logger.info("🔄 Running hourly master shortlist for all segments...")
    master_shortlist = {}
    
    for segment, candidate_coins in config.CRYPTO_SEGMENTS.items():
        if config.PAPER_TRADE:
            selected_coins = _get_segment_coins_binance(candidate_coins, limit=limit * 2)
        else:
            selected_coins = _get_segment_coins_coindcx(candidate_coins, limit=limit * 2)
            
        if _coin_tiers:
            tier_c = {s for s, info in _coin_tiers.items() if info["tier"] == "C"}
            selected_coins = [s for s in selected_coins if s not in tier_c]
            
            tier_a = {s for s, info in _coin_tiers.items() if info["tier"] == "A"}
            selected_coins = (
                [s for s in selected_coins if s in tier_a] +
                [s for s in selected_coins if s not in tier_a]
            )

        selected_coins = selected_coins[:limit]
        if not selected_coins:
            logger.warning("No valid coins found for segment %s.", segment)
            
        master_shortlist[segment] = selected_coins
        
    state = {
        "last_shortlist_time": time.time(),
        "master_shortlist": master_shortlist
    }
    _save_rotation_state(state)
    logger.info("✅ Hourly master shortlist completed and saved.")
    return state

def get_active_segment_coins(limit=2):
    """
    Checks the rotation state. If 1 hour has passed, updates the master shortlist for all segments.
    Then determines the current 15-minute block and returns the coins for the 2 active segments.
    """
    if not getattr(config, "SCANNER_SEGMENT_ROTATION", False):
        logger.info("Segment rotation disabled. Falling back to L1 default.")
        return config.CRYPTO_SEGMENTS["L1"][:limit]

    state = _load_rotation_state()
    now = time.time()
    
    # Update master shortlist every 1 hour (3600 seconds)
    if now - state.get("last_shortlist_time", 0) > 3600 or not state.get("master_shortlist"):
        state = update_hourly_shortlist(limit)
        
    master_shortlist = state.get("master_shortlist", {})
    segments = list(config.CRYPTO_SEGMENTS.keys())
    
    # Determine the 15-minute execution block based on the current UTC minute
    current_minute = datetime.utcnow().minute
    block_index = current_minute // 15
    
    # Each block gets 2 segments (4 blocks per hour, 8 segments total)
    start_idx = (block_index * 2) % len(segments)
    end_idx = start_idx + 2
    
    if end_idx <= len(segments):
        active_segments = segments[start_idx:end_idx]
    else:
        active_segments = segments[start_idx:] + segments[:end_idx % len(segments)]
        
    active_coins = []
    for seg in active_segments:
        active_coins.extend(master_shortlist.get(seg, []))
        
    logger.info("📍 Active block %d (:%.2d-:%.2d). Evaluating %d segments: %s", 
                block_index, block_index * 15, block_index * 15 + 14, len(active_segments), ", ".join(active_segments))
                
    if not active_coins:
        logger.warning("No active coins found in the mapped segments.")
        return [config.PRIMARY_SYMBOL]
        
    return active_coins


def scan_all_regimes(symbols=None, limit=None, timeframe="1h", kline_limit=500):
    """
    Run HMM regime classification on each symbol.

    Returns
    -------
    list[dict] — one entry per symbol:
        {symbol, regime, regime_name, confidence, price, volume_24h, timestamp}
    """
    if symbols is None:
        limit = limit or getattr(config, "SCANNER_COINS_PER_SEGMENT", 5)
        symbols = get_active_segment_coins(limit=limit)

    results = []
    brain = HMMBrain()

    for i, symbol in enumerate(symbols):
        try:
            df = fetch_klines(symbol, timeframe, limit=kline_limit)
            if df is None or len(df) < 60:
                logger.debug("Skipping %s — insufficient data.", symbol)
                auto_exclude_coin(symbol, "insufficient_data")
                continue

            # Compute features & train per-coin HMM
            df_feat = compute_all_features(df)
            df_hmm = compute_hmm_features(df)

            brain_copy = HMMBrain()
            brain_copy.train(df_hmm)

            if not brain_copy.is_trained:
                continue

            state, conf = brain_copy.predict(df_feat)
            regime_name = brain_copy.get_regime_name(state)

            results.append({
                "rank":       i + 1,
                "symbol":     symbol,
                "regime":     int(state),
                "regime_name": regime_name,
                "confidence": round(conf, 4),
                "price":      round(float(df["close"].iloc[-1]), 4),
                "volume_24h": round(float(df["volume"].sum()), 2),
                "tier":       get_coin_tier(symbol),
                "timestamp":  datetime.utcnow().isoformat(),
            })

            # Rate-limit to avoid API throttling
            if (i + 1) % 10 == 0:
                logger.info("Scanned %d/%d coins...", i + 1, len(symbols))
                time.sleep(config.SCANNER_RATE_LIMIT_SLEEP)

        except Exception as e:
            logger.warning("Error scanning %s: %s", symbol, e)
            continue

    # Save results for the dashboard
    _save_scanner_state(results)
    logger.info("Scan complete: %d coins classified.", len(results))
    return results


def _save_scanner_state(results):
    """Persist scanner results for the dashboard."""
    try:
        with open(SCANNER_STATE_FILE, "w") as f:
            json.dump({
                "last_scan": datetime.utcnow().isoformat(),
                "count": len(results),
                "coins": results,
            }, f, indent=2)
    except Exception as e:
        logger.error("Failed to save scanner state: %s", e)


def load_scanner_state():
    """Load the latest scanner results (used by dashboard)."""
    import os
    if not os.path.exists(SCANNER_STATE_FILE):
        return None
    try:
        with open(SCANNER_STATE_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return None


def print_scanner_report(results):
    """Pretty-print scanner results to console."""
    print("\n" + "=" * 90)
    print("  🔍 REGIME-MASTER: TOP COINS SCANNER")
    print("=" * 90)
    print(f"  {'#':<4} {'Symbol':<12} {'Regime':<16} {'Confidence':<12} {'Price':<14} ")
    print("-" * 90)

    for r in results:
        emoji = {"BULLISH": "🟢", "BEARISH": "🔴", "SIDEWAYS/CHOP": "🟡", "CRASH/PANIC": "💀"}.get(r["regime_name"], "❓")
        print(f"  {r['rank']:<4} {r['symbol']:<12} {emoji} {r['regime_name']:<14} {r['confidence']*100:>6.1f}%      ${r['price']:<12,.4f}")

    # Summary
    bull = sum(1 for r in results if r["regime"] == config.REGIME_BULL)
    bear = sum(1 for r in results if r["regime"] == config.REGIME_BEAR)
    chop = sum(1 for r in results if r["regime"] == config.REGIME_CHOP)
    crash = sum(1 for r in results if r["regime"] == config.REGIME_CRASH)
    print("-" * 90)
    print(f"  Summary: 🟢 {bull} Bull | 🔴 {bear} Bear | 🟡 {chop} Chop | 💀 {crash} Crash")
    print("=" * 90 + "\n")


# ─── CLI ─────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
    limit = getattr(config, "SCANNER_COINS_PER_SEGMENT", 5)
    print(f"Scanning up to {limit} coins for active narrative segment...")
    results = scan_all_regimes(limit=limit)
    print_scanner_report(results)

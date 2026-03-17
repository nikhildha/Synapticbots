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
    "POLYXUSDT",
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

def get_hottest_segments(segment_limit=2):
    """
    Evaluate the pulse/momentum of all crypto segments via the 3-Pillar Institutional method:
    Pillar 1: Volume-Weighted Relative Return (VW-RR)
    Pillar 2: Benchmark Alpha (vs BTC)
    Pillar 3: Participation Breadth
    
    Returns the top 'segment_limit' segments.
    """
    try:
        client = _get_binance_client()
        tickers = client.get_ticker()
        ticker_map = {t["symbol"]: t for t in tickers}
    except Exception as e:
        logger.error("Failed to fetch tickers for segment heatmap: %s", e)
        return list(config.CRYPTO_SEGMENTS.keys())[:segment_limit]

    # Get Benchmark (BTC) 24h Return
    btc_return = 0.0
    if "BTCUSDT" in ticker_map:
        try:
            btc_return = float(ticker_map["BTCUSDT"]["priceChangePercent"])
        except:
            pass

    segment_data = []
    for segment, coins in config.CRYPTO_SEGMENTS.items():
        valid_coins = []
        for symbol in coins:
            t = ticker_map.get(symbol)
            if t:
                try:
                    change = float(t["priceChangePercent"])
                    volume = float(t.get("quoteVolume", 0))
                    valid_coins.append({"symbol": symbol, "change": change, "volume": volume})
                except (ValueError, TypeError):
                    pass
        
        if not valid_coins:
            continue

        total_vol = sum(c["volume"] for c in valid_coins)
        
        # Pillar 1: VW-RR (Volume-Weighted Relative Return)
        vw_rr = sum(c["change"] * (c["volume"] / total_vol) for c in valid_coins) if total_vol > 0 else 0.0
        
        # Pillar 2: Benchmark Alpha
        alpha = vw_rr - btc_return
        
        # Pillar 3: Participation Breadth (% of coins participating in the direction of the segment)
        if vw_rr >= 0:
            participating = sum(1 for c in valid_coins if c["change"] > 0)
        else:
            participating = sum(1 for c in valid_coins if c["change"] < 0)
            
        breadth_pct = (participating / len(valid_coins)) * 100 if valid_coins else 0.0
        
        # Composite Score: VW-RR absolute magnitude scaled by breadth
        # Example: A 10% move with 20% breadth is weak. A 5% move with 100% breadth is strong.
        composite_score = vw_rr * (breadth_pct / 100.0)

        segment_data.append({
            "segment": segment,
            "vw_rr": round(vw_rr, 2),
            "btc_alpha": round(alpha, 2),
            "breadth_pct": round(breadth_pct, 1),
            "composite_score": round(composite_score, 2),
            "is_positive": composite_score >= 0,
            "abs_score": abs(composite_score)
        })
        
    # Rank by hottest absolute composite score (fastest movers)
    segment_data.sort(key=lambda x: x["abs_score"], reverse=True)
    
    # Save the heatmap to disk for the dashboard to read
    try:
        heatmap_file = os.path.join(config.DATA_DIR, "segment_heatmap.json")
        with open(heatmap_file, "w") as f:
            json.dump({
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "btc_24h": round(btc_return, 2),
                "segments": segment_data
            }, f, indent=2)
    except Exception as e:
        logger.error("Failed to save segment heatmap: %s", e)
    
    logger.info("🔥 Institutional Segment Heatmap (Composite):")
    for i, seg in enumerate(segment_data):
        logger.info("   #%d %-8s : VW-RR %+.2f%% | Alpha %+.2f%% | Breadth %.0f%% -> Score: %.2f", 
                    i+1, seg["segment"], seg["vw_rr"], seg["btc_alpha"], seg["breadth_pct"], seg["composite_score"])
        
    return [seg["segment"] for seg in segment_data[:segment_limit]]

def get_active_bot_segment_pool(active_bots):
    """
    Builds the coin scan pool based on the segment_filter of all active bots.
    If any bot has segment_filter == "ALL", or if no bots are registered,
    it dynamically fetches the Top 2 hottest segments (and writes heatmap JSON).
    For all other bots, it appends the coins from their specific mapped segments.
    """
    logger.info("🔍 Compiling segment scan pool for %d active bots...", len(active_bots))

    target_segments = set()
    needs_dynamic_all = False

    if not active_bots:
        # No bots registered yet — treat as 'ALL' mode so we still scan segments
        # and write the heatmap for the dashboard
        needs_dynamic_all = True
        logger.info("⚡ No active bots registered — falling back to ALL/dynamic segment mode")
    else:
        for bot in active_bots:
            seg = bot.get("segment_filter", "ALL")
            if seg == "ALL":
                needs_dynamic_all = True
            elif seg in config.CRYPTO_SEGMENTS:
                target_segments.add(seg)

    if needs_dynamic_all:
        segment_limit = getattr(config, "SEGMENT_SCAN_LIMIT", 2)
        top_segments = get_hottest_segments(segment_limit)  # ← also writes heatmap JSON
        logger.info("🎯 Dynamic segment selection — Top %d: %s", segment_limit, ", ".join(top_segments))
        for t_seg in top_segments:
            target_segments.add(t_seg)

    # Compile the final unique list of coins from exactly these target segments
    candidates = set()
    for seg in target_segments:
        coins = config.CRYPTO_SEGMENTS.get(seg, [])
        candidates.update(coins)

    # Clean out exclusions
    exclusions = get_all_exclusions()
    candidates = [c for c in candidates if c not in exclusions]

    logger.info("💎 Final Segment Pool: %d segments targeted → %d total unique coins", len(target_segments), len(candidates))

    # Fallback — should never happen with dynamic mode but keep as safety net
    if not candidates:
        logger.warning("⚠️  Segment pool empty after filtering — using PRIMARY_SYMBOL as fallback")
        return [config.PRIMARY_SYMBOL]

    # Always include PRIMARY_SYMBOL (BTC) at the front regardless of segment filter.
    # BTC is required as the macro reference for dashboard regime display and for the
    # per-coin BTC macro context used in conviction scoring (_multi_tf_brains["BTCUSDT"]).
    pool = sorted(list(candidates))
    if config.PRIMARY_SYMBOL in pool:
        pool.remove(config.PRIMARY_SYMBOL)
    pool.insert(0, config.PRIMARY_SYMBOL)

    return pool



def get_top_segment_candidates():
    """
    Gets the symbols belonging to the top hottest segments.
    This replaces the retail 'top 50 volume' approach.
    """
    segment_limit = getattr(config, "SEGMENT_SCAN_LIMIT", 2)
    top_segments = get_hottest_segments(segment_limit)
    
    logger.info("🏆 Selected Top Segments for this cycle: %s", ", ".join(top_segments))
    
    candidates = []
    for seg in top_segments:
        # Get all mapped coins for this segment
        coins = config.CRYPTO_SEGMENTS.get(seg, [])
        candidates.extend(coins)
        
    # Clean out exclusions
    exclusions = get_all_exclusions()
    candidates = [c for c in candidates if c not in exclusions]
    
    return candidates

def get_top_coins_by_volume(limit=50):
    """Legacy retail backward-compatibility function."""
    try:
        client = _get_binance_client()
        tickers = client.get_ticker()
        tickers.sort(key=lambda x: float(x.get("quoteVolume", 0)), reverse=True)
        exclusions = get_all_exclusions()
        valid = [t["symbol"] for t in tickers if "USDT" in t["symbol"] and t["symbol"] not in exclusions and "UP" not in t["symbol"] and "DOWN" not in t["symbol"]]
        return valid[:limit]
    except Exception:
        return [config.PRIMARY_SYMBOL]

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

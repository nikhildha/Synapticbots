"""
tools/prune_features_phase1.py

HMM Likelihood Permutation Importance — Phase 1 coins.

For each Phase 1 coin:
  1. Fetch recent 15m candles from Binance FUTURES (handles 1000X tokens)
  2. Train HMMBrain (GMMHMM) on ALL 12 features using 80% of data
  3. Permutation shuffle each feature on the 20% test set
  4. Rank by log-likelihood drop (higher drop = more important)
  5. Keep top-7 features + always add mandatory [vwap_dist, bb_width_norm, rel_strength_btc]
  6. Auto-patch COIN_FEATURES dict in segment_features.py

Usage:
  python tools/prune_features_phase1.py
  python tools/prune_features_phase1.py --dry-run   # print only, no file write
"""

import sys
import os
import time
import re
import argparse

import numpy as np
import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config
from data_pipeline import _parse_klines_df
from feature_engine import compute_all_features
from hmm_brain import HMMBrain
from segment_features import ALL_HMM_FEATURES

# ─── Phase 1 trained coins (45 successfully trained) ────────────────────────
PHASE1_TRAINED = [
    # L1
    "ADAUSDT", "APTUSDT", "BCHUSDT", "DOTUSDT", "ETCUSDT", "HBARUSDT",
    "ICPUSDT", "KASUSDT", "LTCUSDT", "NEARUSDT", "TONUSDT", "TRXUSDT", "XRPUSDT",
    # L2
    "CELOUSDT", "MANTAUSDT", "METISUSDT", "ZKUSDT",
    # DeFi
    "CAKEUSDT", "COMPUSDT", "DYDXUSDT", "ENAUSDT", "GMXUSDT",
    "JTOUSDT", "LDOUSDT", "SNXUSDT", "SUSHIUSDT",
    # AI
    "ARKMUSDT", "FETUSDT", "GLMUSDT", "GRTUSDT", "IOUSDT", "RENDERUSDT",
    # Meme
    "1000BONKUSDT", "1000PEPEUSDT", "1000SHIBUSDT", "MEWUSDT", "NOTUSDT",
    # Gaming
    "ENJUSDT", "GALAUSDT", "MANAUSDT", "YGGUSDT",
    # Infrastructure
    "AXLUSDT", "QNTUSDT", "STXUSDT",
    # Oracle
    "BANDUSDT",
]

MANDATORY_FEATURES = ["vwap_dist", "bb_width_norm", "rel_strength_btc"]
TOP_N_FEATURES     = 7
CANDLE_LIMIT       = 1500     # Binance futures API max limit
INTERVAL           = "15m"
SEGMENT_FEATURES_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "segment_features.py"
)


# ─── Fetch 15m candles from Binance futures ──────────────────────────────────

def fetch_15m(symbol: str):
    """Fetch recent 15m candles from Binance USDT-M futures."""
    url = "https://fapi.binance.com/fapi/v1/klines"
    params = {"symbol": symbol, "interval": "15m", "limit": CANDLE_LIMIT}
    try:
        r = requests.get(url, params=params, timeout=15)
        if r.status_code != 200:
            return None
        data = r.json()
        if not data or isinstance(data, dict):
            return None
        return _parse_klines_df(data)
    except Exception as e:
        print(f"    FETCH ERROR {symbol}: {e}")
        return None


# ─── Permutation importance ──────────────────────────────────────────────────

def permutation_importance(brain: HMMBrain, test_df) -> dict:
    """
    Shuffle each feature independently and measure log-likelihood drop.
    Higher drop = feature is more important.
    """
    features = brain.features
    test_X = test_df[features].values
    test_X_scaled = (test_X - brain._feat_mean) / brain._feat_std

    baseline = brain.model.score(test_X_scaled)
    importance = {}
    rng = np.random.RandomState(42)

    for feat in features:
        shuffled = test_df[features].copy()
        idx = features.index(feat)
        perm = rng.permutation(shuffled[feat].values)
        shuffled[feat] = perm
        sx = shuffled.values
        sx_scaled = (sx - brain._feat_mean) / brain._feat_std
        try:
            score = brain.model.score(sx_scaled)
        except Exception:
            score = baseline   # can't measure — treat as neutral
        importance[feat] = baseline - score   # positive = important

    return importance


# ─── Build pruned feature list ───────────────────────────────────────────────

def build_pruned_features(importance: dict) -> list:
    """Return top-N features + mandatory features, deduplicated."""
    sorted_feats = sorted(importance, key=importance.get, reverse=True)
    top = sorted_feats[:TOP_N_FEATURES]
    for m in MANDATORY_FEATURES:
        if m not in top:
            top.append(m)
    return top


# ─── Patch segment_features.py ───────────────────────────────────────────────

def patch_segment_features(new_entries: dict, dry_run: bool):
    """
    Append or update entries in COIN_FEATURES dict inside segment_features.py.
    Uses simple string manipulation — reads the file, finds the COIN_FEATURES block,
    and appends any missing entries before the closing '}'.
    """
    with open(SEGMENT_FEATURES_PATH, "r") as f:
        content = f.read()

    lines_to_add = []
    for symbol, features in new_entries.items():
        # Check if entry already exists
        if f'"{symbol}"' in content:
            print(f"    {symbol}: already in COIN_FEATURES — skipping patch")
            continue
        feat_str = ",\n        ".join(f'"{f}"' for f in features)
        entry = f'    "{symbol}": [\n        {feat_str}\n    ],'
        lines_to_add.append(entry)

    if not lines_to_add:
        print("  Nothing new to patch.")
        return

    new_block = "\n".join(lines_to_add)

    # Find closing brace of COIN_FEATURES and insert before it
    # Pattern: last '}' that closes the COIN_FEATURES dict
    # We look for the line that has just '}' after the last entry
    insert_marker = "\n}\n\ndef get_features_for_coin"
    replacement   = f"\n{new_block}\n" + insert_marker

    if insert_marker not in content:
        print("  WARNING: Could not find insertion point in segment_features.py")
        print("  New entries to add manually:")
        print(new_block)
        return

    patched = content.replace(insert_marker, replacement, 1)

    if dry_run:
        print("\n  [DRY RUN] Would add to segment_features.py:")
        print(new_block)
        return

    with open(SEGMENT_FEATURES_PATH, "w") as f:
        f.write(patched)
    print(f"  segment_features.py updated — {len(lines_to_add)} entries added.")


# ─── Process one coin ────────────────────────────────────────────────────────

def process_coin(symbol: str) -> dict | None:
    """Fetch, train, measure importance, return pruned feature list."""

    # 1. Fetch
    df_raw = fetch_15m(symbol)
    if df_raw is None or df_raw.empty or len(df_raw) < 150:
        print(f"  {symbol:20s} → NO DATA")
        return None

    # 2. Features
    try:
        df = compute_all_features(df_raw).dropna().reset_index(drop=True)
    except Exception as e:
        print(f"  {symbol:20s} → FEATURE ERROR: {e}")
        return None

    if len(df) < 100:
        print(f"  {symbol:20s} → TOO SHORT after features ({len(df)} rows)")
        return None

    # 3. Train / test split 80/20
    split = int(len(df) * 0.8)
    train_df = df.iloc[:split]
    test_df  = df.iloc[split:].copy()

    # 4. Train
    brain = HMMBrain(symbol=symbol, features_list=list(ALL_HMM_FEATURES))
    try:
        brain.train(train_df)
    except Exception as e:
        print(f"  {symbol:20s} → TRAIN ERROR: {e}")
        return None

    if not brain.is_trained:
        print(f"  {symbol:20s} → TRAIN FAILED")
        return None

    # 5. Permutation importance
    try:
        importance = permutation_importance(brain, test_df)
    except Exception as e:
        print(f"  {symbol:20s} → IMPORTANCE ERROR: {e}")
        return None

    # 6. Prune
    pruned = build_pruned_features(importance)

    # Sort importance for display
    ranked = sorted(importance.items(), key=lambda x: x[1], reverse=True)
    kept    = [f for f, _ in ranked if f in pruned]
    removed = [f for f, _ in ranked if f not in pruned]

    print(f"  {symbol:20s} → kept {len(pruned):2d} features | "
          f"removed: {removed if removed else 'none'}")

    return {"features": pruned, "importance": importance}


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print("\n" + "="*70)
    print("  Phase 1 Feature Pruning — Permutation Importance (GMMHMM 15m)")
    print(f"  Coins: {len(PHASE1_TRAINED)}  |  Keep top-{TOP_N_FEATURES} + mandatory")
    print(f"  Target: {SEGMENT_FEATURES_PATH}")
    if args.dry_run:
        print("  *** DRY RUN ***")
    print("="*70 + "\n")

    new_entries = {}
    failed = []

    for i, symbol in enumerate(PHASE1_TRAINED, 1):
        print(f"[{i:2d}/{len(PHASE1_TRAINED)}]", end=" ")
        result = process_coin(symbol)
        if result:
            new_entries[symbol] = result["features"]
        else:
            failed.append(symbol)
        time.sleep(0.3)

    # ─── Summary ─────────────────────────────────────────────────────────────
    print(f"\n{'='*70}")
    print(f"  Done: {len(new_entries)} pruned  |  {len(failed)} failed")
    if failed:
        print(f"  Failed: {failed}")

    # Feature frequency across all coins
    freq: dict = {}
    for feats in new_entries.values():
        for f in feats:
            freq[f] = freq.get(f, 0) + 1

    print("\n  Feature retention frequency:")
    for feat, count in sorted(freq.items(), key=lambda x: x[1], reverse=True):
        bar = "█" * count
        print(f"    {feat:30s}  {count:2d}/{len(new_entries)}  {bar}")

    # ─── Patch segment_features.py ───────────────────────────────────────────
    print(f"\n  Patching segment_features.py...")
    patch_segment_features(new_entries, args.dry_run)
    print("="*70 + "\n")


if __name__ == "__main__":
    main()

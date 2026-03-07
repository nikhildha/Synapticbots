"""
tools/weekly_reclassify.py

Weekly automated coin tier re-classification.

Runs a lightweight walk-forward calibration on the existing coin universe
(from data/coin_tiers.csv) using 120 days of 4h data:
  - Train window: first 90 days
  - Forward test: most recent 30 days

Assigns each coin to a tier based on forward Sharpe:
  Tier A  (≥ 1.0)  — Trade it
  Tier B  (0.0–1.0)— Monitor
  Tier C  (< 0.0)  — Avoid

Updates data/coin_tiers.csv and data/tier_reclassify_state.json.
Runtime: ~5–8 minutes (one Binance API call per coin, 0.4s sleep).

Usage:
  python tools/weekly_reclassify.py          # run immediately
  python tools/weekly_reclassify.py --dry    # compute but don't write CSV
"""
import sys, os, json, time, logging, argparse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
import pandas as pd

import config
from data_pipeline import _parse_klines_df
from feature_engine import compute_hmm_features
from hmm_brain import HMMBrain

logger = logging.getLogger("WeeklyReclassify")

# ─── Settings ─────────────────────────────────────────────────────────────────
TOTAL_DAYS   = 120        # Total history to fetch
TRAIN_DAYS   = 90         # Train window (days)
FWD_DAYS     = 30         # Forward test window (days)
BARS_PER_DAY = 6          # 4h bars per day
MIN_FWD_BARS = 30         # Minimum forward bars to score a coin
SLEEP_S      = 0.4        # Sleep between Binance API calls


def _fetch_recent(symbol: str, days: int):
    """Fetch recent N days of 4h klines from Binance public API (no auth required)."""
    from binance.client import Client
    client = Client(tld="com")
    start = f"{days + 2} days ago UTC"
    try:
        klines = client.get_historical_klines(symbol, Client.KLINE_INTERVAL_4HOUR, start)
        return _parse_klines_df(klines) if klines else None
    except Exception as e:
        logger.warning("Fetch error %s: %s", symbol, e)
        return None


def _compute_forward_sharpe(df: pd.DataFrame, train_days: int, fwd_days: int) -> float:
    """
    Walk-forward Sharpe:
      1. Train HMM on first train_days × 6 bars (4h).
      2. Predict regimes on next fwd_days × 6 bars.
      3. Strategy: long on BULL, short on BEAR, flat on CHOP.
      4. Return annualised Sharpe of the forward strategy returns.
    """
    train_bars = train_days * BARS_PER_DAY
    fwd_bars   = fwd_days   * BARS_PER_DAY

    df_feat = compute_hmm_features(df).dropna()

    if len(df_feat) < train_bars + MIN_FWD_BARS:
        return float("nan")

    df_train = df_feat.iloc[:train_bars]
    df_fwd   = df_feat.iloc[train_bars:train_bars + fwd_bars]

    if len(df_fwd) < MIN_FWD_BARS:
        return float("nan")

    brain = HMMBrain(n_states=config.HMM_N_STATES)
    brain.train(df_train)
    if not brain.is_trained:
        return float("nan")

    regimes  = brain.predict_all(df_fwd)
    log_rets = df_fwd["log_return"].values

    # +1 on BULL (long), -1 on BEAR (short), 0 on CHOP (flat)
    strategy = np.where(
        regimes == config.REGIME_BULL,  log_rets,
        np.where(regimes == config.REGIME_BEAR, -log_rets, 0.0)
    )

    if len(strategy) < 2 or strategy.std() < 1e-10:
        return float("nan")

    annualise = np.sqrt(BARS_PER_DAY * 365)   # 4h → annualised
    return float((strategy.mean() / strategy.std()) * annualise)


def _assign_tier(sharpe: float) -> str:
    if np.isnan(sharpe):
        return "B"
    if sharpe >= 1.0:
        return "A"
    if sharpe >= 0.0:
        return "B"
    return "C"


def load_coin_universe() -> list:
    """Read coin universe from existing coin_tiers.csv."""
    if not os.path.exists(config.COIN_TIER_FILE):
        logger.error("coin_tiers.csv not found at %s", config.COIN_TIER_FILE)
        return []
    return pd.read_csv(config.COIN_TIER_FILE)["symbol"].tolist()


def run_reclassify(dry_run: bool = False) -> dict:
    """
    Main entry point — callable from main.py in a background thread.

    Returns summary: {"A": [...], "B": [...], "C": [...], "skipped": [...]}
    """
    logger.info("=== Weekly Coin Tier Re-classification START ===")
    symbols = load_coin_universe()
    if not symbols:
        logger.warning("No coins in universe — aborting.")
        return {}

    logger.info(
        "Re-classifying %d coins | train=%dd forward=%dd",
        len(symbols), TRAIN_DAYS, FWD_DAYS,
    )

    rows = []
    skipped_rows = []
    summary = {"A": [], "B": [], "C": [], "skipped": []}

    for i, sym in enumerate(symbols, 1):
        logger.info("[%d/%d] %s ...", i, len(symbols), sym)
        df = _fetch_recent(sym, TOTAL_DAYS)

        if df is None or len(df) < (TRAIN_DAYS + MIN_FWD_BARS) * BARS_PER_DAY:
            logger.warning("  Skipping %s — insufficient data.", sym)
            summary["skipped"].append(sym)
            time.sleep(SLEEP_S)
            continue

        sharpe = _compute_forward_sharpe(df, TRAIN_DAYS, FWD_DAYS)
        tier   = _assign_tier(sharpe)
        summary[tier].append(sym)

        rows.append({
            "symbol":       sym,
            "tier":         tier,
            "fwd_sharpe":   round(sharpe, 4) if not np.isnan(sharpe) else "",
            "fwd_accuracy": "",
            "fwd_pnl":      "",
            "bt_sharpe":    "",
            "pattern":      "UNKNOWN",
            "stable":       "",
        })

        sharpe_str = f"{sharpe:.3f}" if not np.isnan(sharpe) else "nan"
        logger.info("  → Tier %s  (fwd Sharpe=%s)", tier, sharpe_str)
        time.sleep(SLEEP_S)

    if not rows:
        logger.warning("No coins processed — CSV not updated.")
        return summary

    if not dry_run:
        df_out = pd.DataFrame(rows)

        # Preserve rows for skipped coins from the original file
        if summary["skipped"] and os.path.exists(config.COIN_TIER_FILE):
            df_orig = pd.read_csv(config.COIN_TIER_FILE)
            preserved = df_orig[df_orig["symbol"].isin(summary["skipped"])]
            df_out = pd.concat([df_out, preserved], ignore_index=True)

        df_out.to_csv(config.COIN_TIER_FILE, index=False)
        logger.info("Updated %s (%d coins).", config.COIN_TIER_FILE, len(df_out))

        state = {
            "last_reclassified": datetime.now(timezone.utc).isoformat(),
            "tier_a_count":  len(summary["A"]),
            "tier_b_count":  len(summary["B"]),
            "tier_c_count":  len(summary["C"]),
            "skipped_count": len(summary["skipped"]),
            "tier_a":  summary["A"],
            "tier_c":  summary["C"],
        }
        with open(config.TIER_RECLASSIFY_STATE_FILE, "w") as f:
            json.dump(state, f, indent=2)
        logger.info("State written → %s", config.TIER_RECLASSIFY_STATE_FILE)

    logger.info(
        "=== Re-classification DONE | A=%d  B=%d  C=%d  Skipped=%d ===",
        len(summary["A"]), len(summary["B"]),
        len(summary["C"]), len(summary["skipped"]),
    )
    return summary


def needs_reclassify() -> bool:
    """Return True if TIER_RECLASSIFY_DAYS have elapsed since last run."""
    if not os.path.exists(config.TIER_RECLASSIFY_STATE_FILE):
        return True
    try:
        with open(config.TIER_RECLASSIFY_STATE_FILE) as f:
            state = json.load(f)
        last    = datetime.fromisoformat(state["last_reclassified"])
        elapsed = (datetime.now(timezone.utc) - last).total_seconds() / 86400
        return elapsed >= config.TIER_RECLASSIFY_DAYS
    except Exception:
        return True


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(levelname)s  %(message)s",
    )
    parser = argparse.ArgumentParser(description="Weekly coin tier re-classification")
    parser.add_argument("--dry", action="store_true",
                        help="Compute tiers but don't write CSV or state file")
    args = parser.parse_args()
    run_reclassify(dry_run=args.dry)

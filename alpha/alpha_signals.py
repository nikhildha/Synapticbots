"""
╔══════════════════════════════════════════════════════════════════════════════╗
║                        ALPHA MODULE — SYNAPTIC                              ║
║  Module : alpha/alpha_signals.py                                             ║
║  Purpose: Entry signal detection and exit condition checking.                ║
║                                                                              ║
║  Entry:  vol_zscore > 1.5 on BOTH of the last 2 closed 15m bars             ║
║          AND both bars move in the regime direction                          ║
║  Exit:   Price crosses SL, TP, or BE-activated SL                           ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  ISOLATION CONTRACT                                                          ║
║  ✗ DO NOT import any root module                                             ║
║  ✓ Only imports: pandas, numpy, alpha_config, alpha_logger                   ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

import pandas as pd
import numpy as np
from alpha.alpha_config import ALPHA_VOL_THRESH, ALPHA_VOL_BARS
from alpha.alpha_logger import get_logger

logger = get_logger("signals")


def check_entry_signal(df_15m: pd.DataFrame, regime: str) -> dict:
    """
    Check whether an entry signal exists on the last 2 closed 15m bars.

    Conditions (ALL must be true):
      1. vol_zscore[-2] > ALPHA_VOL_THRESH (1.5)
      2. vol_zscore[-1] > ALPHA_VOL_THRESH (1.5)
      3. Both bars confirm regime direction:
           BULL → close > open on both bars (bullish candles)
           BEAR → close < open on both bars (bearish candles)

    Args:
        df_15m:  15m DataFrame with features computed (must have vol_zscore, open, close)
        regime:  "BULL" or "BEAR" from AlphaHMM.predict()

    Returns:
        {
            "signal":           bool,
            "side":             "LONG" | "SHORT" | None,
            "vol_zscore_last":  float,
            "vol_zscore_prev":  float,
            "bar_match":        bool,
            "reason":           str,   # human-readable explanation
        }
    """
    _no_signal = lambda reason, vz_last=0.0, vz_prev=0.0: {
        "signal": False, "side": None,
        "vol_zscore_last": vz_last, "vol_zscore_prev": vz_prev,
        "bar_match": False, "reason": reason,
    }

    required = ["vol_zscore", "open", "close"]
    missing  = [c for c in required if c not in df_15m.columns]
    if missing:
        return _no_signal(f"missing columns: {missing}")

    if len(df_15m) < ALPHA_VOL_BARS + 1:
        return _no_signal(f"only {len(df_15m)} bars — need ≥{ALPHA_VOL_BARS + 1}")

    # Use the last 2 CLOSED bars (iloc[-2] and iloc[-1])
    # Note: iloc[-1] is the most recently CLOSED bar (current bar is still forming)
    bar_prev = df_15m.iloc[-2]
    bar_last = df_15m.iloc[-1]

    vz_prev = float(bar_prev["vol_zscore"])
    vz_last = float(bar_last["vol_zscore"])

    # Check vol_zscore threshold on both bars
    vol_ok = (vz_prev > ALPHA_VOL_THRESH) and (vz_last > ALPHA_VOL_THRESH)
    if not vol_ok:
        return _no_signal(
            f"vol_zscore below threshold: prev={vz_prev:.2f}, last={vz_last:.2f} (need >{ALPHA_VOL_THRESH})",
            vz_last, vz_prev,
        )

    # Check bar direction alignment with regime
    if regime == "BULL":
        bar_match = (
            float(bar_prev["close"]) > float(bar_prev["open"]) and
            float(bar_last["close"]) > float(bar_last["open"])
        )
        side = "LONG"
        direction_label = "bullish candles"
    elif regime == "BEAR":
        bar_match = (
            float(bar_prev["close"]) < float(bar_prev["open"]) and
            float(bar_last["close"]) < float(bar_last["open"])
        )
        side = "SHORT"
        direction_label = "bearish candles"
    else:
        return _no_signal(f"unknown regime: {regime}", vz_last, vz_prev)

    if not bar_match:
        return _no_signal(
            f"bars do not confirm {regime} direction (need {direction_label})",
            vz_last, vz_prev,
        )

    logger.info(
        "SIGNAL %s %s | vol_z: prev=%.2f last=%.2f | bars aligned ✓",
        regime, side, vz_prev, vz_last,
    )
    return {
        "signal":          True,
        "side":            side,
        "vol_zscore_last": vz_last,
        "vol_zscore_prev": vz_prev,
        "bar_match":       True,
        "reason":          f"{regime} confirmed: vol_z={vz_last:.2f}/{vz_prev:.2f}, {direction_label}",
    }


def check_exit(trade: dict, current_price: float) -> dict:
    """
    Determine if an open trade should be closed based on current price.

    Checks (in order):
      1. TP hit
      2. SL hit (or BE-activated SL hit)

    Args:
        trade:          Trade dict from alpha_tradebook (must have side, stop_loss,
                        take_profit, be_activated)
        current_price:  Current market price (float)

    Returns:
        {
            "should_exit": bool,
            "reason":      "TP" | "SL" | "BE_SL" | None,
        }
    """
    side       = trade.get("side")
    stop_loss  = trade.get("stop_loss")
    take_profit = trade.get("take_profit")
    be_activated = trade.get("be_activated", False)

    if not all([side, stop_loss, take_profit, current_price]):
        return {"should_exit": False, "reason": None}

    if side == "LONG":
        if current_price >= take_profit:
            return {"should_exit": True, "reason": "TP"}
        if current_price <= stop_loss:
            return {"should_exit": True, "reason": "BE_SL" if be_activated else "SL"}

    elif side == "SHORT":
        if current_price <= take_profit:
            return {"should_exit": True, "reason": "TP"}
        if current_price >= stop_loss:
            return {"should_exit": True, "reason": "BE_SL" if be_activated else "SL"}

    return {"should_exit": False, "reason": None}

"""
╔══════════════════════════════════════════════════════════════════════════════╗
║                        ALPHA MODULE — SYNAPTIC                              ║
║  Module : alpha/alpha_risk.py                                                ║
║  Purpose: Position sizing, SL/TP/BE price calculation, and breakeven        ║
║           management. Single source of truth for all risk math in Alpha.    ║
║                                                                              ║
║  Strategy parameters (from R13 best config):                                ║
║    Leverage:  25x flat                                                       ║
║    SL:        3.5×ATR from entry                                             ║
║    TP:        9.0×ATR from entry                                             ║
║    BE:        move SL to entry when price moves 3.0×ATR in our favour       ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  ISOLATION CONTRACT                                                          ║
║  ✗ DO NOT import any root module                                             ║
║  ✓ Only imports: numpy, alpha_config, alpha_logger                           ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

import numpy as np
from alpha.alpha_config import (
    ALPHA_LEVERAGE,
    ALPHA_SL_ATR, ALPHA_TP_ATR, ALPHA_BE_ATR,
    ALPHA_CAPITAL_PER_COIN, ALPHA_FEE_PER_LEG,
)
from alpha.alpha_logger import get_logger

logger = get_logger("risk")


# ── Position sizing ───────────────────────────────────────────────────────────

def calc_position_size(entry_price: float, atr: float) -> dict:
    """
    Calculate position size in contracts (units of base asset) for a trade.

    Method: risk-based sizing clipped to ALPHA_CAPITAL_PER_COIN × leverage.
      notional = capital × leverage
      qty       = notional / entry_price

    ATR is used here for reference (SL distance), but we use flat leverage
    for all trades (R11 finding: dynamic vs flat leverage difference minimal).

    Returns:
        {
            "qty":              float,   # base asset quantity (e.g. AAVE units)
            "notional_usdt":    float,   # USD value of position
            "margin_usdt":      float,   # collateral used (= capital_per_coin)
            "fee_open_usdt":    float,   # entry fee in USD
        }
    """
    if entry_price <= 0 or atr <= 0:
        logger.error("calc_position_size: invalid inputs entry=%.4f atr=%.4f", entry_price, atr)
        return {"qty": 0.0, "notional_usdt": 0.0, "margin_usdt": 0.0, "fee_open_usdt": 0.0}

    notional   = ALPHA_CAPITAL_PER_COIN * ALPHA_LEVERAGE
    qty        = notional / entry_price
    fee_open   = notional * ALPHA_FEE_PER_LEG

    return {
        "qty":           round(qty, 6),
        "notional_usdt": round(notional, 2),
        "margin_usdt":   round(ALPHA_CAPITAL_PER_COIN, 2),
        "fee_open_usdt": round(fee_open, 4),
    }


# ── SL / TP / BE price levels ─────────────────────────────────────────────────

def calc_levels(entry_price: float, atr: float, side: str) -> dict:
    """
    Calculate SL, TP, and BE trigger prices from entry + ATR.

    LONG:
      sl_price  = entry - (ALPHA_SL_ATR × atr)    = entry - 3.5×ATR
      tp_price  = entry + (ALPHA_TP_ATR × atr)    = entry + 9.0×ATR
      be_trigger= entry + (ALPHA_BE_ATR × atr)    = entry + 3.0×ATR (when to move SL → entry)

    SHORT:
      sl_price  = entry + (ALPHA_SL_ATR × atr)    = entry + 3.5×ATR
      tp_price  = entry - (ALPHA_TP_ATR × atr)    = entry - 9.0×ATR
      be_trigger= entry - (ALPHA_BE_ATR × atr)    = entry - 3.0×ATR

    Returns:
        {
            "stop_loss":    float,
            "take_profit":  float,
            "be_trigger":   float,   # price that activates breakeven
            "sl_atr_dist":  float,   # SL distance in ATR units (always ALPHA_SL_ATR)
            "tp_atr_dist":  float,   # TP distance in ATR units (always ALPHA_TP_ATR)
            "rr_ratio":     float,   # reward/risk = ALPHA_TP_ATR / ALPHA_SL_ATR
        }
    """
    if side == "LONG":
        sl    = entry_price - ALPHA_SL_ATR * atr
        tp    = entry_price + ALPHA_TP_ATR * atr
        be    = entry_price + ALPHA_BE_ATR * atr
    elif side == "SHORT":
        sl    = entry_price + ALPHA_SL_ATR * atr
        tp    = entry_price - ALPHA_TP_ATR * atr
        be    = entry_price - ALPHA_BE_ATR * atr
    else:
        raise ValueError(f"calc_levels: invalid side '{side}'")

    rr = round(ALPHA_TP_ATR / ALPHA_SL_ATR, 2)

    return {
        "stop_loss":   round(sl, 6),
        "take_profit": round(tp, 6),
        "be_trigger":  round(be, 6),
        "sl_atr_dist": ALPHA_SL_ATR,
        "tp_atr_dist": ALPHA_TP_ATR,
        "rr_ratio":    rr,
    }


# ── Breakeven management ──────────────────────────────────────────────────────

def should_activate_breakeven(trade: dict, current_price: float) -> bool:
    """
    Return True if breakeven should be activated (SL moved to entry).

    Conditions:
      - breakeven not already activated
      - current price has moved past the be_trigger level
    """
    if trade.get("be_activated", False):
        return False   # already done

    be_trigger = trade.get("be_trigger")
    side       = trade.get("side")
    if not be_trigger or not side:
        return False

    if side == "LONG"  and current_price >= be_trigger:
        return True
    if side == "SHORT" and current_price <= be_trigger:
        return True
    return False


def apply_breakeven(trade: dict) -> dict:
    """
    Return updated trade dict with SL moved to entry (breakeven activated).
    Original entry_price becomes the new stop_loss.
    """
    updated = trade.copy()
    updated["stop_loss"]    = trade["entry_price"]
    updated["be_activated"] = True
    logger.info(
        "BREAKEVEN activated | %s %s | SL moved to entry %.6f",
        trade.get("symbol"), trade.get("side"), trade["entry_price"],
    )
    return updated


# ── PnL calculation ───────────────────────────────────────────────────────────

def calc_pnl(trade: dict, exit_price: float) -> dict:
    """
    Calculate realised PnL for a closed trade.

    Returns:
        {
            "gross_pnl":  float,   # before fees
            "fee_close":  float,   # exit leg fee
            "net_pnl":    float,   # gross - both fees
            "pnl_pct":    float,   # net_pnl / margin_usdt × 100
        }
    """
    side          = trade.get("side")
    entry_price   = trade.get("entry_price", 0.0)
    qty           = trade.get("qty", 0.0)
    notional      = trade.get("notional_usdt", 0.0)
    fee_open      = trade.get("fee_open_usdt", 0.0)
    margin        = trade.get("margin_usdt", ALPHA_CAPITAL_PER_COIN)

    if side == "LONG":
        gross = (exit_price - entry_price) * qty
    elif side == "SHORT":
        gross = (entry_price - exit_price) * qty
    else:
        gross = 0.0

    fee_close = (exit_price * qty) * ALPHA_FEE_PER_LEG
    net       = gross - fee_open - fee_close
    pnl_pct   = (net / margin * 100) if margin > 0 else 0.0

    return {
        "gross_pnl": round(gross, 4),
        "fee_close": round(fee_close, 4),
        "net_pnl":   round(net, 4),
        "pnl_pct":   round(pnl_pct, 2),
    }

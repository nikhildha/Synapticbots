"""
╔══════════════════════════════════════════════════════════════════════════════╗
║                        ALPHA MODULE — SYNAPTIC                              ║
║  Module : alpha/alpha_tradebook.py                                           ║
║  Purpose: Atomic JSON tradebook for Alpha trades. Completely separate from  ║
║           the main tradebook.py — different file, different schema,         ║
║           different IDs (prefix "A-").                                       ║
║                                                                              ║
║  File:    alpha/data/tradebook.json                                          ║
║  Schema:  {"open": {trade_id: {...}}, "closed": {trade_id: {...}}}           ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  ISOLATION CONTRACT                                                          ║
║  ✗ NEVER reads/writes the root tradebook.py or data/tradebook.json          ║
║  ✓ All writes go to alpha/data/tradebook.json only                          ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

import json
import uuid
import fcntl
import os
from datetime import datetime, timezone
from typing import Optional

from alpha.alpha_config import ALPHA_TRADEBOOK_FILE, ALPHA_PAPER_MODE
from alpha.alpha_logger import get_logger

logger = get_logger("tradebook")


# ── ID generation ─────────────────────────────────────────────────────────────

def _new_trade_id() -> str:
    """Generate unique Alpha trade ID: A-XXXX (4 hex chars)."""
    return "A-" + uuid.uuid4().hex[:4].upper()


# ── File I/O (atomic with file lock) ─────────────────────────────────────────

def _load() -> dict:
    """Load tradebook from disk. Returns {"open": {}, "closed": {}} if missing."""
    if not os.path.exists(ALPHA_TRADEBOOK_FILE):
        return {"open": {}, "closed": {}}
    try:
        with open(ALPHA_TRADEBOOK_FILE, "r") as f:
            fcntl.flock(f, fcntl.LOCK_SH)
            data = json.load(f)
            fcntl.flock(f, fcntl.LOCK_UN)
        # Schema guard
        if "open" not in data:   data["open"]   = {}
        if "closed" not in data: data["closed"] = {}
        return data
    except Exception as e:
        logger.error("_load failed: %s — returning empty book", e)
        return {"open": {}, "closed": {}}


def _save(book: dict) -> None:
    """Atomically write tradebook to disk via temp file + rename."""
    tmp = ALPHA_TRADEBOOK_FILE + ".tmp"
    try:
        with open(tmp, "w") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            json.dump(book, f, indent=2, default=str)
            fcntl.flock(f, fcntl.LOCK_UN)
        os.replace(tmp, ALPHA_TRADEBOOK_FILE)
    except Exception as e:
        logger.error("_save failed: %s", e)
        if os.path.exists(tmp):
            os.remove(tmp)


# ── Public API ────────────────────────────────────────────────────────────────

def open_trade(
    symbol: str,
    side: str,
    entry_price: float,
    qty: float,
    stop_loss: float,
    take_profit: float,
    be_trigger: float,
    notional_usdt: float,
    margin_usdt: float,
    fee_open_usdt: float,
    atr: float,
    regime: str,
    regime_margin: float,
    vol_zscore: float,
) -> dict:
    """
    Record a new open trade. Returns the trade dict (including assigned ID).

    trade_id prefix "A-" uniquely identifies Alpha trades across all logs/Telegram.
    """
    trade_id = _new_trade_id()
    now      = datetime.now(timezone.utc).isoformat()

    trade = {
        # Identity
        "trade_id":       trade_id,
        "source":         "alpha",          # permanent marker — never "main_engine"
        "paper_mode":     ALPHA_PAPER_MODE,

        # Market
        "symbol":         symbol,
        "side":           side,

        # Entry
        "entry_price":    entry_price,
        "qty":            qty,
        "notional_usdt":  notional_usdt,
        "margin_usdt":    margin_usdt,
        "fee_open_usdt":  fee_open_usdt,
        "opened_at":      now,

        # Levels
        "stop_loss":      stop_loss,
        "take_profit":    take_profit,
        "be_trigger":     be_trigger,
        "be_activated":   False,

        # Context
        "atr_at_entry":   atr,
        "regime":         regime,
        "regime_margin":  regime_margin,
        "vol_zscore":     vol_zscore,

        # Runtime
        "status":         "OPEN",
        "exit_price":     None,
        "exit_reason":    None,
        "closed_at":      None,
        "net_pnl":        None,
        "pnl_pct":        None,
        "fee_close_usdt": None,
    }

    book = _load()
    book["open"][trade_id] = trade
    _save(book)

    logger.info(
        "OPENED %s %s %s | entry=%.4f SL=%.4f TP=%.4f BE@%.4f | %s",
        trade_id, symbol, side, entry_price, stop_loss, take_profit, be_trigger,
        "PAPER" if ALPHA_PAPER_MODE else "LIVE",
    )
    return trade


def update_breakeven(trade_id: str, new_stop_loss: float) -> bool:
    """
    Update stop_loss to entry (breakeven activated). Returns True on success.
    """
    book = _load()
    if trade_id not in book["open"]:
        logger.warning("update_breakeven: trade %s not found in open book", trade_id)
        return False

    book["open"][trade_id]["stop_loss"]    = new_stop_loss
    book["open"][trade_id]["be_activated"] = True
    _save(book)
    logger.info("BREAKEVEN %s | new SL=%.6f", trade_id, new_stop_loss)
    return True


def close_trade(
    trade_id: str,
    exit_price: float,
    exit_reason: str,      # "TP" | "SL" | "BE_SL" | "DIR_FLIP" | "MANUAL"
    net_pnl: float,
    pnl_pct: float,
    fee_close_usdt: float,
) -> Optional[dict]:
    """
    Move a trade from open → closed, record all exit fields.
    Returns the closed trade dict, or None if not found.
    """
    book = _load()
    if trade_id not in book["open"]:
        logger.warning("close_trade: trade %s not in open book", trade_id)
        return None

    trade = book["open"].pop(trade_id)
    now   = datetime.now(timezone.utc).isoformat()

    trade.update({
        "exit_price":     exit_price,
        "exit_reason":    exit_reason,
        "closed_at":      now,
        "net_pnl":        net_pnl,
        "pnl_pct":        pnl_pct,
        "fee_close_usdt": fee_close_usdt,
        "status":         "CLOSED",
    })

    book["closed"][trade_id] = trade
    _save(book)

    emoji = "✅" if net_pnl > 0 else "❌"
    logger.info(
        "CLOSED %s %s %s | %s exit=%.4f pnl=$%.2f (%.1f%%) | %s",
        trade_id, trade["symbol"], trade["side"],
        emoji, exit_price, net_pnl, pnl_pct, exit_reason,
    )
    return trade


def get_open_trades() -> list[dict]:
    """Return list of all open Alpha trades."""
    return list(_load()["open"].values())


def get_closed_trades() -> list[dict]:
    """Return list of all closed Alpha trades, newest first."""
    trades = list(_load()["closed"].values())
    return sorted(trades, key=lambda t: t.get("closed_at", ""), reverse=True)


def get_open_symbols() -> set[str]:
    """Return set of symbols that currently have an open Alpha trade."""
    return {t["symbol"] for t in get_open_trades()}


def get_trade(trade_id: str) -> Optional[dict]:
    """Look up a trade by ID (checks open then closed)."""
    book = _load()
    return book["open"].get(trade_id) or book["closed"].get(trade_id)


def portfolio_summary() -> dict:
    """
    Compute running portfolio stats.

    Returns:
        {
            "open_count":    int,
            "closed_count":  int,
            "total_net_pnl": float,
            "win_count":     int,
            "loss_count":    int,
            "win_rate":      float,
            "total_fees":    float,
        }
    """
    book    = _load()
    closed  = list(book["closed"].values())

    net_pnls = [t.get("net_pnl", 0.0) or 0.0 for t in closed]
    wins     = sum(1 for p in net_pnls if p > 0)
    losses   = sum(1 for p in net_pnls if p <= 0)
    n        = len(net_pnls)

    all_trades = list(book["open"].values()) + closed
    total_fees = sum(
        (t.get("fee_open_usdt") or 0.0) + (t.get("fee_close_usdt") or 0.0)
        for t in all_trades
    )

    return {
        "open_count":    len(book["open"]),
        "closed_count":  len(closed),
        "total_net_pnl": round(sum(net_pnls), 2),
        "win_count":     wins,
        "loss_count":    losses,
        "win_rate":      round(wins / n * 100, 1) if n > 0 else 0.0,
        "total_fees":    round(total_fees, 4),
    }

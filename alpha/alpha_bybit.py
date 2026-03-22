"""
╔══════════════════════════════════════════════════════════════════════════════╗
║                        ALPHA MODULE — SYNAPTIC                              ║
║  Module : alpha/alpha_bybit.py                                               ║
║  Purpose: Bybit V5 order execution layer for Alpha.                          ║
║           Handles signing, order placement, SL/TP, position management.      ║
║                                                                              ║
║  In PAPER mode  → all functions log what would happen and return a          ║
║                   simulated fill. No real API calls, no real orders.         ║
║  In LIVE mode   → signs requests with HMAC-SHA256 and calls Bybit REST.     ║
║                   Only activated when ALPHA_PAPER_MODE=false.               ║
║                                                                              ║
║  Bybit V5 API — Linear perpetuals (USDT-margined)                           ║
║  Docs: https://bybit-exchange.github.io/docs/v5/order/create-order          ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  ISOLATION CONTRACT                                                          ║
║  ✗ DO NOT import any root module                                             ║
║  ✓ Only imports: stdlib, requests, alpha_config, alpha_logger                ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

import hmac
import hashlib
import time
import json
import requests
from typing import Optional

from alpha.alpha_config import (
    ALPHA_PAPER_MODE, ALPHA_LEVERAGE,
    ALPHA_BYBIT_API_KEY, ALPHA_BYBIT_API_SECRET, ALPHA_BYBIT_BASE_URL,
    ALPHA_PAPER_SLIPPAGE,
)
from alpha.alpha_logger import get_logger

logger = get_logger("bybit")

_RECV_WINDOW = "5000"
_CATEGORY    = "linear"


# ── Auth / signing ────────────────────────────────────────────────────────────

def _sign(payload_str: str, timestamp: str) -> str:
    """HMAC-SHA256 signature for Bybit V5."""
    message = f"{timestamp}{ALPHA_BYBIT_API_KEY}{_RECV_WINDOW}{payload_str}"
    return hmac.new(
        ALPHA_BYBIT_API_SECRET.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _headers(payload_str: str) -> dict:
    """Build signed request headers."""
    ts = str(int(time.time() * 1000))
    return {
        "Content-Type":       "application/json",
        "X-BAPI-API-KEY":     ALPHA_BYBIT_API_KEY,
        "X-BAPI-SIGN":        _sign(payload_str, ts),
        "X-BAPI-TIMESTAMP":   ts,
        "X-BAPI-RECV-WINDOW": _RECV_WINDOW,
    }


def _post(endpoint: str, body: dict) -> Optional[dict]:
    """Signed POST to Bybit. Returns response dict or None on failure."""
    payload = json.dumps(body, separators=(",", ":"))
    url     = ALPHA_BYBIT_BASE_URL + endpoint
    try:
        resp = requests.post(url, headers=_headers(payload), data=payload, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        if data.get("retCode") != 0:
            logger.error("Bybit API error: retCode=%s retMsg=%s | body=%s",
                         data.get("retCode"), data.get("retMsg"), body)
            return None
        return data
    except Exception as e:
        logger.error("_post %s failed: %s", endpoint, e)
        return None


def _get(endpoint: str, params: dict) -> Optional[dict]:
    """Signed GET to Bybit. Returns response dict or None on failure."""
    qs  = "&".join(f"{k}={v}" for k, v in sorted(params.items()))
    url = ALPHA_BYBIT_BASE_URL + endpoint
    ts  = str(int(time.time() * 1000))
    sig = _sign(qs, ts)
    headers = {
        "X-BAPI-API-KEY":     ALPHA_BYBIT_API_KEY,
        "X-BAPI-SIGN":        sig,
        "X-BAPI-TIMESTAMP":   ts,
        "X-BAPI-RECV-WINDOW": _RECV_WINDOW,
    }
    try:
        resp = requests.get(url, headers=headers, params=params, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        if data.get("retCode") != 0:
            logger.error("Bybit GET error: %s %s", data.get("retCode"), data.get("retMsg"))
            return None
        return data
    except Exception as e:
        logger.error("_get %s failed: %s", endpoint, e)
        return None


# ── Leverage setup ─────────────────────────────────────────────────────────────

def set_leverage(symbol: str) -> bool:
    """
    Set leverage to ALPHA_LEVERAGE (25x) for a symbol in one-way mode.
    Only needs to be called once per symbol. Safe to call repeatedly.
    """
    if ALPHA_PAPER_MODE:
        logger.info("[PAPER] set_leverage %s → %dx (skipped)", symbol, ALPHA_LEVERAGE)
        return True

    body = {
        "category":    _CATEGORY,
        "symbol":      symbol,
        "buyLeverage": str(ALPHA_LEVERAGE),
        "sellLeverage": str(ALPHA_LEVERAGE),
    }
    result = _post("/v5/position/set-leverage", body)
    if result is not None:
        logger.info("Leverage set: %s → %dx", symbol, ALPHA_LEVERAGE)
        return True
    # retCode=110043 means leverage not modified (already set) — treat as success
    return False


# ── Order placement ────────────────────────────────────────────────────────────

def place_market_order(
    symbol:     str,
    side:       str,           # "LONG" or "SHORT"
    qty:        float,
    stop_loss:  float,
    take_profit: float,
    entry_price: float,        # used for paper fill only
) -> Optional[dict]:
    """
    Place a market order with pre-attached SL/TP.

    Paper mode: returns a simulated fill dict with minor slippage.
    Live mode:  places real market order on Bybit linear perpetuals.

    Returns:
        {
            "order_id":   str,
            "fill_price": float,
            "qty":        float,
            "side":       str,
            "symbol":     str,
            "mode":       "PAPER" | "LIVE",
        }
    or None on failure.
    """
    bybit_side = "Buy" if side == "LONG" else "Sell"

    if ALPHA_PAPER_MODE:
        # Simulate slippage: adverse fill
        import random
        slip = random.uniform(0, ALPHA_PAPER_SLIPPAGE)
        fill_price = entry_price * (1 + slip) if side == "LONG" else entry_price * (1 - slip)
        fill_price = round(fill_price, 6)
        logger.info(
            "[PAPER] OPEN %s %s qty=%.4f fill=%.4f SL=%.4f TP=%.4f",
            side, symbol, qty, fill_price, stop_loss, take_profit,
        )
        return {
            "order_id":   f"PAPER-{symbol}-{int(time.time())}",
            "fill_price": fill_price,
            "qty":        qty,
            "side":       side,
            "symbol":     symbol,
            "mode":       "PAPER",
        }

    # Live: set leverage first (idempotent)
    set_leverage(symbol)

    body = {
        "category":     _CATEGORY,
        "symbol":       symbol,
        "side":         bybit_side,
        "orderType":    "Market",
        "qty":          f"{qty:.4f}",
        "timeInForce":  "IOC",
        "stopLoss":     f"{stop_loss:.6f}",
        "takeProfit":   f"{take_profit:.6f}",
        "slTriggerBy":  "MarkPrice",
        "tpTriggerBy":  "MarkPrice",
        "positionIdx":  0,           # one-way mode
        "reduceOnly":   False,
    }
    result = _post("/v5/order/create", body)
    if result is None:
        return None

    order_id = result.get("result", {}).get("orderId", "")
    logger.info("LIVE OPEN %s %s qty=%.4f orderId=%s SL=%.4f TP=%.4f",
                side, symbol, qty, order_id, stop_loss, take_profit)

    # Fetch actual fill price from order history
    fill_price = _get_fill_price(symbol, order_id) or entry_price

    return {
        "order_id":   order_id,
        "fill_price": fill_price,
        "qty":        qty,
        "side":       side,
        "symbol":     symbol,
        "mode":       "LIVE",
    }


def close_position(
    symbol:      str,
    side:        str,     # the OPEN side ("LONG" or "SHORT")
    qty:         float,
    exit_price:  float,   # used for paper mode only
    reason:      str = "CLOSE",
) -> Optional[dict]:
    """
    Close an open position with a market order.

    Paper mode: returns simulated fill.
    Live mode:  places reduceOnly market order.

    Returns fill dict or None on failure.
    """
    close_side = "Sell" if side == "LONG" else "Buy"

    if ALPHA_PAPER_MODE:
        import random
        slip = random.uniform(0, ALPHA_PAPER_SLIPPAGE)
        fill_price = exit_price * (1 - slip) if side == "LONG" else exit_price * (1 + slip)
        fill_price = round(fill_price, 6)
        logger.info(
            "[PAPER] CLOSE %s %s qty=%.4f fill=%.4f reason=%s",
            side, symbol, qty, fill_price, reason,
        )
        return {
            "order_id":   f"PAPER-CLOSE-{symbol}-{int(time.time())}",
            "fill_price": fill_price,
            "qty":        qty,
            "side":       side,
            "symbol":     symbol,
            "mode":       "PAPER",
            "reason":     reason,
        }

    body = {
        "category":    _CATEGORY,
        "symbol":      symbol,
        "side":        close_side,
        "orderType":   "Market",
        "qty":         f"{qty:.4f}",
        "timeInForce": "IOC",
        "positionIdx": 0,
        "reduceOnly":  True,
    }
    result = _post("/v5/order/create", body)
    if result is None:
        return None

    order_id   = result.get("result", {}).get("orderId", "")
    fill_price = _get_fill_price(symbol, order_id) or exit_price
    logger.info("LIVE CLOSE %s %s qty=%.4f fill=%.4f reason=%s", side, symbol, qty, fill_price, reason)

    return {
        "order_id":   order_id,
        "fill_price": fill_price,
        "qty":        qty,
        "side":       side,
        "symbol":     symbol,
        "mode":       "LIVE",
        "reason":     reason,
    }


def update_stop_loss(symbol: str, side: str, new_sl: float) -> bool:
    """
    Move stop loss to a new price (used for breakeven activation).
    Paper mode: logs and returns True.
    Live mode:  calls /v5/position/trading-stop.
    """
    if ALPHA_PAPER_MODE:
        logger.info("[PAPER] UPDATE SL %s %s → %.6f", side, symbol, new_sl)
        return True

    body = {
        "category":    _CATEGORY,
        "symbol":      symbol,
        "stopLoss":    f"{new_sl:.6f}",
        "slTriggerBy": "MarkPrice",
        "positionIdx": 0,
    }
    result = _post("/v5/position/trading-stop", body)
    if result is not None:
        logger.info("LIVE SL updated %s → %.6f", symbol, new_sl)
        return True
    return False


# ── Position query ────────────────────────────────────────────────────────────

def get_position(symbol: str) -> Optional[dict]:
    """
    Get current open position for a symbol.

    Returns simplified dict or None if no position / error.
        {
            "symbol":      str,
            "side":        "LONG" | "SHORT" | None,
            "size":        float,
            "avg_price":   float,
            "unrealised_pnl": float,
            "stop_loss":   float,
            "take_profit": float,
        }
    """
    if ALPHA_PAPER_MODE:
        logger.debug("[PAPER] get_position %s — returning None (use tradebook)", symbol)
        return None

    result = _get("/v5/position/list", {"category": _CATEGORY, "symbol": symbol})
    if result is None:
        return None

    positions = result.get("result", {}).get("list", [])
    for pos in positions:
        size = float(pos.get("size", 0))
        if size > 0:
            raw_side = pos.get("side", "")
            return {
                "symbol":         symbol,
                "side":           "LONG" if raw_side == "Buy" else "SHORT",
                "size":           size,
                "avg_price":      float(pos.get("avgPrice", 0)),
                "unrealised_pnl": float(pos.get("unrealisedPnl", 0)),
                "stop_loss":      float(pos.get("stopLoss", 0)),
                "take_profit":    float(pos.get("takeProfit", 0)),
            }
    return None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_fill_price(symbol: str, order_id: str) -> Optional[float]:
    """Fetch actual average fill price from order history."""
    result = _get("/v5/order/history", {
        "category": _CATEGORY,
        "symbol":   symbol,
        "orderId":  order_id,
        "limit":    "1",
    })
    if result:
        orders = result.get("result", {}).get("list", [])
        if orders:
            avg_price = orders[0].get("avgPrice")
            if avg_price:
                return float(avg_price)
    return None


def check_connectivity() -> bool:
    """
    Verify Bybit API credentials are valid. Safe to call at startup.
    Returns True if authenticated, False otherwise.
    """
    if ALPHA_PAPER_MODE:
        logger.info("[PAPER] check_connectivity → True (paper mode, no auth check)")
        return True

    result = _get("/v5/account/wallet-balance", {"accountType": "UNIFIED"})
    if result is not None:
        logger.info("Bybit connectivity OK")
        return True
    logger.error("Bybit connectivity FAILED — check ALPHA_BYBIT_API_KEY / ALPHA_BYBIT_API_SECRET")
    return False

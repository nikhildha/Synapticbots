"""
Project Regime-Master — Tradebook
Comprehensive trade journal tracking every entry, exit, and P&L metric.
Persists to JSON for the dashboard. Supports live unrealized P&L updates.
"""
import json
import os
import logging
import threading
from datetime import datetime
from data_pipeline import get_current_price
import config
import telegram as tg

logger = logging.getLogger("Tradebook")

TRADEBOOK_FILE = os.path.join(config.DATA_DIR, "tradebook.json")

# H2 FIX: Thread lock for concurrent file access safety
_book_lock = threading.Lock()


def _load_book():
    """Load tradebook from disk (thread-safe)."""
    with _book_lock:
        if not os.path.exists(TRADEBOOK_FILE):
            return {"trades": [], "summary": {}}
        try:
            with open(TRADEBOOK_FILE, "r") as f:
                return json.load(f)
        except Exception:
            return {"trades": [], "summary": {}}


def _save_book(book):
    """Save tradebook to disk (thread-safe)."""
    with _book_lock:
        try:
            with open(TRADEBOOK_FILE, "w") as f:
                json.dump(book, f, indent=2)
        except Exception as e:
            logger.error("Failed to save tradebook: %s", e)


def _next_id(book):
    """Generate next trade ID by scanning ALL existing IDs for the maximum."""
    if not book["trades"]:
        return "T-0001"
    max_num = 0
    for t in book["trades"]:
        tid = t.get("trade_id", "")
        # Handle IDs like "T-0030", "T-0030-T1", "T-0030-T2" etc.
        parts = tid.split("-")
        if len(parts) >= 2:
            try:
                num = int(parts[1])
                if num > max_num:
                    max_num = num
            except ValueError:
                pass
    return f"T-{max_num + 1:04d}"


def _compute_summary(book):
    """Compute aggregate portfolio stats."""
    trades = book["trades"]
    total = len(trades)
    active = [t for t in trades if t["status"] in ("ACTIVE", "OPEN")]
    closed = [t for t in trades if t["status"] == "CLOSED"]
    wins = [t for t in closed if t.get("realized_pnl", 0) > 0]
    losses = [t for t in closed if t.get("realized_pnl", 0) < 0]

    total_realized = sum(t.get("realized_pnl", 0) for t in closed)
    total_unrealized = sum(t.get("unrealized_pnl", 0) for t in active)
    max_capital = config.PAPER_MAX_CAPITAL if hasattr(config, 'PAPER_MAX_CAPITAL') else 2500
    deployed_capital = len(active) * 100  # $100 per active trade

    book["summary"] = {
        "total_trades": total,
        "active_trades": len(active),
        "closed_trades": len(closed),
        "wins": len(wins),
        "losses": len(losses),
        "win_rate_pct": round(len(wins) / len(closed) * 100, 1) if closed else 0,
        "total_realized_pnl": round(total_realized, 4),
        "total_realized_pnl_pct": round(total_realized / max_capital * 100, 2) if max_capital else 0,
        "total_unrealized_pnl": round(total_unrealized, 4),
        "total_unrealized_pnl_pct": round(total_unrealized / deployed_capital * 100, 2) if deployed_capital else 0,
        "cumulative_pnl": round(total_realized + total_unrealized, 4),
        "cumulative_pnl_pct": round((total_realized + total_unrealized) / max_capital * 100, 2) if max_capital else 0,
        "best_trade": round(max((t.get("realized_pnl", 0) for t in closed), default=0), 4),
        "worst_trade": round(min((t.get("realized_pnl", 0) for t in closed), default=0), 4),
        "avg_leverage": round(sum(t.get("leverage", 1) for t in trades) / total, 1) if total else 0,
        "last_updated": datetime.utcnow().isoformat(),
    }


# ═══════════════════════════════════════════════════════════════════════════════
#  PUBLIC API
# ═══════════════════════════════════════════════════════════════════════════════

def open_trade(symbol, side, leverage, quantity, entry_price, atr,
               regime, confidence, reason="", capital=100.0, mode=None, user_id=None,
               profile_id="standard", bot_name="Synaptic Adaptive",
               exchange=None, pair=None, position_id=None, bot_id=None, all_bot_ids=None,
               rm_id=None, override_sl=None, override_tp=None, status="ACTIVE",
               order_type=None):
    """
    Record a new trade entry in the tradebook.

    Parameters
    ----------
    symbol      : str   — e.g. 'BTCUSDT'
    side        : str   — 'BUY' or 'SELL' (mapped to LONG/SHORT)
    leverage    : int
    quantity    : float
    entry_price : float
    atr         : float — ATR at entry (for SL/TP reference)
    regime      : str   — regime name
    confidence  : float — HMM confidence
    reason      : str
    capital     : float — capital allocated ($100 default)

    Returns
    -------
    str : trade_id
    """
    book = _load_book()

    # Guard 1: same BOT already has this symbol active — block regardless of direction.
    # This is the tightest check and catches same-bot duplicates (e.g. two AR LONGs).
    if bot_id:
        bot_existing = [t for t in book["trades"]
                        if t["symbol"] == symbol
                        and t.get("bot_id", "") == bot_id
                        and t["status"] in ("ACTIVE", "OPEN")]
        if bot_existing:
            logger.warning(
                "⚠️ Skipping trade for %s [bot=%s] — this bot already has ACTIVE trade %s",
                symbol, bot_id, bot_existing[0]["trade_id"]
            )
            return bot_existing[0]["trade_id"]

    # Guard 2: same USER has this symbol active on ANY bot — block to prevent cross-bot hedging.
    # (e.g. L1 LONG + DePIN SHORT on BTC with same user_id)
    if user_id:
        user_existing = [t for t in book["trades"]
                         if t["symbol"] == symbol
                         and t.get("user_id", "") == user_id
                         and t["status"] in ("ACTIVE", "OPEN")]
        if user_existing:
            logger.warning(
                "⚠️ Skipping trade for %s [user=%s] — another bot already has ACTIVE trade %s",
                symbol, user_id, user_existing[0]["trade_id"]
            )
            return user_existing[0]["trade_id"]

    # Legacy fallback: if both bot_id and user_id are empty, block by symbol alone
    if not bot_id and not user_id:
        existing = [t for t in book["trades"]
                    if t["symbol"] == symbol
                    and t["status"] in ("ACTIVE", "OPEN")]
        if existing:
            logger.warning("⚠️ Skipping duplicate trade for %s — already have ACTIVE trade %s",
                           symbol, existing[0]["trade_id"])
            return existing[0]["trade_id"]

    trade_id = _next_id(book)
    position = "LONG" if side == "BUY" else "SHORT"

    # Compute SL/TP based on ATR (adjusted for leverage)
    if override_sl is not None and override_tp is not None:
        stop_loss = round(override_sl, 6)
        take_profit = round(override_tp, 6)
        t1_price = None
        t2_price = None
        t3_price = None
        
        # RM5_Trailing locks 50% at 2% and trails the rest
        if rm_id == "RM5_Trailing":
            direction = 1 if position == "LONG" else -1
            t1_price = round(entry_price + direction * (entry_price * 0.02), 6)
    else:
        sl_mult, tp_mult = config.get_atr_multipliers(leverage)

        # ── Multi-Target System (0304_v1) ──
        if getattr(config, 'MULTI_TARGET_ENABLED', False):
            sl_dist = atr * sl_mult
            t3_dist = sl_dist * config.MT_RR_RATIO  # 1:5 R:R
            if position == "LONG":
                stop_loss = round(entry_price - sl_dist, 6)
                t1_price = round(entry_price + t3_dist * config.MT_T1_FRAC, 6)
                t2_price = round(entry_price + t3_dist * config.MT_T2_FRAC, 6)
                t3_price = round(entry_price + t3_dist, 6)
            else:
                stop_loss = round(entry_price + sl_dist, 6)
                t1_price = round(entry_price - t3_dist * config.MT_T1_FRAC, 6)
                t2_price = round(entry_price - t3_dist * config.MT_T2_FRAC, 6)
                t3_price = round(entry_price - t3_dist, 6)
            take_profit = t3_price  # TP = T3 for display
        else:
            if position == "LONG":
                stop_loss = round(entry_price - atr * sl_mult, 6)
                take_profit = round(entry_price + atr * tp_mult, 6)
            else:
                stop_loss = round(entry_price + atr * sl_mult, 6)
                take_profit = round(entry_price - atr * tp_mult, 6)
            t1_price = None
            t2_price = None
            t3_price = None

    now_iso = datetime.utcnow().isoformat()
    trade = {
        "trade_id":         trade_id,
        "entry_timestamp":  now_iso,
        "exit_timestamp":   None,
        "symbol":           symbol,
        "position":         position,
        "side":             side,
        "regime":           regime,
        "confidence":       round(confidence, 4) if confidence else 0,
        "leverage":         leverage,
        "capital":          capital,
        "quantity":         round(quantity, 6),
        "entry_price":      round(entry_price, 6),
        "exit_price":       None,
        "current_price":    round(entry_price, 6),
        "stop_loss":        stop_loss,
        "take_profit":      take_profit,
        "atr_at_entry":     round(atr, 6),
        "trailing_sl":      stop_loss,
        "trailing_tp":      take_profit,
        "peak_price":       round(entry_price, 6),
        "trailing_active":  False,
        "trail_sl_count":   0,
        "tp_extensions":    0,
        # Multi-target fields
        "t1_price":         t1_price,
        "t2_price":         t2_price,
        "t3_price":         t3_price,
        "t1_hit":           False,
        "t2_hit":           False,
        "original_qty":     round(quantity, 6),
        "original_capital": capital,
        "status":           status,
        "exit_reason":      None,
        "realized_pnl":     0,
        "realized_pnl_pct": 0,
        "unrealized_pnl":   0,
        "unrealized_pnl_pct": 0,
        "max_favorable":    0,
        "max_adverse":      0,
        "duration_minutes":  0,
        "mode":             mode if mode else ("PAPER" if config.PAPER_TRADE else "LIVE"),
        "user_id":          user_id,
        "commission":       0,
        "funding_cost":     0,
        "funding_payments": 0,
        "last_funding_check": now_iso,
        "profile_id":       profile_id,
        "bot_name":         bot_name,
        "bot_id":           bot_id or "",  # Stamp real bot_id for per-bot trade isolation
        "all_bot_ids":      all_bot_ids or [],  # Multi-bot: list of all active bot IDs at trade time
        # CoinDCX exchange tracking
        "exchange":         exchange,
        "pair":             pair,
        "position_id":      position_id,
        "rm_id":            rm_id,
        "order_type":       order_type,
    }

    book["trades"].append(trade)
    _compute_summary(book)
    _save_book(book)

    logger.info("📗 Tradebook OPEN: %s %s %s @ %.6f | %dx | Capital: $%.0f",
                trade_id, position, symbol, entry_price, leverage, capital)

    return trade_id


def close_trade(trade_id=None, symbol=None, exit_price=None, reason="MANUAL", exchange_fee=None):
    """
    Close a trade by ID, or ALL active trades for a symbol.

    Parameters
    ----------
    trade_id     : str (optional) — close specific trade
    symbol       : str (optional) — close ALL active trades for this symbol
    exit_price   : float (if None, fetches current price)
    reason       : str — why the trade was closed
    exchange_fee : float (optional) — actual fee from exchange (CoinDCX fee_amount)

    Returns
    -------
    dict or list : closed trade record(s)
    """
    book = _load_book()

    # Find target trade(s)
    targets = []
    for trade in book["trades"]:
        if trade["status"] not in ("ACTIVE", "OPEN"):
            continue
        if trade_id and trade["trade_id"] == trade_id:
            targets = [trade]
            break
        if symbol and trade["symbol"] == symbol:
            targets.append(trade)

    if not targets:
        logger.warning("No active trade found for id=%s symbol=%s", trade_id, symbol)
        return None

    closed = []
    for target in targets:
        # A3 FIX: For LIVE trades, use CoinDCX price (not Binance)
        px = exit_price
        if px is None:
            if target.get("mode", "").upper().startswith("LIVE"):
                try:
                    import coindcx_client as cdx
                    cdx_pair = target.get("pair") or cdx.to_coindcx_pair(target["symbol"])
                    if cdx_pair:
                        px = cdx.get_current_price(cdx_pair)
                except Exception:
                    pass
            if px is None:
                px = get_current_price(target["symbol"]) or target["entry_price"]
        px = round(px, 6)

        # Calculate P&L
        entry = target["entry_price"]
        qty = target["quantity"]
        lev = target["leverage"]
        capital = target["capital"]

        if target["position"] == "LONG":
            raw_pnl = (px - entry) * qty
        else:
            raw_pnl = (entry - px) * qty

        # Commission: use actual exchange fee if available, otherwise estimate
        entry_notional = entry * qty
        exit_notional = px * qty
        if exchange_fee is not None and exchange_fee > 0:
            commission = round(exchange_fee, 4)
        else:
            commission = round((entry_notional + exit_notional) * config.TAKER_FEE, 4)

        # PnL FIX: qty is already leveraged (qty = capital * leverage / price)
        # so raw_pnl already represents the real dollar P&L.
        # DO NOT multiply by leverage again — that was squaring leverage.
        net_pnl = round(raw_pnl - commission, 4)
        pnl_pct = round(net_pnl / capital * 100, 2) if capital else 0

        # Duration
        entry_time = datetime.fromisoformat(target["entry_timestamp"])
        duration = (datetime.utcnow() - entry_time).total_seconds() / 60

        target["exit_timestamp"] = datetime.utcnow().isoformat()
        target["exit_price"] = px
        target["current_price"] = px
        target["status"] = "CLOSED"
        target["exit_reason"] = reason
        target["commission"] = commission
        target["exchange_fee"] = round(exchange_fee, 6) if exchange_fee else 0
        target["realized_pnl"] = net_pnl
        target["realized_pnl_pct"] = pnl_pct
        target["unrealized_pnl"] = 0
        target["unrealized_pnl_pct"] = 0
        target["duration_minutes"] = round(duration, 1)

        logger.info("📕 Tradebook CLOSE: %s %s %s @ %.6f → %.6f | P&L: $%.4f (%.2f%%)",
                    target["trade_id"], target["position"], target["symbol"],
                    entry, px, net_pnl, pnl_pct)
        closed.append(target)

    _compute_summary(book)
    _save_book(book)

    return closed[0] if len(closed) == 1 else closed


def cancel_trade(trade_id, reason="CANCELLED"):
    """Cancel an OPEN limit order without recording P&L."""
    book = _load_book()
    cancelled = None
    for trade in book["trades"]:
        if trade["status"] == "OPEN" and trade["trade_id"] == trade_id:
            trade["status"] = "CANCELLED"
            trade["exit_reason"] = reason
            trade["exit_timestamp"] = datetime.utcnow().isoformat()
            logger.info("🚫 Tradebook CANCEL: %s [%s]", trade_id, reason)
            cancelled = trade
            break
    if cancelled:
        _save_book(book)
    return cancelled


def activate_limit_order(trade_id, fill_price, fill_qty):
    """Transition an OPEN limit order to ACTIVE state upon fill."""
    book = _load_book()
    activated = None
    for trade in book["trades"]:
        if trade["status"] == "OPEN" and trade["trade_id"] == trade_id:
            trade["status"] = "ACTIVE"
            
            # Update actual fill details
            trade["entry_price"] = round(fill_price, 6)
            trade["current_price"] = round(fill_price, 6)
            trade["peak_price"] = round(fill_price, 6)
            trade["quantity"] = round(fill_qty, 6)
            trade["original_qty"] = round(fill_qty, 6)
            
            # Recalculate capital based on actual fill
            trade["capital"] = round(fill_qty * fill_price / trade["leverage"], 4)
            trade["original_capital"] = trade["capital"]
            
            # Shift entry timestamp to when it actually filled
            trade["entry_timestamp"] = datetime.utcnow().isoformat()

            logger.info("🟢 Tradebook ACTIVATE: %s filled @ %.6f (qty: %.6f) — now ACTIVE", 
                        trade_id, fill_price, fill_qty)
            activated = trade
            break
            
    if activated:
        _compute_summary(book)
        _save_book(book)
    return activated


def update_trade(trade_id, updates):
    """Update fields of an existing trade."""
    book = _load_book()
    updated = False
    for trade in book["trades"]:
        if trade["trade_id"] == trade_id:
            for k, v in updates.items():
                if v is not None:
                    trade[k] = v
            updated = True
            break
    if updated:
        _save_book(book)
    return updated


def _book_partial_inline(trade, book, exit_price, qty_frac, reason):
    """
    Book partial profit for a fraction of the active position.
    Creates a CLOSED child trade entry in the tradebook with the booked P&L.
    Reduces the parent trade's quantity and capital proportionally.
    """
    px = round(exit_price, 6)
    entry = trade["entry_price"]
    parent_qty = trade["quantity"]
    parent_capital = trade["capital"]
    lev = trade["leverage"]

    # Quantity and capital for this booking
    book_qty = round(parent_qty * qty_frac, 6)
    book_capital = round(parent_capital * qty_frac, 4)

    if trade["position"] == "LONG":
        raw_pnl = (px - entry) * book_qty
    else:
        raw_pnl = (entry - px) * book_qty

    entry_notional = entry * book_qty
    exit_notional = px * book_qty
    commission = round((entry_notional + exit_notional) * config.TAKER_FEE, 4)
    # PnL FIX: qty is already leveraged — DO NOT multiply by lev again
    net_pnl = round(raw_pnl - commission, 4)
    pnl_pct = round(net_pnl / book_capital * 100, 2) if book_capital else 0

    entry_time = datetime.fromisoformat(trade["entry_timestamp"])
    duration = (datetime.utcnow() - entry_time).total_seconds() / 60

    # Create child trade ID
    child_id = f"{trade['trade_id']}-{reason}"

    child_trade = {
        "trade_id":         child_id,
        "parent_trade_id":  trade["trade_id"],
        "entry_timestamp":  trade["entry_timestamp"],
        "exit_timestamp":   datetime.utcnow().isoformat(),
        "symbol":           trade["symbol"],
        "position":         trade["position"],
        "side":             trade["side"],
        "regime":           trade.get("regime", ""),
        "confidence":       trade.get("confidence", 0),
        "leverage":         lev,
        "capital":          book_capital,
        "quantity":         book_qty,
        "entry_price":      entry,
        "exit_price":       px,
        "current_price":    px,
        "stop_loss":        trade["stop_loss"],
        "take_profit":      trade["take_profit"],
        "atr_at_entry":     trade.get("atr_at_entry", 0),
        "trailing_sl":      trade.get("trailing_sl", trade["stop_loss"]),
        "trailing_tp":      trade.get("trailing_tp", trade["take_profit"]),
        "peak_price":       trade.get("peak_price", entry),
        "trailing_active":  False,
        "trail_sl_count":   0,
        "tp_extensions":    0,
        "t1_price":         trade.get("t1_price"),
        "t2_price":         trade.get("t2_price"),
        "t3_price":         trade.get("t3_price"),
        "t1_hit":           trade.get("t1_hit", False),
        "t2_hit":           trade.get("t2_hit", False),
        "original_qty":     trade.get("original_qty", parent_qty),
        "original_capital": trade.get("original_capital", parent_capital),
        "status":           "CLOSED",
        "exit_reason":      reason,
        "realized_pnl":     net_pnl,
        "realized_pnl_pct": pnl_pct,
        "unrealized_pnl":   0,
        "unrealized_pnl_pct": 0,
        "max_favorable":    0,
        "max_adverse":      0,
        "duration_minutes":  round(duration, 1),
        "mode":             trade.get("mode", "PAPER"),
        "user_id":          trade.get("user_id"),
        "commission":       commission,
        "funding_cost":     0,
        "funding_payments": 0,
        "last_funding_check": datetime.utcnow().isoformat(),
    }

    # Add child trade to the tradebook
    book["trades"].append(child_trade)

    # Reduce parent trade's quantity and capital
    trade["quantity"] = round(parent_qty - book_qty, 6)
    trade["capital"] = round(parent_capital - book_capital, 4)

    logger.info("📊 Partial booking %s: %s %.6f qty @ %.6f | P&L: $%.4f (%.2f%%) | Remaining: %.1f%%",
                child_id, reason, book_qty, px, net_pnl, pnl_pct,
                (trade['quantity'] / trade.get('original_qty', parent_qty)) * 100)

    # Telegram notification
    try:
        tg.notify_trade_close(child_trade)
    except Exception:
        pass

    return child_trade


def _close_trade_inline(trade, exit_price, reason):
    """
    Close a trade INLINE (mutates the trade dict directly).
    Used by update_unrealized() to avoid the load/save race condition.
    """
    px = round(exit_price, 6)
    entry = trade["entry_price"]
    qty = trade["quantity"]
    lev = trade["leverage"]
    capital = trade["capital"]

    if trade["position"] == "LONG":
        raw_pnl = (px - entry) * qty
    else:
        raw_pnl = (entry - px) * qty

    entry_notional = entry * qty
    exit_notional = px * qty
    commission = round((entry_notional + exit_notional) * config.TAKER_FEE, 4)
    funding_cost = trade.get("funding_cost", 0)

    # PnL FIX: qty is already leveraged — DO NOT multiply by lev again
    net_pnl = round(raw_pnl - commission - funding_cost, 4)
    pnl_pct = round(net_pnl / capital * 100, 2) if capital else 0

    entry_time = datetime.fromisoformat(trade["entry_timestamp"])
    duration = (datetime.utcnow() - entry_time).total_seconds() / 60

    trade["exit_timestamp"] = datetime.utcnow().isoformat()
    trade["exit_price"] = px
    trade["current_price"] = px
    trade["status"] = "CLOSED"
    trade["exit_reason"] = reason
    trade["commission"] = commission
    trade["realized_pnl"] = net_pnl
    trade["realized_pnl_pct"] = pnl_pct
    trade["unrealized_pnl"] = 0
    trade["unrealized_pnl_pct"] = 0
    trade["duration_minutes"] = round(duration, 1)

    logger.info("📕 Tradebook CLOSE: %s %s %s @ %.6f → %.6f | P&L: $%.4f (%.2f%%) [%s]",
                trade["trade_id"], trade["position"], trade["symbol"],
                entry, px, net_pnl, pnl_pct, reason)

    # Telegram notification
    try:
        tg.notify_trade_close(trade)
        if reason == "MAX_LOSS":
            tg.notify_max_loss(trade["symbol"], pnl_pct, trade["trade_id"])
    except Exception:
        pass


def update_unrealized(prices=None, funding_rates=None):
    """
    Update unrealized P&L for all active trades using live prices.
    Auto-closes trades that hit MAX_LOSS, SL, or TP thresholds.
    Accumulates funding rate costs for positions held across 8h intervals.

    IMPORTANT: All closes happen INLINE on the same book object to avoid
    the race condition where close_trade() would save independently and
    then this function would overwrite with a stale copy.

    Parameters
    ----------
    prices : dict (optional) — {symbol: price}. If None, fetches live.
    funding_rates : dict (optional) — {symbol: rate}. Live funding rates per coin.
    """
    book = _load_book()
    changed = False

    for trade in book["trades"]:
        if trade["status"] not in ("ACTIVE", "OPEN"):
            continue

        symbol = trade["symbol"]
        if prices and symbol in prices:
            current = prices[symbol]
        else:
            # A4 FIX: For LIVE trades, try CoinDCX price first (not Binance)
            if trade.get("mode", "").upper().startswith("LIVE"):
                try:
                    import coindcx_client as cdx
                    cdx_pair = trade.get("pair") or cdx.to_coindcx_pair(symbol)
                    if cdx_pair:
                        current = cdx.get_current_price(cdx_pair)
                except Exception:
                    current = None
            else:
                current = None

            if not current:
                current = get_current_price(symbol)
                if not current:
                    continue

        current = round(current, 6)
        entry = trade["entry_price"]
        qty = trade["quantity"]
        lev = trade["leverage"]
        capital = trade["capital"]

        if trade["position"] == "LONG":
            raw_pnl = (current - entry) * qty
        else:
            raw_pnl = (entry - current) * qty

        # ── Accumulate funding rate cost ──────────────────────────
        # Initialize funding fields for legacy trades
        if "funding_cost" not in trade:
            trade["funding_cost"] = 0
            trade["funding_payments"] = 0
            trade["last_funding_check"] = trade["entry_timestamp"]

        try:
            last_check = datetime.fromisoformat(trade["last_funding_check"])
            hours_since = (datetime.utcnow() - last_check).total_seconds() / 3600
            intervals = int(hours_since / config.FUNDING_INTERVAL_HOURS)
            if intervals > 0:
                # Use live funding rate if available, else default
                sym = trade["symbol"]
                fr = config.DEFAULT_FUNDING_RATE
                if funding_rates and sym in funding_rates:
                    fr = abs(funding_rates[sym])  # always treat as cost
                notional = entry * qty * lev
                cost_per_interval = notional * fr
                new_cost = round(cost_per_interval * intervals, 6)
                trade["funding_cost"] = round(trade["funding_cost"] + new_cost, 6)
                trade["funding_payments"] += intervals
                trade["last_funding_check"] = datetime.utcnow().isoformat()
        except Exception:
            pass

        funding_cost = trade.get("funding_cost", 0)

        # To prevent trades from starting in an immediate deep paper loss,
        # we do NOT subtract estimated exit commissions from the unrealized PnL.
        # It is only subtracted during a real exit (realized PnL).
        net_pnl = round(raw_pnl - funding_cost, 4)
        pnl_pct = round(net_pnl / capital * 100, 2) if capital else 0

        # Track max favorable / adverse excursion
        if net_pnl > trade.get("max_favorable", 0):
            trade["max_favorable"] = net_pnl
        if net_pnl < trade.get("max_adverse", 0):
            trade["max_adverse"] = net_pnl

        # Duration
        entry_time = datetime.fromisoformat(trade["entry_timestamp"])
        duration = (datetime.utcnow() - entry_time).total_seconds() / 60

        trade["current_price"] = current
        trade["unrealized_pnl"] = net_pnl
        trade["unrealized_pnl_pct"] = pnl_pct
        trade["duration_minutes"] = round(duration, 1)

        # ── Trailing SL: Stepped Breakeven + Profit Lock (F2) ────
        atr = trade.get("atr_at_entry", 0)
        is_long = trade["position"] == "LONG"

        # Initialize trailing fields for legacy trades that lack them
        if "trailing_sl" not in trade:
            trade["trailing_sl"] = trade["stop_loss"]
        if "trailing_tp" not in trade:
            trade["trailing_tp"] = trade["take_profit"]
        if "peak_price" not in trade:
            trade["peak_price"] = entry
        if "trailing_active" not in trade:
            trade["trailing_active"] = False
        if "trail_sl_count" not in trade:
            trade["trail_sl_count"] = 0
        if "tp_extensions" not in trade:
            trade["tp_extensions"] = 0
        if "stepped_lock_level" not in trade:
            trade["stepped_lock_level"] = -1  # No milestone hit yet

        # ── F2 Stepped Trailing SL ────────────────────────────────
        # Iterate through TRAILING_SL_STEPS milestones and progressively
        # tighten SL based on leveraged P&L %.
        # Each step: (trigger_pnl_pct, lock_pnl_pct)
        # lock_pnl_pct = 0 means breakeven (entry price)
        if config.TRAILING_SL_ENABLED:
            lev = trade["leverage"]
            steps = getattr(config, 'TRAILING_SL_STEPS', [])

            for step_idx, (trigger_pnl, lock_pnl) in enumerate(steps):
                # Only process steps we haven't activated yet
                if step_idx <= trade["stepped_lock_level"]:
                    continue
                if pnl_pct >= trigger_pnl:
                    # Calculate the lock price from lock_pnl percentage
                    # lock_pnl is in leveraged %, convert to price move
                    lock_price_move = (lock_pnl / 100) / lev
                    if is_long:
                        new_sl = round(entry * (1 + lock_price_move), 6)
                    else:
                        new_sl = round(entry * (1 - lock_price_move), 6)

                    # Only tighten, never loosen
                    sl_improved = (is_long and new_sl > trade["trailing_sl"]) or \
                                  (not is_long and new_sl < trade["trailing_sl"])
                    if sl_improved:
                        old_sl = trade["trailing_sl"]
                        trade["trailing_sl"] = new_sl
                        trade["trailing_active"] = True
                        trade["stepped_lock_level"] = step_idx
                        trade["trail_sl_count"] = trade.get("trail_sl_count", 0) + 1

                        if lock_pnl == 0:
                            lock_label = "BREAKEVEN"
                        else:
                            lock_label = f"+{lock_pnl:.0f}% profit"

                        logger.info(
                            "🔒 Stepped SL for %s: P&L %.1f%% ≥ %.0f%% trigger → SL %.6f → %.6f (%s)",
                            trade["trade_id"], pnl_pct, trigger_pnl, old_sl, new_sl, lock_label,
                        )

                        # For LIVE trades: modify exchange SL order
                        is_live = trade.get("mode") == "LIVE"
                        if is_live:
                            try:
                                from execution_engine import ExecutionEngine
                                ExecutionEngine.modify_sl_live(symbol, new_sl)
                                logger.info("🔒 Live SL modified on exchange for %s → %.6f", symbol, new_sl)
                            except Exception as e:
                                logger.error("❌ Failed to modify live SL for %s: %s", symbol, e)

        # ── EXIT CHECKS ──────────────────────────────────────────────
        # For LIVE trades, CoinDCX handles SL/TP/MAX_LOSS via exchange
        # orders. The heartbeat _sync_coindcx_positions() detects when
        # exchange closes a position. We ONLY auto-close in tradebook
        # for paper trades.
        is_live = trade.get("mode") == "LIVE"

        # HARD MAX LOSS GUARD (paper + live safety net)
        max_loss_limit = config.MAX_LOSS_PER_TRADE_PCT
        if pnl_pct <= max_loss_limit:
            logger.warning(
                "🛑 MAX LOSS hit on %s (%.2f%% <= %.0f%%) — auto-closing trade %s",
                symbol, pnl_pct, max_loss_limit, trade["trade_id"],
            )
            if is_live:
                from execution_engine import ExecutionEngine
                ExecutionEngine.close_position_live(symbol)
            _close_trade_inline(trade, current, f"MAX_LOSS_{int(max_loss_limit)}%")
            changed = True
            continue

        # ── MULTI-TARGET EXIT CHECKS (paper + live) ──
        mt_enabled = getattr(config, 'MULTI_TARGET_ENABLED', False)
        t1_price = trade.get("t1_price")
        t2_price = trade.get("t2_price")
        t3_price = trade.get("t3_price")

        if mt_enabled and t1_price is not None:
            # Initialize fields for legacy trades
            if "t1_hit" not in trade:
                trade["t1_hit"] = False
            if "t2_hit" not in trade:
                trade["t2_hit"] = False
            if "original_qty" not in trade:
                trade["original_qty"] = trade["quantity"]
            if "original_capital" not in trade:
                trade["original_capital"] = trade["capital"]

            # T1 check
            if not trade["t1_hit"]:
                t1_hit = (is_long and current >= t1_price) or (not is_long and current <= t1_price)
                if t1_hit:
                    book_frac = config.MT_T1_BOOK_PCT  # 25%
                    # Live: partial close on exchange
                    if is_live:
                        from execution_engine import ExecutionEngine
                        close_qty = trade["quantity"] * book_frac
                        ExecutionEngine.partial_close_live(symbol, trade["position"], close_qty)
                        ExecutionEngine.modify_sl_live(symbol, trade["entry_price"])
                    _book_partial_inline(trade, book, current, book_frac, "T1")
                    trade["t1_hit"] = True
                    trade["trailing_sl"] = trade["entry_price"]  # SL → breakeven
                    trade["trailing_active"] = True
                    logger.info("🎯 T1 hit on %s — booked 25%%, SL → breakeven (%.6f)",
                                trade["trade_id"], trade["entry_price"])
                    changed = True

            # T2 check
            if trade["t1_hit"] and not trade["t2_hit"]:
                t2_hit = (is_long and current >= t2_price) or (not is_long and current <= t2_price)
                if t2_hit:
                    book_frac = config.MT_T2_BOOK_PCT  # 50% of remaining
                    # Live: partial close on exchange
                    if is_live:
                        from execution_engine import ExecutionEngine
                        close_qty = trade["quantity"] * book_frac
                        ExecutionEngine.partial_close_live(symbol, trade["position"], close_qty)
                        ExecutionEngine.modify_sl_live(symbol, t1_price)
                    _book_partial_inline(trade, book, current, book_frac, "T2")
                    trade["t2_hit"] = True
                    trade["trailing_sl"] = t1_price  # SL → T1
                    logger.info("🎯 T2 hit on %s — booked 50%% remaining, SL → T1 (%.6f)",
                                trade["trade_id"], t1_price)
                    changed = True

            # T3 check (close everything remaining)
            if trade["t2_hit"]:
                t3_hit = (is_long and current >= t3_price) or (not is_long and current <= t3_price)
                if t3_hit:
                    logger.info("🏆 T3 hit on %s — closing remaining position",
                                trade["trade_id"])
                    if is_live:
                        from execution_engine import ExecutionEngine
                        ExecutionEngine.close_position_live(symbol)
                    _close_trade_inline(trade, current, "T3")
                    changed = True
                    continue

        # Use trailing values for SL hit checks (paper only — live SL handled by exchange)
        if not is_live:
            effective_sl = trade.get("trailing_sl", trade["stop_loss"])

            sl_hit = False
            if is_long:
                sl_hit = current <= effective_sl
            else:
                sl_hit = current >= effective_sl

            if sl_hit:
                sl_n = trade.get("trail_sl_count", 0)
                step_level = trade.get("stepped_lock_level", -1)
                # Determine SL reason based on target state
                if trade.get("t2_hit"):
                    reason = "SL_T2"  # SL hit after T2 (at T1 price)
                elif trade.get("t1_hit"):
                    reason = "SL_T1"  # SL hit after T1 (at breakeven)
                elif trade["trailing_active"] and step_level >= 0:
                    # Stepped lock was active — show which level
                    steps = getattr(config, 'TRAILING_SL_STEPS', [])
                    if step_level < len(steps):
                        _, lock_pnl = steps[step_level]
                        if lock_pnl == 0:
                            lock_tag = " (BEV)"
                        else:
                            lock_tag = f" (+{lock_pnl:.0f}% Locked)"
                    else:
                        lock_tag = ""
                    reason = f"STEPPED_SL_{sl_n}{lock_tag}"
                else:
                    reason = "FIXED_SL"
                _close_trade_inline(trade, current, reason)
                changed = True
                continue

            # Old TP hit (only when multi-target is NOT active for this trade)
            if not mt_enabled or t1_price is None:
                effective_tp = trade.get("trailing_tp", trade["take_profit"])
                tp_hit = False
                if is_long:
                    tp_hit = current >= effective_tp
                else:
                    tp_hit = current <= effective_tp
                if tp_hit:
                    ext = trade["tp_extensions"]
                    reason = f"TP_EXT_{ext}" if ext > 0 else "FIXED_TP"
                    _close_trade_inline(trade, current, reason)
                    changed = True
                    continue

        # ── TP OVERSHOOT SAFETY NET (paper only) ──────────────────────────
        # Fires when price GAPS THROUGH the TP level between heartbeats.
        # Checks PnL% directly — independent of price-based TP checks.
        # If the trade's current PnL% has exceeded what TP would give by ≥2%,
        # the trade must have passed its TP and should be closed.
        # Example: BTC SHORT TP gives +73% at leverage, actual PnL is +99% → fire.
        if not is_live:
            eff_tp = trade.get("trailing_tp", trade.get("take_profit", 0))
            lev_overshoot = trade.get("leverage", 1)
            if eff_tp and eff_tp > 0 and entry and entry > 0 and lev_overshoot > 0:
                # Expected PnL% at TP level (leveraged)
                price_move_to_tp = abs(eff_tp - entry) / entry
                expected_tp_pnl_pct = round(price_move_to_tp * lev_overshoot * 100, 2)
                # If actual PnL% exceeds expected TP PnL% by ≥2% buffer → overshoot
                if expected_tp_pnl_pct > 0 and pnl_pct >= expected_tp_pnl_pct + 2.0:
                    logger.warning(
                        "🎯 TP OVERSHOOT on %s: actual PnL %.1f%% > TP target %.1f%% — "
                        "price gapped through TP (%.6f). Closing trade.",
                        trade["trade_id"], pnl_pct, expected_tp_pnl_pct, eff_tp,
                    )
                    _close_trade_inline(trade, current, "TP_OVERSHOOT")
                    changed = True
                    continue

        changed = True

    if changed:
        _compute_summary(book)
        _save_book(book)


def get_tradebook():
    """Return the full tradebook dict."""
    return _load_book()


def get_active_trades():
    """Return only active trades."""
    book = _load_book()
    return [t for t in book["trades"] if t["status"] in ("ACTIVE", "OPEN")]


def get_closed_trades():
    """Return only closed trades."""
    book = _load_book()
    return [t for t in book["trades"] if t["status"] == "CLOSED"]


def get_current_loss_streak():
    """Return (streak_count, last_loss_timestamp) for the current consecutive losing streak.
    Counts backwards from the most recent closed trade.
    """
    closed = get_closed_trades()
    if not closed:
        return 0, None

    # Sort by exit timestamp descending (most recent first)
    closed.sort(key=lambda t: t.get("exit_timestamp", ""), reverse=True)

    streak = 0
    last_loss_ts = None
    for t in closed:
        pnl = t.get("realized_pnl", 0)
        if pnl < 0:
            streak += 1
            if last_loss_ts is None:
                last_loss_ts = t.get("exit_timestamp")
        else:
            break  # Streak broken by a win
    return streak, last_loss_ts


# ═══════════════════════════════════════════════════════════════════════════════
#  LIVE TRAILING SL/TP SYNC
# ═══════════════════════════════════════════════════════════════════════════════

def _close_live_position(symbol):
    """Close a live CoinDCX position when SL/TP is hit."""
    try:
        import coindcx_client as cdx
        pair = cdx.to_coindcx_pair(symbol)
        positions = cdx.list_positions()
        for p in positions:
            if p.get("pair") == pair and float(p.get("active_pos", 0)) != 0:
                cdx.exit_position(p["id"])
                logger.info("📤 Closed CoinDCX position %s for %s", p["id"], symbol)
                return True
        logger.warning("No CoinDCX position found for %s to close", symbol)
    except Exception as e:
        logger.error("Failed to close CoinDCX position for %s: %s", symbol, e)
    return False


def _price_round(p):
    """Round price to CoinDCX-compatible tick size."""
    if p >= 1000:   return round(p, 1)
    elif p >= 10:   return round(p, 2)
    elif p >= 1:    return round(p, 3)
    elif p >= 0.01: return round(p, 4)
    else:           return round(p, 5)


def sync_live_tpsl():
    """
    Push updated trailing SL/TP to CoinDCX for live positions.

    Called from the heartbeat loop (main.py) AFTER update_unrealized().
    Only runs in LIVE mode. Compares current trailing_sl/trailing_tp
    with the last values pushed to CoinDCX and updates if changed.
    """
    if config.PAPER_TRADE:
        return

    try:
        import coindcx_client as cdx
    except ImportError:
        return

    book = _load_book()
    updated_count = 0

    for trade in book["trades"]:
        if trade["status"] != "ACTIVE":
            continue
        if trade.get("mode") != "LIVE":
            continue

        symbol = trade["symbol"]
        trailing_sl = trade.get("trailing_sl", trade["stop_loss"])
        trailing_tp = trade.get("trailing_tp", trade["take_profit"])

        # Compare with last-pushed values
        last_sl = trade.get("_cdx_last_sl")
        last_tp = trade.get("_cdx_last_tp")

        # Force initial push if never synced to CoinDCX
        first_push = (last_sl is None or last_tp is None)

        if not first_push:
            sl_changed = abs(trailing_sl - last_sl) > 1e-8
            tp_changed = abs(trailing_tp - last_tp) > 1e-8
            if not sl_changed and not tp_changed:
                continue

        # Find CoinDCX position ID
        pair = cdx.to_coindcx_pair(symbol)
        try:
            positions = cdx.list_positions()
            pos_id = None
            for p in positions:
                if p.get("pair") == pair and float(p.get("active_pos", 0)) != 0:
                    pos_id = p["id"]
                    break

            if not pos_id:
                logger.debug("No CoinDCX position for %s — skip TPSL sync", symbol)
                continue

            # Round to CoinDCX tick sizes
            rounded_sl = _price_round(trailing_sl)
            rounded_tp = _price_round(trailing_tp)

            cdx.create_tpsl(
                position_id=pos_id,
                take_profit_price=rounded_tp,
                stop_loss_price=rounded_sl,
            )

            # Record pushed values
            trade["_cdx_last_sl"] = trailing_sl
            trade["_cdx_last_tp"] = trailing_tp
            updated_count += 1

            logger.info(
                "🔄 TPSL updated on CoinDCX for %s: SL=$%.6f → $%.6f | TP=$%.6f → $%.6f",
                symbol, last_sl, rounded_sl, last_tp, rounded_tp,
            )

        except Exception as e:
            logger.error("Failed to sync TPSL for %s: %s", symbol, e)

    if updated_count > 0:
        _save_book(book)
        logger.info("📊 Synced trailing SL/TP for %d live positions", updated_count)

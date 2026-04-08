"""
Project Regime-Master — Execution Engine
Handles futures order placement with protective SL/TP orders.
  • Paper mode → Binance testnet (simulated)
  • Live mode  → CoinDCX or Binance Futures (real orders)
"""
import logging
import csv
import os
import time
from datetime import datetime

import config
from risk_manager import RiskManager

logger = logging.getLogger("ExecutionEngine")

# ─── Exchange Client Factory ─────────────────────────────────────────────────────

_live_exchange_client = None

def get_exchange_client():
    """Get the live exchange client based on EXCHANGE_LIVE config."""
    global _live_exchange_client
    if _live_exchange_client is not None:
        return _live_exchange_client

    exchange = getattr(config, 'EXCHANGE_LIVE', '').lower()
    if exchange == 'binance':
        from binance_futures_client import BinanceFuturesClient
        testnet = getattr(config, 'BINANCE_FUTURES_TESTNET', True)
        _live_exchange_client = BinanceFuturesClient(testnet=testnet)
    elif exchange == 'coindcx':
        from coindcx_exchange_client import CoinDCXExchangeClient
        _live_exchange_client = CoinDCXExchangeClient()
    else:
        logger.warning("No EXCHANGE_LIVE set — live trading disabled.")
        return None

    return _live_exchange_client


class ExecutionEngine:
    """
    Places and manages futures trades.

    Key safety features:
      • ISOLATED margin per position
      • ATR-based SL/TP bracket orders
      • Paper trade mode (logs but doesn't execute)

    Live mode routes to CoinDCX Futures.
    Paper mode routes to Binance (testnet, simulated).
    """

    def __init__(self, client=None):
        self._client = client  # Binance client (paper only)
        self.risk = RiskManager()

    def _get_binance_client(self):
        """Lazy-init Binance client (paper mode only)."""
        if self._client is None:
            from binance.client import Client
            self._client = Client(
                api_key=config.BINANCE_API_KEY,
                api_secret=config.BINANCE_API_SECRET,
                testnet=config.TESTNET,
            )
        return self._client

    # ─── Margin & Leverage Setup (Paper/Binance) ──────────────────────────────

    def setup_position(self, symbol, leverage):
        """Set isolated margin and leverage for a symbol (Binance paper)."""
        client = self._get_binance_client()
        try:
            client.futures_change_margin_type(symbol=symbol, marginType="ISOLATED")
            logger.info("Margin set to ISOLATED for %s.", symbol)
        except Exception:
            pass  # Already ISOLATED

        try:
            client.futures_change_leverage(symbol=symbol, leverage=leverage)
            logger.info("Leverage set to %dx for %s.", leverage, symbol)
        except Exception as e:
            logger.error("Failed to set leverage for %s: %s", symbol, e)

    # ─── Trade Execution ─────────────────────────────────────────────────────

    def execute_trade(self, symbol, side, leverage, quantity, atr,
                      regime=None, confidence=None, reason="", swing_l=None, swing_h=None,
                      fallback_leverage=None):
        """
        Execute a futures trade with protective SL/TP.

        Routes:
          Paper mode → simulated log entry
          Live mode  → CoinDCX Futures market order with TP/SL

        Parameters
        ----------
        symbol : str — Binance-style (BTCUSDT)
        side : str ('BUY' or 'SELL')
        leverage : int
        quantity : float
        atr : float (for computing SL/TP)
        regime : int (optional, for logging)
        confidence : float (optional)
        reason : str

        Returns
        -------
        dict: trade result or paper log
        """
        if leverage <= 0:
            logger.info("Leverage is 0 — no trade for %s.", symbol)
            return None

        regime_name = config.REGIME_NAMES.get(regime, "UNKNOWN")

        # ── Paper Trade Mode ────────────────────────────────────────
        if config.PAPER_TRADE:
            # Use Binance WebSocket price (sub-100ms) — falls back to REST if WS not ready yet
            try:
                from price_stream import get_price_stream
                ps = get_price_stream()
                ws_price = ps.get_price(symbol)
            except Exception:
                ws_price = None

            if ws_price and ws_price > 0:
                current_price = ws_price
                logger.debug("📡 PAPER using WS price %s = %.6f", symbol, current_price)
            else:
                from data_pipeline import get_current_price
                current_price = get_current_price(symbol) or 0
                logger.debug("📡 PAPER WS not ready for %s — using REST price %.6f", symbol, current_price)

            # Apply simulated slippage for realistic paper fills
            slippage_pct = getattr(config, 'PAPER_SIMULATED_SLIPPAGE_PCT', 0) / 100.0
            if slippage_pct > 0 and current_price > 0:
                import random
                slip = random.uniform(0, slippage_pct)
                if side.upper() == "BUY":
                    current_price = round(current_price * (1 + slip), 6)  # BUY fills slightly higher
                else:
                    current_price = round(current_price * (1 - slip), 6)  # SELL fills slightly lower
                logger.debug("📡 PAPER slippage applied %s: %.4f%% → %.6f", symbol, slip * 100, current_price)

            sl, tp, rm_id = self.risk.calculate_optimal_stops(symbol, current_price, atr, side, leverage, swing_l, swing_h)
            log_entry = {
                "timestamp":   datetime.utcnow().isoformat(),
                "symbol":      symbol,
                "side":        side,
                "leverage":    leverage,
                "quantity":    quantity,
                "entry_price": current_price,
                "stop_loss":   sl,
                "take_profit": tp,
                "capital":     round(quantity * current_price / (leverage or 1), 2) if (leverage or 0) > 0 and (current_price or 0) > 0 else 100.0,
                "regime":      regime_name,
                "confidence":  f"{confidence:.2f}" if confidence else "N/A",
                "reason":      reason,
                "rm_id":       rm_id,
                "mode":        "PAPER",
                "exchange":    "binance_mainnet" if getattr(config, 'PAPER_USE_MAINNET', False) else "binance_testnet",
                "order_type":  "MARKET",
                "status":      "FILLED",
            }
            self._log_trade(log_entry)
            logger.info("PAPER MARKET %s %s @ %.4f | %dx | SL=%.4f TP=%.4f | %s", side, symbol, current_price, leverage, sl, tp, regime_name)
            return log_entry

        # ── Live Trade (Market Order) ────────────────────────────────
        exchange = getattr(config, 'EXCHANGE_LIVE', '').lower()
        if exchange == 'binance':
            return self._execute_binance_live(symbol, side, leverage, quantity, atr,
                                              regime, regime_name, confidence, reason, swing_l, swing_h)
        # Default to CoinDCX
        return self._execute_coindcx(symbol, side, leverage, quantity, atr,
                                     regime, regime_name, confidence, reason, swing_l, swing_h,
                                     fallback_leverage)

    def _execute_binance_live(self, symbol, side, leverage, quantity, atr,
                               regime, regime_name, confidence, reason, swing_l=None, swing_h=None):
        """Execute a live trade on Binance Futures."""
        client = get_exchange_client()
        if not client:
            logger.error("No exchange client available for Binance live trade.")
            return None

        from data_pipeline import get_current_price
        current_price = get_current_price(symbol) or 0
        
        # Max Slippage Guard
        max_slippage = getattr(config, 'MAX_SLIPPAGE_PCT', 0.5) / 100.0
        limit_price = current_price * (1 + max_slippage) if side.upper() == 'BUY' else current_price * (1 - max_slippage)
        
        sl, tp, rm_id = self.risk.calculate_optimal_stops(symbol, current_price, atr, side, leverage, swing_l, swing_h)

        result = client.open_position(
            symbol=symbol, side=side, quantity=quantity,
            leverage=leverage, sl_price=sl, tp_price=tp,
            order_type="LIMIT", limit_price=limit_price
        )

        if result.get("status") in ("FILLED", "OPEN"):
            fill_price = result.get("avg_price", current_price)
            fill_qty = result.get("filled_qty", quantity)
            margin = fill_qty * fill_price / leverage

            log_entry = {
                "timestamp":    datetime.utcnow().isoformat(),
                "symbol":       symbol,
                "side":         side,
                "leverage":     leverage,
                "quantity":     fill_qty,
                "entry_price":  fill_price,
                "stop_loss":    sl,
                "take_profit":  tp,
                "capital":      round(margin, 2),
                "regime":       regime_name,
                "confidence":   confidence if confidence else 0,
                "reason":       reason,
                "rm_id":        rm_id,
                "mode":         "LIVE-BINANCE",
                "exchange":     "binance",
                "order_id":     result.get("order_id"),
                "order_type":   "LIMIT",
                "status":       result.get("status", "OPEN"),
                "created_at":   time.time(),
            }
            self._log_trade(log_entry)
            logger.info(
                "Binance %s %s @ %.4f | %dx | qty=%.6f | SL=%.4f TP=%.4f",
                side, symbol, fill_price, leverage, fill_qty, sl, tp,
            )
            return log_entry
        else:
            logger.error("Binance trade failed for %s: %s", symbol, result.get("error"))
            return None

    # ─── Multi-Target Live Trading Methods ────────────────────────────────────

    @staticmethod
    def partial_close_live(symbol, side, quantity):
        """Partially close a live position (for T1/T2 bookings)."""
        client = get_exchange_client()
        if not client:
            logger.warning("No exchange client — cannot partial close %s", symbol)
            return None
        return client.partial_close(symbol, side, quantity)

    @staticmethod
    def modify_sl_live(symbol, new_sl_price):
        """Modify SL on exchange (for breakeven / T1 moves)."""
        client = get_exchange_client()
        if not client:
            logger.warning("No exchange client — cannot modify SL for %s", symbol)
            return False
        return client.modify_sl(symbol, new_sl_price)

    @staticmethod
    def close_position_live(symbol):
        """Fully close a live position (for T3 or MAX_LOSS)."""
        client = get_exchange_client()
        if not client:
            logger.warning("No exchange client — cannot close %s", symbol)
            return False
        return client.close_position(symbol)

    @staticmethod
    def add_to_position_live(symbol, side, quantity):
        """Add to a live position (for DCA averaging down)."""
        client = get_exchange_client()
        if not client:
            logger.warning("No exchange client — cannot add to %s", symbol)
            return None
            
        exchange = getattr(config, 'EXCHANGE_LIVE', '').lower()
        try:
            if exchange == 'coindcx':
                import coindcx_client as cdx
                pair = cdx.to_coindcx_pair(symbol)
                step = CoinDCXExchangeClient._qty_step(cdx.get_current_price(pair) or 1)
                quantity = CoinDCXExchangeClient._round_to_step(quantity, step)
                return client.create_order(
                    pair=pair, side=side.lower(), order_type="market_order",
                    quantity=quantity, leverage=None, price=None,
                    take_profit_price=None, stop_loss_price=None
                )
            elif exchange == 'binance':
                return client.open_position(
                    symbol=symbol, side=side, quantity=quantity,
                    leverage=None, sl_price=None, tp_price=None,
                    order_type="MARKET"
                )
        except Exception as e:
            logger.error("Failed to add to position live for %s: %s", symbol, e)
            return None
    # ─── CoinDCX helpers ──────────────────────────────────────────────────────

    @staticmethod
    def _cdx_qty_step(price):
        """A5 FIX: Delegate to CoinDCXExchangeClient (single source of truth)."""
        from coindcx_exchange_client import CoinDCXExchangeClient
        return CoinDCXExchangeClient._qty_step(price)

    @staticmethod
    def _round_to_step(qty, step):
        """A5 FIX: Delegate to CoinDCXExchangeClient (single source of truth)."""
        from coindcx_exchange_client import CoinDCXExchangeClient
        return CoinDCXExchangeClient._round_to_step(qty, step)

    @staticmethod
    def _cdx_price_round(p: float) -> float:
        """A5 FIX: Delegate to CoinDCXExchangeClient (single source of truth)."""
        from coindcx_exchange_client import CoinDCXExchangeClient
        return CoinDCXExchangeClient._price_round(p)

    def _validate_and_size_cdx_order(self, symbol, pair, quantity, leverage, cdx, fallback_leverage=None):
        """Fetch price, enforce min notional, check wallet margin, set leverage.

        Returns (price, sized_quantity, final_leverage, wallet_balance) on success,
        or None if the order cannot be placed (insufficient funds / inactive instrument).
        """
        import re as _re

        price = cdx.get_current_price(pair)
        if price is None:
            logger.error("Cannot get price for %s — aborting trade.", pair)
            return None

        # Enforce minimum order size + round to qty step
        step = self._cdx_qty_step(price)
        notional = quantity * price
        if notional < config.COINDCX_MIN_NOTIONAL:
            quantity = self._round_to_step(config.COINDCX_MIN_NOTIONAL / price, step)
            logger.info(
                "Boosted %s qty to %.6f to meet $%.0f CoinDCX min",
                symbol, quantity, config.COINDCX_MIN_NOTIONAL,
            )
        else:
            quantity = self._round_to_step(quantity, step)
        notional = quantity * price

        # Check margin vs wallet balance
        wallet = cdx.get_usdt_balance()
        margin_needed = notional / leverage
        if margin_needed > wallet:
            logger.warning(
                "Insufficient balance for %s: need $%.2f margin, have $%.2f — skipping.",
                symbol, margin_needed, wallet,
            )
            return None

        # Set leverage (auto-clamp on exchange rejection)
        try:
            cdx.update_leverage(pair, leverage)
        except Exception as lev_err:
            err_msg = str(lev_err)
            m = _re.search(r"Max allowed leverage.*?=\s*([\d.]+)", err_msg)
            if m:
                max_lev = int(float(m.group(1)))
                if fallback_leverage is not None and max_lev >= fallback_leverage:
                    logger.warning("%s max leverage %dx (requested %dx) — applying user fallback %dx.", symbol, max_lev, leverage, fallback_leverage)
                    leverage = fallback_leverage
                else:
                    logger.warning("%s max leverage %dx (requested %dx) — clamping to max %dx.", symbol, max_lev, leverage, max_lev)
                    leverage = max_lev
                cdx.update_leverage(pair, leverage)
                margin_needed = notional / leverage
                if margin_needed > wallet:
                    logger.warning("Margin $%.2f > balance $%.2f after clamp — skip.", margin_needed, wallet)
                    return None
            elif "Instrument is not active" in err_msg:
                logger.warning("%s not active on CoinDCX — skipping.", symbol)
                return None
            else:
                raise

        return price, quantity, leverage, wallet

    def _place_cdx_order_with_retry(self, symbol, pair, side, quantity, leverage,
                                    price, sl, tp, wallet, cdx, order_type="market_order", limit_price=None):
        """Place a CoinDCX order, retrying once on qty-step validation errors.

        Returns the exchange result dict on success, None if margin check fails on retry,
        or re-raises on unhandled errors.
        """
        import re as _re

        coindcx_side = side.lower()
        try:
            return cdx.create_order(
                pair=pair, side=coindcx_side, order_type=order_type,
                quantity=quantity, leverage=leverage, price=limit_price,
                take_profit_price=tp, stop_loss_price=sl,
            )
        except Exception as ord_err:
            err_msg = str(ord_err)
            m = _re.search(r"divisible by ([\d.]+)", err_msg)
            if m:
                real_step = float(m.group(1))
                quantity = self._round_to_step(config.COINDCX_MIN_NOTIONAL / price, real_step)
                margin_needed = (quantity * price) / leverage
                if margin_needed > wallet:
                    logger.warning("Margin $%.2f > balance after re-step — skip.", margin_needed)
                    return None
                logger.info("Retry %s with step=%.6f → qty=%.6f", symbol, real_step, quantity)
                return cdx.create_order(
                    pair=pair, side=coindcx_side, order_type=order_type,
                    quantity=quantity, leverage=leverage, price=limit_price,
                    take_profit_price=tp, stop_loss_price=sl,
                )
            raise

    def _read_cdx_confirmed_position(self, pair, price, quantity, leverage, sl, tp, cdx):
        """Wait for exchange settlement then read back the confirmed position.

        Returns a dict of fill details from the exchange, or an empty dict if
        the position cannot be read (falls back to locally-estimated values).
        """
        import time as _time
        _time.sleep(config.COINDCX_ORDER_SETTLE_SLEEP)
        confirmed = {}
        try:
            positions = cdx.list_positions()
            for pos in positions:
                if pos.get("pair") == pair and float(pos.get("active_pos", 0)) != 0:
                    confirmed = {
                        "avg_price":     float(pos.get("avg_price", price)),
                        "active_pos":    abs(float(pos.get("active_pos", quantity))),
                        "leverage":      int(float(pos.get("leverage", leverage))),
                        "locked_margin": float(pos.get("locked_margin", 0)),
                        "mark_price":    float(pos.get("mark_price", price)),
                        "position_id":   pos.get("id"),
                        "sl_trigger":    pos.get("stop_loss_trigger"),
                        "tp_trigger":    pos.get("take_profit_trigger"),
                    }
                    break
        except Exception as read_err:
            logger.warning("Could not read back position for %s: %s", pair, read_err)
        return confirmed

    def _execute_coindcx(self, symbol, side, leverage, quantity, atr,
                         regime, regime_name, confidence, reason, swing_l=None, swing_h=None,
                         fallback_leverage=None):
        """Execute a live trade on CoinDCX Futures. Returns a trade log dict or None."""
        import coindcx_client as cdx

        pair = cdx.to_coindcx_pair(symbol)
        try:
            validated = self._validate_and_size_cdx_order(symbol, pair, quantity, leverage, cdx, fallback_leverage)
            if validated is None:
                return None
            price, quantity, leverage, wallet = validated

            sl, tp, rm_id = self.risk.calculate_optimal_stops(symbol, price, atr, side, leverage, swing_l, swing_h)
            sl = self._cdx_price_round(sl)
            tp = self._cdx_price_round(tp)

            # Max Slippage Guard
            max_slippage = getattr(config, 'MAX_SLIPPAGE_PCT', 0.5) / 100.0
            limit_price = price * (1 + max_slippage) if side.upper() == 'BUY' else price * (1 - max_slippage)
            limit_price = self._cdx_price_round(limit_price)

            result = self._place_cdx_order_with_retry(
                symbol, pair, side, quantity, leverage, price, sl, tp, wallet, cdx,
                order_type="limit_order", limit_price=limit_price
            )
            if result is None:
                return None

            logger.info(
                "CoinDCX %s %s @ %.4f | %dx | qty=%.6f | SL=%.4f TP=%.4f | %s",
                side, symbol, price, leverage, quantity, sl, tp, regime_name,
            )

            confirmed = self._read_cdx_confirmed_position(pair, price, quantity, leverage, sl, tp, cdx)

            fill_price  = confirmed.get("avg_price", price)
            if not fill_price or fill_price <= 0:
                fill_price = price
            fill_qty    = confirmed.get("active_pos", quantity)
            fill_lev    = confirmed.get("leverage", leverage)
            fill_margin = confirmed.get("locked_margin", 0) or (fill_qty * fill_price / fill_lev)
            fill_sl     = confirmed.get("sl_trigger", sl)
            fill_tp     = confirmed.get("tp_trigger", tp)

            log_entry = {
                "timestamp":    datetime.utcnow().isoformat(),
                "symbol":       symbol,
                "side":         side,
                "leverage":     fill_lev,
                "quantity":     fill_qty,
                "entry_price":  fill_price,
                "stop_loss":    float(fill_sl) if fill_sl else sl,
                "take_profit":  float(fill_tp) if fill_tp else tp,
                "capital":      round(fill_margin, 2),
                "regime":       regime_name,
                "confidence":   confidence if confidence else 0,
                "reason":       reason,
                "rm_id":        rm_id,
                "mode":         "LIVE",
                "exchange":     "coindcx",
                "pair":         pair,
                "position_id":  confirmed.get("position_id"),
                "order_result": str(result),
                "order_type":   "LIMIT",
                "status":       "FILLED",
                "created_at":   time.time(),
            }
            self._log_trade(log_entry)
            return log_entry

        except Exception as e:
            logger.error("CoinDCX Execution Error for %s: %s", symbol, e)
            return None

    # ─── Emergency Close ─────────────────────────────────────────────────────

    def close_all_positions(self, symbol=None):
        """
        Close all open futures positions.
        If symbol is provided, close only that symbol.
        """
        if config.PAPER_TRADE:
            logger.info("PAPER: close_all_positions(%s)", symbol or "ALL")
            return

        # ── CoinDCX Live ──
        self._close_coindcx(symbol)

    def _close_coindcx(self, symbol=None):
        """Close positions on CoinDCX Futures."""
        import coindcx_client as cdx

        try:
            positions = cdx.list_positions()
            if not positions:
                logger.info("No CoinDCX positions to close.")
                return

            for pos in positions:
                active = float(pos.get("active_pos", 0))
                if active == 0:
                    continue

                pair = pos.get("pair", "")
                pos_id = pos.get("id", "")

                # Filter by symbol if specified
                if symbol:
                    target_pair = cdx.to_coindcx_pair(symbol)
                    if pair != target_pair:
                        continue

                cdx.exit_position(pos_id)
                logger.info("CoinDCX: Closed position %s (%s)", pair, pos_id)

            # Cancel all open orders
            cdx.cancel_all_open_orders()
            logger.info("CoinDCX: All positions closed and orders cancelled.")

        except Exception as e:
            logger.error("Failed to close CoinDCX positions: %s", e)

    # ─── Get Wallet Balance ──────────────────────────────────────────────────

    def get_futures_balance(self):
        """Get USDT futures wallet balance."""
        if config.PAPER_TRADE:
            # Use override if set via /api/set-config (from SaaS BotConfig.capitalPerTrade)
            override = getattr(config, 'PAPER_BALANCE_OVERRIDE', 0)
            return float(override) if override > 0 else 1000.0

        # ── CoinDCX Live ──
        import coindcx_client as cdx
        return cdx.get_usdt_balance()

    # ─── Trade Logger ────────────────────────────────────────────────────────

    @staticmethod
    def _log_trade(entry):
        """Append trade to CSV log."""
        file_exists = os.path.exists(config.TRADE_LOG_FILE)
        try:
            with open(config.TRADE_LOG_FILE, "a", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=entry.keys())
                if not file_exists:
                    writer.writeheader()
                writer.writerow(entry)
        except Exception as e:
            logger.error("Failed to log trade: %s", e)


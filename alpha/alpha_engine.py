"""
╔══════════════════════════════════════════════════════════════════════════════╗
║                        ALPHA MODULE — SYNAPTIC                              ║
║  Module : alpha/alpha_engine.py                                              ║
║  Purpose: Main 15-minute trading loop. Orchestrates data → HMM → signal     ║
║           → risk → tradebook → Telegram for all 4 Alpha coins.             ║
║                                                                              ║
║  Cycle flow (every 15 minutes):                                              ║
║    1. Fetch enriched data for all coins (Bybit cache)                       ║
║    2. Retrain HMM per coin if stale (every 1h)                              ║
║    3. Per coin:                                                              ║
║       a. Predict regime (1h bars)                                           ║
║       b. If open trade → check BE, check exit (TP/SL/DIR_FLIP)             ║
║       c. If no open trade → check entry signal (15m bars)                  ║
║    4. Persist state                                                          ║
║    5. Send Telegram summary every ALPHA_TELEGRAM_SUMMARY_H hours            ║
║                                                                              ║
║  Paper mode: fills at last Bybit price, no orders sent                      ║
║  Live mode:  (Phase 3) will add Bybit order routing here                    ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  ISOLATION CONTRACT                                                          ║
║  ✗ DO NOT import any root module                                             ║
║  ✓ Only imports: alpha/* modules                                             ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

import json
import time
from datetime import datetime, timezone
from typing import Optional

from alpha.alpha_config import (
    ALPHA_COINS, ALPHA_CANDLE_BUFFER_S,
    ALPHA_TELEGRAM_SUMMARY_H, ALPHA_PAPER_MODE, ALPHA_STATE_FILE,
    ALPHA_AUDIT_LOG_FILE, DEPLOYMENT_LOCKED, ALPHA_VOL_THRESH,
)
from alpha.alpha_logger    import get_logger
from alpha.alpha_data      import get_all_alpha_data, get_latest_price
from alpha.alpha_hmm       import AlphaHMM
from alpha.alpha_signals   import check_entry_signal, check_exit
from alpha.alpha_risk      import (
    calc_position_size, calc_levels,
    should_activate_breakeven, apply_breakeven, calc_pnl,
)
from alpha.alpha_tradebook import (
    open_trade, close_trade, update_breakeven,
    get_open_trades, get_open_symbols, portfolio_summary,
)
from alpha.alpha_telegram  import (
    notify_trade_opened, notify_trade_closed, notify_breakeven,
    notify_cycle_summary, notify_engine_start, notify_error,
)
from alpha.alpha_bybit import (
    place_market_order, close_position, update_stop_loss, check_connectivity,
)

logger = get_logger("engine")


class AlphaEngine:
    """
    Main Alpha trading engine.

    Usage:
        engine = AlphaEngine()
        engine.run()        # blocks forever
        engine.run_once()   # run a single cycle (for testing)
    """

    def __init__(self):
        # One HMM instance per coin — persists across cycles for incremental retraining
        self._hmms: dict[str, AlphaHMM] = {sym: AlphaHMM(sym) for sym in ALPHA_COINS}
        self._cycle: int = 0
        self._last_summary: Optional[datetime] = None
        self._start_time: datetime = datetime.now(timezone.utc)

    # ── Public entry points ────────────────────────────────────────────────────

    def run(self) -> None:
        """
        Run forever in 15-minute intervals aligned to the clock.
        Blocks. Call from run_alpha.py.
        """
        if DEPLOYMENT_LOCKED:
            logger.info("DEPLOYMENT_LOCKED active — running in local mode only")

        logger.info("Alpha engine starting | paper=%s | coins=%s", ALPHA_PAPER_MODE, ALPHA_COINS)
        self._cycle = self._load_state().get("cycle", 0)

        # Verify Bybit connectivity before first cycle
        if not check_connectivity():
            logger.error("Bybit connectivity check failed — aborting startup")
            return

        notify_engine_start(self._cycle)

        while True:
            try:
                self._wait_for_next_15m()
                self.run_once()
            except KeyboardInterrupt:
                logger.info("Alpha engine stopped by user")
                break
            except Exception as e:
                logger.error("Engine top-level error: %s", e, exc_info=True)
                notify_error("run loop", str(e)[:300])
                time.sleep(60)   # back-off 1 min before retrying

    def run_once(self) -> dict:
        """
        Execute one full cycle. Returns a result summary dict.
        Safe to call directly for testing without waiting for clock alignment.
        """
        self._cycle += 1
        cycle_start = datetime.now(timezone.utc)
        logger.info("─── CYCLE #%d START | %s ───", self._cycle, cycle_start.strftime("%Y-%m-%d %H:%M UTC"))

        result = {
            "cycle":          self._cycle,
            "timestamp":      cycle_start.isoformat(),
            "data_ok":        [],
            "data_fail":      [],
            "regime_map":     {},
            "entries":        [],
            "exits":          [],
            "be_activations": [],
            "errors":         [],
        }

        # ── Step 1: Fetch data ─────────────────────────────────────────────────
        data = get_all_alpha_data()
        for sym in ALPHA_COINS:
            if sym in data:
                result["data_ok"].append(sym)
            else:
                result["data_fail"].append(sym)
                logger.warning("No data for %s this cycle — skipping", sym)

        if not data:
            logger.error("No data for any coin — aborting cycle")
            result["errors"].append("all_data_failed")
            return result

        # ── Step 2: Retrain HMM if stale ──────────────────────────────────────
        for sym, dfs in data.items():
            hmm = self._hmms[sym]
            if hmm.needs_retrain():
                logger.info("%s: retraining HMM ...", sym)
                ok = hmm.train(dfs["1h"])
                if not ok:
                    logger.warning("%s: HMM retrain failed", sym)
                    result["errors"].append(f"{sym}_hmm_train_failed")

        # ── Step 3: Per-coin processing ────────────────────────────────────────
        open_symbols = get_open_symbols()

        for sym in ALPHA_COINS:
            if sym not in data:
                continue
            dfs = data[sym]

            # ── Regime prediction ─────────────────────────────────────────────
            regime_info = self._hmms[sym].predict(dfs["1h"])
            result["regime_map"][sym] = regime_info

            if regime_info is None:
                logger.debug("%s: HMM not ready — skipping", sym)
                continue

            regime         = regime_info["regime"]
            passes_filter  = regime_info["passes_filter"]

            # ── Manage open trade for this coin ───────────────────────────────
            if sym in open_symbols:
                self._manage_open_trade(sym, regime, result)
                continue

            # ── Check entry signal ────────────────────────────────────────────
            if not passes_filter:
                logger.debug("%s: regime margin %.2f below filter — no entry", sym, regime_info["margin"])
                continue

            signal = check_entry_signal(dfs["15m"], regime)
            if not signal["signal"]:
                vz_last = signal.get("vol_zscore_last", float("nan"))
                vz_prev = signal.get("vol_zscore_prev", float("nan"))
                logger.info("%s: no signal | vol_z last=%.2f prev=%.2f (need >%.1f on both)",
                            sym, vz_last, vz_prev, ALPHA_VOL_THRESH)
                continue

            # ── Open trade ────────────────────────────────────────────────────
            self._open_new_trade(sym, signal, dfs["15m"], regime_info, result)

        # ── Step 4: Persist state ─────────────────────────────────────────────
        self._save_state(result)

        # ── Step 5: Audit log ─────────────────────────────────────────────────
        self._write_audit(result)

        # ── Step 6: Telegram summary (every N hours) ─────────────────────────
        if self._should_send_summary():
            portfolio = portfolio_summary()
            open_trades_list = get_open_trades()
            notify_cycle_summary(self._cycle, result["regime_map"], open_trades_list, portfolio)
            self._last_summary = datetime.now(timezone.utc)

        elapsed = (datetime.now(timezone.utc) - cycle_start).total_seconds()
        logger.info(
            "─── CYCLE #%d DONE | %.1fs | entries=%d exits=%d be=%d ───",
            self._cycle, elapsed, len(result["entries"]), len(result["exits"]), len(result["be_activations"]),
        )
        return result

    # ── Internal: trade management ─────────────────────────────────────────────

    def _manage_open_trade(self, sym: str, current_regime: str, result: dict) -> None:
        """Check BE activation, TP/SL hits, and DIR_FLIP for a coin with an open trade."""
        open_trades = [t for t in get_open_trades() if t["symbol"] == sym]
        if not open_trades:
            return

        trade = open_trades[0]   # one trade per coin max
        tid   = trade["trade_id"]

        # Get current price
        price = self._get_fill_price(sym)
        if price is None:
            logger.warning("%s: cannot get price for trade management", sym)
            return

        # ── Check breakeven activation ─────────────────────────────────────
        if should_activate_breakeven(trade, price):
            updated = apply_breakeven(trade)
            # Push SL update to exchange (no-op in paper mode)
            update_stop_loss(sym, trade["side"], updated["stop_loss"])
            update_breakeven(tid, updated["stop_loss"])
            notify_breakeven(trade, price)
            result["be_activations"].append(tid)
            trade = updated  # use updated trade for exit checks

        # ── Check DIR_FLIP (regime flipped from entry) ─────────────────────
        entry_regime = trade.get("regime")
        if entry_regime and current_regime != entry_regime:
            # Close on exchange first (market order), then record in tradebook
            fill = close_position(sym, trade["side"], trade["qty"], price, reason="DIR_FLIP")
            actual_exit = fill["fill_price"] if fill else price
            pnl = calc_pnl(trade, actual_exit)
            closed = close_trade(
                tid, exit_price=actual_exit, exit_reason="DIR_FLIP",
                net_pnl=pnl["net_pnl"], pnl_pct=pnl["pnl_pct"],
                fee_close_usdt=pnl["fee_close"],
            )
            if closed:
                notify_trade_closed(closed)
                result["exits"].append({"trade_id": tid, "reason": "DIR_FLIP", "pnl": pnl["net_pnl"]})
            return

        # ── Check TP / SL ──────────────────────────────────────────────────
        exit_check = check_exit(trade, price)
        if exit_check["should_exit"]:
            fill = close_position(sym, trade["side"], trade["qty"], price, reason=exit_check["reason"])
            actual_exit = fill["fill_price"] if fill else price
            pnl = calc_pnl(trade, actual_exit)
            closed = close_trade(
                tid, exit_price=actual_exit, exit_reason=exit_check["reason"],
                net_pnl=pnl["net_pnl"], pnl_pct=pnl["pnl_pct"],
                fee_close_usdt=pnl["fee_close"],
            )
            if closed:
                notify_trade_closed(closed)
                result["exits"].append({"trade_id": tid, "reason": exit_check["reason"], "pnl": pnl["net_pnl"]})

    def _open_new_trade(
        self, sym: str, signal: dict, df_15m, regime_info: dict, result: dict
    ) -> None:
        """Calculate levels and record a new trade."""
        atr   = float(df_15m["atr"].iloc[-1])
        price = self._get_fill_price(sym)
        if price is None or atr <= 0:
            logger.warning("%s: cannot open trade — price=%s atr=%.4f", sym, price, atr)
            return

        side   = signal["side"]
        pos    = calc_position_size(entry_price=price, atr=atr)
        levels = calc_levels(entry_price=price, atr=atr, side=side)

        # Send order to exchange (paper: simulated fill; live: real market order)
        fill = place_market_order(
            symbol      = sym,
            side        = side,
            qty         = pos["qty"],
            stop_loss   = levels["stop_loss"],
            take_profit = levels["take_profit"],
            entry_price = price,
        )
        if fill is None:
            logger.error("%s: place_market_order failed — skipping trade", sym)
            result["errors"].append(f"{sym}_order_failed")
            return

        # Use actual fill price (may differ from signal price due to slippage)
        fill_price = fill["fill_price"]

        trade = open_trade(
            symbol        = sym,
            side          = side,
            entry_price   = fill_price,
            qty           = pos["qty"],
            stop_loss     = levels["stop_loss"],
            take_profit   = levels["take_profit"],
            be_trigger    = levels["be_trigger"],
            notional_usdt = pos["notional_usdt"],
            margin_usdt   = pos["margin_usdt"],
            fee_open_usdt = pos["fee_open_usdt"],
            atr           = atr,
            regime        = regime_info["regime"],
            regime_margin = regime_info["margin"],
            vol_zscore    = signal["vol_zscore_last"],
        )
        notify_trade_opened(trade)
        result["entries"].append({
            "trade_id": trade["trade_id"],
            "symbol":   sym,
            "side":     side,
            "price":    price,
        })

    # ── Internal: price fetch ──────────────────────────────────────────────────

    def _get_fill_price(self, sym: str) -> Optional[float]:
        """
        Get fill price for paper or live mode.
        Paper: fetch latest Bybit mark price.
        Live (Phase 3): will use actual order fill price.
        """
        price = get_latest_price(sym)
        if price is None:
            logger.warning("_get_fill_price(%s): returned None", sym)
        return price

    # ── Internal: clock alignment ──────────────────────────────────────────────

    def _wait_for_next_15m(self) -> None:
        """Sleep until the next 15-minute boundary + ALPHA_CANDLE_BUFFER_S seconds."""
        now     = datetime.now(timezone.utc)
        minute  = now.minute
        # Next 15m boundary
        next_m  = (minute // 15 + 1) * 15
        if next_m >= 60:
            wait_s = (60 - minute) * 60 - now.second + ALPHA_CANDLE_BUFFER_S
        else:
            wait_s = (next_m - minute) * 60 - now.second + ALPHA_CANDLE_BUFFER_S

        wait_s = max(wait_s, 1)
        logger.info("Waiting %.0fs until next 15m boundary ...", wait_s)
        time.sleep(wait_s)

    # ── Internal: state / audit ────────────────────────────────────────────────

    def _save_state(self, last_result: dict) -> None:
        state = {
            "cycle":        self._cycle,
            "last_run":     datetime.now(timezone.utc).isoformat(),
            "paper_mode":   ALPHA_PAPER_MODE,
            "hmm_states":   {sym: self._hmms[sym].to_dict() for sym in ALPHA_COINS},
            "last_result":  {
                "entries":   last_result["entries"],
                "exits":     last_result["exits"],
                "data_fail": last_result["data_fail"],
                "regime_map": last_result.get("regime_map", {}),
            },
        }
        try:
            with open(ALPHA_STATE_FILE, "w") as f:
                json.dump(state, f, indent=2, default=str)
        except Exception as e:
            logger.error("_save_state failed: %s", e)

    def _load_state(self) -> dict:
        try:
            with open(ALPHA_STATE_FILE) as f:
                return json.load(f)
        except Exception:
            return {}

    def _write_audit(self, result: dict) -> None:
        """Append cycle result to audit_log.json (one JSON object per line)."""
        try:
            with open(ALPHA_AUDIT_LOG_FILE, "a") as f:
                f.write(json.dumps(result, default=str) + "\n")
        except Exception as e:
            logger.error("_write_audit failed: %s", e)

    def _should_send_summary(self) -> bool:
        if self._last_summary is None:
            return True
        elapsed_h = (datetime.now(timezone.utc) - self._last_summary).total_seconds() / 3600
        return elapsed_h >= ALPHA_TELEGRAM_SUMMARY_H

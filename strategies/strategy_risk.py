"""
strategy_risk.py — Independent Risk Manager for Strategy Bots (Pyxis / Axiom / Ratio)

Completely separate from the HMM RiskManager. Uses ATR-based stops and fixed leverage.
No dependency on HMM confidence or regime state.
"""
import logging
import time
from datetime import datetime, timezone, timedelta
from typing import Optional, Tuple

logger = logging.getLogger("StrategyRisk")


class StrategyRiskManager:
    """
    Lightweight risk manager for independent strategy bots.

    Rules:
    - Fixed leverage per strategy (no HMM confidence scaling)
    - ATR-based stop-loss and take-profit
    - Max open trades hard cap
    - Daily loss kill switch (pauses bot for 24h if exceeded)
    - No cross-bot contamination — each bot has its own instance
    """

    def __init__(
        self,
        bot_name: str,
        max_open_trades: int = 3,
        capital_per_trade: float = 1000.0,
        leverage: int = 5,
        sl_atr_mult: float = 1.5,    # Stop loss = 1.5x ATR below/above entry
        tp_atr_mult: float = 3.0,    # Take profit = 3.0x ATR above/below entry
        max_daily_loss_pct: float = 0.08,  # 8% daily loss → kill switch for 24h
        risk_pct_per_trade: float = 0.02,  # 2% of capital at risk per trade
    ):
        self.bot_name = bot_name
        self.max_open_trades = max_open_trades
        self.capital_per_trade = capital_per_trade
        self.leverage = leverage
        self.sl_atr_mult = sl_atr_mult
        self.tp_atr_mult = tp_atr_mult
        self.max_daily_loss_pct = max_daily_loss_pct
        self.risk_pct_per_trade = risk_pct_per_trade

        # Kill switch state
        self._paused_until: Optional[float] = None
        self._daily_loss: float = 0.0
        self._daily_loss_reset_at: float = time.time()

    # ─── Kill Switch ─────────────────────────────────────────────────────────

    def is_paused(self) -> bool:
        """Returns True if the daily loss kill switch is active."""
        if self._paused_until and time.time() < self._paused_until:
            remaining = int((self._paused_until - time.time()) / 60)
            logger.warning("🛑 [%s] KILL SWITCH active — %dm remaining", self.bot_name, remaining)
            return True
        self._paused_until = None
        return False

    def record_loss(self, loss_pct: float):
        """
        Track daily realized loss. If threshold exceeded, trigger 24h pause.
        loss_pct: positive decimal (e.g. 0.03 = 3% loss)
        """
        # Reset daily counter at midnight UTC
        now = time.time()
        if now - self._daily_loss_reset_at > 86400:
            self._daily_loss = 0.0
            self._daily_loss_reset_at = now

        self._daily_loss += loss_pct
        if self._daily_loss >= self.max_daily_loss_pct:
            self._paused_until = now + 86400
            logger.error(
                "🛑 [%s] KILL SWITCH triggered! Daily loss %.1f%% >= limit %.1f%%. "
                "Pausing for 24 hours.",
                self.bot_name, self._daily_loss * 100, self.max_daily_loss_pct * 100
            )

    def record_win(self, gain_pct: float):
        """Track gains (reduces effective daily loss)."""
        self._daily_loss = max(0.0, self._daily_loss - gain_pct)

    # ─── Deployment Gate ─────────────────────────────────────────────────────

    def can_deploy(self, symbol: str, open_trades: list) -> Tuple[bool, str]:
        """
        Check if a new trade can be opened.

        Returns:
            (allowed: bool, reason: str)
        """
        if self.is_paused():
            return False, "KILL_SWITCH_ACTIVE"

        # Max open trades cap
        if len(open_trades) >= self.max_open_trades:
            return False, f"MAX_TRADES_REACHED ({len(open_trades)}/{self.max_open_trades})"

        # Prevent re-entering same coin
        open_symbols = {t.get("coin", t.get("symbol", "")) for t in open_trades}
        if symbol in open_symbols:
            return False, f"ALREADY_IN_{symbol}"

        return True, "OK"

    # ─── Position Sizing ─────────────────────────────────────────────────────

    def get_position_size(self, price: float, atr: float) -> float:
        """
        ATR-based position sizing.
        Risk = 2% of capital_per_trade on a 1.5x ATR stop.

        qty = risk_amount / (sl_atr_mult * atr)
        """
        if atr <= 0 or price <= 0:
            return self.capital_per_trade / price if price > 0 else 0.0

        risk_amount = self.capital_per_trade * self.risk_pct_per_trade
        qty = risk_amount / (self.sl_atr_mult * atr)
        return round(qty, 6)

    # ─── SL / TP Calculation ─────────────────────────────────────────────────

    def get_sl_tp(self, entry_price: float, side: str, atr: float) -> Tuple[float, float]:
        """
        ATR-based stop-loss and take-profit.

        BUY:  SL = entry - (sl_mult * atr), TP = entry + (tp_mult * atr)
        SELL: SL = entry + (sl_mult * atr), TP = entry - (tp_mult * atr)
        """
        atr = max(atr, entry_price * 0.005)  # Floor ATR at 0.5% of price

        if side.upper() in ("BUY", "LONG"):
            sl = round(entry_price - self.sl_atr_mult * atr, 6)
            tp = round(entry_price + self.tp_atr_mult * atr, 6)
        else:
            sl = round(entry_price + self.sl_atr_mult * atr, 6)
            tp = round(entry_price - self.tp_atr_mult * atr, 6)

        return sl, tp

    # ─── Summary ─────────────────────────────────────────────────────────────

    def status(self) -> dict:
        return {
            "bot": self.bot_name,
            "paused": self.is_paused(),
            "daily_loss_pct": round(self._daily_loss * 100, 2),
            "max_daily_loss_pct": round(self.max_daily_loss_pct * 100, 2),
            "max_open_trades": self.max_open_trades,
            "leverage": self.leverage,
        }

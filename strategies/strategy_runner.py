"""
strategy_runner.py — Independent Strategy Bot Orchestrator

Runs Pyxis, Axiom, and Ratio as completely separate bot engines on their own cycles.
No HMM. No Athena. No veto gates. Each bot has its own StrategyRiskManager.

Thread model:
    - Launched as a single daemon thread from main.py on startup
    - Internal timer checks every 60s and dispatches each bot at its own frequency
    - Writes trades directly to the shared tradebook + DB

Frequencies:
    Pyxis  — every 60 minutes (1h SMA crossover strategy)
    Axiom  — every 15 minutes (MACD/RSI momentum strategy)
    Ratio  — every 4 hours   (stat-arb cross-asset ranking)
"""
import logging
import time
import threading
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import config
import tradebook
from data_pipeline import fetch_klines
from execution_engine import ExecutionEngine
from signal_validator import get_svs

from strategies.strategy_risk import StrategyRiskManager
from strategies import bot_pyxis, bot_axiom, bot_ratio

logger = logging.getLogger("StrategyRunner")

# ─── Frequencies ─────────────────────────────────────────────────────────────
PYXIS_INTERVAL_S = 3600   # 60 minutes
AXIOM_INTERVAL_S = 900    # 15 minutes
RATIO_INTERVAL_S = 14400  # 4 hours

# ─── Bot Name Keywords (must match SaaS DB bot names) ────────────────────────
PYXIS_KEYWORD = "pyxis"
AXIOM_KEYWORD = "axiom"
RATIO_KEYWORD = "ratio"


class StrategyRunner:
    """
    Orchestrates all 3 independent strategy bots.
    Each bot:
    - Has its own StrategyRiskManager (no shared state)
    - Runs on its own schedule
    - Reads klines independently (via data_pipeline.fetch_klines)
    - Writes trades to tradebook under its own bot_id
    - Has no knowledge of HMM, Athena, or veto gates
    """

    def __init__(self):
        self.executor = ExecutionEngine()
        
        # ── Per-bot Risk Managers ─────────────────────────────────────────────
        # max_open_trades is per-bot-id (already filtered before can_deploy check).
        # With up to 6 active strategies per user, each bot can hold up to 10 simultaneous positions.
        _max_t = getattr(config, "STRATEGY_MAX_TRADES_PER_BOT", 10)
        _cap   = getattr(config, "STRATEGY_BOT_CAPITAL", 100.0)

        self.rm_pyxis = StrategyRiskManager(
            bot_name="Pyxis",
            max_open_trades=_max_t,
            capital_per_trade=_cap,
            leverage=getattr(config, "FIXED_LEVERAGE", 10),
            sl_atr_mult=1.5,
            tp_atr_mult=3.0,
            max_daily_loss_pct=0.08,
        )
        self.rm_axiom = StrategyRiskManager(
            bot_name="Axiom",
            max_open_trades=_max_t,
            capital_per_trade=_cap,
            leverage=getattr(config, "FIXED_LEVERAGE", 10),
            sl_atr_mult=1.2,
            tp_atr_mult=2.5,
            max_daily_loss_pct=0.10,
        )
        self.rm_ratio = StrategyRiskManager(
            bot_name="Ratio",
            max_open_trades=_max_t,
            capital_per_trade=_cap,
            leverage=getattr(config, "FIXED_LEVERAGE", 10),
            sl_atr_mult=2.0,
            tp_atr_mult=4.0,
            max_daily_loss_pct=0.06,
        )

        # ── Execution Engine (shared) ─────────────────────────────────────────
        self._exec = ExecutionEngine()

        # ── Kline caches (per interval) ───────────────────────────────────────
        self._cache_1h: dict = {}
        self._cache_15m: dict = {}
        self._cache_1d: dict = {}

        # ── Timestamps of last run ────────────────────────────────────────────
        self._last_pyxis: float = 0.0
        self._last_axiom: float = 0.0
        self._last_ratio: float = 0.0

        # ── Threading lock for kline cache refresh ────────────────────────────
        self._lock = threading.Lock()

        logger.info("✅ StrategyRunner initialized (Pyxis/Axiom/Ratio)")

    # ─── Kline Helpers ───────────────────────────────────────────────────────

    def _get_all_coins(self) -> list:
        return sorted(set(c for coins in config.CRYPTO_SEGMENTS.values() for c in coins))

    def _refresh_klines(self, interval: str, cache_ref: dict, limit: int = 100):
        """Fetch OHLCV for all coins at a given interval and update cache_ref in-place."""
        coins = self._get_all_coins()
        refreshed = 0
        for sym in coins:
            try:
                klines = fetch_klines(sym, interval=interval, limit=limit)
                if klines is not None and not klines.empty:
                    cache_ref[sym] = klines
                    refreshed += 1
            except Exception as e:
                logger.debug("[StrategyRunner] kline fetch failed %s/%s: %s", sym, interval, e)
        logger.info("[StrategyRunner] Refreshed %d/%d klines for interval=%s", refreshed, len(coins), interval)

    # ─── Current Prices ──────────────────────────────────────────────────────

    def _get_prices(self) -> dict:
        """Extract latest close prices from 15m cache (best proxy for live price)."""
        prices = {}
        for sym, candles in self._cache_15m.items():
            if candles is not None and not candles.empty:
                prices[sym] = float(candles["close"].iloc[-1])
        # Fall back to 1h cache for any missing
        for sym, candles in self._cache_1h.items():
            if sym not in prices and candles is not None and not candles.empty:
                prices[sym] = float(candles["close"].iloc[-1])
        return prices

    # ─── Bot Lookup ──────────────────────────────────────────────────────────

    def _find_bots(self, keyword: str, mode: str) -> list:
        """
        Find bot records from ENGINE_ACTIVE_BOTS matching a keyword and mode.
        Returns list of {bot_id, user_id, bot_name, ...} dicts.
        """
        results = []
        for bot in config.ENGINE_ACTIVE_BOTS:
            name = bot.get("bot_name", "").lower()
            bot_mode = bot.get("mode", "paper").lower()
            if keyword in name and bot_mode == mode:
                results.append(bot)
        return results

    # ─── Trade Deployment ────────────────────────────────────────────────────

    def _deploy_signal(self, signal: dict, bot: dict, rm: StrategyRiskManager, mode: str):
        """
        Attempt to deploy a single signal for a single bot registration.
        """
        sym        = signal["symbol"]
        side       = signal["side"]
        price      = signal.get("price", 0.0)
        atr        = signal.get("atr", price * 0.01)
        conviction = signal.get("conviction", 60)
        strategy   = signal.get("strategy", "Unknown")
        bot_id     = bot.get("bot_id", "")
        user_id    = bot.get("user_id", "")

        if not bot_id or not price:
            return

        # Fetch open trades for this bot matching exact isolation mode
        all_active = tradebook.get_active_trades()
        open_trades = [t for t in all_active if t.get("bot_id") == bot_id and t.get("mode", "paper").lower() == mode.lower()]

        # Risk gate
        can_open, reason = rm.can_deploy(sym, open_trades)
        if not can_open:
            logger.info("🚫 [%s] %s %s blocked: %s", strategy, bot.get("bot_name"), sym, reason)
            return

        # SL / TP from risk manager
        sl, tp = rm.get_sl_tp(price, side, atr)
        
        # Calculate quantity based on this specific user's configured capital
        user_capital = float(bot.get("capital_per_trade", 100.0))
        old_cap = rm.capital_per_trade
        rm.capital_per_trade = user_capital
        qty    = rm.get_position_size(price, atr)
        rm.capital_per_trade = old_cap

        logger.info(
            "🚀 [%s] %s %s | price=%.4f SL=%.4f TP=%.4f qty=%.6f lev=%dx [%s]",
            strategy, side, sym, price, sl, tp, qty, rm.leverage, mode.upper()
        )

        if str(mode).lower() == "live" and config.PAPER_TRADE is False:
            logger.info("⚡ [%s] Executing LIVE execution logic via ExecutionEngine for %s", strategy, sym)
            exec_result = self.executor.execute_trade(
                symbol=sym, side=side,
                quantity=qty, leverage=rm.leverage,
                atr=atr, stop_loss=sl, take_profit=tp
            )
            if not exec_result:
                logger.error("🚫 [%s] LIVE Execution failed for %s. Aborting trade deployment.", strategy, sym)
                return
            
            # Align with actual executed amounts/prices
            price = exec_result.get("entry_price", price)
            qty = exec_result.get("quantity", qty)
            rm_id = exec_result.get("rm_id")
            exchange = exec_result.get("exchange", "coindcx")
            deployed_capital = exec_result.get("capital", user_capital)
        else:
            rm_id = None
            exchange = None
            deployed_capital = user_capital

        # Write to tradebook — aligned with exact open_trade() signature
        try:
            tradebook.open_trade(
                symbol=sym,
                side=side,
                leverage=rm.leverage,
                quantity=qty,
                entry_price=price,
                atr=atr,
                regime=f"STRATEGY:{strategy}",
                confidence=conviction / 100.0,
                reason=f"{strategy} signal",
                capital=deployed_capital,
                mode=mode,
                user_id=user_id,
                bot_id=bot_id,
                bot_name=bot.get("bot_name", strategy),
                override_sl=sl,
                override_tp=tp,
                rm_id=rm_id,
                exchange=exchange,
            )
        except Exception as e:
            logger.error("[%s] tradebook.open_trade failed for %s: %s", strategy, sym, e)
            return


        # Log to signal validator
        try:
            get_svs().log_signal(
                symbol=sym, side=side,
                signal_type=f"{strategy}_SIGNAL",
                segment=strategy,
                conviction=conviction,
                hmm_conf=conviction / 100.0,
                entry_price=price,
                deployed=True,
                gate_vetoed=None,
                cycle=0,
                rsi_1h=50.0,
            )
        except Exception:
            pass

    # ─── Per-Bot Run Methods ─────────────────────────────────────────────────

    def _run_pyxis(self):
        logger.info("⚡ [Pyxis] Starting scan cycle (SMA crossover, 1h)")
        self._refresh_klines("1h", self._cache_1h, limit=120)
        prices = self._get_prices()
        signals = bot_pyxis.get_signals(self._cache_1h, prices)

        for mode in ("paper", "live"):
            bots = self._find_bots(PYXIS_KEYWORD, mode)
            for signal in signals:
                for bot in bots:
                    self._deploy_signal(signal, bot, self.rm_pyxis, mode)

        logger.info("✅ [Pyxis] Cycle complete — %d signals processed", len(signals))

    def _run_axiom(self):
        logger.info("⚡ [Axiom] Starting scan cycle (MACD/RSI/BB momentum, 15m)")
        self._refresh_klines("15m", self._cache_15m, limit=80)
        prices = self._get_prices()
        signals = bot_axiom.get_signals(self._cache_15m, prices)

        for mode in ("paper", "live"):
            bots = self._find_bots(AXIOM_KEYWORD, mode)
            for signal in signals:
                for bot in bots:
                    self._deploy_signal(signal, bot, self.rm_axiom, mode)

        logger.info("✅ [Axiom] Cycle complete — %d signals processed", len(signals))

    def _run_ratio(self):
        logger.info("⚡ [Ratio] Starting scan cycle (stat-arb ranking, 1d)")
        self._refresh_klines("1d", self._cache_1d, limit=120)
        prices = self._get_prices()
        signals = bot_ratio.get_signals(self._cache_1d, prices)

        for mode in ("paper", "live"):
            bots = self._find_bots(RATIO_KEYWORD, mode)
            for signal in signals:
                for bot in bots:
                    self._deploy_signal(signal, bot, self.rm_ratio, mode)

        logger.info("✅ [Ratio] Cycle complete — %d signals processed", len(signals))

    # ─── Main Loop ───────────────────────────────────────────────────────────

    def run_forever(self):
        """
        Daemon loop. Runs until the process dies.
        Checks every 60 seconds whether each bot is due to run.
        """
        logger.info("🤖 StrategyRunner daemon started")
        logger.info("  Pyxis  → every %d min", PYXIS_INTERVAL_S // 60)
        logger.info("  Axiom  → every %d min", AXIOM_INTERVAL_S // 60)
        logger.info("  Ratio  → every %d min", RATIO_INTERVAL_S // 60)

        while True:
            try:
                now = time.time()

                if now - self._last_axiom >= AXIOM_INTERVAL_S:
                    self._run_axiom()
                    self._last_axiom = time.time()

                if now - self._last_pyxis >= PYXIS_INTERVAL_S:
                    self._run_pyxis()
                    self._last_pyxis = time.time()

                if now - self._last_ratio >= RATIO_INTERVAL_S:
                    self._run_ratio()
                    self._last_ratio = time.time()

            except Exception as e:
                logger.exception("StrategyRunner loop error: %s", e)

            time.sleep(60)  # Check every 60 seconds

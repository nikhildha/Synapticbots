import json
import logging
import os
import time
from datetime import datetime, timezone, timedelta

import config
import telegram as tg

logger = logging.getLogger("StateManager")
IST = timezone(timedelta(hours=5, minutes=30))

class StateManager:
    def __init__(self, engine):
        self.engine = engine
        self._redis = engine._redis

    def save_multi_state(self, symbols_scanned, eligible, deployed_count):
        """Save multi-coin bot state for the dashboard and Redis pipeline."""
        # Save legacy single-coin state (backward compat)
        top_coin = self.engine._coin_states.get(config.PRIMARY_SYMBOL, {})
        legacy_state = {
            "timestamp":    datetime.now(IST).replace(tzinfo=None).isoformat(),
            "symbol":       config.PRIMARY_SYMBOL,
            "regime":       top_coin.get("regime", "SCANNING"),
            "confidence":   top_coin.get("confidence", 0),
            "action":       top_coin.get("action", "MULTI_SCAN"),
            "trade_count":  self.engine._trade_count,
            "paper_mode":   config.PAPER_TRADE,
        }
        try:
            with open(config.STATE_FILE, "w") as f:
                json.dump(legacy_state, f, indent=2)
                
            if self._redis:
                self._redis.set("synaptic:legacy_state", json.dumps(legacy_state))
        except Exception as e:
            try:
                logger.debug('Exception caught: %s', e, exc_info=True)
            except NameError:
                pass
            pass

        # Multi-coin state
        now_utc = datetime.utcnow()
        next_analysis = datetime.utcfromtimestamp(
            self.engine._last_analysis_time + config.ANALYSIS_INTERVAL_SECONDS
        ) if self.engine._last_analysis_time else None

        multi_state = {
            "timestamp":        datetime.now(IST).replace(tzinfo=None).isoformat(),
            "cycle":            self.engine._cycle_count,
            "coins_scanned":    len(symbols_scanned),
            "eligible_count":   len(eligible),
            "deployed_count":   deployed_count,
            "total_trades":     self.engine._trade_count,
            "active_positions": self.engine._active_positions,
            "max_concurrent_positions": config.MAX_CONCURRENT_POSITIONS,
            "coin_states":      self.engine._coin_states,
            "orderflow_stats":  self.get_orderflow_stats(),
            "paper_mode":       config.PAPER_TRADE,
            "cycle_execution_time_seconds": getattr(self.engine, '_last_cycle_duration', 0),
            "analysis_interval_seconds": config.ANALYSIS_INTERVAL_SECONDS,
            "last_analysis_time": now_utc.isoformat() + "Z",
            "next_analysis_time": (next_analysis.isoformat() + "Z") if next_analysis else None,
            "active_bots":  [{"bot_id": b.get("bot_id"), "bot_name": b.get("bot_name"),
                              "segment": b.get("segment_filter", "ALL")}
                             for b in list(config.ENGINE_ACTIVE_BOTS)],
            "veto_log":              list(reversed(self.engine._veto_log[-20:])),
            "pending_signals_count": len(self.engine._pending_signals),
            "pending_signals_detail": [
                {
                    "symbol":         sym,
                    "queue_reason":   entry.get("queue_reason", "unknown"),
                    "cycles_pending": entry.get("cycles_pending", 1),
                    "conviction":     entry.get("result", {}).get("conviction", 0),
                    "side":           entry.get("result", {}).get("side", ""),
                    "expires_in_sec": max(0, round(entry.get("expires_at", 0) - time.time())),
                }
                for sym, entry in self.engine._pending_signals.items()
            ],
            "systematic_pool": getattr(self.engine, "_systematic_pool", [])
        }
        try:
            with open(config.MULTI_STATE_FILE, "w") as f:
                json.dump(multi_state, f, indent=2)
            
            if self._redis:
                self._redis.set("synaptic:multi_bot_state", json.dumps(multi_state))
                
        except Exception as e:
            logger.error("Failed to save multi state: %s", e)

    def get_orderflow_stats(self) -> dict:
        """Aggregate orderflow features from all scanned coins."""
        stats = {
            "imbalance_bullish": 0,
            "imbalance_bearish": 0,
            "cvd_bullish": 0,
            "cvd_bearish": 0,
        }
        try:
            for st in self.engine._coin_states.values():
                of = st.get("orderflow", {})
                if not of: continue
                
                imb = of.get("imbalance", 0)
                if imb >= 1.5: stats["imbalance_bullish"] += 1
                elif imb <= 0.5: stats["imbalance_bearish"] += 1
                
                cvd = of.get("cvd_divergence", "none")
                if cvd == "bullish": stats["cvd_bullish"] += 1
                elif cvd == "bearish": stats["cvd_bearish"] += 1
        except Exception as e:
            logger.warning("Error calculating orderflow stats: %s", e)
        return stats

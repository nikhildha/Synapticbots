import logging
from datetime import datetime, timedelta
import dateutil.parser as _dp
import config
from segment_features import get_segment_for_coin

logger = logging.getLogger("RiskManager")

class RiskManager:
    def __init__(self, engine):
        self.engine = engine

    def apply_cooldown(self, sym: str, trade: dict) -> None:
        if not getattr(config, "COOLDOWN_ENABLED", True):
            return

        now = datetime.utcnow()
        exit_reason   = (trade.get("exit_reason") or "").upper()
        realized_pnl  = float(trade.get("realized_pnl_pct") or trade.get("pnl_pct") or 0)
        side          = (trade.get("position") or trade.get("side") or "").upper()

        opened_at = trade.get("entry_time") or trade.get("created_at") or trade.get("open_time")
        hold_mins = 9999
        if opened_at:
            try:
                if isinstance(opened_at, str):
                    opened_dt = _dp.parse(opened_at.replace("Z", "+00:00")).replace(tzinfo=None)
                else:
                    opened_dt = opened_at
                hold_mins = (now - opened_dt).total_seconds() / 60
            except Exception:
                pass

        cooldown_mins = 0
        rule_label    = ""

        flash_thresh = getattr(config, "COOLDOWN_FLASH_HOLD_THRESH", 15)
        if realized_pnl < 0 and hold_mins < flash_thresh:
            cooldown_mins = getattr(config, "COOLDOWN_FLASH_CLOSE_MIN", 120)
            rule_label    = f"Rule3:FlashClose({hold_mins:.0f}min hold)"

        elif exit_reason in ("STOP_LOSS", "TRAILING_SL", "MAX_LOSS"):
            cooldown_mins = getattr(config, "COOLDOWN_SL_MINUTES", 90)
            rule_label    = f"Rule1:{exit_reason}"

        elif realized_pnl < 0:
            cooldown_mins = getattr(config, "COOLDOWN_LOSS_MINUTES", 45)
            rule_label    = "Rule2:LossClose"

        same_dir_mins = getattr(config, "COOLDOWN_SAME_DIR_MINUTES", 30)
        if side and self.engine._coin_last_side.get(sym) == side:
            if cooldown_mins < same_dir_mins:
                cooldown_mins = same_dir_mins
                rule_label    = rule_label or "Rule4:SameDirRepeat"

        self.engine._coin_daily_trades.setdefault(sym, []).append(now)
        cutoff = now - timedelta(hours=24)
        self.engine._coin_daily_trades[sym] = [t for t in self.engine._coin_daily_trades[sym] if t >= cutoff]

        daily_cap = getattr(config, "COOLDOWN_DAILY_CAP_TRADES", 3)
        if len(self.engine._coin_daily_trades[sym]) >= daily_cap:
            midnight = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
            mins_to_midnight = (midnight - now).total_seconds() / 60
            if mins_to_midnight > cooldown_mins:
                cooldown_mins = mins_to_midnight
                rule_label    = "Rule5:DailyCap"

        if side:
            self.engine._coin_last_side[sym] = side

        if cooldown_mins > 0:
            expiry = now + timedelta(minutes=cooldown_mins)
            self.engine._coin_cooldowns[sym] = expiry
            logger.info(
                "⏳ COOLDOWN [%s] for %.0f min until %s UTC (%s, PnL=%.1f%%, hold=%.0fm)",
                sym, cooldown_mins, expiry.strftime("%H:%M"), rule_label, realized_pnl, hold_mins
            )
            self.engine._coin_states.setdefault(sym, {})["cooldown_until"] = expiry.isoformat() + "Z"
            self.engine._coin_states[sym]["cooldown_rule"] = rule_label

    def is_in_cooldown(self, sym: str) -> tuple[bool, str]:
        if not getattr(config, "COOLDOWN_ENABLED", True):
            return False, ""
        expiry = self.engine._coin_cooldowns.get(sym)
        if expiry is None:
            return False, ""
        now = datetime.utcnow()
        if now < expiry:
            remaining = (expiry - now).total_seconds() / 60
            return True, f"cooldown {remaining:.0f}m (until {expiry.strftime('%H:%M')} UTC)"
        del self.engine._coin_cooldowns[sym]
        self.engine._coin_states.get(sym, {}).pop("cooldown_until", None)
        self.engine._coin_states.get(sym, {}).pop("cooldown_rule", None)
        return False, ""

    def apply_segment_cooldown(self, seg: str, trade: dict) -> None:
        if not seg or not getattr(config, "SEG_COOLDOWN_ENABLED", True):
            return

        user_id = trade.get("user_id", getattr(config, "ENGINE_USER_ID", "default"))
        seg_key = (user_id, seg)

        now = datetime.utcnow()
        exit_reason  = (trade.get("exit_reason") or "").upper()
        realized_pnl = float(trade.get("realized_pnl_pct") or trade.get("pnl_pct") or 0)
        is_loss      = realized_pnl < 0
        is_sl        = exit_reason in ("STOP_LOSS", "TRAILING_SL", "MAX_LOSS")
        is_tp        = exit_reason in ("TAKE_PROFIT", "TP")

        if is_sl:
            self.engine._seg_sl_events.setdefault(seg_key, []).append(now)

        self.engine._seg_close_history.setdefault(seg_key, []).append((now, realized_pnl))

        if is_loss and not is_tp:
            self.engine._seg_consec_losses[seg_key] = self.engine._seg_consec_losses.get(seg_key, 0) + 1
        elif not is_loss:
            self.engine._seg_consec_losses[seg_key] = 0

        cooldown_mins = 0
        rule_label    = ""

        burst_window = getattr(config, "SEG_COOLDOWN_SL_BURST_WINDOW", 60)
        burst_count  = getattr(config, "SEG_COOLDOWN_SL_BURST_COUNT", 2)
        cutoff_r1    = now - timedelta(minutes=burst_window)
        self.engine._seg_sl_events[seg_key] = [t for t in self.engine._seg_sl_events.get(seg_key, []) if t >= cutoff_r1]
        if len(self.engine._seg_sl_events.get(seg_key, [])) >= burst_count:
            r1_mins = getattr(config, "SEG_COOLDOWN_SL_BURST_MINS", 90)
            if r1_mins > cooldown_mins:
                cooldown_mins = r1_mins
                rule_label    = f"SegRule1:SL_Burst({len(self.engine._seg_sl_events[seg_key])}x in {burst_window}m)"

        cutoff_r2 = now - timedelta(hours=4)
        recent_closes = [(t, pnl) for t, pnl in self.engine._seg_close_history.get(seg_key, []) if t >= cutoff_r2]
        if len(recent_closes) >= 3:
            loss_count = sum(1 for _, pnl in recent_closes if pnl < 0)
            loss_pct   = (loss_count / len(recent_closes)) * 100
            threshold  = getattr(config, "SEG_COOLDOWN_LOSS_RATE_PCT", 60)
            if loss_pct >= threshold:
                r2_mins = getattr(config, "SEG_COOLDOWN_LOSS_RATE_MINS", 120)
                if r2_mins > cooldown_mins:
                    cooldown_mins = r2_mins
                    rule_label    = f"SegRule2:LossRate({loss_pct:.0f}%>{threshold}%)"

        consec_thresh = getattr(config, "SEG_COOLDOWN_CONSEC_LOSS", 3)
        if self.engine._seg_consec_losses.get(seg_key, 0) >= consec_thresh:
            r5_mins = getattr(config, "SEG_COOLDOWN_CONSEC_LOSS_MINS", 240)
            if r5_mins > cooldown_mins:
                cooldown_mins = r5_mins
                rule_label    = f"SegRule5:ConsecLoss({self.engine._seg_consec_losses[seg_key]}x)"

        prune_cutoff = now - timedelta(hours=24)
        self.engine._seg_close_history[seg_key] = [(t, p) for t, p in self.engine._seg_close_history.get(seg_key, []) if t >= prune_cutoff]

        if cooldown_mins > 0:
            expiry = now + timedelta(minutes=cooldown_mins)
            existing = self.engine._seg_cooldowns.get(seg_key)
            if existing is None or expiry > existing:
                self.engine._seg_cooldowns[seg_key] = expiry
                logger.info(
                    "🔒 SEGMENT_COOLDOWN [%s] for %.0f min until %s UTC (%s, PnL=%.1f%%)",
                    seg, cooldown_mins, expiry.strftime("%H:%M"), rule_label, realized_pnl
                )

    def is_segment_in_cooldown(self, seg: str, user_id: str = None) -> tuple:
        if not seg or not getattr(config, "SEG_COOLDOWN_ENABLED", True):
            return False, ""
            
        user_id = user_id or getattr(config, "ENGINE_USER_ID", "default")
        seg_key = (user_id, seg)

        max_active = getattr(config, "SEG_COOLDOWN_MAX_ACTIVE", 3)
        active_in_seg = sum(
            1 for key, pos in self.engine._active_positions.items()
            if get_segment_for_coin(key.split(":")[-1] if ":" in key else key) == seg
            and pos.get("user_id") == user_id
        )
        if active_in_seg >= max_active:
            return True, f"SegRule3:MaxActive({active_in_seg}/{max_active})"

        churn_window = getattr(config, "SEG_COOLDOWN_CHURN_WINDOW", 360)
        churn_count  = getattr(config, "SEG_COOLDOWN_CHURN_COUNT", 4)
        now = datetime.utcnow()
        cutoff_r4 = now - timedelta(minutes=churn_window)
        self.engine._seg_open_count[seg_key] = [t for t in self.engine._seg_open_count.get(seg_key, []) if t >= cutoff_r4]
        if len(self.engine._seg_open_count.get(seg_key, [])) >= churn_count:
            churn_mins = getattr(config, "SEG_COOLDOWN_CHURN_MINS", 180)
            expiry = now + timedelta(minutes=churn_mins)
            existing = self.engine._seg_cooldowns.get(seg_key)
            if existing is None or expiry > existing:
                self.engine._seg_cooldowns[seg_key] = expiry
                logger.info(
                    "🔒 SEGMENT_COOLDOWN [%s] Rule4:Churn (%d opens in %dm) → %dm block",
                    seg_key, len(self.engine._seg_open_count[seg_key]), churn_window, churn_mins
                )

        expiry = self.engine._seg_cooldowns.get(seg_key)
        if expiry is None:
            return False, ""
        if now < expiry:
            remaining = (expiry - now).total_seconds() / 60
            return True, f"segment_cooldown {remaining:.0f}m (until {expiry.strftime('%H:%M')} UTC)"
        del self.engine._seg_cooldowns[seg_key]
        return False, ""

    def record_segment_open(self, seg: str, user_id: str = None) -> None:
        if seg and getattr(config, "SEG_COOLDOWN_ENABLED", True):
            user_id = user_id or getattr(config, "ENGINE_USER_ID", "default")
            seg_key = (user_id, seg)
            self.engine._seg_open_count.setdefault(seg_key, []).append(datetime.utcnow())

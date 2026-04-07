"""
Signal Validation System (SVS)
================================
Forward-tests every signal the engine emits — both deployed trades and
signals that were vetoed by a gate — to continuously measure:

  1. Deployed accuracy       — what % of deployed signals moved in the right direction
  2. Per-gate veto accuracy  — when gate X vetoed, was it right? (price went wrong way)
  3. Per-segment accuracy    — which segments produce the cleanest signals
  4. Per-signal-type WR      — TREND_FOLLOW vs REVERSAL_PULLBACK quality

Data flow:
  main.py → svs.log_signal(...)      # called at each waterfall decision
  main.py heartbeat → svs.evaluate_pending()   # checks price after eval_hours
  engine_api.py →  svs.get_report()  # served via /api/signal-validation

Files:
  data/signal_validation.jsonl        — one line per signal (append-only)
  data/signal_validation_report.json  — rolling accuracy report (rewritten each eval)
"""

import json
import logging
import os
import time
from datetime import datetime, timezone, timedelta
from typing import Optional

logger = logging.getLogger("SignalValidator")

# ─── Eval windows per signal type ───────────────────────────────────────────
# REVERSAL setups resolve faster — counter-trend moves fail quickly.
# TREND_FOLLOW setups need more time to develop.
EVAL_HOURS = {
    "REVERSAL_PULLBACK": 2,
    "TREND_FOLLOW":      6,
    "default":           4,
}

# ─── Gate labels (used as keys in gate attribution stats) ───────────────────
GATE_LABELS = [
    "BTC_CHOP",
    "MOMENTUM_VETO",
    "RSI_EXTENDED",
    "LOW_CONVICTION",
    "ATHENA_VETO",
    "MAX_OPEN_TRADES",
    "SEGMENT_COOLDOWN",
    "DEPLOYED",        # not a veto — signal was executed
    "OTHER",
]

# ─── Path config ─────────────────────────────────────────────────────────────
try:
    import config as _cfg
    _DATA_DIR = _cfg.DATA_DIR
except Exception:
    _DATA_DIR = os.path.join(os.path.dirname(__file__), "data")

SVS_LOG_FILE    = os.path.join(_DATA_DIR, "signal_validation.jsonl")
SVS_REPORT_FILE = os.path.join(_DATA_DIR, "signal_validation_report.json")


class SignalValidator:
    """
    Live forward-test oracle for every signal the engine emits.

    Usage
    -----
    svs = SignalValidator()

    # At each waterfall decision:
    svs.log_signal(
        symbol="ETHUSDT", side="BUY", signal_type="TREND_FOLLOW",
        segment="L1", conviction=72.5, hmm_conf=0.31,
        entry_price=1820.50, deployed=True, gate_vetoed=None,
    )

    # In heartbeat (every cycle):
    svs.evaluate_pending()

    # From API:
    report = svs.get_report()
    """

    def __init__(self):
        os.makedirs(_DATA_DIR, exist_ok=True)
        self._pending: list[dict] = []   # in-memory pending signals awaiting eval
        self._load_pending()

    # ─── Public API ──────────────────────────────────────────────────────────

    def log_signal(
        self,
        symbol: str,
        side: str,
        signal_type: str,
        segment: str,
        conviction: float,
        hmm_conf: float,
        entry_price: float,
        deployed: bool,
        gate_vetoed: Optional[str],
        cycle: int = 0,
        rsi_1h: float = 50.0,
    ) -> None:
        """Record a signal for forward evaluation."""
        if not entry_price or entry_price <= 0:
            return  # can't evaluate without a price

        _eval_hours = EVAL_HOURS.get(signal_type, EVAL_HOURS["default"])
        signal_id = f"{symbol}_{int(time.time())}_{side[:1]}"

        record = {
            "signal_id":         signal_id,
            "symbol":            symbol,
            "side":              side,
            "signal_type":       signal_type,
            "segment":           segment,
            "conviction":        round(conviction, 1),
            "hmm_conf":          round(hmm_conf, 4),
            "rsi_1h":            round(rsi_1h, 1),
            "entry_price":       entry_price,
            "signal_ts":         datetime.now(timezone.utc).isoformat(),
            "cycle":             cycle,
            "deployed":          deployed,
            "gate_vetoed":       gate_vetoed,
            "eval_hours":        _eval_hours,
            "eval_ts":           None,
            "eval_price":        None,
            "outcome":           None,
            "direction_correct": None,
            "pnl_if_taken":      None,
        }

        # Append to JSONL log
        try:
            with open(SVS_LOG_FILE, "a", encoding="utf-8") as f:
                f.write(json.dumps(record) + "\n")
        except Exception as e:
            logger.debug("SVS log write failed: %s", e)

        # Track pending for evaluation (in-memory only — reloaded on restart)
        self._pending.append(record)
        logger.debug("📡 SVS logged [%s] %s %s (gate=%s deployed=%s)",
                     signal_id, symbol, side, gate_vetoed, deployed)

    def evaluate_pending(self) -> int:
        """
        Check all pending signals whose eval window has elapsed.
        Fetches price and scores each one. Returns count evaluated.
        """
        if not self._pending:
            return 0

        now = datetime.now(timezone.utc)
        evaluated = []
        still_pending = []

        for sig in self._pending:
            try:
                sig_ts = datetime.fromisoformat(sig["signal_ts"])
                if sig_ts.tzinfo is None:
                    sig_ts = sig_ts.replace(tzinfo=timezone.utc)
                due_at = sig_ts + timedelta(hours=sig["eval_hours"])
                if now < due_at:
                    still_pending.append(sig)
                    continue
                # Time to evaluate
                price = self._fetch_price(sig["symbol"])
                if not price:
                    still_pending.append(sig)  # retry next cycle
                    continue
                sig = self._score_signal(sig, price)
                evaluated.append(sig)
                self._update_record(sig)
            except Exception as e:
                logger.debug("SVS eval error for %s: %s", sig.get("signal_id"), e)
                still_pending.append(sig)

        self._pending = still_pending

        if evaluated:
            logger.info("📊 SVS evaluated %d signal(s)", len(evaluated))
            self._rebuild_report()

        return len(evaluated)

    def get_report(self) -> dict:
        """Return the latest rolling accuracy report."""
        try:
            if os.path.exists(SVS_REPORT_FILE):
                with open(SVS_REPORT_FILE, "r") as f:
                    return json.load(f)
        except Exception:
            pass
        return {"status": "no_data", "message": "Signal Validation System: no evaluations yet"}

    def get_recent_signals(self, limit: int = 50) -> list:
        """Return the most recent N signals from the JSONL log (evaluated + pending)."""
        lines = []
        try:
            if os.path.exists(SVS_LOG_FILE):
                with open(SVS_LOG_FILE, "r", encoding="utf-8") as f:
                    lines = f.readlines()
        except Exception:
            pass
        records = []
        for line in reversed(lines[-limit*2:]):
            try:
                records.append(json.loads(line))
            except Exception:
                pass
        return records[:limit]

    # ─── Internal ────────────────────────────────────────────────────────────

    def _fetch_price(self, symbol: str) -> Optional[float]:
        """Fetch current price from Binance REST (lightweight, no auth)."""
        try:
            import urllib.request
            url = f"https://api.binance.com/api/v3/ticker/price?symbol={symbol}"
            with urllib.request.urlopen(url, timeout=3) as resp:
                data = json.loads(resp.read())
            return float(data["price"])
        except Exception:
            return None

    def _score_signal(self, sig: dict, current_price: float) -> dict:
        """Compute direction_correct, pnl_if_taken, and outcome."""
        entry = sig["entry_price"]
        side  = sig["side"].upper()
        lev   = 10.0  # all trades now flat 10x

        direction_correct = (
            (side in ("BUY", "LONG")  and current_price > entry) or
            (side in ("SELL", "SHORT") and current_price < entry)
        )

        price_move_pct = (current_price - entry) / entry
        if side in ("SELL", "SHORT"):
            price_move_pct = -price_move_pct
        pnl_if_taken = round(price_move_pct * lev * 100, 2)

        if pnl_if_taken >= 5.0:
            outcome = "WIN"
        elif pnl_if_taken <= -5.0:
            outcome = "LOSS"
        else:
            outcome = "BREAKEVEN"

        sig = dict(sig)  # don't mutate original
        sig["eval_ts"]           = datetime.now(timezone.utc).isoformat()
        sig["eval_price"]        = round(current_price, 6)
        sig["direction_correct"] = direction_correct
        sig["pnl_if_taken"]      = pnl_if_taken
        sig["outcome"]           = outcome
        return sig

    def _update_record(self, sig: dict) -> None:
        """Rewrite the matching JSONL record with evaluation results."""
        if not os.path.exists(SVS_LOG_FILE):
            return
        try:
            with open(SVS_LOG_FILE, "r", encoding="utf-8") as f:
                lines = f.readlines()
            updated = []
            for line in lines:
                try:
                    rec = json.loads(line)
                    if rec.get("signal_id") == sig["signal_id"]:
                        updated.append(json.dumps(sig) + "\n")
                    else:
                        updated.append(line)
                except Exception:
                    updated.append(line)
            with open(SVS_LOG_FILE, "w", encoding="utf-8") as f:
                f.writelines(updated)
        except Exception as e:
            logger.debug("SVS record update failed: %s", e)

    def _load_pending(self) -> None:
        """On startup, reload unevaluated signals from JSONL."""
        if not os.path.exists(SVS_LOG_FILE):
            return
        try:
            with open(SVS_LOG_FILE, "r", encoding="utf-8") as f:
                lines = f.readlines()
            cutoff = datetime.now(timezone.utc) - timedelta(hours=48)
            for line in lines:
                try:
                    rec = json.loads(line.strip())
                    if rec.get("outcome") is None:
                        ts = datetime.fromisoformat(rec["signal_ts"])
                        if ts.tzinfo is None:
                            ts = ts.replace(tzinfo=timezone.utc)
                        if ts > cutoff:
                            self._pending.append(rec)
                except Exception:
                    pass
            logger.info("📡 SVS: loaded %d pending signals for evaluation", len(self._pending))
        except Exception as e:
            logger.warning("SVS load_pending failed: %s", e)

    def _rebuild_report(self) -> None:
        """Rebuild the rolling accuracy report from the full JSONL log."""
        records = []
        try:
            if not os.path.exists(SVS_LOG_FILE):
                return
            with open(SVS_LOG_FILE, "r", encoding="utf-8") as f:
                for line in f:
                    try:
                        r = json.loads(line.strip())
                        if r.get("outcome") is not None:  # only evaluated records
                            records.append(r)
                    except Exception:
                        pass
        except Exception as e:
            logger.debug("SVS report rebuild failed: %s", e)
            return

        if not records:
            return

        total = len(records)
        deployed  = [r for r in records if r.get("deployed")]
        vetoed    = [r for r in records if not r.get("deployed")]

        def _wr(recs):
            correct = [r for r in recs if r.get("direction_correct")]
            return round(len(correct) / len(recs), 3) if recs else None

        def _avg_pnl(recs):
            pnls = [r["pnl_if_taken"] for r in recs if r.get("pnl_if_taken") is not None]
            return round(sum(pnls) / len(pnls), 2) if pnls else None

        # Per-gate accuracy
        gate_stats = {}
        for gate in GATE_LABELS:
            gate_recs = [r for r in vetoed if r.get("gate_vetoed") == gate]
            if gate_recs:
                # A VETO was "correct" if the signal would have been a LOSS
                veto_correct = [r for r in gate_recs if not r.get("direction_correct")]
                gate_stats[gate] = {
                    "count":            len(gate_recs),
                    "veto_was_correct": round(len(veto_correct) / len(gate_recs), 3),
                    "avg_pnl_avoided":  _avg_pnl(gate_recs),
                }

        # Per-segment accuracy
        segments = list({r.get("segment", "UNKNOWN") for r in records})
        seg_stats = {}
        for seg in segments:
            seg_recs  = [r for r in records if r.get("segment") == seg]
            seg_dep   = [r for r in seg_recs if r.get("deployed")]
            seg_stats[seg] = {
                "total":        len(seg_recs),
                "deployed":     len(seg_dep),
                "deployed_wr":  _wr(seg_dep),
                "all_signal_wr": _wr(seg_recs),
                "avg_pnl":      _avg_pnl(seg_dep),
            }

        # Per signal-type accuracy
        sig_types = list({r.get("signal_type", "UNKNOWN") for r in records})
        type_stats = {}
        for st in sig_types:
            st_recs = [r for r in records if r.get("signal_type") == st]
            st_dep  = [r for r in st_recs if r.get("deployed")]
            type_stats[st] = {
                "total":        len(st_recs),
                "deployed_wr":  _wr(st_dep),
                "all_wr":       _wr(st_recs),
                "avg_pnl":      _avg_pnl(st_dep),
            }

        # Vetoed signals that would have been WINS (missed profit)
        veto_was_wrong = [r for r in vetoed if r.get("direction_correct")]

        report = {
            "updated_at":           datetime.now(timezone.utc).isoformat(),
            "total_evaluated":      total,
            "deployed_count":       len(deployed),
            "vetoed_count":         len(vetoed),
            "deployed_accuracy":    _wr(deployed),
            "deployed_avg_pnl":     _avg_pnl(deployed),
            "vetoed_accuracy":      round(len([r for r in vetoed if not r.get("direction_correct")]) / len(vetoed), 3) if vetoed else None,
            "missed_profit_count":  len(veto_was_wrong),
            "missed_avg_pnl":       _avg_pnl(veto_was_wrong),
            "by_gate":              gate_stats,
            "by_segment":           seg_stats,
            "by_signal_type":       type_stats,
        }

        try:
            with open(SVS_REPORT_FILE, "w", encoding="utf-8") as f:
                json.dump(report, f, indent=2)
            logger.info(
                "📊 SVS report rebuilt: deployed_wr=%.1f%% vetoed_wr=%.1f%% (N=%d)",
                (report["deployed_accuracy"] or 0) * 100,
                (report["vetoed_accuracy"] or 0) * 100,
                total,
            )
        except Exception as e:
            logger.debug("SVS report write failed: %s", e)


# ─── Module-level singleton ───────────────────────────────────────────────────
_svs_instance: Optional[SignalValidator] = None

def get_svs() -> SignalValidator:
    """Return the module-level SVS singleton (create on first call)."""
    global _svs_instance
    if _svs_instance is None:
        _svs_instance = SignalValidator()
    return _svs_instance

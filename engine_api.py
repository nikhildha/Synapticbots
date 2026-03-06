"""
Engine API v2.1 — Lightweight Flask server that wraps main.py.
Runs the trading bot in a background thread and exposes REST endpoints
for the Next.js dashboard to consume.

Endpoints:
  GET  /api/all          — returns multi_bot_state, tradebook, engine_state
  GET  /api/health       — engine status, uptime, cycle info
  POST /api/close-trade  — write close command for a specific trade
  POST /api/close-all    — close all open positions
  POST /api/reset-trades — clear tradebook (both JSON + in-memory)
"""
import json
import os
import sys
import time
import logging
import threading
from datetime import datetime, timezone, timedelta

from flask import Flask, jsonify, request

# Ensure project root is importable
sys.path.insert(0, os.path.dirname(__file__))

import config

app = Flask(__name__)
IST = timezone(timedelta(hours=5, minutes=30))

# ─── Globals ──────────────────────────────────────────────────────────
_engine_thread = None
_engine_start_time = None
_engine_bot = None

logger = logging.getLogger("EngineAPI")


# ─── Helper: read JSON file safely ───────────────────────────────────
def _read_json(filename, default=None):
    path = os.path.join(config.DATA_DIR, filename)
    try:
        if os.path.exists(path):
            with open(path, "r") as f:
                return json.load(f)
    except (json.JSONDecodeError, IOError) as e:
        logger.warning("Failed to read %s: %s", filename, e)
    return default if default is not None else {}


# ─── API Routes ───────────────────────────────────────────────────────

@app.route("/api/all", methods=["GET"])
def api_all():
    """Return all engine state for the dashboard."""
    multi = _read_json("multi_bot_state.json", {
        "coin_states": {},
        "last_analysis_time": None,
    })
    tradebook = _read_json("tradebook.json", {"trades": [], "summary": {}})
    # ── Safeguard: auto-fix stale summary if trades array is empty ──
    tb_trades = tradebook.get("trades", [])
    tb_summary = tradebook.get("summary", {})
    if len(tb_trades) == 0 and tb_summary.get("active_trades", 0) > 0:
        logger.warning("Stale summary detected: trades=[] but active_trades=%d. Auto-fixing.",
                       tb_summary.get("active_trades", 0))
        import tradebook as tb
        book = tb._load_book()
        book["trades"] = []
        tb._compute_summary(book)
        tb._save_book(book)
        tradebook = book
    engine = _read_json("engine_state.json", {"status": "running"})

    return jsonify({
        "multi": multi,
        "tradebook": tradebook,
        "engine": engine,
    })


@app.route("/api/health", methods=["GET"])
def api_health():
    """Engine health check with uptime and status."""
    global _engine_thread, _engine_start_time, _engine_bot

    is_alive = _engine_thread is not None and _engine_thread.is_alive()
    uptime_seconds = 0
    if _engine_start_time and is_alive:
        uptime_seconds = int(time.time() - _engine_start_time)

    # Read cycle info from engine state
    engine_state = _read_json("engine_state.json", {})
    multi_state = _read_json("multi_bot_state.json", {})

    return jsonify({
        "status": "running" if is_alive else "stopped",
        "uptime_seconds": uptime_seconds,
        "uptime_human": _fmt_uptime(uptime_seconds) if is_alive else "—",
        "cycle_count": engine_state.get("cycle_count", 0),
        "last_analysis": multi_state.get("last_analysis_time"),
        "coins_scanned": len(multi_state.get("coin_states", {})),
        "deployed_count": multi_state.get("deployed_count", 0),
        "loop_interval": config.LOOP_INTERVAL_SECONDS,
        "top_coins_limit": config.TOP_COINS_LIMIT,
        "hmm_states": config.HMM_N_STATES,
    })


@app.route("/api/close-trade", methods=["POST"])
def api_close_trade():
    """Directly close a trade in the tradebook."""
    import tradebook as tb

    data = request.get_json() or {}
    trade_id = data.get("trade_id")
    symbol = data.get("symbol")
    reason = data.get("reason", "MANUAL_CLOSE")

    if not trade_id and not symbol:
        return jsonify({"error": "trade_id or symbol required"}), 400

    try:
        result = tb.close_trade(trade_id=trade_id, symbol=symbol, reason=reason)
        if result is None:
            return jsonify({"error": "No matching active trade found"}), 404

        # Normalize to list
        closed = result if isinstance(result, list) else [result]
        return jsonify({
            "success": True,
            "closed": [{
                "trade_id": t.get("trade_id"),
                "symbol": t.get("symbol"),
                "exit_price": t.get("exit_price"),
                "realized_pnl": t.get("realized_pnl"),
                "realized_pnl_pct": t.get("realized_pnl_pct"),
            } for t in closed],
        })
    except Exception as e:
        logger.error("Close trade error: %s", e)
        return jsonify({"error": str(e)}), 500


@app.route("/api/close-all", methods=["POST"])
def api_close_all():
    """Write a CLOSE_ALL command so main.py closes all open positions on next cycle."""
    import json
    from datetime import datetime
    try:
        cmd = {"command": "CLOSE_ALL", "timestamp": datetime.utcnow().isoformat()}
        with open(config.COMMANDS_FILE, "w") as f:
            json.dump(cmd, f)
        return jsonify({"success": True, "message": "CLOSE_ALL command queued"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/reset-trades", methods=["POST"])
def api_reset_trades():
    """Clear all trades from the tradebook."""
    import tradebook as tb
    try:
        book = tb._load_book()
        count = len(book.get("trades", []))
        book["trades"] = []
        book["summary"] = {}
        tb._compute_summary(book)
        tb._save_book(book)
        return jsonify({"success": True, "deletedCount": count})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/logs", methods=["GET"])
def api_logs():
    """Return the last N lines of bot.log."""
    n = request.args.get("lines", 100, type=int)
    log_path = os.path.join(config.DATA_DIR, "bot.log")
    try:
        if os.path.exists(log_path):
            with open(log_path, "r") as f:
                lines = f.readlines()
            return jsonify({"logs": "".join(lines[-n:])})
    except Exception as e:
        return jsonify({"logs": f"Error reading logs: {e}"})
    return jsonify({"logs": ""})


# ─── Helpers ──────────────────────────────────────────────────────────

def _fmt_uptime(seconds):
    if seconds < 60:
        return f"{seconds}s"
    mins = seconds // 60
    if mins < 60:
        return f"{mins}m {seconds % 60}s"
    hrs = mins // 60
    return f"{hrs}h {mins % 60}m"


# ─── Engine Thread ────────────────────────────────────────────────────

def _run_engine():
    """Run the bot's main loop in a background thread."""
    global _engine_bot
    try:
        from main import RegimeMasterBot
        _engine_bot = RegimeMasterBot()
        _engine_bot.run()
    except Exception as e:
        logger.critical("Engine thread crashed: %s", e, exc_info=True)


def start_engine():
    """Start the engine in a background thread."""
    global _engine_thread, _engine_start_time
    if _engine_thread and _engine_thread.is_alive():
        logger.info("Engine already running")
        return
    logger.info("🚀 Starting engine thread...")
    _engine_thread = threading.Thread(target=_run_engine, daemon=True, name="EngineThread")
    _engine_thread.start()
    _engine_start_time = time.time()


# ─── Entry Point ──────────────────────────────────────────────────────

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Start the trading engine in background
    start_engine()

    # Start Flask API server
    port = int(os.environ.get("PORT", 3001))
    logger.info("🌐 Engine API listening on port %d", port)
    app.run(host="0.0.0.0", port=port, debug=False, use_reloader=False)

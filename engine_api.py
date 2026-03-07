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

# ─── In-memory log buffer (circular, last 500 lines) ─────────────────
from collections import deque
_log_buffer = deque(maxlen=500)
_log_lock = threading.Lock()

class _BufferHandler(logging.Handler):
    """Captures all log output into an in-memory ring buffer."""
    def emit(self, record):
        try:
            ts = datetime.fromtimestamp(record.created, tz=IST).strftime("%H:%M:%S")
            msg = f"[{ts}] {record.getMessage()}"
            with _log_lock:
                _log_buffer.append(msg)
        except Exception:
            pass

# Install buffer handler on root logger so ALL engine output is captured
_buf_handler = _BufferHandler()
_buf_handler.setLevel(logging.INFO)
logging.getLogger().addHandler(_buf_handler)


def _restore_mode_on_startup():
    """On startup: restore live mode from engine_mode.json if Railway PAPER_TRADE is still true.
    This persists the runtime mode switch across engine restarts when env var isn't updated."""
    try:
        mode_file = os.path.join(config.DATA_DIR, "engine_mode.json")
        if os.path.exists(mode_file):
            with open(mode_file, "r") as f:
                saved = json.load(f)
            if saved.get("mode") == "live":
                config.PAPER_TRADE = False
                config.EXCHANGE_LIVE = saved.get("exchange", "coindcx")
                logger.info(
                    "Startup: mode restored from engine_mode.json → live (exchange=%s)",
                    config.EXCHANGE_LIVE,
                )
    except Exception as e:
        logger.warning("Startup: could not restore mode from engine_mode.json: %s", e)

_restore_mode_on_startup()

# ── Startup diagnostics: verify mode ─────────────────────────────────
logger.info(
    "🔧 ENGINE MODE DIAGNOSTIC: PAPER_TRADE env=%s | config.PAPER_TRADE=%s | EXCHANGE_LIVE=%s",
    os.getenv("PAPER_TRADE", "<NOT SET>"),
    config.PAPER_TRADE,
    config.EXCHANGE_LIVE,
)


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
        # Trading mode — critical for debugging live vs paper
        "paper_trade": config.PAPER_TRADE,
        "exchange_live": config.EXCHANGE_LIVE or "",
        "mode": "paper" if config.PAPER_TRADE else f"live:{config.EXCHANGE_LIVE}",
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


@app.route("/api/exit-all-live", methods=["POST"])
def api_exit_all_live():
    """
    Immediately close ALL active CoinDCX positions and tradebook entries.
    Called when the bot is stopped from the dashboard.
    """
    import tradebook as tb

    results = {"closed_exchange": [], "closed_tradebook": [], "errors": []}

    # 1. Close all positions on CoinDCX
    if not config.PAPER_TRADE:
        try:
            import coindcx_client as cdx
            positions = cdx.list_positions()
            for p in positions:
                active_pos = float(p.get("active_pos", 0))
                if active_pos == 0:
                    continue
                pair = p.get("pair", "")
                pos_id = p.get("id")
                try:
                    cdx.exit_position(pos_id)
                    symbol = cdx.from_coindcx_pair(pair)
                    results["closed_exchange"].append(symbol)
                    logger.info("📤 EXIT-ALL: Closed CoinDCX position %s (%s)", pos_id, pair)
                except Exception as e:
                    results["errors"].append(f"{pair}: {str(e)}")
                    logger.error("EXIT-ALL: Failed to close %s: %s", pair, e)
        except Exception as e:
            results["errors"].append(f"CoinDCX error: {str(e)}")
            logger.error("EXIT-ALL: CoinDCX list_positions failed: %s", e)

    # 2. Close all active trades in tradebook
    try:
        active = tb.get_active_trades()
        for trade in active:
            tb.close_trade(trade_id=trade["trade_id"], reason="BOT_STOPPED")
            results["closed_tradebook"].append(trade["symbol"])
    except Exception as e:
        results["errors"].append(f"Tradebook error: {str(e)}")

    logger.info(
        "🛑 EXIT-ALL complete: %d exchange positions closed, %d tradebook entries closed, %d errors",
        len(results["closed_exchange"]),
        len(results["closed_tradebook"]),
        len(results["errors"]),
    )

    return jsonify({
        "success": True,
        "closed_exchange": results["closed_exchange"],
        "closed_tradebook": results["closed_tradebook"],
        "errors": results["errors"],
    })


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


@app.route("/api/set-mode", methods=["POST"])
def api_set_mode():
    """Switch engine between paper and live trading mode at runtime."""
    data = request.get_json() or {}
    mode = data.get("mode", "paper")          # "paper" | "live"
    exchange = data.get("exchange", "coindcx")

    mode_config = {
        "mode": mode,
        "exchange": exchange,
        "set_at": datetime.utcnow().isoformat(),
    }
    try:
        path = os.path.join(config.DATA_DIR, "engine_mode.json")
        with open(path, "w") as f:
            json.dump(mode_config, f)

        # Update runtime config (affects next _tick() immediately)
        config.PAPER_TRADE = (mode != "live")
        config.EXCHANGE_LIVE = exchange if mode == "live" else ""

        logger.info("Mode switched to %s (exchange=%s)", mode, exchange)
        return jsonify({"success": True, "mode": mode, "exchange": exchange})
    except Exception as e:
        logger.error("set-mode error: %s", e)
        return jsonify({"error": str(e)}), 500


@app.route("/api/validate-exchange", methods=["GET"])
def api_validate_exchange():
    """Test exchange API key connectivity and return current balance."""
    exchange = request.args.get("exchange", "coindcx")
    try:
        if exchange == "coindcx":
            import coindcx_client as cdx
            balance = cdx.get_usdt_balance()
            return jsonify({
                "valid": True,
                "exchange": "coindcx",
                "balance": balance,
                "currency": "USDT",
            })
        elif exchange == "binance":
            # Basic connectivity check — just verify keys are set
            if not config.BINANCE_API_KEY:
                return jsonify({"valid": False, "exchange": "binance", "error": "BINANCE_API_KEY not set"})
            return jsonify({"valid": True, "exchange": "binance", "balance": None})
        return jsonify({"valid": False, "exchange": exchange, "error": "Unknown exchange"}), 400
    except Exception as e:
        logger.error("validate-exchange error (%s): %s", exchange, e)
        return jsonify({"valid": False, "exchange": exchange, "error": str(e)}), 200


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


# ─── Log viewer ───────────────────────────────────────────────────────

@app.route("/api/logs", methods=["GET"])
def api_logs():
    """Return recent engine log lines from the in-memory buffer."""
    n = request.args.get("n", 200, type=int)
    with _log_lock:
        lines = list(_log_buffer)
    # Return last n lines
    return jsonify({"lines": lines[-n:], "total": len(lines)})


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

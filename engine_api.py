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
import signal
import logging
import threading
from datetime import datetime, timezone, timedelta

from flask import Flask, jsonify, request

# Ensure project root is importable
sys.path.insert(0, os.path.dirname(__file__))

import config
import tradebook as tb

app = Flask(__name__)
IST = timezone(timedelta(hours=5, minutes=30))

# ─── Globals ──────────────────────────────────────────────────────────
_engine_thread = None
_engine_start_time = None
_engine_bot = None
_engine_crash_count = 0
_engine_last_crash = None
_engine_start_lock = threading.Lock()  # Prevents duplicate engine threads on startup
_ENGINE_INITIALIZED = False            # Module-level guard: prevents re-entrant start_engine() calls

# ─── PID Lock File ────────────────────────────────────────────────────
# Prevents two engine processes running simultaneously.
# On Railway overlapping deploys, old + new containers temporarily share
# the same /app/data/ volume. The new container writes its PID here;
# if the old container's PID file is still present AND the old process
# is alive, the new engine defers startup for up to 45 seconds.
ENGINE_PID_FILE = os.path.join(os.path.dirname(__file__), "data", "engine.pid")


def _write_pid_lock():
    """Write our PID to the lock file so other instances can detect us."""
    try:
        os.makedirs(os.path.dirname(ENGINE_PID_FILE), exist_ok=True)
        with open(ENGINE_PID_FILE, "w") as f:
            f.write(str(os.getpid()))
    except Exception as e:
        logger.warning("Could not write engine PID lock: %s", e)


def _clear_pid_lock():
    """Remove the PID file on clean shutdown."""
    try:
        if os.path.exists(ENGINE_PID_FILE):
            os.remove(ENGINE_PID_FILE)
    except Exception:
        pass


def _is_pid_alive(pid: int) -> bool:
    """Check if a process with the given PID is currently running."""
    try:
        os.kill(pid, 0)  # signal 0 = just check existence
        return True
    except (ProcessLookupError, PermissionError):
        return False
    except Exception:
        return False


def _wait_for_old_engine_to_die(timeout: int = 45) -> bool:
    """
    Wait up to `timeout` seconds for the previous engine instance to exit.
    Returns True if the old instance is gone (safe to start), False if it
    timed out (should still start — old container may be on separate host).
    """
    if not os.path.exists(ENGINE_PID_FILE):
        return True
    try:
        with open(ENGINE_PID_FILE) as f:
            old_pid = int(f.read().strip())
    except Exception:
        return True  # Unreadable lock → assume safe

    if old_pid == os.getpid():
        return True  # Our own PID from a previous loop iteration — ignore

    if not _is_pid_alive(old_pid):
        logger.info("✅ Old engine PID %d is already gone — safe to start", old_pid)
        return True

    logger.warning(
        "⏳ Old engine instance (PID %d) still running — waiting up to %ds for it to stop...",
        old_pid, timeout
    )
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(3)
        if not _is_pid_alive(old_pid):
            logger.info("✅ Old engine PID %d stopped after %.0fs — starting new instance",
                        old_pid, timeout - (deadline - time.time()))
            return True

    logger.warning(
        "⚠️ Old engine PID %d still alive after %ds (may be separate container) — "
        "starting anyway but disabling tradebook writes for first 30s to avoid race",
        old_pid, timeout
    )
    return False  # Timed out — old instance may be on a different container

logger = logging.getLogger("EngineAPI")

# ─── Persistent crash log (survives process restarts) ─────────────────
CRASH_LOG_FILE = "engine_crashes.json"
BOOT_COUNT_FILE = "engine_boot_count.json"

def _load_crash_log():
    """Load persistent crash history from disk."""
    try:
        if os.path.exists(CRASH_LOG_FILE):
            with open(CRASH_LOG_FILE, "r") as f:
                return json.loads(f.read())
    except Exception:
        pass
    return {"boots": 0, "total_crashes": 0, "crashes": []}

def _save_crash(error_msg, crash_type="thread_crash"):
    """Append a crash entry to the persistent crash log."""
    try:
        log = _load_crash_log()
        log["total_crashes"] = log.get("total_crashes", 0) + 1
        entry = {
            "time": datetime.now(timezone.utc).isoformat(),
            "type": crash_type,
            "error": str(error_msg)[:500],
            "boot": log.get("boots", 0),
            "memory_mb": _get_memory_mb(),
        }
        log["crashes"] = (log.get("crashes", []) + [entry])[-20:]  # keep last 20
        with open(CRASH_LOG_FILE, "w") as f:
            f.write(json.dumps(log, indent=2))
    except Exception as e:
        logger.warning("Could not save crash log: %s", e)

def _increment_boot_count():
    """Track how many times this process has started (Railway restarts)."""
    try:
        log = _load_crash_log()
        log["boots"] = log.get("boots", 0) + 1
        log["last_boot"] = datetime.now(timezone.utc).isoformat()
        with open(CRASH_LOG_FILE, "w") as f:
            f.write(json.dumps(log, indent=2))
        return log["boots"]
    except Exception:
        return 0

def _get_memory_mb():
    """Get current process memory usage in MB."""
    try:
        import resource
        # maxrss is in KB on Linux, bytes on macOS
        rusage = resource.getrusage(resource.RUSAGE_SELF)
        if os.uname().sysname == "Darwin":
            return round(rusage.ru_maxrss / 1024 / 1024, 1)
        return round(rusage.ru_maxrss / 1024, 1)
    except Exception:
        try:
            # Fallback: read /proc/self/status on Linux
            with open("/proc/self/status") as f:
                for line in f:
                    if line.startswith("VmRSS:"):
                        return round(int(line.split()[1]) / 1024, 1)
        except Exception:
            pass
    return 0

# Track process boots on startup
_boot_number = _increment_boot_count()
_boot_crash_log = _load_crash_log()
if _boot_number > 1 and _boot_crash_log.get("crashes"):
    last = _boot_crash_log["crashes"][-1]
    logger.warning("⚠️ Process boot #%d — previous crash: %s at %s (mem: %sMB)",
                   _boot_number, last.get("error", "?")[:100], last.get("time", "?"), last.get("memory_mb", "?"))
else:
    logger.info("✅ Process boot #%d — clean start", _boot_number)

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


# ─── SAFETY GUARD: Require explicit env var to allow live trading ─────
ALLOW_LIVE_TRADING = os.getenv("ALLOW_LIVE_TRADING", "false").lower() == "true"

def _restore_mode_on_startup():
    """On startup: restore live mode from engine_mode.json if Railway PAPER_TRADE is still true.
    This persists the runtime mode switch across engine restarts when env var isn't updated.
    SAFETY: Requires ALLOW_LIVE_TRADING=true env var to actually switch to live."""
    try:
        mode_file = os.path.join(config.DATA_DIR, "engine_mode.json")
        if os.path.exists(mode_file):
            with open(mode_file, "r") as f:
                saved = json.load(f)
            if saved.get("mode") == "live":
                if not ALLOW_LIVE_TRADING:
                    logger.warning(
                        "🛑 SAFETY: engine_mode.json says live but ALLOW_LIVE_TRADING is not set. "
                        "Staying in PAPER mode. Set ALLOW_LIVE_TRADING=true in Railway env vars to enable live trading."
                    )
                    return
                config.PAPER_TRADE = False
                config.EXCHANGE_LIVE = saved.get("exchange", "coindcx")
                logger.info(
                    "Startup: mode restored from engine_mode.json → live (exchange=%s)",
                    config.EXCHANGE_LIVE,
                )
    except Exception as e:
        logger.warning("Startup: could not restore mode from engine_mode.json: %s", e)

_restore_mode_on_startup()

# ── Startup: auto-clear stale paused engine_state so a manual-pause from a
# previous Railway deployment NEVER silently keeps the engine off after redeploy.
def _clear_stale_pause():
    try:
        state_path = os.path.join(config.DATA_DIR, "engine_state.json")
        if os.path.exists(state_path):
            with open(state_path, "r") as f:
                st = json.load(f)
            if st.get("status") == "paused":
                logger.warning("🔄 Stale paused engine_state.json detected on startup — auto-resuming")
                st["status"] = "running"
                st["paused_by"] = None
                st["resumed_at"] = datetime.now(timezone.utc).isoformat()
                with open(state_path, "w") as fw:
                    json.dump(st, fw, indent=2)
    except Exception as e:
        logger.warning("Startup: could not clear stale pause: %s", e)

_clear_stale_pause()

# ── Startup: load persistent active bots ─────────────────────────────
ACTIVE_BOTS_FILE = os.path.join(config.DATA_DIR, "active_bots.json")

def _load_active_bots():
    """Load persistent active bots from disk on startup."""
    try:
        if os.path.exists(ACTIVE_BOTS_FILE):
            with open(ACTIVE_BOTS_FILE, "r") as f:
                bots = json.load(f)
                if isinstance(bots, list):
                    config.ENGINE_ACTIVE_BOTS = bots
                    if bots:
                        config.ENGINE_BOT_ID = bots[-1].get("bot_id", "")
                    logger.info("🔄 Loaded %d active bots from persistent storage.", len(bots))
    except Exception as e:
        logger.warning("Startup: could not load active_bots.json: %s", e)

def _save_active_bots():
    """Save active bots to disk."""
    try:
        with open(ACTIVE_BOTS_FILE, "w") as f:
            json.dump(config.ENGINE_ACTIVE_BOTS, f, indent=2)
    except Exception as e:
        logger.error("Failed to save active_bots.json: %s", e)

def pull_active_bots_from_saas():
    """
    Pull active bots from SaaS DB via the Next.js internal API.
    This is the primary source of truth — no push/registration required.
    Engine mode (paper/live) is determined by PAPER_TRADE env var.
    Returns True if bots were refreshed, False on failure.
    """
    saas_url = config.SAAS_API_URL
    if not saas_url:
        return False  # Not configured — rely on push registration fallback

    mode = "paper" if config.PAPER_TRADE else "live"
    url = f"{saas_url.rstrip('/')}/api/internal/active-bots?mode={mode}"
    headers = {"X-Synaptic-Internal": "engine-pull"}

    try:
        import urllib.request
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode())
        bots = data.get("bots", [])
        if not isinstance(bots, list):
            return False
        config.ENGINE_ACTIVE_BOTS = bots
        if bots:
            config.ENGINE_BOT_ID = bots[-1].get("bot_id", config.ENGINE_BOT_ID)
        else:
            logger.warning("⚠️  SaaS returned 0 active %s bots — deploy loop will be skipped this cycle", mode)
        _save_active_bots()
        logger.info("✅ Pulled %d active %s bots from SaaS DB", len(bots), mode)
        return True
    except Exception as e:
        logger.warning("⚠️  SaaS bot pull failed (%s) — keeping existing %d bots", e, len(config.ENGINE_ACTIVE_BOTS))
        return False

# Startup: try SaaS pull first, fall back to disk cache
if not pull_active_bots_from_saas():
    _load_active_bots()

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


# ─── C1 FIX: API Auth Middleware ─────────────────────────────────────
# All routes require Bearer token if ENGINE_API_SECRET is set.
# Health endpoint is exempt for monitoring.
ENGINE_API_SECRET = os.getenv("ENGINE_API_SECRET", "")

def _check_auth():
    """Validate Bearer token. Returns error response or None if OK."""
    if not ENGINE_API_SECRET:
        return None  # No secret configured — open access (dev mode)
    auth = request.headers.get("Authorization", "")
    if auth == f"Bearer {ENGINE_API_SECRET}":
        return None
    return jsonify({"error": "Unauthorized — missing or invalid Bearer token"}), 401

@app.before_request
def _auth_middleware():
    """C1 FIX: Require auth on all routes except /api/health."""
    if request.path == "/api/health":
        return None  # Health check exempt for monitoring
    return _check_auth()


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
        book = tb._load_book()
        book["trades"] = []
        tb._compute_summary(book)
        tb._save_book(book)
        tradebook = book
    engine = _read_json("engine_state.json", {"status": "running"})
    heatmap = _read_json("segment_heatmap.json", {"segments": []})

    return jsonify({
        "multi": multi,
        "tradebook": tradebook,
        "engine": engine,
        "heatmap": heatmap,
        # Athena LLM Reasoning Layer state (from live bot object, not disk)
        "athena": _engine_bot._athena.get_state() if _engine_bot and hasattr(_engine_bot, '_athena') and _engine_bot._athena else {"enabled": False},
        # List of bot IDs currently registered with the engine (cleared on restart).
        # Frontend uses this to detect de-registration and auto-re-push bots.
        "registered_bot_ids": [b["bot_id"] for b in config.ENGINE_ACTIVE_BOTS],
    })


@app.route("/api/gemini-health", methods=["GET"])
def api_gemini_health():
    """Check if the Gemini API key is configured and working."""
    has_key = bool(config.LLM_API_KEY)
    if not has_key:
        return jsonify({"status": "missing", "message": "GEMINI_API_KEY not configured", "key_set": False})

    # Try a minimal API call to verify key validity
    try:
        import google.generativeai as genai
        genai.configure(api_key=config.LLM_API_KEY)
        model = genai.GenerativeModel("gemini-2.0-flash")
        response = model.generate_content("Say 'OK' in one word.", generation_config={"max_output_tokens": 10})
        return jsonify({
            "status": "ok",
            "message": "Gemini API key is valid and working",
            "key_set": True,
            "model": config.LLM_MODEL,
            "test_response": response.text.strip()[:50],
            "athena_enabled": config.LLM_REASONING_ENABLED,
        })
    except ImportError:
        return jsonify({"status": "error", "message": "google-generativeai not installed", "key_set": True})
    except Exception as e:
        return jsonify({"status": "error", "message": f"Key validation failed: {str(e)[:200]}", "key_set": True})


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

    # Memory tracking
    mem_mb = _get_memory_mb()
    crash_log = _load_crash_log()

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
        # Crash tracking (in-memory for this boot)
        "crash_count": _engine_crash_count,
        "last_crash": _engine_last_crash,
        # Persistent tracking (survives process restarts)
        "boot_number": _boot_number,
        "total_crashes_all_boots": crash_log.get("total_crashes", 0),
        "last_boot_time": crash_log.get("last_boot"),
        "recent_crashes": crash_log.get("crashes", [])[-5:],
        # Memory
        "memory_mb": mem_mb,
        # Athena LLM Reasoning Layer
        "athena": _engine_bot._athena.get_state() if _engine_bot and hasattr(_engine_bot, '_athena') and _engine_bot._athena else {"enabled": False},
    })


@app.route("/api/close-trade", methods=["POST"])
def api_close_trade():
    """Close a single trade — for LIVE trades, closes CoinDCX position FIRST."""
    data = request.get_json() or {}
    trade_id = data.get("trade_id")
    symbol = data.get("symbol")
    reason = data.get("reason", "MANUAL_CLOSE")

    if not trade_id and not symbol:
        return jsonify({"error": "trade_id or symbol required"}), 400

    try:
        # Find the trade first to check if it's live
        book = tb._load_book()
        target = None
        for t in book["trades"]:
            if t["status"] != "ACTIVE":
                continue
            if trade_id and t["trade_id"] == trade_id:
                target = t
                break
            if symbol and t["symbol"] == symbol:
                target = t
                break

        if not target:
            return jsonify({"error": "No matching active trade found"}), 404

        exchange_close_result = None
        actual_exit_price = None

        # ─── LIVE: Close CoinDCX position FIRST ─────────────────────
        if not config.PAPER_TRADE and target.get("mode") == "LIVE":
            try:
                import coindcx_client as cdx
                pos_id = target.get("position_id")
                pair = target.get("pair")

                if pos_id:
                    cdx.exit_position(pos_id)
                    exchange_close_result = f"closed position {pos_id}"
                    logger.info("📤 CLOSE-TRADE: Closed CoinDCX position %s", pos_id)
                elif pair:
                    # Find position by pair
                    positions = cdx.list_positions()
                    for p in positions:
                        if p.get("pair") == pair and float(p.get("active_pos", 0)) != 0:
                            cdx.exit_position(p["id"])
                            exchange_close_result = f"closed position {p['id']}"
                            logger.info("📤 CLOSE-TRADE: Closed CoinDCX position %s (by pair %s)", p["id"], pair)
                            break
                elif symbol:
                    # Find position by symbol
                    cdx_pair = cdx.to_coindcx_pair(symbol)
                    if cdx_pair:
                        positions = cdx.list_positions()
                        for p in positions:
                            if p.get("pair") == cdx_pair and float(p.get("active_pos", 0)) != 0:
                                cdx.exit_position(p["id"])
                                exchange_close_result = f"closed position {p['id']}"
                                logger.info("📤 CLOSE-TRADE: Closed CoinDCX position by symbol %s", symbol)
                                break

                # Get actual CoinDCX exit price
                try:
                    cdx_pair = target.get("pair") or cdx.to_coindcx_pair(symbol)
                    if cdx_pair:
                        ticker = cdx.get_ticker(cdx_pair)
                        if ticker:
                            actual_exit_price = float(ticker.get("last_price", 0))
                except Exception:
                    pass

            except Exception as e:
                logger.error("CLOSE-TRADE: CoinDCX close failed: %s", e)
                exchange_close_result = f"exchange close failed: {str(e)}"

        # ─── THEN close in tradebook ─────────────────────────────────
        result = tb.close_trade(
            trade_id=trade_id, symbol=symbol, reason=reason,
            exit_price=actual_exit_price,  # Use CoinDCX fill price if available
        )
        if result is None:
            return jsonify({"error": "Trade not found in tradebook (may already be closed)"}), 404

        closed = result if isinstance(result, list) else [result]
        return jsonify({
            "success": True,
            "exchange_close": exchange_close_result,
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
    """Clear all trades from the tradebook. PAPER MODE ONLY for safety."""
    try:
        if not config.PAPER_TRADE:
            return jsonify({"error": "Cannot reset trades in LIVE mode. Use /api/sync-exchange instead."}), 400
        book = tb._load_book()
        count = len(book.get("trades", []))
        book["trades"] = []
        book["summary"] = {}
        tb._compute_summary(book)
        tb._save_book(book)
        return jsonify({"success": True, "deletedCount": count})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/sync-exchange", methods=["POST"])
def api_sync_exchange():
    """
    Reconcile tradebook with CoinDCX exchange positions.

    1. For each ACTIVE tradebook entry: if exchange has NO position → close as EXCHANGE_CLOSED
    2. For each exchange position NOT in tradebook → import as new trade
    3. For matching positions: update current_price, SL, TP from exchange data
    """
    results = {
        "closed_orphans": [],    # tradebook entries closed (no exchange position)
        "imported": [],          # exchange positions imported to tradebook
        "updated": [],           # existing trades with updated prices
        "errors": [],
    }

    if config.PAPER_TRADE:
        return jsonify({
            "success": True,
            "message": "Paper mode — nothing to sync with exchange",
            **results,
        })

    try:
        import coindcx_client as cdx
        from data_pipeline import get_current_price

        # Step 1: Get all CoinDCX positions
        try:
            exchange_positions = cdx.list_positions()
        except Exception as e:
            return jsonify({"error": f"Failed to fetch CoinDCX positions: {str(e)}"}), 500

        # Build lookup: symbol → position
        exchange_map = {}
        for p in exchange_positions:
            active_pos = float(p.get("active_pos", 0))
            if active_pos == 0:
                continue
            pair = p.get("pair", "")
            symbol = cdx.from_coindcx_pair(pair)
            exchange_map[symbol] = {
                "pair": pair,
                "position_id": p.get("id"),
                "side": "LONG" if active_pos > 0 else "SHORT",
                "quantity": abs(active_pos),
                "entry_price": float(p.get("avg_price", 0)),
                "leverage": int(p.get("leverage", 1)),
                "sl": float(p.get("stop_loss", 0) or 0),
                "tp": float(p.get("take_profit", 0) or 0),
                "pnl": float(p.get("pnl", 0) or 0),
            }

        logger.info("🔄 SYNC: Exchange has %d active positions: %s",
                     len(exchange_map), list(exchange_map.keys()))

        # Step 2: Get all ACTIVE trades in tradebook
        active_trades = tb.get_active_trades()
        tradebook_symbols = set()

        # Step 3: Reconcile tradebook → exchange
        for trade in active_trades:
            symbol = trade["symbol"]
            tradebook_symbols.add(symbol)
            mode = (trade.get("mode") or "").upper()
            if not mode.startswith("LIVE"):
                continue  # Skip paper trades

            if symbol in exchange_map:
                # Position exists — update current data
                ex = exchange_map[symbol]
                current = get_current_price(symbol) or ex["entry_price"]
                trade["current_price"] = round(current, 6)
                if ex["sl"] > 0:
                    trade["trailing_sl"] = round(ex["sl"], 6)
                if ex["tp"] > 0:
                    trade["trailing_tp"] = round(ex["tp"], 6)
                results["updated"].append(symbol)
            else:
                # Position NOT on exchange → close as EXCHANGE_CLOSED
                try:
                    tb.close_trade(trade_id=trade["trade_id"], reason="EXCHANGE_CLOSED")
                    results["closed_orphans"].append({
                        "trade_id": trade["trade_id"],
                        "symbol": symbol,
                    })
                    logger.info("🔄 SYNC: Closed orphan tradebook entry %s (%s) — no exchange position",
                                trade["trade_id"], symbol)
                except Exception as e:
                    results["errors"].append(f"Close {trade['trade_id']}: {str(e)}")

        # Step 4: Import exchange positions NOT in tradebook
        for symbol, ex in exchange_map.items():
            if symbol in tradebook_symbols:
                continue  # Already tracked

            try:
                current = get_current_price(symbol) or ex["entry_price"]
                side = "BUY" if ex["side"] == "LONG" else "SELL"
                capital = round(ex["quantity"] * ex["entry_price"] / ex["leverage"], 2)
                trade_id = tb.open_trade(
                    symbol=symbol,
                    side=side,
                    leverage=ex["leverage"],
                    quantity=ex["quantity"],
                    entry_price=ex["entry_price"],
                    atr=0,
                    regime=0,
                    confidence=0,
                    reason="IMPORTED_FROM_EXCHANGE",
                    capital=capital,
                    mode="LIVE",
                    exchange="coindcx",
                    pair=ex["pair"],
                    position_id=ex["position_id"],
                )
                results["imported"].append({
                    "trade_id": trade_id,
                    "symbol": symbol,
                    "side": ex["side"],
                    "entry_price": ex["entry_price"],
                })
                logger.info("🔄 SYNC: Imported exchange position %s %s @ %.4f",
                            symbol, ex["side"], ex["entry_price"])
            except Exception as e:
                results["errors"].append(f"Import {symbol}: {str(e)}")

        # Save updates
        book = tb._load_book()
        tb._compute_summary(book)
        tb._save_book(book)

    except Exception as e:
        logger.error("SYNC: Fatal error: %s", e, exc_info=True)
        results["errors"].append(str(e))

    logger.info(
        "🔄 SYNC complete: %d updated, %d orphans closed, %d imported, %d errors",
        len(results["updated"]),
        len(results["closed_orphans"]),
        len(results["imported"]),
        len(results["errors"]),
    )

    return jsonify({
        "success": len(results["errors"]) == 0,
        **results,
    })


@app.route("/api/set-mode", methods=["POST"])
def api_set_mode():
    """Switch engine between paper and live trading mode at runtime.
    SAFETY: Requires ALLOW_LIVE_TRADING=true env var to switch to live."""
    data = request.get_json() or {}
    mode = data.get("mode", "paper")          # "paper" | "live"
    exchange = data.get("exchange", "coindcx")

    # ─── SAFETY GUARD ─────────────────────────────────────────────
    if mode == "live" and not ALLOW_LIVE_TRADING:
        logger.warning(
            "🛑 SAFETY: Attempted to switch to LIVE mode but ALLOW_LIVE_TRADING is not set. "
            "Set ALLOW_LIVE_TRADING=true in Railway env vars to enable live trading."
        )
        return jsonify({
            "error": "Live trading is disabled. Set ALLOW_LIVE_TRADING=true in Railway environment variables to enable.",
            "safety_blocked": True,
        }), 403

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


@app.route("/api/set-config", methods=["POST"])
def api_set_config():
    """
    Apply per-bot risk settings from the SaaS DB at bot-start time.
    Called by toggle/route.ts alongside /api/set-bot-id.
    Accepted fields (all optional):
      max_loss_pct      — overrides config.MAX_LOSS_PER_TRADE_PCT (e.g. -15)
      capital_per_trade — overrides profile capital_per_trade (e.g. 100)
      paper_balance     — overrides simulated paper balance (default 1000)
    """
    data = request.get_json() or {}
    applied = {}

    max_loss = data.get("max_loss_pct")
    if max_loss is not None:
        try:
            config.MAX_LOSS_PER_TRADE_PCT = float(max_loss)
            # Ensure it's stored as a negative value (guard against user sending 15 instead of -15)
            if config.MAX_LOSS_PER_TRADE_PCT > 0:
                config.MAX_LOSS_PER_TRADE_PCT = -config.MAX_LOSS_PER_TRADE_PCT
            applied["max_loss_pct"] = config.MAX_LOSS_PER_TRADE_PCT
        except (TypeError, ValueError):
            pass

    capital = data.get("capital_per_trade")
    if capital is not None:
        try:
            cap = float(capital)
            if cap > 0:
                config.CAPITAL_PER_TRADE = cap
                applied["capital_per_trade"] = cap
        except (TypeError, ValueError):
            pass

    max_open = data.get("max_open_trades")
    if max_open is not None:
        try:
            mot = int(max_open)
            if mot > 0:
                config.MAX_OPEN_TRADES = mot
                config.MAX_CONCURRENT_POSITIONS = mot
                applied["max_open_trades"] = mot
        except (TypeError, ValueError):
            pass

    paper_balance = data.get("paper_balance")
    if paper_balance is not None:
        try:
            bal = float(paper_balance)
            if bal > 0:
                config.PAPER_BALANCE_OVERRIDE = bal
                applied["paper_balance"] = bal
        except (TypeError, ValueError):
            pass

    logger.info("⚙️  set-config applied: %s", applied)
    return jsonify({"success": True, "applied": applied})


@app.route("/api/set-bot-id", methods=["POST"])
def api_set_bot_id():
    """
    Set the active Bot ID and Brain Type from the Next.js UI.
    Supports multi-bot operations (appends to active list).
    """
    data = request.get_json() or {}
    bot_id = data.get("bot_id", "")
    bot_name = data.get("bot_name", "")
    segment_filter = data.get("segment_filter", "ALL")
    user_id = data.get("user_id", "")
    # Per-bot risk settings (stored so each bot uses its own capital, not global)
    capital_per_trade = data.get("capital_per_trade")
    max_loss_pct = data.get("max_loss_pct")

    if not bot_id:
        return jsonify({"error": "bot_id is required"}), 400

    old_id = config.ENGINE_BOT_ID
    config.ENGINE_BOT_ID = bot_id

    # Also update user_id if provided
    if user_id:
        config.ENGINE_USER_ID = user_id

    # ── MULTI-BOT: Add to active bots list (dedup by bot_id) ──
    config.ENGINE_ACTIVE_BOTS = [
        b for b in config.ENGINE_ACTIVE_BOTS if b.get("bot_id") != bot_id
    ]
    bot_entry = {
        "bot_id": bot_id,
        "bot_name": bot_name,
        "user_id": user_id or config.ENGINE_USER_ID,
        "segment_filter": segment_filter,
    }
    # Store per-bot capital so the deploy loop uses each bot's own setting
    if capital_per_trade is not None:
        try:
            cap = float(capital_per_trade)
            if cap > 0:
                bot_entry["capital_per_trade"] = cap
        except (TypeError, ValueError):
            pass
    if max_loss_pct is not None:
        try:
            bot_entry["max_loss_pct"] = float(max_loss_pct)
        except (TypeError, ValueError):
            pass
    config.ENGINE_ACTIVE_BOTS.append(bot_entry)
    _save_active_bots()

    logger.info(
        "🔑 Bot added: %s (%s) → active_bots=%d (user: %s) segment=%s",
        bot_id, bot_name, len(config.ENGINE_ACTIVE_BOTS), user_id or "<unchanged>", segment_filter,
    )

    return jsonify({
        "success": True,
        "bot_id": bot_id,
        "bot_name": bot_name,
        "previous_bot_id": old_id,
        "user_id": user_id or config.ENGINE_USER_ID,
        "active_bots": len(config.ENGINE_ACTIVE_BOTS),
    })


@app.route("/api/remove-bot-id", methods=["POST"])
def api_remove_bot_id():
    """Remove a bot from the active bots list — called when user stops a bot."""
    data = request.get_json() or {}
    bot_id = data.get("bot_id", "")

    if not bot_id:
        return jsonify({"error": "bot_id is required"}), 400

    before = len(config.ENGINE_ACTIVE_BOTS)
    config.ENGINE_ACTIVE_BOTS = [
        b for b in config.ENGINE_ACTIVE_BOTS if b.get("bot_id") != bot_id
    ]
    after = len(config.ENGINE_ACTIVE_BOTS)

    # If removed bot was the current ENGINE_BOT_ID, switch to first remaining
    if config.ENGINE_BOT_ID == bot_id:
        config.ENGINE_BOT_ID = config.ENGINE_ACTIVE_BOTS[0]["bot_id"] if config.ENGINE_ACTIVE_BOTS else ""
    _save_active_bots()

    logger.info("🔑 Bot removed: %s (%d → %d active)", bot_id, before, after)

    return jsonify({
        "success": True,
        "removed": bot_id,
        "active_bots": after,
    })






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
    """Run the bot's main loop in a background thread with auto-restart."""
    global _engine_bot, _engine_crash_count, _engine_last_crash
    MAX_RETRIES = 5
    BASE_BACKOFF = 10  # seconds
    RECOVERY_COOLDOWN = 300  # 5 minutes before infinite recovery attempt

    # ── PID Lock Guard ────────────────────────────────────────────────
    # Wait for any existing engine instance (from a Railway overlapping deploy)
    # to finish before we start our own loop.
    _wait_for_old_engine_to_die(timeout=45)
    _write_pid_lock()
    logger.info("🔒 Engine PID lock acquired (PID %d)", os.getpid())

    try:
      _run_engine_inner()
    finally:
        _clear_pid_lock()
        logger.info("🔓 Engine PID lock released")


def _run_engine_inner():
    """Inner engine loop — separated so the PID lock wrapper stays clean."""
    global _engine_bot, _engine_crash_count, _engine_last_crash
    MAX_RETRIES = 5
    BASE_BACKOFF = 10  # seconds
    RECOVERY_COOLDOWN = 300  # 5 minutes before infinite recovery attempt

    while True:  # Outer infinite loop for recovery after retry exhaustion
        retry = 0
        while retry < MAX_RETRIES:
            loop_start = time.time()
            try:
                logger.info("🔧 Creating RegimeMasterBot (attempt %d/%d, mem: %sMB)...",
                           retry + 1, MAX_RETRIES, _get_memory_mb())
                from main import RegimeMasterBot
                _engine_bot = RegimeMasterBot()
                logger.info("✅ RegimeMasterBot created (mem: %sMB) — starting run loop", _get_memory_mb())
                _engine_bot.run()
                # If run() returns cleanly (self._running set to False), break out
                logger.info("Engine run() returned (self._running = False)")
                return  # Graceful shutdown requested — don't restart
            except KeyboardInterrupt:
                # SIGTERM from Railway during redeploy — NOT a crash
                # IMPORTANT: do NOT reset retry counter — this allows clean shutdown
                logger.warning("⚡ Engine received SIGTERM/KeyboardInterrupt — shutting down gracefully")
                _save_crash("SIGTERM/KeyboardInterrupt", crash_type="signal")
                return  # Exit cleanly — Flask process will also be stopped
            except Exception as e:
                _engine_crash_count += 1
                _engine_last_crash = datetime.now(timezone.utc).isoformat()
                logger.critical("💥 Engine thread crashed (attempt %d/%d, mem: %sMB): %s",
                               retry + 1, MAX_RETRIES, _get_memory_mb(), e, exc_info=True)
                _save_crash(str(e), crash_type="thread_crash")

                # If engine ran for > 5 minutes, reset retry counter (it was healthy)
                run_duration = time.time() - loop_start
                if run_duration > 300:
                    logger.info("Engine ran for %.0fs before crash — resetting retry counter", run_duration)
                    retry = 0
                else:
                    retry += 1

                if retry < MAX_RETRIES:
                    backoff = min(BASE_BACKOFF * (2 ** (retry - 1)), 160)
                    logger.info("⏳ Restarting engine in %ds...", backoff)
                    time.sleep(backoff)

        # All retries exhausted — send Telegram alert
        logger.critical("❌ Engine exhausted all %d restart attempts", MAX_RETRIES)
        _save_crash("Exhausted all restart attempts", crash_type="permanent_failure")

        # Send Telegram alert about engine death
        try:
            import telegram as tg
            tg.send_message(
                "🚨 *ENGINE DEAD*\n\n"
                f"Engine exhausted all {MAX_RETRIES} restart attempts.\n"
                f"Last crash: {_engine_last_crash}\n"
                f"Total crashes this boot: {_engine_crash_count}\n\n"
                "⏳ Auto-recovery in 5 minutes..."
            )
        except Exception:
            pass

        # Wait 5 minutes then try again (infinite recovery)
        logger.info("⏳ Waiting %ds before infinite recovery attempt...", RECOVERY_COOLDOWN)
        time.sleep(RECOVERY_COOLDOWN)
        logger.info("🔄 Attempting infinite recovery restart...")


def _setup_sigterm_handler():
    """Install SIGTERM handler so Railway container stops cleanly, not like a crash."""
    def _handle_sigterm(signum, frame):
        logger.warning("🛑 SIGTERM received — initiating graceful shutdown")
        if _engine_bot:
            try:
                _engine_bot._running = False
            except Exception:
                pass
        # Give the engine thread 15s to wind down
        if _engine_thread and _engine_thread.is_alive():
            _engine_thread.join(timeout=15)
        # Clear startup lock so next deployment can start cleanly
        try:
            if os.path.exists(_STARTUP_LOCK_FILE):
                os.remove(_STARTUP_LOCK_FILE)
        except Exception:
            pass
        logger.info("👋 Engine shut down cleanly after SIGTERM")
        sys.exit(0)

    signal.signal(signal.SIGTERM, _handle_sigterm)
    logger.info("🛡️ SIGTERM handler installed")


def start_engine():
    """Start the engine in a background thread.
    
    Lock-guarded to prevent duplicate threads when Flask's reloader or
    the watchdog calls this concurrently with the module-scope startup call.
    Without the lock, both the werkzeug parent and reloader child processes
    each see _engine_thread=None and both start an engine instance.
    """
    global _engine_thread, _engine_start_time, _engine_crash_count
    with _engine_start_lock:
        if _engine_thread and _engine_thread.is_alive():
            logger.info("Engine already running — skipping duplicate start")
            return
        _engine_crash_count = 0
        logger.info("🚀 Starting engine thread...")
        _engine_thread = threading.Thread(target=_run_engine, daemon=False, name="EngineThread")
        _engine_thread.start()
        _engine_start_time = time.time()




@app.route("/api/force-signal", methods=["POST"])
def api_force_signal():
    """
    Inject a manual test signal directly into the execution engine.
    Bypasses HMM analysis — use for connection testing only.

    Body (all optional except symbol/side):
      symbol   — e.g. "BTCUSDT"  (default: PRIMARY_SYMBOL)
      side     — "BUY" or "SELL" (default: "BUY")
      capital  — USD per trade   (default: config.CAPITAL_PER_TRADE)
      leverage — integer         (default: 5)
    """
    auth_err = _check_auth()
    if auth_err:
        return auth_err

    if not _engine_bot:
        return jsonify({"success": False, "error": "Engine not initialised yet"}), 503

    data     = request.get_json() or {}
    symbol   = data.get("symbol",   config.PRIMARY_SYMBOL)
    side     = data.get("side",     "BUY").upper()
    capital  = float(data.get("capital",  getattr(config, "CAPITAL_PER_TRADE", 100.0)))
    leverage = int(data.get("leverage", 5))

    if side not in ("BUY", "SELL"):
        return jsonify({"success": False, "error": "side must be BUY or SELL"}), 400

    try:
        from data_pipeline import get_current_price, fetch_klines
        from feature_engine import compute_all_features

        price = get_current_price(symbol) or 0
        if price <= 0:
            return jsonify({"success": False, "error": f"Could not fetch price for {symbol}"}), 400

        # Estimate ATR from recent candles
        atr = price * 0.015  # 1.5% fallback
        try:
            df = fetch_klines(symbol, "1h", limit=50)
            if df is not None and len(df) > 14:
                df2 = compute_all_features(df)
                if "atr" in df2.columns:
                    atr = float(df2["atr"].iloc[-1])
        except Exception:
            pass

        quantity = (capital * leverage) / max(price, 0.0001)

        logger.info("🧪 FORCE-SIGNAL: %s %s @ $%.2f | %dx | qty=%.6f | capital=$%.2f",
                    side, symbol, price, leverage, quantity, capital)

        result = _engine_bot.executor.execute_trade(
            symbol=symbol,
            side=side,
            leverage=leverage,
            quantity=quantity,
            atr=atr,
            ema_15m_20=None,   # force MARKET order (no virtual limit)
            regime=1,
            confidence=0.80,
            reason="force-signal test",
        )

        if result is None:
            return jsonify({"success": False, "error": "execute_trade returned None — check engine logs"}), 400

        # Record in tradebook under first registered bot (or ENGINE_BOT_ID)
        bot_id = (config.ENGINE_ACTIVE_BOTS[0]["bot_id"]
                  if config.ENGINE_ACTIVE_BOTS else config.ENGINE_BOT_ID)

        import coindcx_client as _cdx
        trade_id = tb.open_trade(
            symbol=symbol,
            side=side,
            leverage=result.get("leverage", leverage),
            quantity=result.get("quantity", quantity),
            entry_price=result.get("entry_price", price),
            atr=atr,
            regime=1,
            confidence=0.80,
            reason="force-signal test",
            capital=result.get("capital", capital),
            bot_id=bot_id,
            exchange=result.get("exchange", "coindcx" if not config.PAPER_TRADE else "paper"),
            pair=result.get("pair") or _cdx.to_coindcx_pair(symbol),
            mode=result.get("mode", "LIVE" if not config.PAPER_TRADE else "PAPER"),
            position_id=result.get("position_id"),
        )

        logger.info("🧪 FORCE-SIGNAL recorded: trade_id=%s entry=%.4f", trade_id, result.get("entry_price", 0))
        return jsonify({
            "success":     True,
            "trade_id":    trade_id,
            "symbol":      symbol,
            "side":        side,
            "entry_price": result.get("entry_price", price),
            "quantity":    result.get("quantity", quantity),
            "leverage":    result.get("leverage", leverage),
            "capital":     result.get("capital", capital),
            "stop_loss":   result.get("stop_loss"),
            "take_profit": result.get("take_profit"),
            "mode":        result.get("mode"),
            "exchange":    result.get("exchange"),
            "order_type":  result.get("order_type"),
            "position_id": result.get("position_id"),
        })

    except Exception as e:
        logger.error("force-signal error: %s", e, exc_info=True)
        return jsonify({"success": False, "error": str(e)}), 500


@app.route("/api/broadcast-log", methods=["GET"])
def api_broadcast_log():
    """Return last N lines of signal_broadcast.log as structured JSON.
    Supports optional ?bot_ids=id1,id2,... to filter to specific bots only (user-scoping).
    """
    try:
        n = min(int(request.args.get("n", 100)), 500)
        # Optional comma-separated bot ID filter for user scoping
        bot_ids_raw = request.args.get("bot_ids", "")
        allowed_bot_ids = set(bid.strip() for bid in bot_ids_raw.split(",") if bid.strip()) if bot_ids_raw else None

        log_path = os.path.join(config.DATA_DIR, "signal_broadcast.log")
        if not os.path.exists(log_path):
            return jsonify({"lines": [], "total": 0, "message": "No broadcast log yet — engine hasn't completed a cycle"})

        with open(log_path, "r", encoding="utf-8") as f:
            raw_lines = f.readlines()

        # Take last N*3 lines to have enough candidate lines before filtering
        candidate_count = n * 3 if allowed_bot_ids else n
        tail = raw_lines[-candidate_count:] if len(raw_lines) > candidate_count else raw_lines

        def _val(parts, prefix):
            for p in parts:
                if p.strip().startswith(prefix):
                    return p.strip()[len(prefix):].strip()
            return ""

        parsed = []
        for line in tail:
            line = line.strip()
            if not line:
                continue
            entry = {"raw": line}
            try:
                parts = [p.strip() for p in line.split("|")]
                if len(parts) >= 7:
                    entry["timestamp"] = parts[0].strip()
                    entry["cycle"]   = _val(parts, "cycle=").split()[0] if "cycle=" in line else ""
                    entry["event"]   = parts[2].strip() if len(parts) > 2 else ""
                    entry["bot"]     = _val(parts, "bot=")
                    entry["bot_id"]  = _val(parts, "id=")
                    entry["symbol"]  = _val(parts, "sym=")
                    entry["side"]    = _val(parts, "side=")
                    entry["segment"] = _val(parts, "seg=")
                    entry["conf"]    = _val(parts, "conf=")
                    entry["detail"]  = parts[-1].strip()

                    # Apply bot_id filter — skip lines that don't match allowed bots
                    if allowed_bot_ids and entry["bot_id"] and entry["bot_id"] not in allowed_bot_ids:
                        continue
            except Exception:
                pass
            parsed.append(entry)
            if len(parsed) >= n:
                break

        return jsonify({
            "lines": list(reversed(parsed)),  # newest first
            "total": len(raw_lines),
            "showing": len(parsed),
            "filtered_by_bots": len(allowed_bot_ids) if allowed_bot_ids else None,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500



@app.route("/api/restart", methods=["POST"])
def api_restart():
    """Force-restart the engine thread."""

    global _engine_thread, _engine_start_time, _engine_crash_count, _engine_bot
    logger.info("🔄 Manual engine restart requested")

    # Gracefully stop the current engine via _running flag
    if _engine_bot:
        try:
            _engine_bot._running = False
        except Exception:
            pass

    # Wait briefly for thread to die
    if _engine_thread and _engine_thread.is_alive():
        _engine_thread.join(timeout=10)  # Give it more time to stop cleanly

    _engine_thread = None
    _engine_bot = None
    _engine_crash_count = 0
    start_engine()

    return jsonify({"status": "restarting", "message": "Engine restart initiated"})


# ─── Log viewer ───────────────────────────────────────────────────────

@app.route("/api/logs", methods=["GET"])
def api_logs():
    """Return recent engine log lines from the in-memory buffer."""
    n = request.args.get("n", 200, type=int)
    with _log_lock:
        lines = list(_log_buffer)
    # Return last n lines
    return jsonify({"lines": lines[-n:], "total": len(lines)})


# ─── Engine Watchdog ──────────────────────────────────────────────────

def _engine_watchdog():
    """Background watchdog: check if engine thread is alive every 60s.
    If dead, auto-restart it. This eliminates the 'Flask alive but engine dead' scenario."""
    WATCHDOG_INTERVAL = 60  # seconds
    while True:
        time.sleep(WATCHDOG_INTERVAL)
        if _engine_thread is None or not _engine_thread.is_alive():
            logger.warning("🐕 WATCHDOG: Engine thread is dead — auto-restarting...")
            try:
                import telegram as tg
                tg.send_message(
                    "🐕 *WATCHDOG ALERT*\n\n"
                    "Engine thread was found dead.\n"
                    "Auto-restarting now..."
                )
            except Exception:
                pass
            start_engine()


# ─── API Initialisation ───────────────────────────────────────────────

# Ensure we have a StreamHandler for stdout (Railway console) since basicConfig is blocked
_stream_handler = logging.StreamHandler(sys.stdout)
_stream_handler.setFormatter(logging.Formatter("%(asctime)s [%(name)s] %(levelname)s: %(message)s", "%Y-%m-%d %H:%M:%S"))
_stream_handler.setLevel(logging.INFO)
logging.getLogger().addHandler(_stream_handler)
logging.getLogger().setLevel(logging.INFO)

# ─── One-shot startup guard ──────────────────────────────────────────
# engine_api.py runs its module-scope code every time it is imported.
# On Railway this happens multiple times (overlapping deploys, threads
# importing each other, etc.). Use an atomic O_CREAT|O_EXCL lock file
# so only ONE instance ever calls start_engine().
_STARTUP_LOCK_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "engine_startup.lock")

def _acquire_startup_lock() -> bool:
    """Atomically create startup lock file. Returns True only for the winner."""
    global _ENGINE_INITIALIZED
    if _ENGINE_INITIALIZED:
        return False  # Already started in this process
    try:
        os.makedirs(os.path.dirname(_STARTUP_LOCK_FILE), exist_ok=True)
        fd = os.open(_STARTUP_LOCK_FILE, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(fd, str(os.getpid()).encode())
        os.close(fd)
        _ENGINE_INITIALIZED = True
        logger.info("🔒 Startup lock acquired (PID %d) — this is the primary engine instance", os.getpid())
        return True
    except FileExistsError:
        logger.warning("⏭️  Startup lock already held — skipping duplicate engine start")
        return False
    except Exception as e:
        logger.warning("Could not acquire startup lock (%s) — starting anyway", e)
        _ENGINE_INITIALIZED = True
        return True

# Only the instance that wins the startup lock starts the engine
if _acquire_startup_lock():
    start_engine()
    _watchdog_thread = threading.Thread(target=_engine_watchdog, daemon=True, name="EngineWatchdog")
    _watchdog_thread.start()
    logger.info("🐕 Engine watchdog started (checks every 60s)")
else:
    logger.info("⏭️  Skipped engine + watchdog start — another instance is primary")


# ─── Entry Point (Local Testing) ──────────────────────────────────────

if __name__ == "__main__":

    # Install SIGTERM handler BEFORE starting anything else
    _setup_sigterm_handler()

    # Start Flask API server
    port = int(os.environ.get("PORT", 3001))
    logger.info("🌐 Engine API listening on port %d", port)
    app.run(host="0.0.0.0", port=port, debug=False, use_reloader=False)


# ─── Trade Journal: Exchange Health ──────────────────────────────────────────
# Called by Next.js /api/journal/health every 15s.
# Returns live exchange connectivity, balance, and open position count.
# Paper engines return mode="paper" with no exchange call.

@app.route("/api/exchange-health", methods=["GET"])
def api_exchange_health():
    """Live exchange health for Trade Journal page. Safe to call every 15s."""
    if config.PAPER_TRADE:
        return jsonify({
            "mode": "paper",
            "status": "n/a",
            "exchange": None,
            "balance": 0,
            "openPositions": 0,
            "checkedAt": datetime.utcnow().isoformat() + "Z",
        })
    try:
        import coindcx_client as cdx
        balance = cdx.get_usdt_balance()
        try:
            positions = cdx.list_positions()
            pos_count = len(positions) if isinstance(positions, list) else 0
        except Exception:
            pos_count = -1  # -1 = could not fetch position count
        return jsonify({
            "mode": "live",
            "status": "connected",
            "exchange": config.EXCHANGE_LIVE or "coindcx",
            "balance": balance,
            "openPositions": pos_count,
            "checkedAt": datetime.utcnow().isoformat() + "Z",
        })
    except Exception as e:
        logger.warning("exchange-health: CoinDCX call failed: %s", e)
        return jsonify({
            "mode": "live",
            "status": "failed",
            "exchange": config.EXCHANGE_LIVE or "coindcx",
            "balance": 0,
            "openPositions": 0,
            "error": str(e),
            "checkedAt": datetime.utcnow().isoformat() + "Z",
        })

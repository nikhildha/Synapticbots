"""
╔══════════════════════════════════════════════════════════════════════════════╗
║                        ALPHA MODULE — SYNAPTIC                              ║
║  Module : alpha/alpha_server.py                                              ║
║  Purpose: Lightweight Flask HTTP server that exposes Alpha data to           ║
║           the Next.js dashboard. Runs in a daemon thread alongside the       ║
║           trading loop.                                                      ║
║                                                                              ║
║  Endpoints:                                                                  ║
║    GET /alpha/health  — liveness check (no auth required)                   ║
║    GET /alpha/data    — full data payload (requires X-Alpha-Key header)      ║
║                                                                              ║
║  Authentication: X-Alpha-Key: <ALPHA_INTERNAL_KEY>                          ║
║  All other routes → 404                                                      ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  ISOLATION CONTRACT                                                          ║
║  ✗ DO NOT import any root module (engine_api, config, etc.)                 ║
║  ✓ Only imports: flask, alpha_config, alpha_tradebook, alpha_logger          ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

import json
import threading
from datetime import datetime, timezone

from flask import Flask, jsonify, request, abort

from alpha.alpha_config  import ALPHA_INTERNAL_KEY, ALPHA_PORT, ALPHA_PAPER_MODE
from alpha.alpha_tradebook import (
    get_open_trades, get_closed_trades, portfolio_summary,
)
from alpha.alpha_logger  import get_logger

logger = get_logger("server")

app = Flask(__name__)
app.json.sort_keys = False

# Shared state — engine writes here each cycle, server reads it
_engine_state: dict = {}
_state_lock = threading.Lock()


def update_state(state: dict) -> None:
    """Called by the engine after each cycle to push latest state."""
    with _state_lock:
        _engine_state.update(state)


def _require_key() -> None:
    """Abort with 401 if X-Alpha-Key header is missing or wrong."""
    if not ALPHA_INTERNAL_KEY:
        return   # no key configured — open in dev mode
    key = request.headers.get("X-Alpha-Key", "")
    if key != ALPHA_INTERNAL_KEY:
        abort(401)


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/alpha/health")
def health():
    """Liveness probe — Railway healthcheck uses this."""
    with _state_lock:
        cycle = _engine_state.get("cycle", 0)
        last_run = _engine_state.get("last_run")
    return jsonify({
        "ok":        True,
        "service":   "alpha",
        "cycle":     cycle,
        "last_run":  last_run,
        "paper_mode": ALPHA_PAPER_MODE,
        "ts":        datetime.now(timezone.utc).isoformat(),
    })


@app.route("/alpha/data")
def alpha_data():
    """
    Full Alpha data payload for the Next.js dashboard.
    Requires X-Alpha-Key header.
    """
    _require_key()

    with _state_lock:
        state = dict(_engine_state)

    open_trades   = get_open_trades()
    closed_trades = get_closed_trades()[:50]   # last 50
    portfolio     = portfolio_summary()

    return jsonify({
        "ok":          True,
        "cycle":       state.get("cycle", 0),
        "lastRun":     state.get("last_run"),
        "paperMode":   ALPHA_PAPER_MODE,
        "hmmStates":   state.get("hmm_states", {}),
        "regimeMap":   state.get("last_result", {}).get("regime_map", {}),
        "openTrades":  open_trades,
        "closedTrades": closed_trades,
        "portfolio":   {
            "openCount":    portfolio["open_count"],
            "closedCount":  portfolio["closed_count"],
            "winCount":     portfolio["win_count"],
            "lossCount":    portfolio["loss_count"],
            "winRate":      portfolio["win_rate"],
            "totalNetPnl":  portfolio["total_net_pnl"],
            "totalFees":    portfolio["total_fees"],
        },
    })


@app.route("/alpha/open-trades")
def open_trades():
    """Quick open trades check — useful for monitoring scripts."""
    _require_key()
    return jsonify({"ok": True, "trades": get_open_trades()})


# ── Server launcher ───────────────────────────────────────────────────────────

def start_server_thread() -> threading.Thread:
    """
    Start the Flask server in a background daemon thread.
    Returns the thread (already started).

    Usage in run_alpha.py:
        server_thread = start_server_thread()
        engine.run()   # blocks main thread
    """
    def _run():
        logger.info("Alpha HTTP server starting on port %d", ALPHA_PORT)
        # use_reloader=False is critical — reloader forks and breaks the engine
        app.run(host="0.0.0.0", port=ALPHA_PORT, use_reloader=False, threaded=True)

    t = threading.Thread(target=_run, daemon=True, name="alpha-server")
    t.start()
    logger.info("Alpha server thread started (port=%d)", ALPHA_PORT)
    return t

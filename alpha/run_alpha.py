"""
╔══════════════════════════════════════════════════════════════════════════════╗
║  ALPHA — ENTRYPOINT                                                          ║
║  Local:  python alpha/run_alpha.py                                           ║
║  Prod:   CMD ["python", "-m", "alpha.run_alpha"]  (via Dockerfile.alpha)     ║
║                                                                              ║
║  Flags:                                                                      ║
║    --once     Run a single cycle then exit                                   ║
║    --refresh  Force-refresh Bybit data cache before running                  ║
║    --status   Print portfolio status and exit                                ║
║    --server   Start HTTP server only (no trading loop) — for debug           ║
║                                                                              ║
║  In normal (no flag) mode: starts Flask HTTP server in background thread    ║
║  then runs the 15-minute trading loop forever.                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

import sys
import os
import argparse

# Ensure project root is on path (needed for tools.data_cache import in alpha_data.py)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from alpha.alpha_config import ALPHA_PAPER_MODE, DEPLOYMENT_LOCKED, ALPHA_COINS
from alpha.alpha_logger import get_logger

logger = get_logger("run")


def main() -> None:
    parser = argparse.ArgumentParser(description="Alpha Engine — Synaptic")
    parser.add_argument("--once",    action="store_true", help="Run a single cycle then exit")
    parser.add_argument("--refresh", action="store_true", help="Force-refresh data cache before running")
    parser.add_argument("--status",  action="store_true", help="Show portfolio status and exit")
    parser.add_argument("--server",  action="store_true", help="Start HTTP server only (no trading loop)")
    parser.add_argument("--no-server", action="store_true", dest="no_server", help="Skip HTTP server (local dev)")
    args = parser.parse_args()

    print()
    print("╔══════════════════════════════════════════════════════╗")
    print("║           ALPHA ENGINE — SYNAPTIC                   ║")
    print(f"║  Mode: {'PAPER' if ALPHA_PAPER_MODE else 'LIVE':6}  |  Deploy lock: {'ON ✓' if DEPLOYMENT_LOCKED else 'OFF ⚠️':6}  |  Local  ║")
    print(f"║  Coins: {', '.join(c.replace('USDT','') for c in ALPHA_COINS):<40}  ║")
    print("╚══════════════════════════════════════════════════════╝")
    print()

    # Status-only mode
    if args.status:
        from alpha.alpha_tradebook import portfolio_summary, get_open_trades
        s = portfolio_summary()
        print("Portfolio summary:")
        print(f"  Open trades:   {s['open_count']}")
        print(f"  Closed trades: {s['closed_count']}")
        print(f"  Win rate:      {s['win_rate']:.1f}%")
        print(f"  Total P&L:     ${s['total_net_pnl']:+,.2f}")
        print(f"  Total fees:    ${s['total_fees']:.2f}")
        for t in get_open_trades():
            print(f"  → OPEN {t['trade_id']} {t['symbol']} {t['side']} @ ${t['entry_price']:,.4f}")
        return

    # Optional force-refresh of Bybit cache
    if args.refresh:
        logger.info("Force-refreshing Bybit cache ...")
        from alpha.alpha_data import get_all_alpha_data
        data = get_all_alpha_data(force_refresh=True)
        ok = [s for s in data]
        fail = [s for s in ALPHA_COINS if s not in data]
        logger.info("Cache refresh: OK=%s  FAIL=%s", ok, fail)

    # ── Server-only mode (debug) ───────────────────────────────────────
    if args.server:
        from alpha.alpha_server import start_server_thread
        from alpha.alpha_config import ALPHA_PORT
        logger.info("Server-only mode — no trading loop")
        start_server_thread()
        print(f"Alpha HTTP server running on http://localhost:{ALPHA_PORT}")
        print("GET /alpha/health  — no auth")
        print("GET /alpha/data    — requires X-Alpha-Key header")
        import time
        try:
            while True:
                time.sleep(60)
        except KeyboardInterrupt:
            pass
        return

    from alpha.alpha_engine import AlphaEngine
    engine = AlphaEngine()

    if args.once:
        logger.info("Running single cycle ...")
        result = engine.run_once()
        print("\nCycle result:")
        print(f"  Data OK:    {result['data_ok']}")
        print(f"  Data fail:  {result['data_fail']}")
        print(f"  Entries:    {result['entries']}")
        print(f"  Exits:      {result['exits']}")
        print(f"  BE:         {result['be_activations']}")
        print(f"  Errors:     {result['errors']}")
    else:
        # ── Production: start HTTP server + trading loop ───────────────
        if not args.no_server:
            from alpha.alpha_server import start_server_thread, update_state
            start_server_thread()

            # Patch engine to push state to server after each cycle
            _original_save = engine._save_state
            def _patched_save(result):
                _original_save(result)
                update_state({
                    "cycle":      engine._cycle,
                    "last_run":   __import__("datetime").datetime.now(
                                    __import__("datetime").timezone.utc).isoformat(),
                    "hmm_states": {s: engine._hmms[s].to_dict() for s in engine._hmms},
                    "last_result": {"regime_map": result.get("regime_map", {})},
                })
            engine._save_state = _patched_save

        logger.info("Starting continuous loop (Ctrl+C to stop) ...")
        engine.run()


if __name__ == "__main__":
    main()

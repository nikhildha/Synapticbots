"""
Project Regime-Master — Real-Time Price Stream
Maintains a live price cache via Binance WebSocket bookTicker streams.
Updates every ~100ms (vs 10s REST polling), eliminating gap-through risk
for max-loss and trailing SL checks.

Usage:
    from price_stream import get_price_stream
    ps = get_price_stream()
    ps.ensure_subscribed(["BTCUSDT", "ETHUSDT"])
    prices = ps.get_all_prices()   # {symbol: float}

Reconnect behaviour:
    A background watchdog thread monitors last-update timestamps.
    If no price update is received for any subscribed symbol within
    STALE_THRESHOLD_SECONDS (default 60 s), the WebSocket manager is
    torn down and restarted from scratch, re-subscribing to all symbols.
    This resolves the recurring "Read loop has been closed" crash.
"""
import threading
import logging
import time
import urllib.request
import json as _json

logger = logging.getLogger("PriceStream")

# How long (seconds) with no WS update before we declare the connection dead
STALE_THRESHOLD_SECONDS = 60
# How long (seconds) to wait between watchdog checks
WATCHDOG_INTERVAL_SECONDS = 20
# How long (seconds) to wait before retrying a failed subscription
SUB_RETRY_COOLDOWN_SECONDS = 60   # reduced from 300 — retry failed subs faster
# REST fallback: poll prices via REST when WS is unavailable
REST_POLL_INTERVAL_SECONDS = 5    # poll every 5s (vs 100ms WS, but better than 300s gap)
BINANCE_REST_PRICE_URL = "https://fapi.binance.com/fapi/v1/ticker/price"


class PriceStreamManager:
    """
    Thread-safe real-time price cache using Binance WebSocket bookTicker.

    - Subscribes to individual symbol streams on demand.
    - Uses best bid/ask midpoint as the live price reference.
    - Auto-reconnects via watchdog when connection silently dies.
    - Falls back gracefully if WS is unavailable.
    """

    def __init__(self):
        self._prices: dict[str, float] = {}        # symbol → latest price
        self._lock = threading.Lock()
        self._twm = None                           # ThreadedWebsocketManager
        self._subscribed: set[str] = set()
        self._streams: dict[str, str] = {}         # symbol → stream key
        self._running = False
        self._last_update: dict[str, float] = {}   # symbol → epoch of last update
        self._watchdog_thread: threading.Thread | None = None
        self._failed_subs: dict[str, float] = {}   # symbol → epoch of last failure (cooldown guard)
        self._rest_poll_thread: threading.Thread | None = None  # REST fallback thread

    # ─── Public API ─────────────────────────────────────────────────────────

    def start(self):
        """Start the WebSocket manager and watchdog (call once on engine startup)."""
        if self._running:
            return
        self._running = True
        self._init_twm()
        self._start_watchdog()
        logger.info("⚡ PriceStream: WebSocket manager + watchdog started")

    def stop(self):
        """Gracefully stop all WebSocket connections and the watchdog."""
        self._running = False
        self._stop_twm()
        logger.info("🔌 PriceStream: WebSocket manager stopped")

    def ensure_subscribed(self, symbols: list[str]):
        """
        Subscribe to any symbols not yet tracked.
        Safe to call repeatedly — only subscribes to new symbols.
        Symbols should be Binance-style (e.g. 'BTCUSDT').
        """
        if not self._running or not self._twm:
            return
        with self._lock:
            new_syms = [s.upper() for s in symbols if s.upper() not in self._subscribed]
        for sym in new_syms:
            self._subscribe_one(sym)

    def get_price(self, symbol: str) -> float | None:
        """Return latest cached price for a symbol, or None if not yet received."""
        with self._lock:
            return self._prices.get(symbol.upper())

    def get_all_prices(self) -> dict[str, float]:
        """Return a snapshot of all cached prices: {symbol: price}."""
        with self._lock:
            return dict(self._prices)

    def is_fresh(self, symbol: str, max_age_seconds: float = 30.0) -> bool:
        """
        Returns True if we have a recent price (within max_age_seconds).
        Use this to decide whether to fall back to REST.
        """
        with self._lock:
            last = self._last_update.get(symbol.upper())
        if last is None:
            return False
        return (time.time() - last) <= max_age_seconds

    # ─── Internal ───────────────────────────────────────────────────────────

    def _init_twm(self):
        """Initialize (or re-initialize) the ThreadedWebsocketManager.
        
        On failure, automatically starts a REST fallback polling thread so prices
        stay fresh even when the Binance WebSocket fails to initialize.
        """
        try:
            from binance import ThreadedWebsocketManager
            # Pass None (not "") for public market data streams — empty strings cause
            # auth failures on some network environments (e.g. Railway) even for
            # unauthenticated endpoints.
            twm = ThreadedWebsocketManager(api_key=None, api_secret=None)
            twm.start()
            self._twm = twm
            # Clear failed-sub cooldowns on successful (re-)init so all symbols retry
            with self._lock:
                self._failed_subs.clear()
            logger.info("⚡ PriceStream: ThreadedWebsocketManager ready")
        except Exception as e:
            logger.warning(
                "⚠️ PriceStream: WebSocket init failed (%s) — using REST fallback poll every %ds",
                e, REST_POLL_INTERVAL_SECONDS
            )
            self._twm = None
            # Start REST fallback so prices don't go stale for 300s
            self._start_rest_fallback()

    def _stop_twm(self):
        """Tear down the current ThreadedWebsocketManager cleanly."""
        twm = self._twm
        self._twm = None
        self._streams.clear()
        if twm:
            try:
                twm.stop()
            except Exception as e:
                logger.debug("PriceStream: TWM stop error (expected on crash): %s", e)

    def _subscribe_one(self, sym: str):
        """Subscribe a single symbol to the bookTicker stream."""
        if not self._twm:
            return

        # Cooldown guard — don't retry a recently-failed subscription every heartbeat.
        # After a failure, wait SUB_RETRY_COOLDOWN_SECONDS before trying again.
        now = time.time()
        with self._lock:
            last_fail = self._failed_subs.get(sym, 0)
        if now - last_fail < SUB_RETRY_COOLDOWN_SECONDS:
            remaining = int(SUB_RETRY_COOLDOWN_SECONDS - (now - last_fail))
            logger.debug("PriceStream: %s sub cooldown active (%ds remaining) — skip", sym, remaining)
            return

        try:
            key = self._twm.start_symbol_book_ticker_socket(
                callback=self._on_message,
                symbol=sym,
            )
            with self._lock:
                self._streams[sym] = key
                self._subscribed.add(sym)
                self._failed_subs.pop(sym, None)  # clear failure on success
            logger.info("📡 PriceStream: Subscribed to %s bookTicker", sym)
        except Exception as e:
            with self._lock:
                self._failed_subs[sym] = now  # record failure time for cooldown
            logger.warning(
                "⚠️ PriceStream: Failed to subscribe %s: %s (retry in %ds)",
                sym, e, SUB_RETRY_COOLDOWN_SECONDS
            )

    def _start_rest_fallback(self):
        """Start a background REST polling thread as fallback when WebSocket is unavailable.
        
        Polls Binance Futures REST /fapi/v1/ticker/price every REST_POLL_INTERVAL_SECONDS.
        Only fetches prices for currently subscribed symbols.
        Stops automatically when WebSocket becomes available (twm is set).
        """
        if self._rest_poll_thread and self._rest_poll_thread.is_alive():
            return  # already running

        def rest_poll():
            logger.info("📡 PriceStream REST fallback: polling every %ds", REST_POLL_INTERVAL_SECONDS)
            while self._running:
                # If WebSocket comes back, let it take over — REST stays as safety net
                with self._lock:
                    symbols = list(self._subscribed)
                if symbols:
                    try:
                        url = BINANCE_REST_PRICE_URL
                        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                        with urllib.request.urlopen(req, timeout=5) as resp:
                            data = _json.loads(resp.read())
                        # data is a list of {"symbol": "BTCUSDT", "price": "85000.00"}
                        price_map = {item["symbol"]: float(item["price"]) for item in data if "symbol" in item}
                        now = time.time()
                        with self._lock:
                            for sym in symbols:
                                if sym in price_map:
                                    # Only update if WS hasn't updated recently (WS takes priority)
                                    last_ws = self._last_update.get(sym, 0)
                                    if now - last_ws > REST_POLL_INTERVAL_SECONDS:
                                        self._prices[sym] = price_map[sym]
                                        self._last_update[sym] = now
                    except Exception as e:
                        logger.debug("PriceStream REST poll error: %s", e)
                time.sleep(REST_POLL_INTERVAL_SECONDS)
            logger.info("📡 PriceStream REST fallback: stopped")

        t = threading.Thread(target=rest_poll, name="PriceStream-REST", daemon=True)
        t.start()
        self._rest_poll_thread = t

    def _start_watchdog(self):
        """Start a background thread that monitors connection health."""
        def watchdog():
            logger.info("🐕 PriceStream watchdog: started (checks every %ds, stale=%ds)",
                        WATCHDOG_INTERVAL_SECONDS, STALE_THRESHOLD_SECONDS)
            while self._running:
                time.sleep(WATCHDOG_INTERVAL_SECONDS)
                if not self._running:
                    break
                self._check_and_reconnect()

        t = threading.Thread(target=watchdog, name="PriceStream-Watchdog", daemon=True)
        t.start()
        self._watchdog_thread = t

    def _check_and_reconnect(self):
        """
        Check if any subscribed symbol has gone stale.
        If so, restart the entire WebSocket manager and re-subscribe.
        """
        now = time.time()
        with self._lock:
            subscribed = set(self._subscribed)
            last_updates = dict(self._last_update)

        if not subscribed:
            return   # nothing subscribed yet — nothing to check

        stale = [
            sym for sym in subscribed
            if (now - last_updates.get(sym, 0)) > STALE_THRESHOLD_SECONDS
        ]

        if not stale:
            return   # all fresh — nothing to do

        logger.warning(
            "⚠️ PriceStream watchdog: %d symbols stale (e.g. %s) — restarting WebSocket",
            len(stale), stale[:3]
        )

        # Tear down old connection
        self._stop_twm()

        # Small pause to let OS clean up sockets
        time.sleep(3)

        # Re-initialize
        self._init_twm()
        if not self._twm:
            logger.error("❌ PriceStream watchdog: re-init failed — will retry next cycle")
            return

        # Re-subscribe to ALL previously subscribed symbols
        # Also reset failed-sub cooldowns so all symbols get a fresh attempt
        with self._lock:
            to_resubscribe = set(self._subscribed)
            self._subscribed.clear()     # clear so _subscribe_one adds them back
            self._failed_subs.clear()    # reset cooldowns — fresh TWM deserves fresh retry

        for sym in to_resubscribe:
            self._subscribe_one(sym)

        logger.info("✅ PriceStream watchdog: reconnected, re-subscribed %d symbols", len(to_resubscribe))

    def _on_message(self, msg: dict):
        """
        Callback for bookTicker stream messages.

        bookTicker format:
            {"u": updateId, "s": "BTCUSDT", "b": "69000.0", "B": "1.5", "a": "69001.0", "A": "2.0"}

        We use midpoint of bid/ask.
        For risk management (max loss / SL), using ask slightly overestimates
        losses on longs, which is the conservative (safer) choice.
        """
        if not msg or msg.get("e") == "error":
            logger.debug("PriceStream: WS error message: %s", msg)
            return
        try:
            symbol = msg.get("s", "").upper()
            if not symbol:
                return
            # Use midpoint of bid/ask for a balanced price
            bid = float(msg.get("b", 0) or 0)
            ask = float(msg.get("a", 0) or 0)
            if bid > 0 and ask > 0:
                price = (bid + ask) / 2.0
            elif ask > 0:
                price = ask
            elif bid > 0:
                price = bid
            else:
                return

            with self._lock:
                self._prices[symbol] = price
                self._last_update[symbol] = time.time()
        except Exception as e:
            logger.debug("PriceStream: Message parse error: %s | msg: %s", e, msg)


# ─── Module-level singleton ──────────────────────────────────────────────────

_manager: PriceStreamManager | None = None
_manager_lock = threading.Lock()


def get_price_stream() -> PriceStreamManager:
    """
    Get (or create) the global PriceStreamManager singleton.
    Starts the WebSocket manager on first call.
    """
    global _manager
    with _manager_lock:
        if _manager is None:
            _manager = PriceStreamManager()
            _manager.start()
    return _manager


def shutdown_price_stream():
    """Cleanly stop the global price stream (call on engine shutdown)."""
    global _manager
    with _manager_lock:
        if _manager is not None:
            _manager.stop()
            _manager = None

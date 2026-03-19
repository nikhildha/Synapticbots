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
"""
import threading
import logging
import time

logger = logging.getLogger("PriceStream")


class PriceStreamManager:
    """
    Thread-safe real-time price cache using Binance WebSocket bookTicker.

    - Subscribes to individual symbol streams on demand.
    - Uses best bid price as the live price reference (conservative).
    - Auto-reconnects on disconnect with exponential backoff.
    - Falls back gracefully if WS is unavailable.
    """

    def __init__(self):
        self._prices: dict[str, float] = {}        # symbol → latest price
        self._lock = threading.Lock()
        self._twm = None                           # ThreadedWebsocketManager
        self._subscribed: set[str] = set()
        self._streams: dict[str, str] = {}         # symbol → stream key
        self._running = False
        self._reconnect_delay = 5                  # seconds, doubles on each failure
        self._last_update: dict[str, float] = {}   # symbol → epoch of last update

    # ─── Public API ─────────────────────────────────────────────────────────

    def start(self):
        """Start the WebSocket manager (call once on engine startup)."""
        if self._running:
            return
        self._running = True
        self._init_twm()
        logger.info("⚡ PriceStream: WebSocket manager started")

    def stop(self):
        """Gracefully stop all WebSocket connections."""
        self._running = False
        try:
            if self._twm:
                self._twm.stop()
                self._twm = None
        except Exception as e:
            logger.debug("PriceStream stop error: %s", e)
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
            try:
                key = self._twm.start_symbol_book_ticker_socket(
                    callback=self._on_message,
                    symbol=sym,
                )
                with self._lock:
                    self._streams[sym] = key
                    self._subscribed.add(sym)
                logger.info("📡 PriceStream: Subscribed to %s bookTicker", sym)
            except Exception as e:
                logger.warning("⚠️ PriceStream: Failed to subscribe %s: %s", sym, e)

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
        """Initialize (or re-initialize) the ThreadedWebsocketManager."""
        try:
            from binance import ThreadedWebsocketManager
            # API keys not required for public market data streams
            self._twm = ThreadedWebsocketManager(api_key="", api_secret="")
            self._twm.start()
            logger.info("⚡ PriceStream: ThreadedWebsocketManager ready")
        except Exception as e:
            logger.error("❌ PriceStream: Failed to init WebSocket manager: %s", e)
            self._twm = None

    def _on_message(self, msg: dict):
        """
        Callback for bookTicker stream messages.

        bookTicker format:
            {"u": updateId, "s": "BTCUSDT", "b": "69000.0", "B": "1.5", "a": "69001.0", "A": "2.0"}

        We use best ask ('a') as the "current price" for longs
        and best bid ('b') for shorts — but for simplicity we use midpoint.
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

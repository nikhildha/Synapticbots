"""
Project Regime-Master — Main Bot Loop (Multi-Coin)
Scans top 50 coins by volume, runs HMM regime analysis on each,
and deploys paper/live trades on all eligible symbols simultaneously.
"""
import gc
import json
import os
import time
import logging
import threading
import urllib.request
from datetime import datetime, timezone, timedelta

IST = timezone(timedelta(hours=5, minutes=30))

import config
from hmm_brain import HMMBrain, MultiTFHMMBrain
from data_pipeline import fetch_klines, get_multi_timeframe_data, _get_binance_client, compute_market_structure
from feature_engine import compute_all_features, compute_hmm_features, compute_trend, compute_ema
from execution_engine import ExecutionEngine
from risk_manager import RiskManager
from coin_scanner import get_top_coins_by_volume, get_active_bot_segment_pool
import tradebook
import telegram as tg

import orderflow_engine as _of_mod
import coindcx_client as cdx
from llm_reasoning import AthenaEngine
from price_stream import get_price_stream, shutdown_price_stream
from segment_features import get_segment_for_coin  # promoted from inline import — needed at line ~1350
# ─── Logging Setup ───────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(os.path.join(config.DATA_DIR, "bot.log"), encoding="utf-8"),
    ]
)
# Suppress Binance library's internal WS error spam.
# When a connection drops, binance.ws.threaded_stream fires 100s of identical
# "Read loop has been closed" errors — one per stream thread.
# Our watchdog in price_stream.py already handles reconnection; the spam adds
# no diagnostic value and hits Railway's log rate limit.
logging.getLogger("binance.ws.threaded_stream").setLevel(logging.CRITICAL)
logging.getLogger("binance").setLevel(logging.WARNING)
logger = logging.getLogger("RegimeMaster")

# ─── Signal Broadcast Audit Logger ───────────────────────────────────────────
# Separate rotating log file: every signal after Athena verdict, per bot receive
import logging.handlers as _lh
_broadcast_log_path = os.path.join(config.DATA_DIR, "signal_broadcast.log")
_bcast_handler = _lh.TimedRotatingFileHandler(
    _broadcast_log_path, when="midnight", backupCount=7, encoding="utf-8"
)
_bcast_handler.setFormatter(logging.Formatter("%(asctime)s %(message)s", datefmt="%Y-%m-%dT%H:%M:%S"))
broadcast_logger = logging.getLogger("signal_broadcast")
broadcast_logger.setLevel(logging.INFO)
broadcast_logger.addHandler(_bcast_handler)
broadcast_logger.propagate = False  # Don't duplicate to bot.log

def _bcast(event: str, cycle: int, bot_name: str, bot_id: str, sym: str, side: str = "",
           segment: str = "", conf: float = 0, detail: str = ""):
    """Structured broadcast audit log. One line per signal event for full traceability."""
    broadcast_logger.info(
        "| cycle=%-4d | %-20s | bot=%-28s | id=%-24s | sym=%-10s | side=%-5s | seg=%-8s | conf=%4.0f%% | %s",
        cycle, event.upper(), bot_name[:28], bot_id[:24], sym, side, segment, conf * 100, detail
    )



# ─── Bot name → segment mapping (fallback when segment_filter not in ENGINE_ACTIVE_BOTS) ──
# Handles engine restart case where bots haven't been re-registered via toggle
def _infer_segment_from_name(bot_name: str) -> str:
    """
    Infer the segment_filter from the bot name.
    E.g.: 'L1 Specialist' → 'L1', 'Gaming Specialist' → 'Gaming',
          'Synaptic Adaptive — ALL' → 'ALL'
    Returns 'ALL' if no known segment keyword is found (safe default for router bots).
    """
    name_lower = bot_name.lower()
    # Explicit 'ALL' type bots
    if "all" in name_lower or "adaptive" in name_lower or "router" in name_lower:
        return "ALL"
    # Map known segment keywords
    segment_keywords = {
        "l1": "L1",
        "l2": "L2",
        "defi": "DeFi",
        "ai": "AI",
        "meme": "Meme",
        "rwa": "RWA",
        "gaming": "Gaming",
        "depin": "DePIN",
        "modular": "Modular",
        "oracle": "Oracles",
    }
    for keyword, segment in segment_keywords.items():
        if keyword in name_lower:
            return segment
    return "ALL"  # Safe default


class RegimeMasterBot:
    """
    Multi-coin orchestrator for Project Regime-Master.

    Heartbeat: every 1 minute (LOOP_INTERVAL_SECONDS)
      - Process commands (kill switch, reset)
      - Sync positions (detect SL/TP auto-closes)
      - Update unrealized P&L

    Full analysis: every 15 minutes (ANALYSIS_INTERVAL_SECONDS)
      1. Periodically refresh top-50 coin list (every SCAN_INTERVAL_CYCLES)
      2. For each coin: fetch data → HMM regime → check eligibility → trade
      3. Track active positions to respect MAX_CONCURRENT_POSITIONS
      4. Check global risk (kill switch, drawdown)
    """

    def __init__(self):
        self._running = True  # Graceful shutdown flag (checked in run() loop)

        # ── Critical deps — wrapped to prevent init crashes from burning retries ──
        try:
            self.executor = ExecutionEngine()
        except Exception as e:
            logger.error("⚠️ ExecutionEngine init failed: %s — using fallback", e)
            self.executor = ExecutionEngine()  # retry once

        try:
            self.risk = RiskManager()
        except Exception as e:
            logger.error("⚠️ RiskManager init failed: %s — using fallback", e)
            self.risk = RiskManager()

        self._trade_count = 0
        self._cycle_count = 0
        self._last_cycle_duration = 0
        self._last_analysis_time = 0.0  # epoch — triggers immediate first run

        # Multi-coin state
        self._coin_list = []
        self._active_positions = {}  # symbol → {regime, confidence, side, entry_time}
        self._coin_brains = {}       # symbol → HMMBrain (cached per coin) — legacy 1H
        self._multi_tf_brains = {}   # symbol → MultiTFHMMBrain (3 TFs per coin)
        self._coin_states = {}       # symbol → latest state dict (for dashboard)
        self._live_prices = {}       # symbol → {ls, fr, ...} (fetched each cycle)
        self._BRAIN_CACHE_MAX = 5    # LRU eviction cap (down from 20) — strict limit protects Railway 300MB RAM tier from OOM kills

        # ── Signal Queue ────────────────────────────────────────────────────────
        # Stores HMM-qualified signals that couldn't deploy this cycle (no bots,
        # Guard 4 blocked, max-cap hit, etc.). Re-attempted next cycle.
        # Format: {symbol → {result_dict, expires_at, queued_at, cycles_pending}}
        self._pending_signals: dict = {}
        self._SIGNAL_QUEUE_TTL_SECONDS = 480   # 8 min — 1 cycle TTL (entry lost after one retry)

        # ── Veto Log ────────────────────────────────────────────────────────────
        # Every Athena VETO is stored here with price, reason, side, conviction
        # so the cockpit can retrospectively check what happened to the vetoed coin.
        self._veto_log: list = []   # [{symbol, price, side, conviction, reason, ts}]
        self._VETO_LOG_MAX = 50     # keep last 50 vetoes

        # ─── Coin pool configuration ─────────────────────────────────────────
        # Pool size matches config.TOP_COINS_LIMIT to scan all coins per cycle
        self._full_coin_pool: list = []
        self._scan_rotation: int = 0
        self._SCAN_BATCH_SIZE: int = config.TOP_COINS_LIMIT
        self._SCAN_POOL_SIZE: int = config.TOP_COINS_LIMIT


        # ── Startup: sync _active_positions from tradebook ──────────
        try:
            self._load_positions_from_tradebook()
        except Exception as e:
            logger.error("⚠️ Failed to load positions from tradebook on startup: %s", e)



        # ── Order Flow Engine (lazy singleton) ────────────────────────
        self._orderflow = None
        if config.ORDERFLOW_ENABLED:
            try:
                self._orderflow = _of_mod.get_engine()
                logger.info("📊 Order Flow Engine ready (L2 depth + taker flow + cumDelta)")
            except Exception as e:
                logger.warning("⚠️  Order Flow Engine failed to load: %s", e)

        # ── Athena — LLM Reasoning Layer ───────────────────────────────
        self._athena = None
        if config.LLM_REASONING_ENABLED:
            try:
                self._athena = AthenaEngine()
                logger.info("🏛️ Athena LLM Reasoning Layer ready (model: %s)", config.LLM_MODEL)
            except Exception as e:
                logger.warning("⚠️  Athena failed to load: %s", e)

        # ── Real-Time Price Stream (WebSocket bookTicker → ~100ms updates) ──
        # Replaces 10s REST polling for max-loss / trailing SL checks.
        # Falls back to REST automatically if WS connection is not yet ready.
        try:
            self._price_stream = get_price_stream()
            logger.info("⚡ PriceStream: WebSocket price cache ready")
        except Exception as e:
            logger.warning("⚠️ PriceStream failed to start: %s — will fall back to REST", e)
            self._price_stream = None

    # ─── Main Loop ───────────────────────────────────────────────────────────

    def run(self):
        mode = "PAPER" if config.PAPER_TRADE else "LIVE"
        net = "TESTNET" if config.TESTNET else "PRODUCTION"
        coin_mode = "MULTI-COIN" if config.MULTI_COIN_MODE else "SINGLE"
        logger.info(
            "🚀 Regime-Master Bot Started | %s mode | %s | %s | Max Positions: %d",
            mode, net, coin_mode, config.MAX_CONCURRENT_POSITIONS,
        )
        logger.info(
            "⏱ Heartbeat: %ds | Full analysis: every %ds",
            config.LOOP_INTERVAL_SECONDS, config.ANALYSIS_INTERVAL_SECONDS,
        )

        while self._running:
            try:
                self._heartbeat()
                self._evict_brain_cache()  # Memory safeguard
                gc.collect()  # Force GC after eviction to prevent OOM on Railway
                time.sleep(config.LOOP_INTERVAL_SECONDS)

            except KeyboardInterrupt:
                logger.info("⏹ Bot stopped (SIGTERM/KeyboardInterrupt).")
                self._running = False
                raise  # Re-raise so _run_engine() sees it as a signal, not clean exit
            except Exception as e:
                err_str = str(e)
                # ── Binance IP ban: parse expiry and sleep until it passes ──
                if 'banned until' in err_str and '-1003' in err_str:
                    import re
                    m = re.search(r'banned until (\d+)', err_str)
                    if m:
                        ban_until_ms = int(m.group(1))
                        wait_sec = max(10, (ban_until_ms - int(time.time() * 1000)) / 1000 + 10)
                        logger.warning(
                            "🔒 Binance IP ban — sleeping %.0fs until ban expires",
                            wait_sec,
                        )
                        time.sleep(min(wait_sec, 600))  # cap at 10 min
                        continue
                logger.error("⚠️ Loop error: %s", e, exc_info=True)
                time.sleep(config.ERROR_RETRY_SECONDS)

        logger.info("🛑 Engine loop exited (self._running = False).")

    def _heartbeat(self):
        """1-minute heartbeat: lightweight checks + trigger full analysis on schedule."""
        # ── Check engine pause state ──────────────────────────────────
        # H3 FIX: json imported at module level (line 6), no inline import needed
        try:
            state_path = os.path.join(os.path.dirname(__file__), "data", "engine_state.json")
            if os.path.exists(state_path):
                with open(state_path) as f:
                    state = json.load(f)
                if state.get("status") == "paused":
                    # Check if timed halt has expired
                    halt_until = state.get("halt_until")
                    if halt_until:
                        try:
                            halt_dt = datetime.fromisoformat(halt_until.replace("Z", "+00:00")).replace(tzinfo=None)
                            if datetime.now(IST).replace(tzinfo=None) >= halt_dt:
                                # Auto-resume: halt period expired
                                resume_state = {"status": "running", "resumed_at": datetime.now(IST).replace(tzinfo=None).isoformat() + "Z", "paused_by": None}
                                with open(state_path, "w") as fw:
                                    json.dump(resume_state, fw, indent=2)
                                logger.info("✅ Auto-halt expired — engine RESUMED automatically")
                                self._pause_logged = False
                            else:
                                remaining = (halt_dt - datetime.now(IST).replace(tzinfo=None)).total_seconds() / 60
                                if not getattr(self, '_pause_logged', False):
                                    reason = state.get("reason", "Auto-halted")
                                    logger.warning("⏸️  Engine HALTED: %s (%.0f min remaining)", reason, remaining)
                                    self._pause_logged = True
                                return  # Still halted
                        except Exception:
                            pass
                    else:
                        # Manual pause (no expiry)
                        if not getattr(self, '_pause_logged', False):
                            logger.info("⏸️  Engine PAUSED via dashboard — skipping all analysis")
                            self._pause_logged = True
                        return  # Skip entire heartbeat
            self._pause_logged = False
        except Exception:
            pass

        # Always: process commands (kill switch / reset)
        self._process_commands()

        if self.risk.is_killed:
            return

        # Always: sync positions (detect SL/TP auto-closes)
        self._sync_positions()

        # Always: update unrealized P&L + trailing SL/TP (with live funding rates)
        try:
            # Build funding rates dict from live CoinDCX prices
            funding_rates = {}
            for cdx_pair, info in getattr(self, '_live_prices', {}).items():
                try:
                    sym = cdx.from_coindcx_pair(cdx_pair)
                    fr = float(info.get("fr", 0)) or float(info.get("efr", 0))
                    if fr != 0:
                        funding_rates[sym] = fr
                except Exception:
                    pass

            # ── WebSocket price feed: ensure active symbols are subscribed ──
            # Provides ~100ms price updates (vs 10s REST), eliminating gap-through risk.
            ws_prices = {}
            if self._price_stream is not None:
                try:
                    active_trades = tradebook.get_active_trades()
                    active_syms = list({t['symbol'] for t in active_trades if t.get('symbol')})
                    if active_syms:
                        self._price_stream.ensure_subscribed(active_syms)
                    # Only use WS prices for symbols with a fresh reading (< 30s old)
                    for sym in active_syms:
                        if self._price_stream.is_fresh(sym, max_age_seconds=30.0):
                            price = self._price_stream.get_price(sym)
                            if price:
                                ws_prices[sym] = price
                    if ws_prices:
                        logger.debug("⚡ PriceStream: using WS prices for %d symbols", len(ws_prices))
                except Exception as e:
                    logger.debug("PriceStream subscription error: %s", e)

            # ── REST supplement: fetch prices for deployed coins missing from WS ──
            # Deployed coins are excluded from the scan pool, so the WS stream may
            # not have a fresh reading for them.  A single batch Binance REST call
            # costs ~50ms and guarantees every active trade gets a price.
            try:
                all_active_syms = list({t['symbol'] for t in tradebook.get_active_trades() if t.get('symbol')})
                missing_syms = [s for s in all_active_syms if s not in ws_prices]
                if missing_syms:
                    import requests as _req
                    import json as _json
                    _resp = _req.get(
                        "https://api.binance.com/api/v3/ticker/price",
                        params={"symbols": _json.dumps(missing_syms)},
                        timeout=4,
                    )
                    if _resp.status_code == 200:
                        for _item in _resp.json():
                            _sym = _item.get("symbol")
                            _px  = _item.get("price")
                            if _sym and _px:
                                ws_prices[_sym] = float(_px)
                        logger.debug("⚡ REST supplement: fetched prices for %d deployed symbols", len(missing_syms))
            except Exception as _rest_err:
                logger.debug("REST supplement price fetch failed: %s", _rest_err)

            # Pass combined prices (WS + REST supplement) to update_unrealized
            tradebook.update_unrealized(funding_rates=funding_rates, prices=ws_prices or None)
        except Exception as e:
            logger.warning("⚠️ Tradebook unrealized update error (max-loss/SL/TP guards may not have run): %s", e, exc_info=True)

        # Live mode: sync CoinDCX positions → tradebook → trailing SL/TP
        if not config.PAPER_TRADE:
            try:
                self._sync_coindcx_positions()
            except Exception as e:
                logger.debug("CoinDCX position sync error: %s", e)
            try:
                tradebook.sync_live_tpsl()
            except Exception as e:
                logger.debug("Live TPSL sync error: %s", e)

        # Check for manual trigger from dashboard
        trigger_file = os.path.join(config.DATA_DIR, "force_cycle.trigger")
        force = os.path.exists(trigger_file)
        if force:
            try:
                os.remove(trigger_file)
            except Exception:
                pass
            logger.info("⚡ Manual cycle trigger received from dashboard!")

        # Check if it's time for a full analysis cycle
        now = time.time()
        elapsed = now - self._last_analysis_time
        if force or elapsed >= config.ANALYSIS_INTERVAL_SECONDS:
            logger.info("🧠 Running full analysis cycle (%.0fs since last)...", elapsed)
            self._tick()
            self._last_analysis_time = time.time()
            self._save_timing()  # Update timing for dashboard
        else:
            remaining = config.ANALYSIS_INTERVAL_SECONDS - elapsed
            logger.debug("💤 Next analysis in %.0fs...", remaining)

    def _save_timing(self):
        """Persist last/next analysis timestamps for the dashboard."""
        try:
            multi = {}
            if os.path.exists(config.MULTI_STATE_FILE):
                with open(config.MULTI_STATE_FILE, "r") as f:
                    multi = json.load(f)
            multi["last_analysis_time"] = datetime.utcnow().isoformat() + "Z"
            nxt = self._last_analysis_time + config.ANALYSIS_INTERVAL_SECONDS
            # F5 FIX: Use UTC+Z for next_analysis_time (matching last_analysis_time format)
            multi["next_analysis_time"] = datetime.utcfromtimestamp(nxt).isoformat() + "Z"
            multi["analysis_interval_seconds"] = config.ANALYSIS_INTERVAL_SECONDS
            with open(config.MULTI_STATE_FILE, "w") as f:
                json.dump(multi, f, indent=2)
        except Exception:
            pass

    def _tick(self):
        """Full analysis cycle — runs every ANALYSIS_INTERVAL_SECONDS."""
        cycle_start = time.time()
        self._cycle_count += 1
        _cycle_ts = datetime.utcnow().isoformat() + "Z"

        # ── CACHE FIX: Hard-reset all coin states at cycle start ────────────────
        # Strategy: keep ONLY coins with active trades (preserve live PnL data).
        # For every other coin, wipe the old state completely — no stale ELIGIBLE/
        # READY reasons, actions, or confidence scores bleeding from prior cycles.
        # Pre-populate pool coins with a SCANNING placeholder so the dashboard
        # shows "SCANNING" during analysis instead of last cycle's stale READY.
        _active_syms = set(self._active_positions.keys()) \
            if hasattr(self, "_active_positions") else set()

        # Hard clear: drop every non-active-position coin state
        self._coin_states = {
            s: v for s, v in self._coin_states.items()
            if s in _active_syms
        }

        # ── DEPLOYED SEED: ensure active trades always appear in Brain Summary ──
        # On engine restart, _coin_states is empty — deployed coins are excluded
        # from the scan pool so they'd never get a DEPLOY_QUEUED stamp.
        # Fix: stamp them from the tradebook every tick before the pool seed.
        for _at in tradebook.get_active_trades():
            _sym = _at.get("symbol", "")
            _bid = _at.get("bot_id", "")
            if not _sym:
                continue
            if _sym not in self._coin_states:
                self._coin_states[_sym] = {
                    "symbol":     _sym,
                    "action":     "DEPLOYED",
                    "regime":     _at.get("regime", None),
                    "confidence": _at.get("confidence", None),
                    "conviction": None,
                    "cycle":      self._cycle_count,
                    "scanned_at": _cycle_ts,
                }
            if _bid:
                self._coin_states[_sym].setdefault("bot_deploy_statuses", {})[_bid] = "DEPLOY_QUEUED"

        # Pre-seed pool coins with SCANNING placeholder so dashboard reflects
        # real cycle state immediately (not stale state from previous cycle)
        _pool_to_seed = getattr(self, "_full_coin_pool", []) or []
        for _sym in _pool_to_seed:
            if _sym not in self._coin_states:
                self._coin_states[_sym] = {
                    "symbol":     _sym,
                    "action":     "SCANNING",
                    "regime":     None,
                    "confidence": None,
                    "conviction": None,
                    "cycle":      self._cycle_count,
                    "scanned_at": _cycle_ts,
                }

        # ── 0a. Pull active bots from SaaS DB (every cycle) ───
        # Engine is the pull side — no push/registration required.
        # This self-heals after every Railway redeploy without any dashboard visit.
        try:
            from engine_api import pull_active_bots_from_saas
            pull_active_bots_from_saas()
        except Exception as _pab_err:
            logger.warning("⚠️  Bot pull failed: %s", _pab_err)

        # ── 0b. Removed Fail Fast Block ──────────
        # We must NOT return early here, otherwise the engine stucks at Cycle 0
        # and the dashboard appears dead. If NO bots are active, the pool logic below
        # will naturally scan 0 altcoins, but process BTCUSDT & Heatmap to keep the UI alive.
        if not config.ENGINE_ACTIVE_BOTS:
            logger.info("ℹ️  ENGINE_ACTIVE_BOTS is empty. Will scan only BTCUSDT for dashboard heartbeat.")

        # ── 0c. Reset Athena rate limiter for this cycle ─────────
        if self._athena:
            self._athena.reset_cycle()

        # ── 1. Coin scan pool ─────────
        if config.MULTI_COIN_MODE:
            # Pre-warm BTC 1h kline cache before analysis to avoid race conditions
            # (two engine threads both try to fetch BTCUSDT:1h simultaneously on fresh start)
            try:
                from data_pipeline import fetch_klines as _prefetch
                _btc_warm = _prefetch("BTCUSDT", config.TIMEFRAME_CONFIRMATION, limit=config.HMM_LOOKBACK)
                if _btc_warm is not None and len(_btc_warm) >= 60:
                    logger.debug("🔥 BTC 1h klines pre-warmed (%d candles)", len(_btc_warm))
                else:
                    logger.warning("⚠️  BTC 1h pre-warm failed (got %s rows) — regime may be STALE this cycle",
                                   len(_btc_warm) if _btc_warm is not None else "None")
            except Exception as _pw_err:
                logger.warning("⚠️  BTC 1h pre-warm exception: %s", _pw_err)

            # Always refresh the segment heatmap JSON every cycle (cheap Binance ticker call)
            # This keeps the dashboard heatmap live even when the pool is not being rebuilt
            try:
                from coin_scanner import get_hottest_segments as _refresh_heatmap
                _refresh_heatmap(getattr(config, "SEGMENT_SCAN_LIMIT", 2))
            except Exception as _he:
                logger.warning("⚠️  Heatmap refresh failed (non-fatal): %s", _he)

            # Refresh the full coin pool every N cycles (or on first run)
            refresh_rotations = max(1, self._SCAN_POOL_SIZE // self._SCAN_BATCH_SIZE)
            if not self._full_coin_pool or self._cycle_count % max(1, config.SCAN_INTERVAL_CYCLES * refresh_rotations) == 1:
                logger.info("🔄 Refreshing Segment-First coin pool based on %d active bots...", len(config.ENGINE_ACTIVE_BOTS))
                self._full_coin_pool = get_active_bot_segment_pool(config.ENGINE_ACTIVE_BOTS)
                logger.info("📋 Full pool (%d coins): %s ...",
                            len(self._full_coin_pool), ", ".join(self._full_coin_pool[:8]))

            # Determine slice based on rotation
            actual_pool_size = max(1, len(self._full_coin_pool))
            num_rotations = max(1, (actual_pool_size + self._SCAN_BATCH_SIZE - 1) // self._SCAN_BATCH_SIZE)
            self._scan_rotation = (self._cycle_count - 1) % num_rotations
            batch_start = self._scan_rotation * self._SCAN_BATCH_SIZE
            batch_end   = batch_start + self._SCAN_BATCH_SIZE
            batch_raw   = self._full_coin_pool[batch_start:batch_end]

            # Skip already-deployed coins — they are being managed; no need to retrain HMM
            deployed_symbols = set(self._active_positions.keys())
            batch_undeployed = [s for s in batch_raw if s not in deployed_symbols]

            # Fill any gaps left by skipped deployed coins from the overflow slice
            gap = self._SCAN_BATCH_SIZE - len(batch_undeployed)
            if gap > 0:
                next_start = batch_end % len(self._full_coin_pool) if self._full_coin_pool else 0
                overflow   = self._full_coin_pool[next_start:next_start + gap]
                extra      = [s for s in overflow if s not in deployed_symbols and s not in batch_undeployed]
                batch_undeployed += extra[:gap]

            symbols = batch_undeployed
            logger.info(
                "🔄 Rotation %d/3 | Batch #%d–%d | Scanning %d coins%s | Deployed (skipped): %d",
                self._scan_rotation + 1, batch_start + 1, batch_end,
                len(symbols),
                " (+ overflow fill)" if gap > 0 else "",
                len(deployed_symbols),
            )

            # Keep _coin_list for dashboard / health endpoint compatibility
            self._coin_list = symbols

            # Fallback to standard tracking limit
            symbols = symbols[:self._SCAN_BATCH_SIZE]
        else:
            symbols = [config.PRIMARY_SYMBOL]

        # ── 1b. Fetch live market data (Funding, Prices) ──────────
        try:
            self._live_prices = cdx.get_current_prices()
        except Exception as e:
            logger.warning("Failed to fetch live prices: %s", e)
            self._live_prices = {}

        # ── 2. Global equity + kill switch check ─────────────────
        balance = self.executor.get_futures_balance()

        # Retry balance fetch if it returns 0 in LIVE mode (API may have failed)
        if not config.PAPER_TRADE and balance <= 0:
            for attempt in range(1, 4):
                logger.warning("⚠️  Balance=$0 in LIVE mode — retry %d/3...", attempt)
                time.sleep(2 * attempt)  # 2s, 4s, 6s backoff
                balance = self.executor.get_futures_balance()
                if balance > 0:
                    logger.info("✅ Balance recovered on retry %d: $%.2f", attempt, balance)
                    break

        logger.info("💰 Cycle #%d balance: $%.2f (%s mode)",
                    self._cycle_count, balance, "PAPER" if config.PAPER_TRADE else "LIVE")

        # HALT deployments if LIVE balance is still 0 after retries
        if not config.PAPER_TRADE and balance <= 0:
            logger.error(
                "🚨 LIVE balance is $0 after 3 retries — HALTING deployments this cycle. "
                "Check CoinDCX API keys and wallet."
            )
            try:
                tg.send_message(
                    "🚨 *BALANCE ALERT*\n\n"
                    "CoinDCX balance returned $0 after 3 retries.\n"
                    "Deployments are PAUSED until balance is available.\n\n"
                    "Possible causes:\n"
                    "• Empty futures wallet\n"
                    "• Invalid API keys\n"
                    "• CoinDCX API downtime"
                )
            except Exception:
                pass
            # Still run exits and state save, but skip new deployments
            self._check_exits(symbols)
            self._save_multi_state(symbols, [], 0)
            return

        self.risk.record_equity(balance)
        if self.risk.check_kill_switch():
            logger.warning("🚨 Kill switch triggered! Closing all positions.")
            # Telegram kill switch alert
            try:
                peak = max(b for _, b in self.risk.equity_history) if self.risk.equity_history else 0
                current = self.risk.equity_history[-1][1] if self.risk.equity_history else 0
                dd = (peak - current) / peak * 100 if peak > 0 else 0
                tg.notify_kill_switch(dd, peak, current)
            except Exception:
                pass
            for sym in list(self._active_positions.keys()):
                tradebook.close_trade(symbol=sym, reason="KILL_SWITCH")
                self.executor.close_all_positions(sym)
            self._active_positions.clear()
            return

        # ── 3. Check exits for active positions ──────────────────
        self._check_exits(symbols)

        # ── 4. Scan each coin ────────────────────────────────────
        # SOLE SOURCE OF TRUTH: tradebook active count
        tradebook_active = tradebook.get_active_trades()
        tradebook_active_count = len(tradebook_active)
        raw_results = []

        # Scan ALL symbols — do NOT skip based on other bots' deployed coins.
        # Each bot has its own position check (pos_key = bot_id:symbol).
        # If Synaptic Adaptive deployed ETH, L1 Specialist should still scan + deploy it.
        # BTCUSDT is the macro regime reference for every coin's conviction score.
        # It must be analyzed on EVERY cycle regardless of which batch rotation is active.
        scan_symbols = symbols if "BTCUSDT" in symbols else ["BTCUSDT"] + list(symbols)
        logger.info("📡 Initial Scan list: %d coins | active trades in book: %d",
                    len(scan_symbols), tradebook_active_count)

        # ── 4a-1. Segment pool already shortlists coins (top-4 segments) ──
        # No direction gate: HMM per-coin decides BULLISH/BEARISH/SIDEWAYS.
        # All coins that made it into the scan pool go straight to analysis.
        logger.info("📡 Segment pool locked — %d coins routed to HMM", len(scan_symbols))


        # ── 4b. Macro Veto Overlay (BTC Flash Crash Detection) ──
        btc_flash_crash = False
        try:
            btc_df = fetch_klines("BTCUSDT", config.TIMEFRAME_EXECUTION, limit=3)
            if btc_df is not None and len(btc_df) >= 2:
                btc_latest = float(btc_df["close"].iloc[-1])
                btc_prev = float(btc_df["close"].iloc[-2])
                btc_5m_return = (btc_latest - btc_prev) / btc_prev
                # Block LONGS if BTC dropped more than configured threshold in the last 15m candle
                threshold_pct = getattr(config, "MACRO_VETO_BTC_DROP_PCT", 1.5) / 100.0
                if btc_5m_return < -threshold_pct:
                    btc_flash_crash = True
                    logger.warning("🚨 MACRO VETO: BTCUSDT Flash Crash! (5m return: %.2f%%) — Blocking all long setups.", btc_5m_return * 100)
        except Exception as e:
            logger.debug("Failed to fetch BTC macro context: %s", e)

        for symbol in scan_symbols:
            if symbol in config.EXCLUDED_COINS:
                logger.info("🚫 Skipping %s (Exclusion List)", symbol)
                continue
            try:
                result = self._analyze_coin(symbol, balance, btc_flash_crash=btc_flash_crash)
                if result:
                    raw_results.append(result)
            except Exception as e:
                if symbol == "BTCUSDT":
                    logger.error("🚨 BTC analysis failed: %s", e, exc_info=True)
                else:
                    logger.warning("⚠️ Analysis failed for %s: %s", symbol, e)

            # Aggressive GC: Clear memory physically bounded by MTF array instantiations immediately
            # so the baseline RAM never scales to n_coins during a single heartbeat cycle.
            self._evict_brain_cache()
            gc.collect()



        # ── 5. Deploy: Top HMM coin per segment → Athena final call ────────────────
        # Sort by conviction desc so top_coins[:N] picks highest-conviction coin per segment
        raw_results.sort(key=lambda r: r.get("conviction", 0), reverse=True)

        # ── Signal Queue: step 1 — evict expired signals ─────────────────────────
        _now = time.time()
        expired = [s for s, v in self._pending_signals.items() if v["expires_at"] < _now]
        for s in expired:
            logger.info("🗑️  Signal queue: evicting expired signal for %s (queued %.0f min ago)",
                        s, (_now - self._pending_signals[s]["queued_at"]) / 60)
            del self._pending_signals[s]

        # ── Signal Queue: step 2 — if NO bots registered, queue all fresh HMM signals ──
        # (Bot loop won't run at all, so Athena can't evaluate them — safe to pre-queue)
        if not _tick_active_bots:
            for _r in raw_results:
                _sym = _r.get("symbol")
                if not _sym:
                    continue
                self._pending_signals[_sym] = {
                    "result":         _r,
                    "expires_at":     _now + self._SIGNAL_QUEUE_TTL_SECONDS,
                    "queued_at":      self._pending_signals.get(_sym, {}).get("queued_at", _now),
                    "cycles_pending": self._pending_signals.get(_sym, {}).get("cycles_pending", 0) + 1,
                    "queue_reason":   "no_bots",
                }
            if raw_results:
                logger.info("📥 Signal queue: pre-queued %d HMM signals (no bots registered)", len(raw_results))

        # ── Signal Queue: step 3 — reinject queued signals from previous cycle into deploy pool ──
        # Only coins that were Athena-approved-but-blocked (not vetoed) land here.
        fresh_syms = {r["symbol"] for r in raw_results}
        reinjected = 0
        for _sym, _entry in list(self._pending_signals.items()):
            if _sym not in fresh_syms and _entry["cycles_pending"] >= 1:
                _reinjected = dict(_entry["result"])
                _reinjected["_queued"] = True
                _reinjected["_cycles_pending"] = _entry["cycles_pending"]
                raw_results.append(_reinjected)
                reinjected += 1
        if reinjected:
            logger.info("📬 Signal queue: reinjected %d Athena-approved signal(s) from last cycle", reinjected)
            raw_results.sort(key=lambda r: r.get("conviction", 0), reverse=True)
        # For each registered segment bot:
        #   1. Find the best HMM coin in that bot's segment from raw_results
        #   2. Skip if bot already has that coin open (duplicate check)
        #   3. Call Athena — FINAL DECISION (EXECUTE or VETO)
        #   4. Execute if Athena approves
        # No per-bot position cap — only the duplicate check prevents re-entering the same coin.

        _tick_active_bots = list(config.ENGINE_ACTIVE_BOTS)


        if not _tick_active_bots:
            logger.warning("⚠️  No bots registered in ENGINE_ACTIVE_BOTS — skipping deploy step")

        from segment_features import get_segment_for_coin

        deployed_trades = []
        deployed = 0
        athena_calls_this_cycle = 0  # H4: track Athena calls to enforce LLM_MAX_CALLS_PER_CYCLE
        # ── GUARD 4: Per-segment tick lock ──────────────────────────────
        # Prevents the waterfall from cascading multiple DeFi coins across 10 bots
        # in the same cycle (e.g. bot#1 gets COMP, bot#2 gets GMX, ..., bot#10 gets LINK).
        # Once ANY bot deploys a coin from a segment, that segment is locked for this tick.
        # Bots with segment_filter="ALL" are exempt (they don't share a named segment pool).
        deployed_segments: set = set()  # segment names already served this cycle

        for target in _tick_active_bots:
            bot_id   = target.get("bot_id", config.ENGINE_BOT_ID)
            bot_name = target.get("bot_name", "Synaptic Bot")
            user_id  = target.get("user_id", config.ENGINE_USER_ID)
            bot_segment_filter = target.get("segment_filter") or _infer_segment_from_name(bot_name)

            # ── Clear stale deploy statuses from last cycle for this bot ──────────
            # Without this, coins that were #1 last cycle (e.g. RONIN with "Conviction too low")
            # keep their old reason even when they drop to runner-up position this cycle,
            # causing contradictory display (lower-conviction coin shows a different reason than higher ones). 
            for _cs in self._coin_states.values():
                _cs.get("bot_deploy_statuses", {}).pop(bot_id, None)

            # Build allowed-coin set for this bot's segment
            if bot_segment_filter == "ALL":
                bot_allowed_coins = None  # no restriction
            else:
                bot_allowed_coins = set(config.CRYPTO_SEGMENTS.get(bot_segment_filter, []))

            # Filter raw_results to this bot's segment
            if bot_allowed_coins is not None:
                seg_results = [r for r in raw_results if r["symbol"] in bot_allowed_coins]
            else:
                seg_results = list(raw_results)

            # ── Waterfall: evaluate candidates in conviction order ─────────────────
            # ATHENA_WATERFALL_DEPTH = how many coins per bot we'll send to Athena.
            # If coin #1 is VETO'd → coin #2 gets evaluated, then #3, etc.
            # One successful EXECUTE stops the waterfall for this bot.
            waterfall_depth = getattr(config, "ATHENA_WATERFALL_DEPTH", 4)
            waterfall_candidates = seg_results[:waterfall_depth]

            if not waterfall_candidates:
                logger.info("🔍 [%s] No HMM signals for segment %s this cycle", bot_name, bot_segment_filter)
                continue

            # Mark coins beyond the waterfall window as excluded (never evaluated)
            for ignored in seg_results[waterfall_depth:]:
                sym = ignored["symbol"]
                self._coin_states.setdefault(sym, {}).setdefault("bot_deploy_statuses", {})[bot_id] = "FILTERED: Not top coin in segment"

            deploys_this_bot = 0  # counter: how many trades deployed this cycle for this bot
            max_deploys_bot = getattr(config, "MAX_DEPLOYS_PER_BOT_PER_CYCLE", 3)

            # ── GUARD 4: Segment tick lock ────────────────────────────────────
            # If this bot's named segment was already served this cycle, skip the
            # entire waterfall. This prevents 10 bots all in "DeFi" from each
            # deploying a different DeFi coin via the waterfall in the same tick.
            if bot_segment_filter not in ("ALL", None) and bot_segment_filter in deployed_segments:
                logger.info(
                    "🔒 [%s] Segment '%s' already deployed this cycle — skip (Guard 4)",
                    bot_name, bot_segment_filter,
                )
                for _cs in self._coin_states.values():
                    _cs.get("bot_deploy_statuses", {}).setdefault(bot_id, "FILTERED: segment already served this cycle")
                # ── Signal Queue: queue top Athena-approved coin in this segment that got Guard-4-blocked ──
                # We don't have Athena output yet (loop skipped), so queue the top HMM result
                # for this bot's segment so it retries next cycle when the segment lock resets.
                _seg_candidates = [r for r in raw_results if r.get("symbol") in (bot_allowed_coins or set())]
                if not _seg_candidates and bot_allowed_coins is None:
                    _seg_candidates = raw_results
                if _seg_candidates:
                    _top_blocked = _seg_candidates[0]
                    _bsym = _top_blocked.get("symbol")
                    if _bsym and _bsym not in self._pending_signals:
                        self._pending_signals[_bsym] = {
                            "result":         _top_blocked,
                            "expires_at":     _now + self._SIGNAL_QUEUE_TTL_SECONDS,
                            "queued_at":      _now,
                            "cycles_pending": 1,
                            "queue_reason":   "guard4_segment_locked",
                        }
                        logger.info("📥 Signal queue: queued %s (Guard 4 blocked segment %s)", _bsym, bot_segment_filter)
                continue  # skip this bot entirely this cycle

            for _wf_idx, top in enumerate(waterfall_candidates):
                if deploys_this_bot >= max_deploys_bot:
                    break  # hit max deploys for this bot this cycle

                sym      = top["symbol"]
                pos_key  = f"{bot_id}:{sym}"
                seg_name = get_segment_for_coin(sym)

                if _wf_idx > 0:
                    logger.info("⬇️  WATERFALL [%s] candidate #%d: %s (prev vetoed/skipped)",
                                bot_name, _wf_idx + 1, sym)

                # Conviction threshold — skip before Athena call if too low
                conviction = top.get("conviction", 0)
                min_conv   = getattr(config, "MIN_CONVICTION_FOR_DEPLOY", 60)
                if conviction < min_conv:
                    logger.info("⛔ [%s] %s conviction %.0f < %.0f — waterfall exhausted (remaining candidates also low)",
                                 bot_name, sym, conviction, min_conv)
                    # All remaining candidates will also fail — break out
                    break
                    self._coin_states.setdefault(sym, {}).setdefault("bot_deploy_statuses", {})[bot_id] = (
                        f"FILTERED: low conviction ({conviction:.0f} < {min_conv:.0f})"
                    )
                    continue

                # ── C4 Fix: Enforce MAX_OPEN_TRADES cap ──────────────────────────
                max_trades = getattr(config, "MAX_OPEN_TRADES", 25)
                if tradebook_active_count + deployed >= max_trades:
                    logger.warning(
                        "🛑 MAX_OPEN_TRADES cap reached (%d open + %d this tick = %d >= limit %d) — "
                        "skipping [%s] %s", tradebook_active_count, deployed,
                        tradebook_active_count + deployed, max_trades, bot_name, sym
                    )
                    self._coin_states.setdefault(sym, {}).setdefault("bot_deploy_statuses", {})[bot_id] = (
                        f"FILTERED: max open trades cap ({max_trades}) reached"
                    )
                    continue

                if self.risk.check_kill_switch():
                    return

                # ── Conviction-based leverage ─────────────────────────────────────
                # H2 Fix: 4-tier scale — borderline signals (65–69) get reduced leverage
                if conviction >= 95:
                    lev, fallback_lev = 25, 10
                elif conviction >= 80:
                    lev, fallback_lev = 20, 10
                elif conviction >= 70:
                    lev, fallback_lev = 15, 5
                else:
                    lev, fallback_lev = 10, 5

                # ── Athena: FINAL CALL (gates deployment) ────────────────────────
                current_price = self._coin_states.get(sym, {}).get("price", 0)
                atr_val = top.get("atr", 0)
                athena_decision = None
                if self._athena and config.LLM_REASONING_ENABLED:
                    # H4 Fix: enforce per-cycle call cap to prevent rate-limit burst.
                    # IMPORTANT: cached calls are FREE (no Gemini API hit) — only count them
                    # if the result is NOT from cache. Otherwise, with 3 bots × N coins,
                    # the cap gets hit on cached responses and coins get hard-skipped.
                    llm_cap = getattr(config, "LLM_MAX_CALLS_PER_CYCLE", 10)
                    if athena_calls_this_cycle >= llm_cap:
                        logger.warning(
                            "⚠️ Athena real-call cap reached (%d/%d) — skipping [%s] %s (fail-closed)",
                            athena_calls_this_cycle, llm_cap, bot_name, sym
                        )
                        self._coin_states.setdefault(sym, {}).setdefault("bot_deploy_statuses", {})[bot_id] = (
                            f"FILTERED: Athena cap ({llm_cap} real calls/cycle) reached"
                        )
                        continue
                    try:
                        # Compute market structure levels for Athena context
                        mkt_struct = compute_market_structure(sym)

                        # Per-TF HMM predictions — passed from _analyze_coin via top dict
                        tf_summary = top.get("tf_breakdown", {})

                        llm_ctx = {
                            # ── Core signal ──────────────────────────────
                            "ticker":          sym,
                            "side":            top["side"],
                            "leverage":        lev,
                            "hmm_confidence":  top["confidence"],
                            "hmm_regime":      top.get("regime_name", ""),
                            "conviction":      conviction,
                            "signal_type":     top.get("signal_type", "TREND_FOLLOW"),
                            "tf_agreement":    top.get("tf_agreement", 0),
                            # ── Per-TF breakdown ─────────────────────────
                            "tf_breakdown":    tf_summary,
                            # ── Price context ────────────────────────────
                            "current_price":   current_price,
                            "atr":             atr_val,
                            "atr_pct":         round((atr_val / max(current_price, 0.0001)) * 100, 3),
                            "trend":           self._coin_states.get(sym, {}).get("context", {}).get("trend_alignment", "UNKNOWN"),
                            # ── BTC macro ────────────────────────────────
                            "btc_regime":      self._coin_states.get("BTCUSDT", {}).get("regime", "UNKNOWN"),
                            "btc_margin":      self._coin_states.get("BTCUSDT", {}).get("confidence", 0),
                            # ── Derivatives context (from conviction score) ────
                            "funding_rate":    top.get("funding_rate"),   # float or None
                            "oi_change":       top.get("oi_change"),      # % OI change
                            "orderflow_score": top.get("orderflow_score"), # -1.0 to +1.0
                            # ── Market structure levels ───────────────────
                            "pdh":             mkt_struct.get("pdh"),
                            "pdl":             mkt_struct.get("pdl"),
                            "pwh":             mkt_struct.get("pwh"),
                            "pwl":             mkt_struct.get("pwl"),
                            "vwap":            mkt_struct.get("vwap"),
                            "dist_vwap_pct":   mkt_struct.get("dist_vwap_pct"),
                            "swing_high_3":    mkt_struct.get("swing_high_3"),
                            "swing_low_3":     mkt_struct.get("swing_low_3"),
                            "swing_high_5":    mkt_struct.get("swing_high_5"),
                            "swing_low_5":     mkt_struct.get("swing_low_5"),
                            "ath_7d":          mkt_struct.get("ath_7d"),
                            "atl_7d":          mkt_struct.get("atl_7d"),
                            # ── Entry quality: OB zones + order walls ────
                            "nearest_bullish_ob": top.get("nearest_bullish_ob"),  # demand zone
                            "nearest_bearish_ob": top.get("nearest_bearish_ob"),  # supply zone
                            "nearest_bid_wall":   top.get("nearest_bid_wall"),    # bid wall price
                            "nearest_ask_wall":   top.get("nearest_ask_wall"),    # ask wall price
                        }
                        athena_decision = self._athena.validate_signal(llm_ctx)
                        # Only count REAL Gemini API calls — cached decisions are free.
                        # decision.cached=True means the result came from Athena's in-process cache.
                        if not getattr(athena_decision, 'cached', False):
                            athena_calls_this_cycle += 1  # count only real LLM API hits
                        self._coin_states.setdefault(sym, {})["athena_state"] = {
                            "action":    athena_decision.action,
                            "confidence": athena_decision.adjusted_confidence,
                            "reasoning": athena_decision.reasoning,
                            "risk_flags": getattr(athena_decision, "risk_flags", []),
                            "model":     getattr(athena_decision, "model", "unknown"),
                            "latency_ms": getattr(athena_decision, "latency_ms", 0),
                            "side":       getattr(athena_decision, "athena_direction", ""),
                            "suggested_sl": getattr(athena_decision, "suggested_sl", 0),
                            "suggested_tp": getattr(athena_decision, "suggested_tp", 0),
                        }
                        _bcast("ATHENA_DECISION", self._cycle_count, bot_name, bot_id, sym,
                               top["side"], seg_name, athena_decision.adjusted_confidence,
                               f"action={athena_decision.action} reason={athena_decision.reasoning[:80]}")
                        logger.info("🏛️ ATHENA [%s] %s → %s (conf=%.0f%%)",
                                    bot_name, sym, athena_decision.action,
                                    athena_decision.adjusted_confidence * 100)
                    except Exception as e:
                        logger.warning("⚠️ Athena call failed for %s: %s — failing open (deploy anyway)", sym, e)
                        athena_decision = None  # fail open: treat as EXECUTE

                # Athena VETO — coin blocked
                if athena_decision and athena_decision.action not in ("EXECUTE", "LONG", "SHORT"):
                    logger.info("🚫 ATHENA VETO [%s] %s — action=%s", bot_name, sym, athena_decision.action)
                    self._coin_states.setdefault(sym, {}).setdefault("bot_deploy_statuses", {})[bot_id] = f"FILTERED: Athena {athena_decision.action}"
                    _bcast("ATHENA_VETO", self._cycle_count, bot_name, bot_id, sym,
                           top["side"], seg_name, top.get("confidence", 0),
                           f"Athena vetoed: {athena_decision.action} — {athena_decision.reasoning[:80]}")
                    # ── Veto Log: record for retrospective analysis ─────────────────────────
                    import datetime as _dt
                    self._veto_log.append({
                        "symbol":     sym,
                        "price":      current_price,
                        "side":       top.get("side", ""),
                        "conviction": top.get("conviction", 0),
                        "reason":     (athena_decision.reasoning or "")[:200],
                        "action":     athena_decision.action,
                        "ts":         _dt.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
                    })
                    if len(self._veto_log) > self._VETO_LOG_MAX:
                        self._veto_log = self._veto_log[-self._VETO_LOG_MAX:]
                    # ── Signal Queue: dequeue Athena-vetoed coin ──────────────────────
                    # Athena said NO — don't re-queue for next cycle. Only Guard-4-blocked
                    # or cap-blocked coins deserve a retry. Athena vetos are final.
                    if sym in self._pending_signals:
                        logger.info("🚫 Signal queue: removing %s — Athena vetoed (%s), no retry",
                                    sym, athena_decision.action)
                        del self._pending_signals[sym]
                    continue

                # ── Build trade dict ──────────────────────────────────────────────
                capital     = target.get("capital_per_trade") or getattr(config, "CAPITAL_PER_TRADE", 100.0)
                qty         = (capital * lev) / max(current_price, 0.0001)
                
                # Base math reason
                reason_str  = top.get("reason", f"{top.get('regime_name','')} {int(top['confidence']*100)}%")
                final_conf  = top["confidence"]

                # Apply Athena's outputs to the trade payload (only if real LLM decision)
                if athena_decision and not athena_decision.reasoning.startswith("Auto-approve"):
                    reason_str = f"Athena ✅ ({int(athena_decision.adjusted_confidence*100)}%): {athena_decision.reasoning[:200]}"
                    final_conf = athena_decision.adjusted_confidence

                # SIGNAL_DISPATCH broadcast
                _bcast("SIGNAL_DISPATCH", self._cycle_count, bot_name, bot_id, sym,
                       top["side"], seg_name, final_conf,
                       f"regime={top.get('regime_name','')} lev={lev}x qty={qty:.4f} athena=APPROVED")

                self._coin_states.setdefault(sym, {}).setdefault("bot_deploy_statuses", {})[bot_id] = "DEPLOY_QUEUED"

                logger.info(
                    "🔥 DEPLOYING [%s]: %s %s @ %dx | HMM %.0f%% conv | Athena ✅ %.0f%%",
                    bot_name, top["side"], sym, lev, conviction, final_conf * 100,
                )

                # Execute
                try:
                    result = self.executor.execute_trade(
                        symbol=sym,
                        side=top["side"],
                        leverage=lev,
                        quantity=qty,
                        atr=atr_val,
                        regime=top.get("regime", 0),
                        confidence=final_conf,
                        reason=reason_str,
                        swing_l=top.get("swing_l"),
                        swing_h=top.get("swing_h"),
                        fallback_leverage=fallback_lev,
                    )
                except Exception as exec_err:
                    logger.error("🚨 EXECUTE CRASH [%s] %s: %s", bot_name, sym, exec_err, exc_info=True)
                    _bcast("EXEC_CRASH", self._cycle_count, bot_name, bot_id, sym,
                           top["side"], seg_name, top["confidence"],
                           f"{type(exec_err).__name__}: {str(exec_err)[:120]}")
                    self._coin_states.setdefault(sym, {}).setdefault("bot_deploy_statuses", {})[bot_id] = "FILTERED: execute crash"
                    continue

                if result is None and not config.PAPER_TRADE:
                    logger.warning("⚠️ EXEC RETURNED NONE [%s] %s — order rejected", bot_name, sym)
                    _bcast("EXEC_NULL", self._cycle_count, bot_name, bot_id, sym,
                           top["side"], seg_name, top["confidence"],
                           "execute_trade returned None (live mode) — order rejected")
                    self._coin_states.setdefault(sym, {}).setdefault("bot_deploy_statuses", {})[bot_id] = "FILTERED: exec returned None"
                    continue

                entry_price  = result.get("entry_price", 0) if result else 0
                fill_qty     = result.get("quantity",   qty)    if result else qty
                fill_lev     = result.get("leverage",   lev)    if result else lev
                fill_capital = result.get("capital",    capital) if result else capital
                fill_sl      = result.get("stop_loss",  0)      if result else 0
                fill_tp      = result.get("take_profit", 0)     if result else 0

                # ── Athena SL/TP Override ──────────────────────────────────
                # Use Athena's structure-aware SL/TP when available,
                # falling back to traditional ATR-based SL/TP otherwise.
                athena_sl_used = False
                athena_tp_used = False
                if athena_decision and entry_price > 0:
                    a_sl = getattr(athena_decision, 'suggested_sl', 0) or 0
                    a_tp = getattr(athena_decision, 'suggested_tp', 0) or 0
                    is_long = top["side"].upper() in ("BUY", "LONG")

                    # Sanity check: SL must be on correct side and within 20% of entry
                    if a_sl > 0:
                        sl_dist_pct = abs(a_sl - entry_price) / entry_price
                        sl_correct_side = (is_long and a_sl < entry_price) or (not is_long and a_sl > entry_price)
                        if sl_correct_side and sl_dist_pct < 0.20:
                            fill_sl = a_sl
                            athena_sl_used = True
                        else:
                            logger.debug("🏛️ Athena SL rejected for %s: sl=%.4f entry=%.4f side=%s",
                                         sym, a_sl, entry_price, top["side"])

                    # Sanity check: TP must be on correct side and within 30% of entry
                    if a_tp > 0:
                        tp_dist_pct = abs(a_tp - entry_price) / entry_price
                        tp_correct_side = (is_long and a_tp > entry_price) or (not is_long and a_tp < entry_price)
                        if tp_correct_side and tp_dist_pct < 0.30:
                            fill_tp = a_tp
                            athena_tp_used = True
                        else:
                            logger.debug("🏛️ Athena TP rejected for %s: tp=%.4f entry=%.4f side=%s",
                                         sym, a_tp, entry_price, top["side"])

                    if athena_sl_used or athena_tp_used:
                        logger.info("🏛️ Athena SL/TP override [%s]: SL=%s(%.4f) TP=%s(%.4f)",
                                    sym,
                                    "ATHENA" if athena_sl_used else "ATR", fill_sl,
                                    "ATHENA" if athena_tp_used else "ATR", fill_tp)

                # H5 Fix: validate entry_price in ALL modes, not just live
                if entry_price <= 0:
                    if config.PAPER_TRADE and current_price > 0:
                        # Paper mode: execution engine returned 0 — use last known price as fallback
                        entry_price = current_price
                        logger.warning("⚠️ PAPER zero entry_price for %s — using current_price %.6f", sym, entry_price)
                    else:
                        _bcast("EXEC_ZERO_PRICE", self._cycle_count, bot_name, bot_id, sym,
                               top["side"], seg_name, top["confidence"], "entry_price=0")
                        self._coin_states.setdefault(sym, {}).setdefault("bot_deploy_statuses", {})[bot_id] = "FILTERED: zero entry price"
                        continue

                # Each bot in the outer loop owns its own trade record.
                # Using the current bot_id (not matching_bot_ids[0]) is critical:
                # if we used the first bot in ENGINE_ACTIVE_BOTS it would always be
                # the admin bot, causing non-admin trades to be stamped with the wrong
                # owner and the per-bot duplicate key (bot_id:symbol) to never match
                # the stored trade, so non-admin bots would open new trades every cycle.
                tradebook.open_trade(
                    symbol=sym,
                    side=top["side"],
                    leverage=fill_lev,
                    quantity=fill_qty,
                    entry_price=entry_price,
                    atr=atr_val,
                    regime=top.get("regime_name", ""),
                    confidence=top["confidence"],
                    reason=reason_str,
                    capital=fill_capital,
                    user_id=user_id,
                    profile_id="segment",
                    bot_name=bot_name,
                    exchange=result.get("exchange") if result else None,
                    pair=result.get("pair") if result else None,
                    position_id=result.get("position_id") if result else None,
                    bot_id=bot_id,
                    all_bot_ids=[bot_id],
                    rm_id=result.get("rm_id") if result else None,
                    override_sl=fill_sl if fill_sl > 0 else None,
                    override_tp=fill_tp if fill_tp > 0 else None,
                )

                _bcast("TRADEBOOK_RECORDED", self._cycle_count, bot_name, bot_id, sym,
                       top["side"], seg_name, top["confidence"],
                       f"entry=${entry_price:.4f} lev={fill_lev}x sl=${fill_sl:.4f} tp=${fill_tp:.4f}")

                self._active_positions[pos_key] = {
                    "bot_name": bot_name,
                    "regime":   top.get("regime_name", ""),
                    "confidence": top["confidence"],
                    "side":     top["side"],
                    "entry_time": datetime.now(IST).replace(tzinfo=None).isoformat(),
                    "leverage": fill_lev,
                    "entry_price": entry_price,
                    "quantity": fill_qty,
                }
                # Guard 4: lock this segment for the rest of the cycle
                if bot_segment_filter not in ("ALL", None):
                    deployed_segments.add(bot_segment_filter)
                # Signal Queue: step 4 — dequeue successfully deployed coin
                if sym in self._pending_signals:
                    logger.info("✅ Signal queue: dequeuing %s (deployed after %d cycle(s) pending)",
                                sym, self._pending_signals[sym].get("cycles_pending", 1))
                    del self._pending_signals[sym]

                self._trade_count += 1
                deployed += 1

                deployed_trades.append({
                    "regime": top.get("regime_name", ""), # Use top.get for regime
                    "confidence": top["confidence"],
                    "leverage": fill_lev,
                    "entry_price": entry_price,
                    "stop_loss": fill_sl,
                    "take_profit": fill_tp,
                    "profile": "segment", # fixed
                    "symbol": sym, # Add symbol for batch notification filtering
                    "side": top["side"], # Add side for batch notification
                })

                deploys_this_bot += 1  # waterfall: continues until max_deploys_bot reached

        # ── Batch Telegram notification for all deployed trades ──
        if deployed_trades:
            try:
                # Re-read full trade records from tradebook for SL/TP info
                active = tradebook.get_active_trades()
                deployed_syms = {t["symbol"] for t in deployed_trades}
                full_records = [t for t in active if t["symbol"] in deployed_syms]
                # Use full records if available (has SL/TP), else use collected data
                tg.notify_batch_entries(full_records if full_records else deployed_trades)
            except Exception:
                pass

        # ── 6. Save state for dashboard ──────────────────────────
        cycle_duration = time.time() - cycle_start
        self._last_cycle_duration = cycle_duration
        self._save_multi_state(symbols, deployed_trades, deployed)

        # ── 7. Persist cycle snapshot to DB (background thread, non-blocking) ─
        threading.Thread(
            target=self._post_cycle_snapshot,
            args=(cycle_duration, deployed_trades, deployed),
            daemon=True,
            name=f"CycleSnap-{self._cycle_count}",
        ).start()

        logger.info(
            "📊 Cycle #%d complete | Scanned: %d | Deployed: %d | Active: %d",
            self._cycle_count, len(symbols), deployed,
            len(tradebook.get_active_trades()),
        )

    def _post_cycle_snapshot(self, cycle_duration: float, deployed_trades: list, deployed: int):
        """POST per-cycle signal archive to dashboard /api/cycle-snapshot for DB persistence."""
        try:
            dashboard_url = os.environ.get("DASHBOARD_URL", "").rstrip("/")
            if not dashboard_url:
                return  # no dashboard URL configured — silent skip

            secret = os.environ.get("ENGINE_INTERNAL_SECRET", "synaptic-internal-2024")

            # Collect per-coin scan results from _coin_states
            coin_results = []
            for sym, state in self._coin_states.items():
                coin_results.append({
                    "symbol":        sym,
                    "regime":        state.get("regime"),
                    "regime_full":   state.get("regime_full"),
                    "action":        state.get("action"),
                    "side":          state.get("side"),
                    "confidence":    state.get("confidence"),
                    "conviction":    state.get("conviction"),
                    "tf_agreement":  state.get("tf_agreement"),
                    "atr":           state.get("atr"),
                    "price":         state.get("price") or state.get("current_price"),
                    "deploy_status": state.get("deploy_status"),
                    "was_deployed":  sym in [t.get("symbol") for t in deployed_trades],
                    "athena_decision": state.get("athena_decision"),
                })

            # Collect segment heatmap data
            heatmap = {}
            try:
                heatmap_file = getattr(config, "HEATMAP_STATE_FILE", "data/segment_heatmap.json")
                if os.path.exists(heatmap_file):
                    with open(heatmap_file, "r") as f:
                        hmap = json.load(f)
                    segs = hmap.get("segments", [])
                    btc_24h = hmap.get("btc_24h", 0)
                    selected = {s.get("segment") for s in segs[:2]}  # top-2 are selected
                    
                    segments_list = []
                    for i, seg in enumerate(segs):
                        segments_list.append({
                            "segment":         seg.get("segment"),
                            "composite_score": seg.get("composite_score"),
                            "vw_rr":           seg.get("vw_rr"),
                            "btc_alpha":       seg.get("btc_alpha"),
                            "breadth_pct":     seg.get("breadth_pct"),
                            "is_selected":     seg.get("segment") in selected,
                            "rank":            i + 1,
                        })
                    
                    heatmap = {
                        "segments": segments_list,
                        "btc_24h": btc_24h
                    }
            except Exception:
                pass

            # BTC state for market context
            btc_state = self._coin_states.get("BTCUSDT", {})
            active_bots = list(config.ENGINE_ACTIVE_BOTS)
            bot_id = active_bots[0]["bot_id"] if active_bots else getattr(config, "ENGINE_BOT_ID", None)
            mode = "live" if not getattr(config, "PAPER_TRADE", True) else "paper"

            payload = {
                "cycle_number":   self._cycle_count,
                "mode":           mode,
                "engine_bot_id":  bot_id,
                "scanned_at":     datetime.now(IST).isoformat(),
                "duration_ms":    int(cycle_duration * 1000),
                "btc_regime":     btc_state.get("regime"),
                "btc_confidence": btc_state.get("confidence"),
                "btc_price":      btc_state.get("price") or btc_state.get("current_price"),
                "macro_action":   btc_state.get("action"),
                "coins_scanned":  len(self._coin_states),
                "eligible_count": len(deployed_trades),
                "deployed_count": deployed,
                "filtered_count": max(0, len(self._coin_states) - len(deployed_trades)),
                "coin_results":   coin_results,
                "heatmap":        heatmap,
            }

            data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                f"{dashboard_url}/api/cycle-snapshot",
                data=data,
                method="POST",
                headers={
                    "Content-Type":    "application/json",
                    "x-engine-secret": secret,
                },
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                logger.debug("📦 Cycle snapshot persisted — status %s", resp.status)

        except Exception as exc:
            logger.debug("Cycle snapshot POST failed (non-critical): %s", exc)

    # ─── Per-Coin Analysis ───────────────────────────────────────────────────


    def _analyze_coin(self, symbol, balance, btc_flash_crash=False):
        """
        Analyze a single coin. Returns a trade dict if eligible, else None.
        Uses multi-timeframe analysis: 1h (primary) + 4h (macro confirmation).
        """
        # Fetch 1h data — with 1 retry + cache fallback for resilience
        df_1h = fetch_klines(symbol, config.TIMEFRAME_CONFIRMATION, limit=config.HMM_LOOKBACK)
        if (df_1h is None or len(df_1h) < 60) and symbol == "BTCUSDT":
            # Retry once after a short delay before declaring STALE
            import time as _t
            _t.sleep(2)
            df_1h = fetch_klines(symbol, config.TIMEFRAME_CONFIRMATION, limit=config.HMM_LOOKBACK)
        if df_1h is None or len(df_1h) < 60:
            if symbol == "BTCUSDT":
                logger.error("🚨 BTC 1h data fetch failed or too short — regime STALE")
                self._coin_states.setdefault("BTCUSDT", {})["last_fetch_error"] = datetime.utcnow().isoformat()
            return None

        # Get or create brain for this coin (1h)
        brain = self._coin_brains.get(symbol)
        if brain is None:
            brain = HMMBrain(symbol=symbol)
            self._coin_brains[symbol] = brain

        # Compute features
        df_1h_feat = compute_all_features(df_1h)

        # Train if needed
        if brain.needs_retrain():
            brain.train(df_1h_feat)

        if not brain.is_trained:
            if symbol == "BTCUSDT":
                logger.error("🚨 BTC brain not trained — regime STALE")
            return None

        # Predict regime (1h)
        regime, conf = brain.predict(df_1h_feat)
        regime_name = brain.get_regime_name(regime)

        # ── Multi-TF HMM Analysis (replaces single 1H + 4H) ──
        if config.MULTI_TF_ENABLED:
            # Get or create MultiTFBrain for this coin
            mtf_brain = self._multi_tf_brains.get(symbol)
            if mtf_brain is None:
                mtf_brain = MultiTFHMMBrain(symbol)
                self._multi_tf_brains[symbol] = mtf_brain

            # Fetch and train each timeframe
            tf_data = {}  # timeframe → feature DataFrame
            for tf in config.MULTI_TF_TIMEFRAMES:
                tf_key = f"{symbol}_{tf}"
                tf_brain = self._coin_brains.get(tf_key)
                if tf_brain is None:
                    tf_brain = HMMBrain(symbol=symbol)
                    self._coin_brains[tf_key] = tf_brain

                try:
                    df_tf = fetch_klines(symbol, tf, limit=config.MULTI_TF_CANDLE_LIMIT)
                    if df_tf is not None and len(df_tf) >= 60:
                        df_tf_feat = compute_all_features(df_tf)
                        if tf_brain.needs_retrain():
                            logger.info("🧠 [%s] Training %s TF brain (%d bars)...", symbol, tf, len(df_tf))
                            tf_brain.train(df_tf_feat)
                        if tf_brain.is_trained:
                            mtf_brain.set_brain(tf, tf_brain)
                            tf_data[tf] = df_tf_feat
                        else:
                            logger.warning("⚠️  [%s] %s TF brain failed to train", symbol, tf)
                    else:
                        logger.warning("⚠️  [%s] %s TF klines too short or None (got %s bars)",
                                       symbol, tf, len(df_tf) if df_tf is not None else 0)
                except Exception as e:
                    logger.warning("⚠️  [%s] %s TF failed: %s", symbol, tf, e, exc_info=True)

            # Check if enough models are ready
            # Build a compact tf_breakdown dict for Athena context
            tf_breakdown = {}
            if hasattr(mtf_brain, '_predictions') and mtf_brain._predictions:
                for _tf, (_r, _m) in mtf_brain._predictions.items():
                    tf_breakdown[_tf] = {
                        "regime": config.REGIME_NAMES.get(_r, "?"),
                        "margin": round(_m, 3),
                    }

            if not mtf_brain.is_ready():
                ready_tfs = list(mtf_brain._brains.keys())
                logger.warning("⚠️  [%s] MTF not ready — only %d/%d TFs trained: %s",
                               symbol, len(ready_tfs), len(config.MULTI_TF_TIMEFRAMES), ready_tfs)
                self._coin_states[symbol] = {
                    "symbol": symbol, "regime": "N/A", "confidence": 0,
                    "price": 0, "action": "MTF_INSUFFICIENT_MODELS",
                    "segment": get_segment_for_coin(symbol),
                }
                return None

            # Predict across all timeframes
            mtf_brain.predict(tf_data)
            conviction, side, tf_agreement = mtf_brain.get_conviction()
            regime_summary = mtf_brain.get_regime_summary()
            # Log per-coin MTF result for visibility
            tf_detail = " | ".join(
                f"{tf}={config.REGIME_NAMES.get(r,'?')}({m:.2f})"
                for tf, (r, m) in mtf_brain._predictions.items()
            )
            logger.info("🔍 [%s] MTF: %s → conv=%.0f dir=%s agree=%d/%d",
                        symbol, tf_detail, conviction, side or "–",
                        tf_agreement, len(config.MULTI_TF_TIMEFRAMES))


            if side is None:
                self._coin_states[symbol] = {
                    "symbol": symbol, "regime": regime_summary,
                    "confidence": 0, "price": 0, "action": "MTF_NO_CONSENSUS",
                    "segment": get_segment_for_coin(symbol),
                }
                return None

            # Macro Veto Block
            if side == "BUY" and btc_flash_crash:
                self._coin_states[symbol] = {
                    "symbol": symbol, "regime": regime_summary,
                    "confidence": 0, "price": 0, "action": "MACRO_VETO_BTC_CRASH",
                    "segment": get_segment_for_coin(symbol),
                }
                return None

            # Use 1H data for trade execution params (ATR, price, etc.)
            # 1H should always be available since it's in MULTI_TF_TIMEFRAMES
            df_1h_feat = tf_data.get("1h")
            if df_1h_feat is None:
                return None

            current_price = float(df_1h_feat["close"].iloc[-1])
            current_atr = float(df_1h_feat["atr"].iloc[-1]) if "atr" in df_1h_feat.columns else 0.0
            regime = config.REGIME_BULL if side == "BUY" else config.REGIME_BEAR
            regime_name = config.REGIME_NAMES.get(regime, "UNKNOWN")
            # Use the average margin across agreeing TFs as confidence
            conf = conviction / 100.0

            # Get BTC Daily regime for brain switcher
            btc_regime_str = "CHOP"
            btc_margin = 0.0
            btc_daily_key = "BTCUSDT_1d"
            btc_brain = self._coin_brains.get(btc_daily_key)
            # Only use tf_data["1d"] for BTC itself — for other coins tf_data["1d"] is their OWN
            # daily data, not BTC's, so feeding it to btc_brain produces wrong macro context.
            if btc_brain and btc_brain.is_trained and "1d" in tf_data and symbol == "BTCUSDT":
                btc_r, btc_m = btc_brain.predict(tf_data["1d"])
                if btc_r == config.REGIME_BULL:
                    btc_regime_str = "BULL"
                elif btc_r == config.REGIME_BEAR:
                    btc_regime_str = "BEAR"
                btc_margin = btc_m
            elif symbol != "BTCUSDT":
                # Try to use BTCUSDT's cached brain
                btc_mtf = self._multi_tf_brains.get("BTCUSDT")
                if btc_mtf and btc_mtf._predictions.get("1d"):
                    btc_r, btc_m = btc_mtf._predictions["1d"]
                    if btc_r == config.REGIME_BULL:
                        btc_regime_str = "BULL"
                    elif btc_r == config.REGIME_BEAR:
                        btc_regime_str = "BEAR"
                    btc_margin = btc_m

            # No fallback brain profile needed — BRAIN_PROFILES removed
            brain_cfg = {}  # sizing comes from CAPITAL_PER_TRADE in deploy loop
            brain_id = "MultiTF-HMM"
            _is_reversal_tier2 = False  # set here; legacy tier2 logic (line ~1318) is unreachable from multi-TF path

            # Weekend skip
            if config.WEEKEND_SKIP_ENABLED:
                now_utc = datetime.now(timezone.utc)
                if now_utc.weekday() in config.WEEKEND_SKIP_DAYS:
                    self._coin_states[symbol] = {
                        "symbol": symbol, "regime": regime_summary,
                        "confidence": round(conf, 4), "price": current_price,
                        "action": "WEEKEND_SKIP",
                        "segment": get_segment_for_coin(symbol),
                    }
                    return None

            # Volatility filter
            if config.VOL_FILTER_ENABLED and current_atr > 0:
                vol_ratio = current_atr / current_price
                if vol_ratio < config.VOL_MIN_ATR_PCT:
                    self._coin_states[symbol] = {
                        "symbol": symbol, "regime": regime_summary,
                        "confidence": round(conf, 4), "price": current_price,
                        "action": "VOL_TOO_LOW",
                        "segment": get_segment_for_coin(symbol),
                    }
                    return None
                if vol_ratio > config.VOL_MAX_ATR_PCT:
                    self._coin_states[symbol] = {
                        "symbol": symbol, "regime": regime_summary,
                        "confidence": round(conf, 4), "price": current_price,
                        "action": "VOL_TOO_HIGH",
                        "segment": get_segment_for_coin(symbol),
                    }
                    return None

            # Conviction threshold check — single source: config.MIN_CONVICTION_FOR_DEPLOY
            # (removed brain_cfg["conviction_min"] duplicate — was a second gate with same value)
            conv_min = config.MIN_CONVICTION_FOR_DEPLOY
            if conviction < conv_min:
                self._coin_states[symbol] = {
                    "symbol": symbol, "regime": regime_summary,
                    "confidence": round(conf, 4), "price": current_price,
                    "action": f"LOW_CONVICTION:{conviction:.1f}<{conv_min}",
                    "brain": brain_id,
                    "segment": get_segment_for_coin(symbol),
                }
                return None

            # ── Athena pre-screening removed from scan phase ──
            # Athena per-bot evaluation is handled in the deploy loop (lines 686-770).
            # Running Athena here would veto signals FOR ALL BOTS (incl. adaptive ones)
            # if any single athena-brained bot is active — silently blocking signals.
            # The raw result is returned as-is; deploy loop applies Athena per-bot.
            athena_action = None


            # Update coin state for dashboard
            self._coin_states[symbol] = {
                "symbol": symbol,
                "regime": regime_name,
                "confidence": round(conf, 4),
                "price": current_price,
                "action": f"ELIGIBLE_{side}",
                "conviction": round(conviction, 1),
                "brain": brain_id,
                "tf_agreement": tf_agreement,
                "regime_summary": regime_summary,
                "athena": athena_action,
                "segment": get_segment_for_coin(symbol),
            }

            return {
                "symbol": symbol,
                "side": side,
                "atr": current_atr,
                "regime": regime,
                "regime_name": regime_name,
                "confidence": conf,
                "conviction": conviction,
                "brain_id": brain_id,
                "brain_cfg": brain_cfg,
                "tf_agreement": tf_agreement,
                "athena": athena_action,
                "signal_type": "REVERSAL_PULLBACK" if _is_reversal_tier2 else "TREND_FOLLOW",
                "reason": f"MultiTF-HMM | {regime_summary} | conv={conviction:.1f} TF={tf_agreement}/3",
            }

        # ── Legacy single-TF path (when MULTI_TF_ENABLED=False) ──
        macro_regime_name = None

        # Update coin state for dashboard
        current_price = float(df_1h_feat["close"].iloc[-1])

        # Extract latest HMM feature values for the feature heatmap
        _features = {}
        try:
            last = df_1h_feat.iloc[-1]
            
            # Get real-time funding (if available)
            cdx_pair = cdx.to_coindcx_pair(symbol)
            live_info = self._live_prices.get(cdx_pair, {})
            # 'fr' is official Funding Rate, 'efr' is Estimated Funding Rate
            live_fund = float(live_info.get("fr", 0.0))
            if live_fund == 0.0:
                 live_fund = float(live_info.get("efr", 0.0))

            _features = {
                "log_return":    round(float(last.get("log_return", 0)), 6),
                "volatility":    round(float(last.get("volatility", 0)), 6),
                "volume_change": round(float(last.get("volume_change", 0)), 6),
                "rsi_norm":      round(float(last.get("rsi_norm", 0)), 6),
                "oi_change":     0.0, # Not available in API
                "funding":       round(live_fund, 8),
            }
        except Exception:
            pass
        # Fetch real Binance 24h volume for this coin
        _volume_24h = 0.0
        try:
            client = _get_binance_client()
            ticker = client.get_ticker(symbol=symbol)
            _volume_24h = round(float(ticker.get("quoteVolume", 0)), 2)
        except Exception:
            # Fallback: compute from 1h candles
            try:
                vol_col = "volume" if "volume" in df_1h_feat.columns else None
                if vol_col:
                    close_col = df_1h_feat["close"].tail(24)
                    vol_vals = df_1h_feat[vol_col].tail(24)
                    _volume_24h = round(float((close_col * vol_vals).sum()), 2)
            except Exception:
                pass

        self._coin_states[symbol] = {
            "symbol":       symbol,
            "regime":       regime_name,
            "confidence":   round(conf, 4),
            "price":        current_price,
            "action":       "ANALYZING",
            "macro_regime": macro_regime_name,
            "features":     _features,
            "volume_24h":   _volume_24h,
            "segment":      get_segment_for_coin(symbol),   # ← was missing: shortlist card shows '—' without this
        }

        # ── Multi-Timeframe TA (1h / 15m / 5m) ──
        try:
            ta_multi = {"price": current_price}
            # 1h — already have df_1h_feat
            rsi_1h = float(df_1h_feat["rsi"].iloc[-1]) if "rsi" in df_1h_feat.columns else None
            atr_1h = float(df_1h_feat["atr"].iloc[-1]) if "atr" in df_1h_feat.columns else None
            ema20_1h = float(compute_ema(df_1h_feat["close"], 20).iloc[-1])
            ema50_1h = float(compute_ema(df_1h_feat["close"], 50).iloc[-1])
            ta_multi["1h"] = {
                "rsi": round(rsi_1h, 2) if rsi_1h else None,
                "atr": round(atr_1h, 4) if atr_1h else None,
                "trend": compute_trend(df_1h_feat),
            }
            ta_multi["ema_20_1h"] = round(ema20_1h, 4)
            ta_multi["ema_50_1h"] = round(ema50_1h, 4)

            # 5m
            try:
                df_5m_ta = fetch_klines(symbol, config.TIMEFRAME_EXECUTION, limit=100)
                if df_5m_ta is not None and len(df_5m_ta) >= 30:
                    df_5m_ta = compute_all_features(df_5m_ta)
                    ta_multi["5m"] = {
                        "rsi": round(float(df_5m_ta["rsi"].iloc[-1]), 2) if "rsi" in df_5m_ta.columns else None,
                        "atr": round(float(df_5m_ta["atr"].iloc[-1]), 4) if "atr" in df_5m_ta.columns else None,
                        "trend": compute_trend(df_5m_ta),
                    }
            except Exception as e:
                logger.debug("5m TA failed for %s: %s", symbol, e)

            # 5m
            try:
                df_5m_ta = fetch_klines(symbol, "5m", limit=100)
                if df_5m_ta is not None and len(df_5m_ta) >= 30:
                    df_5m_ta = compute_all_features(df_5m_ta)
                    ta_multi["5m"] = {
                        "rsi": round(float(df_5m_ta["rsi"].iloc[-1]), 2) if "rsi" in df_5m_ta.columns else None,
                        "atr": round(float(df_5m_ta["atr"].iloc[-1]), 4) if "atr" in df_5m_ta.columns else None,
                        "trend": compute_trend(df_5m_ta),
                    }
            except Exception as e:
                logger.debug("5m TA failed for %s: %s", symbol, e)

            self._coin_states[symbol]["ta_multi"] = ta_multi
        except Exception as e:
            logger.debug("Multi-TF TA failed for %s: %s", symbol, e)

        # NOTE: With HMM_N_STATES=3, CRASH is merged into BEAR. No separate CRASH check needed.

        # ── Multi-TF Tiered Signal Logic ─────────────────────────────────────────
        # Tier 1 (full consensus): 1H and 4H agree → normal full-conviction flow
        # Tier 2 (reversal setup): 5m flips vs 1H/4H → gate entry on ATR pullback
        #                          to 5m EMA20 before allowing through at reduced size
        # Tier 3 (true noise):     1H vs 4H conflict (not just 5m) → hard block
        _is_reversal_tier2 = False
        if macro_regime_name:
            # Hard block: 1H and 4H directly contradict each other (true noise)
            # Note: macro_regime_name = 4H regime, regime_name = 5m regime (primary scan TF)
            # 5m BULL + 4H BEAR = potential reversal, NOT noise → Tier 2
            # We check 1H vs 4H conflict separately via tf_agreement being 1 (only one agrees)
            one_h_predictions = (mtf_brain._predictions if mtf_brain else {})
            regime_1h = one_h_predictions.get("1h", (None, 0))[0]
            regime_4h = one_h_predictions.get("4h", (None, 0))[0]

            tier1_conflict = (
                regime_1h is not None and regime_4h is not None
                and regime_1h != regime_4h
                and regime_1h != config.REGIME_CHOP
                and regime_4h != config.REGIME_CHOP
            )
            if tier1_conflict:
                # 1H and 4H flatly disagree (e.g. 1H=BULL, 4H=BEAR) — Tier 3 noise block
                self._coin_states[symbol]["action"] = "MTF_CONFLICT"
                return None

            # [DISABLED] Tier 2: 5m flipped but higher TFs haven't confirmed yet
            # 5m says BUY but 1H/4H still BEAR (or vice versa) → reversal setup
            primary_regime = regime  # 5m HMM
            higher_tf_regimes = [r for r in [regime_1h, regime_4h] if r is not None]
            higher_tf_bear = all(r == config.REGIME_BEAR for r in higher_tf_regimes)
            higher_tf_bull = all(r == config.REGIME_BULL for r in higher_tf_regimes)

            if ((primary_regime == config.REGIME_BULL and higher_tf_bear) or
                    (primary_regime == config.REGIME_BEAR and higher_tf_bull)):
                # Tier 2: early reversal detected
                _is_reversal_tier2 = True
                
                # USER OVERRIDE: Tier 2 EMA20 pullback logic disabled.
                # Proceeding with trade without waiting for pullback.
                conviction = min(conviction, 55.0)
                logger.info(
                    "🔄 [%s] Tier2 REVERSAL detected — "
                    "price=%.4f — proceeding at capped conviction %.1f (EMA Pullback logic DISABLED)",
                    symbol, current_price, conviction,
                )
                self._coin_states[symbol]["action"] = "REVERSAL_TIER2_ACCEPTED_NO_PULLBACK"


        # ── Tier 2B: 15m+4H agree, 1H lagging — gate on 1H EMA20 pullback ──────
        # Cases 24 & 25: 5m=BULL + 4H=BULL + 1H=BEAR (or inverse SHORT version)
        _is_tier2b = False
        if regime_1h is not None and regime_4h is not None:
            macro_direction_bull = (regime_4h == config.REGIME_BULL and regime == config.REGIME_BULL)
            macro_direction_bear = (regime_4h == config.REGIME_BEAR and regime == config.REGIME_BEAR)
            one_h_lagging_bear   = (regime_1h == config.REGIME_BEAR and macro_direction_bull)
            one_h_lagging_bull   = (regime_1h == config.REGIME_BULL and macro_direction_bear)

            if one_h_lagging_bear or one_h_lagging_bull:
                # 5m and 4H agree; 1H is lagging opposite → Tier 2B
                _is_tier2b = True
                
                # USER OVERRIDE: Tier 2B 1H EMA20 pullback logic disabled.
                # Proceeding with trade without waiting for pullback.
                conviction = min(conviction, 60.0)
                logger.info(
                    "📈 [%s] Tier2B TREND RESUME detected — "
                    "price=%.4f — conviction capped %.1f (EMA Pullback logic DISABLED)",
                    symbol, current_price, conviction,
                )
                self._coin_states[symbol]["action"] = "TIER2B_RESUME_ACCEPTED_NO_PULLBACK"

        # ── TREND (BULL / BEAR) — 8-factor conviction flow ──────────────────────

        # 1. Determine side first (needed for sentiment gate + conviction)
        if regime == config.REGIME_BULL:
            side = "BUY"
        elif regime == config.REGIME_BEAR:
            side = "SELL"
        else:
            return None

        if side == "BUY" and btc_flash_crash:
            self._coin_states[symbol]["action"] = "MACRO_VETO_BTC_CRASH"
            return None

        current_atr   = df_1h_feat["atr"].iloc[-1]   if "atr"   in df_1h_feat.columns else 0.0
        current_price = float(df_1h_feat["close"].iloc[-1])
        current_swing_l = float(df_1h_feat["swing_l"].iloc[-1]) if "swing_l" in df_1h_feat.columns else None
        current_swing_h = float(df_1h_feat["swing_h"].iloc[-1]) if "swing_h" in df_1h_feat.columns else None

        # 2. Volatility filter
        if config.VOL_FILTER_ENABLED and current_atr > 0:
            vol_ratio = current_atr / current_price
            if vol_ratio < config.VOL_MIN_ATR_PCT:
                self._coin_states[symbol]["action"] = "VOL_TOO_LOW"
                return None
            if vol_ratio > config.VOL_MAX_ATR_PCT:
                self._coin_states[symbol]["action"] = "VOL_TOO_HIGH"
                return None

        # 3. 5m momentum filter + order flow (fetch df_5m once for both)
        df_5m = None
        orderflow_score = None
        nearest_bullish_ob = None
        nearest_bearish_ob = None
        nearest_bid_wall   = None
        nearest_ask_wall   = None
        try:
            df_5m = fetch_klines(symbol, config.TIMEFRAME_EXECUTION, limit=50)
            if df_5m is not None and len(df_5m) >= 5:
                df_5m_feat = compute_all_features(df_5m)
                price_now   = float(df_5m_feat["close"].iloc[-1])
                price_5_ago = float(df_5m_feat["close"].iloc[-5])
        except Exception:
            pass

        if self._orderflow:
            try:
                of_sig = self._orderflow.get_signal(symbol, df_5m)
                if of_sig is not None:
                    orderflow_score = of_sig.score
                    nearest_bullish_ob = of_sig.nearest_bullish_ob
                    nearest_bearish_ob = of_sig.nearest_bearish_ob
                    nearest_bid_wall   = of_sig.nearest_bid_wall
                    nearest_ask_wall   = of_sig.nearest_ask_wall
                    # Export detailed metrics for dashboard (v2 — multi-exchange + OB)
                    self._coin_states[symbol]["orderflow_details"] = {
                        "score": round(of_sig.score, 2),
                        "imbalance": round(of_sig.book_imbalance, 2),
                        "taker_buy_ratio": round(of_sig.taker_buy_ratio, 2),
                        "cumulative_delta": round(of_sig.cumulative_delta, 2),
                        "ls_ratio": round(of_sig.ls_ratio, 2),
                        "exchange_count": of_sig.exchange_count,
                        "aggregated_bid_usd": round(of_sig.aggregated_bid_usd, 0),
                        "aggregated_ask_usd": round(of_sig.aggregated_ask_usd, 0),
                        "bid_walls": [
                            {"price": w.price, "size": w.size_usd, "multiple": round(w.multiple, 1), "exchange": w.exchange} 
                            for w in of_sig.bid_walls
                        ],
                        "ask_walls": [
                            {"price": w.price, "size": w.size_usd, "multiple": round(w.multiple, 1), "exchange": w.exchange} 
                            for w in of_sig.ask_walls
                        ],
                        "order_blocks": [ob.to_dict() for ob in of_sig.order_blocks],
                        "nearest_bullish_ob": of_sig.nearest_bullish_ob,
                        "nearest_bearish_ob": of_sig.nearest_bearish_ob,
                    }

                    if of_sig.bid_walls or of_sig.ask_walls:
                        logger.info("🧱 %s order walls: %s", symbol, of_sig.note)
                    if of_sig.order_blocks:
                        logger.info("📦 %s order blocks: %d detected", symbol, len(of_sig.order_blocks))
            except Exception as _oe:
                logger.debug("OrderFlow fetch failed for %s: %s", symbol, _oe)

        # ─── Post-OrderFlow Momentum Filter ───
        if df_5m is not None and len(df_5m) >= 5:
            try:
                price_now   = float(df_5m_feat["close"].iloc[-1])
                price_5_ago = float(df_5m_feat["close"].iloc[-5])
                if side == "BUY"  and price_now <= price_5_ago:
                    self._coin_states[symbol]["action"] = "5M_FILTER_SKIP"
                    return None
                if side == "SELL" and price_now >= price_5_ago:
                    self._coin_states[symbol]["action"] = "5M_FILTER_SKIP"
                    return None
            except Exception:
                pass

        # 5. Full 4-factor conviction score
        funding     = df_1h_feat["funding_rate"].iloc[-1] if "funding_rate" in df_1h_feat.columns else None
        oi_chg      = df_1h_feat["oi_change"].iloc[-1]    if "oi_change"    in df_1h_feat.columns else None

        conviction = self.risk.compute_conviction_score(
            confidence=conf,
            regime=regime,
            side=side,
            funding_rate=funding,
            oi_change=oi_chg,
            orderflow_score=orderflow_score,
        )
        # Basic conviction floor — no profile will deploy below 40
        if conviction < 40:
            self._coin_states[symbol]["action"] = f"LOW_CONVICTION:{conviction:.1f}"
            return None

        of_note = f" | OF={orderflow_score:+.2f}" if orderflow_score is not None else ""
        self._coin_states[symbol]["action"] = f"ELIGIBLE_{side}"
        self._coin_states[symbol].update({
            "conviction": round(conviction, 1),
            "orderflow":  round(orderflow_score, 3) if orderflow_score is not None else None,
        })
        return {
            "symbol": symbol,
            "side": side,
            "atr": current_atr,
            "swing_l": current_swing_l,
            "swing_h": current_swing_h,
            "regime": regime,
            "regime_name": regime_name,
            "confidence": conf,
            "conviction": conviction,
            "funding_rate": round(funding, 6) if funding is not None else None,
            "oi_change":    round(oi_chg, 4)  if oi_chg  is not None else None,
            "orderflow_score": round(orderflow_score, 3) if orderflow_score is not None else None,
            # ── Entry quality context for Athena ─────────────────────────────
            "nearest_bullish_ob": nearest_bullish_ob,  # Demand zone from OB detector
            "nearest_bearish_ob": nearest_bearish_ob,  # Supply zone from OB detector
            "nearest_bid_wall":   nearest_bid_wall,    # Closest bid wall price (support)
            "nearest_ask_wall":   nearest_ask_wall,    # Closest ask wall price (resistance)
            "tf_breakdown":    tf_breakdown,   # ← passed to Athena context
            "tf_agreement":    tf_agreement,
            "reason": f"Trend {regime_name} | conf={conf:.0%} | conv={conviction:.1f}{of_note}",
        }

    # ─── Profile Evaluation ──────────────────────────────────────────────────

    # ─── Exit & Sync Logic ────────────────────────────────────────────────────

    def _check_exits(self, current_symbols):
        """
        DISABLED — Regime changes no longer trigger exits.

        Backtest confirmed: regime-change exits HURT returns because
        the HMM anticipates moves, and exit fees eat into profits.

        Trades now exit ONLY via:
          • ATR-based Stop Loss
          • ATR-based Take Profit
          • Trailing SL / Trailing TP
          • Max-loss guard (tradebook.update_unrealized)
        """
        # Sync _active_positions dict (remove entries closed by SL engine).
        # Keys may be "profile_id:symbol" or plain "symbol" — extract symbol portion.
        active_syms = {t["symbol"] for t in tradebook.get_active_trades()}
        for key in list(self._active_positions.keys()):
            sym = key.split(":")[-1] if ":" in key else key
            if sym not in active_syms:
                del self._active_positions[key]

    def _load_positions_from_tradebook(self):
        """Load active tradebook entries into _active_positions on startup."""
        try:
            active_trades = tradebook.get_active_trades()
            for t in active_trades:
                sym = t["symbol"]
                if sym not in self._active_positions:
                    self._active_positions[sym] = {
                        "regime": t.get("regime", "UNKNOWN"),
                        "confidence": t.get("confidence", 0),
                        "side": t.get("side", "BUY"),
                        "leverage": t.get("leverage", 1),
                        "entry_time": t.get("entry_timestamp", ""),
                    }
            if active_trades:
                logger.info(
                    "📂 Loaded %d active positions from tradebook: %s",
                    len(self._active_positions),
                    ", ".join(self._active_positions.keys()),
                )
        except Exception as e:
            logger.warning("Could not load tradebook positions on startup: %s", e)

    def _sync_positions(self):
        """
        Remove entries from _active_positions that were auto-closed
        by the tradebook (e.g., SL/TP hit during paper-mode simulation).
        Keys may be "profile_id:symbol" or plain "symbol" — extract symbol portion.
        """
        active_symbols = {t["symbol"] for t in tradebook.get_active_trades()}
        closed_out = [key for key in self._active_positions
                      if (key.split(":")[-1] if ":" in key else key) not in active_symbols]
        for key in closed_out:
            sym = key.split(":")[-1] if ":" in key else key
            logger.info("📗 Position %s auto-closed by tradebook (SL/TP hit). Removing.", sym)
            del self._active_positions[key]

    def _sync_coindcx_positions(self):
        """
        Sync CoinDCX positions → tradebook + dashboard (source of truth).

        Every heartbeat (1 min) this:
          1. Fetches all CoinDCX positions
          2. Auto-registers positions not in tradebook (manual opens)
          3. Detects exchange-side closures → close in tradebook
          4. Updates mark prices for P&L calculation
        """
        import coindcx_client as cdx

        try:
            cdx_positions = cdx.list_positions()
        except Exception as e:
            logger.debug("Failed to fetch CoinDCX positions: %s", e)
            return

        # Build map of active CoinDCX positions: symbol → position data
        cdx_active = {}
        for p in cdx_positions:
            active_pos = float(p.get("active_pos", 0))
            if active_pos == 0:
                continue
            pair = p.get("pair", "")
            try:
                symbol = cdx.from_coindcx_pair(pair)
            except Exception:
                continue
            cdx_active[symbol] = {
                "pair":          pair,
                "position_id":   p.get("id"),
                "active_pos":    active_pos,
                "avg_price":     float(p.get("avg_price", 0)),
                "mark_price":    float(p.get("mark_price", 0)),
                "leverage":      int(float(p.get("leverage", 1))),
                "locked_margin": float(p.get("locked_margin", 0)),
                "sl_trigger":    p.get("stop_loss_trigger"),
                "tp_trigger":    p.get("take_profit_trigger"),
                "side":          "BUY" if active_pos > 0 else "SELL",
            }

        # Get current tradebook active symbols
        tb_active = tradebook.get_active_trades()
        tb_symbols = {t["symbol"] for t in tb_active}

        # ── 1. Detect exchange-side closures / Fills ────────────────────────
        # If tradebook has an ACTIVE LIVE trade but CoinDCX doesn't → closed on exchange
        for trade in tb_active:
            sym = trade["symbol"]
            is_live = (trade.get("mode") or "").upper().startswith("LIVE")
            if not is_live:
                continue

            # Handle Limit Orders getting FILLED
            if trade.get("status") == "OPEN":
                # Check if it was filled by checking cdx_active
                if sym in cdx_active:
                    # Transition to ACTIVE!
                    logger.info("🟢 Limit Order %s (%s) was FILLED on CoinDCX. Transitioning to ACTIVE.", trade["trade_id"], sym)
                    tradebook.activate_limit_order(trade["trade_id"], cdx_active[sym]["avg_price"], cdx_active[sym]["active_pos"])
                    # Also update internal execution state layer
                    self._active_positions[f"{trade.get('profile_id', 'standard')}:{sym}"] = {
                        "regime": trade.get("regime", "UNKNOWN"),
                        "confidence": trade.get("confidence", 0),
                        "side": trade.get("side", "BUY"),
                        "entry_time": datetime.now(IST).replace(tzinfo=None).isoformat(),
                        "leverage": trade.get("leverage", 1),
                        "entry_price": cdx_active[sym]["avg_price"],
                        "quantity": abs(cdx_active[sym]["active_pos"]),
                        "exchange": "coindcx",
                        "position_id": cdx_active[sym]["position_id"],
                    }
                continue

            if sym not in cdx_active:
                # Fetch actual exit price + fee from CoinDCX trade history (LIVE only)
                exit_price = None
                exchange_fee = None
                try:
                    cdx_pair = trade.get("pair") or cdx.to_coindcx_pair(sym)
                    exit_result = cdx.get_last_exit_price(cdx_pair)
                    exit_price = exit_result.get("price")
                    exchange_fee = exit_result.get("fee", 0)
                except Exception as e:
                    logger.debug("Could not fetch exit price for %s: %s", sym, e)

                logger.info(
                    "📕 %s closed on CoinDCX (SL/TP or manual). Closing in tradebook%s%s.",
                    sym,
                    f" @ ${exit_price:.6f}" if exit_price else " (mark price)",
                    f" fee=${exchange_fee:.4f}" if exchange_fee else "",
                )
                tradebook.close_trade(
                    symbol=sym, reason="EXCHANGE_CLOSED",
                    exit_price=exit_price, exchange_fee=exchange_fee,
                )
                if sym in self._active_positions:
                    del self._active_positions[sym]

        # ── 2. Auto-register external positions ─────────────────────
        # If CoinDCX has active position but tradebook doesn't → register it
        for sym, pos in cdx_active.items():
            if sym in tb_symbols:
                continue

            logger.info(
                "📘 Discovered untracked CoinDCX position: %s %s %dx @ $%.6f — registering.",
                pos["side"], sym, pos["leverage"], pos["avg_price"],
            )

            # Compute ATR (best-effort) for trailing
            try:
                from data_pipeline import fetch_klines
                from feature_engine import compute_all_features
                df = fetch_klines(sym, "1h", limit=200)
                df_feat = compute_all_features(df)
                atr = float(df_feat["atr"].iloc[-1])
            except Exception:
                atr = pos["avg_price"] * 0.015  # fallback 1.5%

            capital = pos["locked_margin"] if pos["locked_margin"] > 0 else 100.0

            trade_id = tradebook.open_trade(
                symbol=sym,
                side=pos["side"],
                leverage=pos["leverage"],
                quantity=abs(pos["active_pos"]),
                entry_price=pos["avg_price"],
                atr=atr,
                # H4 FIX: Use honest labels for auto-synced positions (not fake regime)
                regime="AUTO_SYNCED" if pos["side"] == "SELL" else "AUTO_SYNCED",
                confidence=0.0,
                reason="Auto-synced from CoinDCX (not engine-originated)",
                capital=capital,
                mode="LIVE",
                user_id=getattr(config, 'ENGINE_USER_ID', None),
                bot_name=config.ENGINE_BOT_NAME or "Synaptic Adaptive",
            )

            self._active_positions[sym] = {
                "regime": "BEARISH" if pos["side"] == "SELL" else "BULLISH",
                "confidence": 0.99,
                "side": pos["side"],
                "entry_time": datetime.now(IST).replace(tzinfo=None).isoformat(),
                "leverage": pos["leverage"],
                "entry_price": pos["avg_price"],
                "quantity": abs(pos["active_pos"]),
                "exchange": "coindcx",
                "position_id": pos["position_id"],
            }
            logger.info("  → Registered as %s", trade_id)

        # ── 3. Push CoinDCX mark prices to tradebook ────────────────
        # This ensures unrealized P&L uses the exchange price, not Binance
        if cdx_active:
            cdx_prices = {sym: pos["mark_price"] for sym, pos in cdx_active.items()}
            tradebook.update_unrealized(prices=cdx_prices)

        # ── 4. MERGE active-trade data into multi_bot_state for dashboard ──
        # CRITICAL: Read existing state first, then merge — do NOT overwrite.
        # _save_multi_state() writes full analysis coin_states (all scanned coins
        # with confidence + regime). This sync only updates active-trade entries.
        try:
            active_trades = tradebook.get_active_trades()
            positions_dict = {}
            trade_coin_updates = {}
            for t in active_trades:
                sym = t["symbol"]
                positions_dict[sym] = {
                    "side": t.get("side", "SELL"),
                    "leverage": t.get("leverage", 1),
                    "entry_price": t.get("entry_price", 0),
                    "quantity": t.get("quantity", 0),
                    "atr": t.get("atr_at_entry", 0),
                    "status": "active",
                    "trade_id": t.get("trade_id"),
                    "exchange": "coindcx",
                    "unrealized_pnl": t.get("unrealized_pnl", 0),
                    "unrealized_pnl_pct": t.get("unrealized_pnl_pct", 0),
                    "current_price": t.get("current_price", 0),
                }
                trade_coin_updates[sym] = {
                    "regime": t.get("regime", "UNKNOWN"),
                    "confidence": t.get("confidence", 0),
                    "action": f'{"LONG" if t.get("position") == "LONG" else "SHORT"} ACTIVE',
                    "side": t.get("side", "SELL"),
                    "leverage": t.get("leverage", 1),
                    "deploy_status": "ACTIVE",
                }

            # Read existing multi_bot_state (preserves analysis coin_states)
            existing = {}
            if os.path.exists(config.MULTI_STATE_FILE):
                try:
                    with open(config.MULTI_STATE_FILE, "r") as f:
                        existing = json.load(f)
                except Exception:
                    existing = {}

            # Merge: keep all existing coin_states, overlay active-trade updates
            merged_coin_states = existing.get("coin_states", {})
            merged_coin_states.update(trade_coin_updates)

            # Update only the fields this sync is responsible for
            existing["active_positions"] = positions_dict
            existing["positions"] = positions_dict
            existing["deployed_count"] = len(positions_dict)
            existing["coin_states"] = merged_coin_states
            existing["timestamp"] = datetime.now(IST).replace(tzinfo=None).isoformat()
            # Preserve: cycle, coins_scanned, eligible_count, timing fields
            # (those are written by _save_multi_state and should not be touched)

            with open(config.MULTI_STATE_FILE, "w") as f:
                json.dump(existing, f, indent=2)
        except Exception as e:
            logger.debug("Failed to save multi_bot_state during sync: %s", e)

    def _get_orderflow_stats(self) -> dict:
        """Aggregate order flow stats for dashboard (Whale Walls, Inst. Flow, OBs)."""
        if not self._orderflow:
            return {}
        
        walls_count = 0
        inst_flow_count = 0
        total_exchanges = 0
        total_order_blocks = 0
        total_agg_bid_usd = 0.0
        total_agg_ask_usd = 0.0
        
        # Scan recently analyzed coins
        for sym in self._coin_states.keys():
            sig = self._orderflow.get_signal(sym)
            if sig:
                walls_count += len(sig.bid_walls) + len(sig.ask_walls)
                if abs(sig.cumulative_delta) > 0.5 or abs(sig.taker_buy_ratio - 0.5) > 0.1:
                    inst_flow_count += 1
                total_exchanges = max(total_exchanges, sig.exchange_count)
                total_order_blocks += len(sig.order_blocks)
                total_agg_bid_usd += sig.aggregated_bid_usd
                total_agg_ask_usd += sig.aggregated_ask_usd
                
        return {
            "WhaleWalls": walls_count,
            "Institutional": inst_flow_count,
            "exchange_count": total_exchanges,
            "order_blocks_detected": total_order_blocks,
            "agg_bid_usd": round(total_agg_bid_usd, 0),
            "agg_ask_usd": round(total_agg_ask_usd, 0),
        }

    # ─── State Persistence ───────────────────────────────────────────────────

    def _save_multi_state(self, symbols_scanned, eligible, deployed_count):
        """Save multi-coin bot state for the dashboard."""
        # Also save legacy single-coin state (backward compat)
        top_coin = self._coin_states.get(config.PRIMARY_SYMBOL, {})
        legacy_state = {
            "timestamp":    datetime.now(IST).replace(tzinfo=None).isoformat(),
            "symbol":       config.PRIMARY_SYMBOL,
            "regime":       top_coin.get("regime", "SCANNING"),
            "confidence":   top_coin.get("confidence", 0),
            "action":       top_coin.get("action", "MULTI_SCAN"),
            "trade_count":  self._trade_count,
            "paper_mode":   config.PAPER_TRADE,
        }
        try:
            with open(config.STATE_FILE, "w") as f:
                json.dump(legacy_state, f, indent=2)
        except Exception:
            pass

        # Multi-coin state
        now_utc = datetime.utcnow()
        next_analysis = datetime.utcfromtimestamp(
            self._last_analysis_time + config.ANALYSIS_INTERVAL_SECONDS
        ) if self._last_analysis_time else None

        multi_state = {
            "timestamp":        datetime.now(IST).replace(tzinfo=None).isoformat(),
            "cycle":            self._cycle_count,
            "coins_scanned":    len(symbols_scanned),
            "eligible_count":   len(eligible),
            "deployed_count":   deployed_count,
            "total_trades":     self._trade_count,
            "active_positions": self._active_positions,
            "max_concurrent_positions": config.MAX_CONCURRENT_POSITIONS,
            "coin_states":      self._coin_states,
            "orderflow_stats":  self._get_orderflow_stats(),
            "paper_mode":       config.PAPER_TRADE,
            "cycle_execution_time_seconds": getattr(self, '_last_cycle_duration', 0),
            "analysis_interval_seconds": config.ANALYSIS_INTERVAL_SECONDS,
            # Timing fields — written directly so dashboard always has them
            "last_analysis_time": now_utc.isoformat() + "Z",
            "next_analysis_time": (next_analysis.isoformat() + "Z") if next_analysis else None,
            "active_bots":  [{"bot_id": b.get("bot_id"), "bot_name": b.get("bot_name"),
                              "segment": b.get("segment_filter", "ALL")}
                             for b in list(config.ENGINE_ACTIVE_BOTS)],
            # Veto log — last 20 entries newest-first for cockpit Veto Log tab
            "veto_log":              list(reversed(self._veto_log[-20:])),
            # Signal queue — count + detail for Brain Execution Summary
            "pending_signals_count": len(self._pending_signals),
            "pending_signals_detail": [
                {
                    "symbol":         sym,
                    "queue_reason":   entry.get("queue_reason", "unknown"),
                    "cycles_pending": entry.get("cycles_pending", 1),
                    "conviction":     entry.get("result", {}).get("conviction", 0),
                    "side":           entry.get("result", {}).get("side", ""),
                    "expires_in_sec": max(0, round(entry.get("expires_at", 0) - time.time())),
                }
                for sym, entry in self._pending_signals.items()
            ],
        }
        try:
            with open(config.MULTI_STATE_FILE, "w") as f:
                json.dump(multi_state, f, indent=2)
        except Exception as e:
            logger.error("Failed to save multi state: %s", e)

    def _evict_brain_cache(self):
        """LRU eviction: cap HMM brain caches to prevent OOM kills on Railway."""
        cap = self._BRAIN_CACHE_MAX
        if len(self._coin_brains) > cap:
            # Evict oldest entries (dict preserves insertion order in Python 3.7+)
            excess = len(self._coin_brains) - cap
            keys_to_drop = list(self._coin_brains.keys())[:excess]
            for k in keys_to_drop:
                del self._coin_brains[k]
            logger.info("🧹 Evicted %d old HMM brains (cache: %d/%d)", excess, len(self._coin_brains), cap)
        if len(self._multi_tf_brains) > cap:
            excess = len(self._multi_tf_brains) - cap
            keys_to_drop = list(self._multi_tf_brains.keys())[:excess]
            for k in keys_to_drop:
                del self._multi_tf_brains[k]
            logger.info("🧹 Evicted %d old MTF brains (cache: %d/%d)", excess, len(self._multi_tf_brains), cap)

    def _process_commands(self):
        """Check for external commands (from dashboard kill switch)."""
        import os
        try:
            if not os.path.exists(config.COMMANDS_FILE):
                return
            with open(config.COMMANDS_FILE, "r") as f:
                cmd = json.load(f)

            if cmd.get("command") == "KILL":
                logger.warning("🚨 External KILL command received!")
                self.risk._killed = True
                for sym in list(self._active_positions.keys()):
                    tradebook.close_trade(symbol=sym, reason="EXTERNAL_KILL")
                    self.executor.close_all_positions(sym)
                self._active_positions.clear()
                os.remove(config.COMMANDS_FILE)

            elif cmd.get("command") == "RESET":
                logger.info("🔄 External RESET command received.")
                self.risk.reset_kill_switch()
                os.remove(config.COMMANDS_FILE)

            elif cmd.get("command") == "CLOSE_ALL":
                logger.info("🛑 External CLOSE_ALL command received — closing all positions.")
                for sym in list(self._active_positions.keys()):
                    tradebook.close_trade(symbol=sym, reason="BOT_STOPPED")
                    self.executor.close_all_positions(sym)
                self._active_positions.clear()
                os.remove(config.COMMANDS_FILE)

        except (json.JSONDecodeError, KeyError):
            pass
        except Exception as e:
            logger.error("Error processing commands: %s", e)


# ─── Entry Point ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    bot = RegimeMasterBot()
    bot.run()

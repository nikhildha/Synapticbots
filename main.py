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
from data_pipeline import fetch_klines, get_multi_timeframe_data, _get_binance_client
from feature_engine import compute_all_features, compute_hmm_features, compute_trend, compute_support_resistance, compute_sr_position, compute_ema
from execution_engine import ExecutionEngine
from risk_manager import RiskManager
from coin_scanner import get_top_coins_by_volume, get_active_bot_segment_pool, reload_coin_tiers
from tools.weekly_reclassify import needs_reclassify, run_reclassify
import tradebook
import telegram as tg
import sentiment_engine as _sent_mod
import orderflow_engine as _of_mod
import coindcx_client as cdx
from llm_reasoning import AthenaEngine
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

        # ─── Coin pool configuration ─────────────────────────────────────────
        # Pool size matches config.TOP_COINS_LIMIT to scan all coins per cycle
        self._full_coin_pool: list = []
        self._scan_rotation: int = 0
        self._SCAN_BATCH_SIZE: int = config.TOP_COINS_LIMIT
        self._SCAN_POOL_SIZE: int = config.TOP_COINS_LIMIT


        # Weekly tier re-classification state
        self._reclassify_thread: threading.Thread | None = None

        # ── Startup: sync _active_positions from tradebook ──────────
        try:
            self._load_positions_from_tradebook()
        except Exception as e:
            logger.error("⚠️ Failed to load positions from tradebook on startup: %s", e)

        # ── Sentiment Engine (lazy singleton) ─────────────────────────
        self._sentiment = None
        if config.SENTIMENT_ENABLED:
            try:
                self._sentiment = _sent_mod.get_engine()
                logger.info("📰 Sentiment Engine ready (VADER%s)",
                            " + FinBERT" if config.SENTIMENT_USE_FINBERT else " only")
            except Exception as e:
                logger.warning("⚠️  Sentiment Engine failed to load: %s", e)

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
            tradebook.update_unrealized(funding_rates=funding_rates)
        except Exception as e:
            logger.debug("Tradebook unrealized update error: %s", e)

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

    def _maybe_reclassify_tiers(self):
        """
        Spawn a background thread to re-classify coin tiers if TIER_RECLASSIFY_DAYS
        have elapsed since the last run. Non-blocking — bot continues trading while
        calibration runs. On completion, reloads the updated coin_tiers.csv.
        """
        # Skip if a reclassify thread is already running
        t = self._reclassify_thread
        if t is not None and t.is_alive():
            return

        if not needs_reclassify():
            return

        logger.info(
            "📊 Weekly coin tier re-classification due — starting background thread "
            "(~5–8 min, trading continues normally)."
        )

        def _worker():
            try:
                run_reclassify()
                reload_coin_tiers()
                logger.info("✅ Coin tiers refreshed and reloaded into memory.")
                tg.send_message(
                    "📊 *Weekly Tier Update*\nCoin tier re-classification complete. "
                    "Tiers reloaded — new Tier A/C lists now active."
                )
            except Exception as exc:
                logger.error("Weekly reclassify failed: %s", exc)

        self._reclassify_thread = threading.Thread(target=_worker, daemon=True, name="TierReclassify")
        self._reclassify_thread.start()

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
        # ── 0. Weekly coin tier re-classification (background) ───
        self._maybe_reclassify_tiers()

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
            # Always refresh the segment heatmap JSON every cycle (cheap Binance ticker call)
            # This keeps the dashboard heatmap live even when the pool is not being rebuilt
            try:
                from coin_scanner import get_hottest_segments as _refresh_heatmap
                _refresh_heatmap(getattr(config, "SEGMENT_SCAN_LIMIT", 3))
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
        # Build set of active (bot_id, symbol) to prevent a specific bot from duplicating a trade
        active_bot_symbols = {(t.get('bot_id', ''), t['symbol']) for t in tradebook_active}
        # Tracks symbols deployed THIS tick to prevent double-deploying the same coin across bots
        active_symbols: set = set()
        raw_results = []

        # Scan ALL symbols — do NOT skip based on other bots' deployed coins.
        # Each bot has its own position check (pos_key = bot_id:symbol).
        # If Synaptic Adaptive deployed ETH, L1 Specialist should still scan + deploy it.
        # BTCUSDT is the macro regime reference for every coin's conviction score.
        # It must be analyzed on EVERY cycle regardless of which batch rotation is active.
        scan_symbols = symbols if "BTCUSDT" in symbols else ["BTCUSDT"] + list(symbols)
        logger.info("📡 Scanning %d coins | active trades in book: %d",
                    len(scan_symbols), tradebook_active_count)

        # ── 4b. Macro Veto Overlay (BTC Flash Crash Detection) ──
        btc_flash_crash = False
        try:
            btc_df = fetch_klines("BTCUSDT", "15m", limit=3)
            if btc_df is not None and len(btc_df) >= 2:
                btc_latest = float(btc_df["close"].iloc[-1])
                btc_prev = float(btc_df["close"].iloc[-2])
                btc_15m_return = (btc_latest - btc_prev) / btc_prev
                # Block LONGS if BTC dropped more than configured threshold in the last 15m candle
                threshold_pct = getattr(config, "MACRO_VETO_BTC_DROP_PCT", 1.5) / 100.0
                if btc_15m_return < -threshold_pct:
                    btc_flash_crash = True
                    logger.warning("🚨 MACRO VETO: BTCUSDT Flash Crash! (15m return: %.2f%%) — Blocking all long setups.", btc_15m_return * 100)
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
                    logger.warning("⚠️ Analysis failed for %s: %s", symbol, e)  # H3 Fix: visible in prod logs
                
            # Aggressive GC: Clear memory physically bounded by MTF array instantiations immediately
            # so the baseline RAM never scales to n_coins during a single heartbeat cycle.
            self._evict_brain_cache()
            gc.collect()



        # ── 5. Deploy: Top HMM coin per segment → Athena final call ────────────────
        # Sort by conviction desc so top_coins[:N] picks highest-conviction coin per segment
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

        for target in _tick_active_bots:
            bot_id   = target.get("bot_id", config.ENGINE_BOT_ID)
            bot_name = target.get("bot_name", "Synaptic Bot")
            user_id  = target.get("user_id", config.ENGINE_USER_ID)
            bot_segment_filter = target.get("segment_filter") or _infer_segment_from_name(bot_name)

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

            # Pick top N coins by HMM conviction
            top_n = getattr(config, "TOP_COINS_PER_SEGMENT", 1)
            top_coins = seg_results[:top_n]

            if not top_coins:
                logger.info("🔍 [%s] No HMM signals for segment %s this cycle", bot_name, bot_segment_filter)
                continue

            # Explicitly mark non-top eligible coins so the UI doesn't get stuck showing "READY"
            for ignored in seg_results[top_n:]:
                sym = ignored["symbol"]
                _st = self._coin_states.get(sym, {}).get("bot_deploy_statuses", {}).get(bot_id, "")
                if not _st:
                    self._coin_states.setdefault(sym, {}).setdefault("bot_deploy_statuses", {})[bot_id] = "FILTERED: Not top coin in segment"

            for top in top_coins:
                sym      = top["symbol"]
                pos_key  = f"{bot_id}:{sym}"
                seg_name = get_segment_for_coin(sym)

                # Conviction threshold — skip before Athena call if too low
                conviction = top.get("conviction", 0)
                min_conv   = getattr(config, "MIN_CONVICTION_FOR_DEPLOY", 60)
                if conviction < min_conv:
                    logger.debug("⛔ [%s] %s conviction %.0f < %.0f threshold — skip",
                                 bot_name, sym, conviction, min_conv)
                    self._coin_states.setdefault(sym, {}).setdefault("bot_deploy_statuses", {})[bot_id] = (
                        f"FILTERED: low conviction ({conviction:.0f} < {min_conv:.0f})"
                    )
                    continue

                # Per-bot duplicate check (skip if THIS bot is already trading this coin)
                if (bot_id, sym) in active_bot_symbols:
                    logger.debug("🔄 [%s] %s already open for this bot — skip", bot_name, sym)
                    self._coin_states.setdefault(sym, {}).setdefault("bot_deploy_statuses", {})[bot_id] = "FILTERED: active trade exists for this bot"
                    _bcast("FILTERED_DUPLICATE", self._cycle_count, bot_name, bot_id, sym,
                           top.get("side", ""), seg_name, top.get("confidence", 0),
                           "active trade already open for this bot")
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
                # H2 Fix: 4-tier scale — borderline signals (60–69) get reduced leverage
                if conviction >= 95:
                    lev = 20
                elif conviction >= 80:
                    lev = 15
                elif conviction >= 70:
                    lev = 10
                else:
                    lev = 5   # 60–69: passed threshold but weak signal

                # ── Athena: FINAL CALL (gates deployment) ────────────────────────
                current_price = self._coin_states.get(sym, {}).get("price", 0)
                atr_val = top.get("atr", 0)
                athena_decision = None
                if self._athena and config.LLM_REASONING_ENABLED:
                    # H4 Fix: enforce per-cycle call cap to prevent rate-limit burst
                    llm_cap = getattr(config, "LLM_MAX_CALLS_PER_CYCLE", 10)
                    if athena_calls_this_cycle >= llm_cap:
                        logger.warning(
                            "⚠️ Athena cap reached (%d/%d) — skipping [%s] %s (fail-closed)",
                            athena_calls_this_cycle, llm_cap, bot_name, sym
                        )
                        self._coin_states.setdefault(sym, {}).setdefault("bot_deploy_statuses", {})[bot_id] = (
                            f"FILTERED: Athena cap ({llm_cap} calls/cycle) reached"
                        )
                        continue
                    try:
                        llm_ctx = {
                            "ticker":         sym,
                            "side":           top["side"],
                            "leverage":       lev,
                            "hmm_confidence": top["confidence"],
                            "hmm_regime":     top.get("regime_name", ""),
                            "conviction":     conviction,
                            "current_price":  current_price,
                            "atr":            atr_val,
                            "atr_pct":        (atr_val / max(current_price, 0.0001)) * 100,
                            "trend":          self._coin_states.get(sym, {}).get("context", {}).get("trend_alignment", "UNKNOWN"),
                            "signal_type":    top.get("signal_type", "TREND_FOLLOW"),
                            "ema_15m_20":     top.get("ema_15m_20"),
                            "tf_agreement":   top.get("tf_agreement", 0),
                            "btc_regime":     self._coin_states.get("BTCUSDT", {}).get("regime", "UNKNOWN"),
                        }
                        athena_decision = self._athena.validate_signal(llm_ctx)
                        athena_calls_this_cycle += 1  # H4: count successful calls
                        self._coin_states.setdefault(sym, {})["athena_state"] = {
                            "action":    athena_decision.action,
                            "confidence": athena_decision.adjusted_confidence,
                            "reasoning": athena_decision.reasoning,
                            "risk_flags": getattr(athena_decision, "risk_flags", []),
                            "model":     getattr(athena_decision, "model", "unknown"),
                            "latency_ms": getattr(athena_decision, "latency_ms", 0),
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
                    continue

                # ── Build trade dict ──────────────────────────────────────────────
                capital     = target.get("capital_per_trade") or getattr(config, "CAPITAL_PER_TRADE", 100.0)
                qty         = (capital * lev) / max(current_price, 0.0001)
                reason_str  = top.get("reason", f"{top.get('regime_name','')} {int(top['confidence']*100)}%")

                # SIGNAL_DISPATCH broadcast
                _bcast("SIGNAL_DISPATCH", self._cycle_count, bot_name, bot_id, sym,
                       top["side"], seg_name, top["confidence"],
                       f"regime={top.get('regime_name','')} lev={lev}x qty={qty:.4f} athena=APPROVED")

                self._coin_states.setdefault(sym, {}).setdefault("bot_deploy_statuses", {})[bot_id] = "DEPLOY_QUEUED"

                logger.info(
                    "🔥 DEPLOYING [%s]: %s %s @ %dx | HMM %.0f%% conv | Athena ✅",
                    bot_name, top["side"], sym, lev, conviction,
                )

                # Execute
                try:
                    result = self.executor.execute_trade(
                        symbol=sym,
                        side=top["side"],
                        leverage=lev,
                        quantity=qty,
                        atr=atr_val,
                        ema_15m_20=top.get("ema_15m_20"),
                        regime=top.get("regime", 0),
                        confidence=top["confidence"],
                        reason=reason_str,
                        swing_l=top.get("swing_l"),
                        swing_h=top.get("swing_h"),
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
                active_symbols.add(sym)
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
        # Fetch 1h data
        df_1h = fetch_klines(symbol, config.TIMEFRAME_CONFIRMATION, limit=config.HMM_LOOKBACK)
        if df_1h is None or len(df_1h) < 60:
            if symbol == "BTCUSDT":
                logger.error("🚨 BTC 1h data fetch failed or too short — regime STALE")
                self._coin_states.setdefault("BTCUSDT", {})["last_fetch_error"] = datetime.utcnow().isoformat()
            return None

        # Get or create brain for this coin (1h)
        brain = self._coin_brains.get(symbol)
        if brain is None:
            brain = HMMBrain()
            self._coin_brains[symbol] = brain

        # Compute features
        df_1h_feat = compute_all_features(df_1h)
        df_1h_hmm = compute_hmm_features(df_1h)

        # Train if needed
        if brain.needs_retrain():
            brain.train(df_1h_hmm)

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
                    tf_brain = HMMBrain()
                    self._coin_brains[tf_key] = tf_brain

                try:
                    df_tf = fetch_klines(symbol, tf, limit=config.MULTI_TF_CANDLE_LIMIT)
                    if df_tf is not None and len(df_tf) >= 60:
                        df_tf_feat = compute_all_features(df_tf)
                        df_tf_hmm = compute_hmm_features(df_tf)
                        if tf_brain.needs_retrain():
                            tf_brain.train(df_tf_hmm)
                        if tf_brain.is_trained:
                            mtf_brain.set_brain(tf, tf_brain)
                            tf_data[tf] = df_tf_feat
                except Exception as e:
                    logger.debug("Multi-TF %s fetch failed for %s: %s", tf, symbol, e)

            # Check if enough models are ready
            if not mtf_brain.is_ready():
                self._coin_states[symbol] = {
                    "symbol": symbol, "regime": "N/A", "confidence": 0,
                    "price": 0, "action": "MTF_INSUFFICIENT_MODELS",
                }
                return None

            # Predict across all timeframes
            mtf_brain.predict(tf_data)
            conviction, side, tf_agreement = mtf_brain.get_conviction()
            regime_summary = mtf_brain.get_regime_summary()

            if side is None:
                self._coin_states[symbol] = {
                    "symbol": symbol, "regime": regime_summary,
                    "confidence": 0, "price": 0, "action": "MTF_NO_CONSENSUS",
                }
                return None

            # Macro Veto Block
            if side == "BUY" and btc_flash_crash:
                self._coin_states[symbol] = {
                    "symbol": symbol, "regime": regime_summary,
                    "confidence": 0, "price": 0, "action": "MACRO_VETO_BTC_CRASH",
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
                    }
                    return None
                if vol_ratio > config.VOL_MAX_ATR_PCT:
                    self._coin_states[symbol] = {
                        "symbol": symbol, "regime": regime_summary,
                        "confidence": round(conf, 4), "price": current_price,
                        "action": "VOL_TOO_HIGH",
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
            }

            # Compute ema_15m_20 for ATR pullback limit orders (multi-TF path)
            # Without this, execution_engine always falls back to MARKET orders.
            _ema_15m_20 = None
            try:
                df_15m_for_ema = fetch_klines(symbol, "15m", limit=50)
                if df_15m_for_ema is not None and len(df_15m_for_ema) >= 20:
                    from feature_engine import compute_ema
                    _ema_15m_20 = float(compute_ema(compute_all_features(df_15m_for_ema)["close"], 20).iloc[-1])
            except Exception:
                pass

            return {
                "symbol": symbol,
                "side": side,
                "atr": current_atr,
                "ema_15m_20": _ema_15m_20,
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
        sr_pos_4h = None
        vwap_pos_4h = None

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
            "symbol": symbol,
            "regime": regime_name,
            "confidence": round(conf, 4),
            "price": current_price,
            "action": "ANALYZING",
            "macro_regime": macro_regime_name,
            "features": _features,
            "volume_24h": _volume_24h,
        }

        # ── Multi-Timeframe TA (1h / 15m / 5m) ──
        try:
            ta_multi = {"price": current_price}
            # 1h — already have df_1h_feat
            rsi_1h = float(df_1h_feat["rsi"].iloc[-1]) if "rsi" in df_1h_feat.columns else None
            atr_1h = float(df_1h_feat["atr"].iloc[-1]) if "atr" in df_1h_feat.columns else None
            ema20_1h = float(compute_ema(df_1h_feat["close"], 20).iloc[-1])
            ema50_1h = float(compute_ema(df_1h_feat["close"], 50).iloc[-1])
            sr_1h = compute_support_resistance(df_1h_feat)
            ta_multi["1h"] = {
                "rsi": round(rsi_1h, 2) if rsi_1h else None,
                "atr": round(atr_1h, 4) if atr_1h else None,
                "trend": compute_trend(df_1h_feat),
                "support": sr_1h["support"],
                "resistance": sr_1h["resistance"],
                "bb_pos": sr_1h["bb_pos"],
            }
            ta_multi["ema_20_1h"] = round(ema20_1h, 4)
            ta_multi["ema_50_1h"] = round(ema50_1h, 4)

            # 15m
            try:
                df_15m_ta = fetch_klines(symbol, "15m", limit=100)
                if df_15m_ta is not None and len(df_15m_ta) >= 30:
                    df_15m_ta = compute_all_features(df_15m_ta)
                    sr_15m = compute_support_resistance(df_15m_ta)
                    ta_multi["15m"] = {
                        "rsi": round(float(df_15m_ta["rsi"].iloc[-1]), 2) if "rsi" in df_15m_ta.columns else None,
                        "atr": round(float(df_15m_ta["atr"].iloc[-1]), 4) if "atr" in df_15m_ta.columns else None,
                        "trend": compute_trend(df_15m_ta),
                        "support": sr_15m["support"],
                        "resistance": sr_15m["resistance"],
                        "bb_pos": sr_15m["bb_pos"],
                    }
            except Exception as e:
                logger.debug("15m TA failed for %s: %s", symbol, e)

            # 5m
            try:
                df_5m_ta = fetch_klines(symbol, "5m", limit=100)
                if df_5m_ta is not None and len(df_5m_ta) >= 30:
                    df_5m_ta = compute_all_features(df_5m_ta)
                    sr_5m = compute_support_resistance(df_5m_ta)
                    ta_multi["5m"] = {
                        "rsi": round(float(df_5m_ta["rsi"].iloc[-1]), 2) if "rsi" in df_5m_ta.columns else None,
                        "atr": round(float(df_5m_ta["atr"].iloc[-1]), 4) if "atr" in df_5m_ta.columns else None,
                        "trend": compute_trend(df_5m_ta),
                        "support": sr_5m["support"],
                        "resistance": sr_5m["resistance"],
                        "bb_pos": sr_5m["bb_pos"],
                    }
            except Exception as e:
                logger.debug("5m TA failed for %s: %s", symbol, e)

            self._coin_states[symbol]["ta_multi"] = ta_multi
        except Exception as e:
            logger.debug("Multi-TF TA failed for %s: %s", symbol, e)

        # NOTE: With HMM_N_STATES=3, CRASH is merged into BEAR. No separate CRASH check needed.

        # ── Multi-TF Tiered Signal Logic ─────────────────────────────────────────
        # Tier 1 (full consensus): 1H and 4H agree → normal full-conviction flow
        # Tier 2 (reversal setup): 15m flips vs 1H/4H → gate entry on ATR pullback
        #                          to 15m EMA20 before allowing through at reduced size
        # Tier 3 (true noise):     1H vs 4H conflict (not just 15m) → hard block
        _is_reversal_tier2 = False
        if macro_regime_name:
            # Hard block: 1H and 4H directly contradict each other (true noise)
            # Note: macro_regime_name = 4H regime, regime_name = 15m regime (primary scan TF)
            # 15m BULL + 4H BEAR = potential reversal, NOT noise → Tier 2
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

            # [DISABLED] Tier 2: 15m flipped but higher TFs haven't confirmed yet
            # 15m says BUY but 1H/4H still BEAR (or vice versa) → reversal setup
            primary_regime = regime  # 15m HMM
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
        # Cases 24 & 25: 15m=BULL + 4H=BULL + 1H=BEAR (or inverse SHORT version)
        _is_tier2b = False
        if regime_1h is not None and regime_4h is not None:
            macro_direction_bull = (regime_4h == config.REGIME_BULL and regime == config.REGIME_BULL)
            macro_direction_bear = (regime_4h == config.REGIME_BEAR and regime == config.REGIME_BEAR)
            one_h_lagging_bear   = (regime_1h == config.REGIME_BEAR and macro_direction_bull)
            one_h_lagging_bull   = (regime_1h == config.REGIME_BULL and macro_direction_bear)

            if one_h_lagging_bear or one_h_lagging_bull:
                # 15m and 4H agree; 1H is lagging opposite → Tier 2B
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

        # 3. Sentiment (fast veto before conviction compute)
        sentiment_score = None
        coin_sym = symbol.replace("USDT", "").replace("BUSD", "")
        if self._sentiment:
            try:
                s_sig = self._sentiment.get_coin_sentiment(coin_sym)
                if s_sig is not None:
                    # Store news for dashboard
                    self._coin_states[symbol]["news"] = s_sig.top_articles
                    
                    if s_sig.alert:
                        self._coin_states[symbol]["action"] = f"SENTIMENT_ALERT:{s_sig.alert_reason}"
                        return None
                    sentiment_score = s_sig.effective_score
                    if sentiment_score <= config.SENTIMENT_VETO_THRESHOLD:
                        self._coin_states[symbol]["action"] = "SENTIMENT_VETO"
                        return None
            except Exception as _se:
                logger.debug("Sentiment fetch failed for %s: %s", symbol, _se)

        # 4. 15m momentum filter + order flow (fetch df_15m once for both)
        df_15m = None
        orderflow_score = None
        ema_15m_20 = None
        try:
            df_15m = fetch_klines(symbol, config.TIMEFRAME_EXECUTION, limit=50)
            if df_15m is not None and len(df_15m) >= 5:
                df_15m_feat = compute_all_features(df_15m)
                price_now   = float(df_15m_feat["close"].iloc[-1])
                price_5_ago = float(df_15m_feat["close"].iloc[-5])
                ema_15m_20  = float(compute_ema(df_15m_feat["close"], 20).iloc[-1])
                pass
        except Exception:
            pass

        if self._orderflow:
            try:
                of_sig = self._orderflow.get_signal(symbol, df_15m)
                if of_sig is not None:
                    orderflow_score = of_sig.score
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
        if df_15m is not None and len(df_15m) >= 5:
            try:
                price_now   = float(df_15m_feat["close"].iloc[-1])
                price_5_ago = float(df_15m_feat["close"].iloc[-5])
                if side == "BUY"  and price_now <= price_5_ago:
                    self._coin_states[symbol]["action"] = "15M_FILTER_SKIP"
                    return None
                if side == "SELL" and price_now >= price_5_ago:
                    self._coin_states[symbol]["action"] = "15M_FILTER_SKIP"
                    return None
            except Exception:
                pass

        # 5. Full 8-factor conviction score
        _regime_name_to_int = {v: k for k, v in config.REGIME_NAMES.items()}
        btc_proxy   = _regime_name_to_int.get(macro_regime_name) if macro_regime_name else None
        funding     = df_1h_feat["funding_rate"].iloc[-1] if "funding_rate" in df_1h_feat.columns else None
        oi_chg      = df_1h_feat["oi_change"].iloc[-1]    if "oi_change"    in df_1h_feat.columns else None
        volatility  = (current_atr / current_price)       if current_atr > 0 else None

        conviction = self.risk.compute_conviction_score(
            confidence=conf,
            regime=regime,
            side=side,
            btc_regime=btc_proxy,
            funding_rate=funding,
            oi_change=oi_chg,
            volatility=volatility,
            sr_position=sr_pos_4h,
            vwap_position=vwap_pos_4h,
            sentiment_score=sentiment_score,
            orderflow_score=orderflow_score,
        )
        # Basic conviction floor — no profile will deploy below 40
        if conviction < 40:
            self._coin_states[symbol]["action"] = f"LOW_CONVICTION:{conviction:.1f}"
            return None

        of_note = f" | OF={orderflow_score:+.2f}" if orderflow_score is not None else ""
        sn_note = f" | sent={sentiment_score:+.2f}" if sentiment_score is not None else ""
        self._coin_states[symbol]["action"] = f"ELIGIBLE_{side}"
        self._coin_states[symbol].update({
            "conviction": round(conviction, 1),
            "orderflow":  round(orderflow_score, 3) if orderflow_score is not None else None,
            "sentiment":  round(sentiment_score, 3) if sentiment_score is not None else None,
        })
        return {
            "symbol": symbol,
            "side": side,
            "atr": current_atr,
            "ema_15m_20": ema_15m_20,
            "swing_l": current_swing_l,
            "swing_h": current_swing_h,
            "regime": regime,
            "regime_name": regime_name,
            "confidence": conf,
            "conviction": conviction,
            "reason": f"Trend {regime_name} | conf={conf:.0%} | conv={conviction:.1f}{sn_note}{of_note}",
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
            "source_stats":     self._sentiment.get_source_stats() if self._sentiment else {},
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

"""
Athena — LLM Reasoning Layer for Synaptic Trading Engine
═══════════════════════════════════════════════════════════
Strategic AI brain that validates HMM signals using contextual reasoning.
Uses Google Gemini to act as a "risk committee" — reviewing each trade signal
against market context, sentiment, macro events, and multi-TF confluence.

Actions:
  EXECUTE     → Proceed with trade at original conviction
  REDUCE_SIZE → Lower conviction (reduce position size / leverage)
  VETO        → Block the trade entirely (reasoning logged)

Design:
  - Fail-open: API failure → EXECUTE (never blocks trades due to infra issues)
  - Cached per coin for LLM_CACHE_MINUTES
  - Rate-limited to LLM_MAX_CALLS_PER_CYCLE per analysis cycle
  - All decisions logged to data/athena_decisions.json for analysis
"""
import json
import logging
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, Optional

import config


logger = logging.getLogger("Athena")

# Setup dedicated file logger for Athena
if not logger.handlers:
    try:
        os.makedirs(config.DATA_DIR, exist_ok=True)
        athena_log_file = os.path.join(config.DATA_DIR, "athena_system.log")
        file_handler = logging.FileHandler(athena_log_file, encoding="utf-8")
        file_handler.setFormatter(logging.Formatter("%(asctime)s [%(name)s] %(levelname)s: %(message)s", datefmt="%Y-%m-%d %H:%M:%S"))
        logger.addHandler(file_handler)
        logger.setLevel(logging.DEBUG)  # Ensure debug logs are captured
    except Exception as e:
        pass


# ─── Output dataclass ────────────────────────────────────────────────────────

@dataclass
class AthenaDecision:
    """Result of Athena's analysis of an HMM trade signal."""
    action: str             # EXECUTE, REDUCE_SIZE, or VETO
    adjusted_confidence: float  # 0.0–1.0 (multiplied against conviction)
    reasoning: str          # Human-readable explanation
    risk_flags: list        # List of identified risk factors
    athena_direction: str = ""  # LONG, SHORT, or SKIP — Athena's own directional view
    model: str = ""         # Model used (e.g. "gpt-4o")
    latency_ms: int = 0     # API call duration
    cached: bool = False    # Whether this was a cache hit
    suggested_sl: float = 0.0   # Athena's recommended stop-loss (0 = not provided)
    suggested_tp: float = 0.0   # Athena's recommended target/take-profit (0 = not provided)
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


# ─── System Prompt ────────────────────────────────────────────────────────────

ATHENA_SYSTEM_PROMPT = """You are **Athena**, the Lead Crypto Quant Trading Officer for a quantitative crypto trading fund.
A coin has been flagged by our HMM (Hidden Markov Model) multi-timeframe regime system.
Your job is to make the FINAL DECISION: LONG, SHORT, or SKIP.

## Context You Receive Per Coin

| Field | What It Means |
|---|---|
| HMM Signal Dir | Direction the HMM voted: BUY or SELL |
| HMM Regime | BULLISH / BEARISH / SIDEWAYS |
| HMM Confidence | Margin between best & 2nd-best state (0–1). Above 0.3 = meaningful. |
| Multi-TF Conviction | 0–100 weighted score: 1D×40pts + 1H×35pts + 15m×25pts |
| TF Breakdown | Per-timeframe regime + margin |
| Signal Type | TREND_FOLLOW or REVERSAL |
| TF Agreement | How many timeframes agree (1–3) |
| BTC Regime / Margin | Current macro environment |
| **PDH / PDL** | **Previous Day High / Low** — key daily S/R zones |
| **PWH / PWL** | **Previous Week High / Low** — major structural levels |
| **VWAP** | **24h Volume-Weighted Average Price** — institutional reference |
| **Dist from VWAP %** | Price vs VWAP — positive=above, negative=below |
| **Swing High 3/5** | Most recent fractal swing high (3-bar and 5-bar lookback) |
| **Swing Low 3/5** | Most recent fractal swing low (3-bar and 5-bar lookback) |

## Your Analysis Workflow

1. **Read the Structure Levels:**
   - Is price ABOVE or BELOW VWAP? (bullish bias = above VWAP)
   - Is price approaching PDH/PWH (resistance)? → note it, do NOT auto-skip
   - Is price approaching PDL/PWL (support)? → note it, do NOT auto-skip
   - Are recent swing highs being broken (higher high)? → Bullish (breakout signal)
   - Are recent swing lows breaking down (lower low)? → Bearish (breakdown signal)

2. **BTC Alignment Rule (scoring — NEVER auto-skip solely due to BTC):**
   - BTC aligns with trade direction → apply +15% confidence boost
   - BTC opposes trade direction → apply -20% confidence penalty
   - Never issue SKIP based on BTC regime alone. BTC is a modifier, not a gatekeeper.

3. **Give 40% weight to HMM** — the quantitative model's signal + conviction carry 40% of your final decision. Your fundamental/technical analysis is 60%.

4. **Embed risk identifiers inside your reasoning paragraph** — do NOT list them separately. Naturally state risks as part of your analytical synthesis.

4a. **Condition Counting Rule (CRITICAL — prevents over-SKIPping):**

    Count distinct conditions, NOT individual signals. Highly correlated signals in the same zone = 1 condition:
    - Swing proximity + PDH/PWH proximity close together = **1 structural resistance/support condition**
    - VWAP stretch + momentum overextension = **1 extension condition**
    - Order block presence (any tier) = **1 condition**
    - Wall proximity = **1 condition** (does NOT stack with OB or swing)

    Do NOT double-count correlated signals. A breakout near both a swing high AND the PDH is ONE resistance cluster, not two separate conditions.

5. **Trade-Type Adaptive Logic (CRITICAL — apply BEFORE running entry gates):**

   **If Signal Type = TREND_FOLLOW (breakout / continuation):**
   - Entry near swing highs (LONG) or swing lows (SHORT) is EXPECTED — do NOT penalize heavily.
   - Automatically ignore 1 Tier-2 proximity condition (breakouts legitimately happen near prior highs/lows).
   - VWAP extension is acceptable up to 3.5% (breakouts run above VWAP).
   - Prioritize momentum and TF alignment over proximity warnings.

   **If Signal Type = REVERSAL:**
   - Apply full strict rules for PDH/PDL and swing proximity.
   - Require VWAP mean reversion behavior (price near or crossing VWAP).
   - Tighter tolerance for structural violations.
   - **Reversal Validity Requirement — require at least ONE of:**
     - VWAP reclaim (LONG) or VWAP rejection (SHORT)
     - Clear price rejection at PDH/PDL/PWH/PWL (wick or close reversal)
     - Opposing swing failure: failed higher high (LONG) or failed lower low (SHORT)
   - If none of the above are present → reduce confidence significantly (−30%) or SKIP.

6. **MOMENTUM OVERRIDE (High Priority — check BEFORE the entry gate):**

   If ALL of the following are true:
   - HMM Confidence ≥ 0.65
   - Multi-TF Conviction ≥ 70
   - TF Agreement ≥ 2/3
   - Price is breaking recent 5-bar Swing High (LONG) or 5-bar Swing Low (SHORT)

   Then activate MOMENTUM OVERRIDE:
   - Ignore up to 1 Tier-2 proximity warning
   - Allow trade even if price is near PDH/PWH (LONG) or PDL/PWL (SHORT)
   - When MOMENTUM OVERRIDE is active, VETO requires **3+ conditions** (not 2), OR **2 conditions including at least 1 Tier-3 extreme risk**
   - This captures breakouts, continuations, and trend acceleration

7. **ENTRY QUALITY GATE — Tiered Check (run after adaptive logic and momentum override):**

   **Tier 1 — Order Block Zones (use when OB data is available, i.e. not N/A):**
   - LONG: price inside/above a Bearish OB (supply zone) → reduce confidence by **20%** (OB detection is noisy; crypto often trades through).
   - SHORT: price inside/below a Bullish OB (demand zone) → reduce confidence by **20%**.
   - SKIP only if: OB conflict + **2 additional conditions** AND conviction < 60.
   - If both Bullish OB and Bearish OB are N/A → skip Tier 1 entirely, proceed to Tier 2.

   **Tier 2 — Swing High/Low Proximity (primary fallback when OB is N/A):**
   - LONG: within 0.8% of 5-bar Swing High → flag "near resistance", reduce confidence. Within 0.3% → SKIP (unless TREND_FOLLOW or MOMENTUM OVERRIDE).
   - SHORT: within 0.8% of 5-bar Swing Low → flag "near support", reduce confidence. Within 0.3% → SKIP (unless TREND_FOLLOW or MOMENTUM OVERRIDE).
   - LONG: within 0.8% of PDH or PWH → flag "approaching daily/weekly resistance" — reduce size, NOT skip.
   - SHORT: within 0.8% of PDL or PWL → flag "approaching daily/weekly support" — reduce size, NOT skip.

   **Tier 3 — VWAP & Wall Checks (always run):**

   *VWAP tolerance is adaptive:*
   - **TREND_FOLLOW or MOMENTUM OVERRIDE:** Allow up to **+5% above VWAP** (LONG) / **-5% below VWAP** (SHORT). Reduce confidence by **10–15%** only.
   - **REVERSAL:** Strict limit at **3.5%**. Reduce confidence by 25% if breached.
   - LONG: within 0.5% of Ask Wall → tighten recommended stop-loss, cite wall price.
   - SHORT: within 0.5% of Bid Wall → tighten recommended stop-loss, cite wall price.

8. **Convert hard blocks → soft risk adjustments wherever possible:**

   | Condition | Action |
   |---|---|
   | Near resistance/support | Reduce confidence, not skip |
   | VWAP stretched | Reduce position size |
   | BTC opposing | Reduce confidence by 20% |
   | Wall nearby | Tighten stop-loss |
   | Low conviction | Reduce size to 30–50%, lower leverage |

9. **VETO Rule (revised — precision > frequency):**

   **⚡ PRECEDENCE: If MOMENTUM OVERRIDE is active, its VETO logic OVERRIDES ALL standard VETO rules below. Do not apply the 3-condition threshold when Momentum Override is active.**

   **Condition Prioritization Rule (prevents artificial inflation):**
   Conditions are grouped into max 3 independent buckets:
   - **Structural bucket** (swing proximity + PDH/PWH + OB = counts as 1)
   - **Extension bucket** (VWAP stretch + momentum overextension = counts as 1)
   - **Microstructure bucket** (walls = counts as 1)

   Maximum effective condition count = 3. Do NOT treat all tier signals as independent conditions. A setup with swing high + PDH + VWAP stretch has only **2 distinct conditions**, not 3.

   **Standard VETO (no Momentum Override):** Issue SKIP only if ONE of:
   - **3 or more independent conditions** (one per bucket) fire simultaneously
   - **2 conditions** fire AND (HMM Confidence < 0.55 AND Multi-TF Conviction < 60)
   - Structure is clearly invalid (price in dead zone, no viable S/R framework)

   **Momentum Override VETO:** Issue SKIP only if ONE of:
   - **3 or more** conditions (across all buckets)
   - **2 conditions** including at least 1 Tier-3 extreme risk

   For all other imperfect setups: reduce size (30–50%), reduce leverage, lower confidence score — but EXECUTE the trade.
   Always cite specific price levels that triggered each condition.

10. **Confidence Scaling (prefer calibrated execution over binary skip):**

    - Perfect setup: full size, recommended leverage, confidence = 0.85–1.0
    - 1 minor condition fired: reduce size 20%, confidence = 0.65–0.84
    - 2 conditions fired (but conviction strong): reduce size 40–50%, halve leverage, confidence = 0.50–0.64
    - 3+ **distinct bucket** conditions OR weak conviction: SKIP

11. **Execution Bias Rule (default to action, not inaction):**

    If BOTH of the following are true:
    - HMM Confidence ≥ 0.60
    - Multi-TF Conviction ≥ 65

    Then: **execute only if the setup has a clear edge**. If the trade has no obvious
    catalyst, no clean structure, and no momentum — SKIP. Do not deploy just because
    signals pass minimum thresholds. Quality over quantity.

    **Clustered condition handling:** If 3 conditions are present BUT they are clustered (e.g. swing high + PDH = structural cluster, plus VWAP stretch), count them as **2 distinct conditions** → reduce size 40–50% and EXECUTE. Only SKIP when conditions are structurally independent AND clearly invalid.

12. **Confidence Mapping Guide (anchor your output score to these inputs):**

    Start from base confidence derived from HMM + Conviction:
    - HMM Confidence × 0.40 + (Conviction / 100) × 0.60 = raw base score

    Then apply adjustments:
    - Each distinct condition fired: **−0.10 to −0.15**
    - BTC alignment (same direction): **+0.10**
    - BTC opposing: **−0.15**
    - Momentum Override active: **+0.10**
    - Reversal with no validity signal: **−0.30**

    **Clamp final adjusted_confidence between 0.30 and 0.95.**
    Do not output values outside this range.

13. **DRAWDOWN GUARDRAIL (absolute):**
    If the portfolio context or recent signals suggest a losing streak (multiple
    recent VETO/losing signals), automatically raise your veto sensitivity:
    - Reduce all confidence scores by an additional -0.10
    - SKIP any trade with adjusted_confidence < 0.55 (regardless of other rules)
    This prevents snowball losses during adverse regimes.

14. **Output your decision** as clean JSON.

## Output Format

Return ONLY a valid JSON object — no markdown, no backticks, no extra text:
{
  "ticker": "BTCUSDT",
  "action": "LONG" | "SHORT" | "SKIP",
  "confidence_rating": 1-10,
  "adjusted_confidence": 0.0-1.0,
  "leverage_recommendation": "5x",
  "size_recommendation": "50%",
  "entry_price": "$X.XXXX  (ideal entry zone)",
  "stop_loss": "$X.XXXX  (below key S/R — cite the level)",
  "target": "$X.XXXX  (nearest resistance — cite the level)",
  "reasoning": "3-4 sentences: analytical synthesis + embedded risk identifiers citing specific price levels, structure (VWAP/PDH/PWH/swings), BTC context, and any confidence/size adjustments made.",
  "key_support": "$X.XX (PDL=$X, VWAP=$X)",
  "key_resistance": "$X.XX (PDH=$X, PWH=$X)"
}"""


# ─── Main Engine ──────────────────────────────────────────────────────────────

class AthenaEngine:
    """
    LLM-powered reasoning layer that validates HMM trade signals.

    Thread-safe for single-process use (trading bot is single-threaded).
    Caches decisions per-coin, rate-limits API calls, and logs all decisions.
    """

    def __init__(self):
        self._model = None
        self._cache: Dict[str, tuple] = {}  # "symbol:segment:side" → (AthenaDecision, expiry_time)
                                             # FIX: keyed on full context, not just symbol
        self._cycle_call_count = 0
        self._cycle_start = 0.0
        self._initialized = False
        self._decision_log = self._load_decision_log()  # Persisted across restarts
        self._error_log: list = []  # Last 20 errors — surfaced in admin debug panel

    def _load_decision_log(self) -> list:
        """Load persisted decision log from disk on startup."""
        try:
            log_path = config.LLM_LOG_FILE
            if os.path.exists(log_path):
                with open(log_path, "r") as f:
                    entries = json.loads(f.read())
                if isinstance(entries, list):
                    # Filter out stale entries with empty/placeholder reasoning
                    valid = [
                        e for e in entries
                        if e.get("reasoning") and
                           e["reasoning"] not in ("No reasoning provided", "") and
                           not e["reasoning"].startswith("Auto-approve:") and
                           not e["reasoning"].startswith("REST API error")
                    ]
                    return valid[-50:]
        except Exception:
            pass
        return []

    def _ensure_initialized(self):
        """Lazy-init the OpenAI REST client."""
        if self._initialized:
            return True
        if not config.LLM_API_KEY:
            logger.warning("🏹 Athena disabled — no GEMINI_API_KEY configured (now holds OpenAI key)")
            return False
        self._initialized = True
        logger.info("🏹 Athena initialized — model: %s (OpenAI REST API)", config.LLM_MODEL)
        return True

    def reset_cycle(self):
        """Call at the start of each analysis cycle to reset rate limiting."""
        self._cycle_call_count = 0
        self._cycle_start = time.time()

    def validate_signal(self, signal_context: dict) -> AthenaDecision:
        """
        Validate an HMM trade signal using Gemini reasoning.

        Parameters
        ----------
        signal_context : dict
            Contains: ticker, side, hmm_regime, hmm_confidence, conviction,
            brain_id, current_price, atr, tf_agreement, btc_regime, btc_margin,
            vol_percentile

        Returns
        -------
        AthenaDecision — always returns a decision (fail-open on errors)
        """
        symbol = signal_context.get("ticker", "UNKNOWN")

        # 1. Check cache first (keyed on symbol:segment:side)
        _cache_key = "{}:{}:{}".format(
            symbol,
            signal_context.get("segment", "ALL"),
            signal_context.get("side", "BUY"),
        )
        cached = self._check_cache(_cache_key)
        if cached:
            logger.info("🏛️ Athena [%s] → %s (cached)", symbol, cached.action)
            # Only log cached decisions that have real reasoning — skip stale/empty ones
            # so they don't pollute the dashboard while a fresh API call hasn't run yet.
            stale_reasoning = not cached.reasoning or cached.reasoning in (
                "No reasoning provided", "", "Auto-approve: Rate limit reached",
            ) or cached.reasoning.startswith("Auto-approve:") or cached.reasoning.startswith("REST API error")
            if not stale_reasoning:
                self._log_decision(symbol, signal_context, cached)
            return cached

        # 2. Rate limit check
        if self._cycle_call_count >= config.LLM_MAX_CALLS_PER_CYCLE:
            logger.debug("🏛️ Athena [%s] → EXECUTE (rate limited)", symbol)
            decision = self._default_execute(symbol, reason="Rate limit reached")
            self._log_decision(symbol, signal_context, decision)
            return decision

        # 3. Init check
        if not self._ensure_initialized():
            return self._default_execute(symbol, reason="Not initialized")

        # 4. Call OpenAI — fail-closed: log error and re-raise so caller skips the trade
        try:
            return self._call_openai(symbol, signal_context)
        except Exception as e:
            err_entry = {
                "time": datetime.now(timezone.utc).isoformat(),
                "symbol": symbol,
                "side": signal_context.get("side", "?"),
                "error": str(e)[:200],
                "cycle_call": self._cycle_call_count,
            }
            self._error_log.append(err_entry)
            if len(self._error_log) > 20:
                self._error_log.pop(0)
            logger.error("🏛️ Athena [%s] API error — trade will be skipped: %s", symbol, e)
            raise

    def _call_openai(self, symbol: str, ctx: dict) -> AthenaDecision:
        """Make the actual OpenAI Chat Completions API call via REST."""
        import requests

        prompt = self._build_prompt(ctx)
        url = "https://api.openai.com/v1/chat/completions"

        payload = {
            "model": config.LLM_MODEL,
            "messages": [
                {"role": "system", "content": ATHENA_SYSTEM_PROMPT},
                {"role": "user",   "content": prompt},
            ],
            "temperature": 0.3,
            "max_tokens":  2048,
            "response_format": {"type": "json_object"},   # GPT-4o-mini supports JSON mode
        }

        headers = {
            "Content-Type":  "application/json",
            "Authorization": f"Bearer {config.LLM_API_KEY}",
        }

        start = time.time()
        try:
            resp = requests.post(url, json=payload, headers=headers, timeout=config.LLM_TIMEOUT_SECONDS)
            resp.raise_for_status()
            resp_data = resp.json()
        except Exception as e:
            logger.warning("🏹 Athena [%s] OpenAI REST error (fail-open): %s", symbol, e)
            return self._default_execute(symbol, reason=f"REST API error: {str(e)[:80]}")

        latency_ms = int((time.time() - start) * 1000)
        self._cycle_call_count += 1

        raw = ""
        try:
            choices = resp_data.get("choices", [])
            if choices:
                raw = choices[0].get("message", {}).get("content", "").strip()

            if not raw:
                logger.warning("🏹 Athena [%s] empty OpenAI response (latency=%dms)", symbol, latency_ms)
                return self._default_execute(symbol, reason="Empty API response")

            # Strip markdown code fences if present (shouldn't happen with json_object mode)
            if raw.startswith("```"):
                raw = raw.split("\n", 1)[-1]
                raw = raw.rsplit("```", 1)[0].strip()

            # Try to extract valid JSON from the response
            data = self._extract_json(raw)
            if data is None:
                logger.warning("🏹 Athena [%s] could not extract JSON | raw=%s", symbol, repr(raw[:400]))
                return self._default_execute(symbol, reason="Could not extract JSON from response")
        except Exception as e:
            logger.warning("🏹 Athena [%s] response error: %s", symbol, str(e)[:100])
            return self._default_execute(symbol, reason=f"Response error: {str(e)[:80]}")

        # Handle JSON array (prompt asks for array format) — take first element
        if isinstance(data, list):
            data = data[0] if data else {}

        # Map LONG/SHORT/SKIP/BUY/SELL → EXECUTE/REDUCE_SIZE/VETO for engine compatibility
        raw_action = data.get("action", "SKIP").upper()
        if raw_action in ("LONG", "SHORT", "BUY", "SELL"):
            action = "EXECUTE"
        elif raw_action == "SKIP":
            action = "VETO"
        else:
            action = raw_action  # fallback: EXECUTE/REDUCE_SIZE/VETO

        # Handle confidence_rating: gemini-2.5-flash returns 0-1 float OR 1-10 int.
        # If value is > 1.0 treat it as 1-10 scale and normalise; otherwise use as-is.
        conf_rating = data.get("confidence_rating", 5)
        try:
            conf_rating = float(conf_rating)
        except (TypeError, ValueError):
            conf_rating = 5.0
        if conf_rating > 1.0:
            conf_rating_norm = conf_rating / 10.0  # 1-10 → 0-1
        else:
            conf_rating_norm = conf_rating          # already 0-1

        # Prefer explicit adjusted_confidence from model; fall back to normalised rating
        adj_conf_raw = data.get("adjusted_confidence")
        if adj_conf_raw is not None:
            try:
                adj_conf = float(adj_conf_raw)
                if adj_conf > 1.0:
                    adj_conf = adj_conf / 10.0  # guard against 1-10 scale here too
            except (TypeError, ValueError):
                adj_conf = conf_rating_norm
        else:
            adj_conf = conf_rating_norm
        adj_conf = max(0.0, min(1.0, adj_conf))

        # Apply veto threshold
        if adj_conf < config.LLM_VETO_THRESHOLD and action != "VETO":
            logger.info(
                "🚫 Athena [%s] raw=%s conf=%.2f < threshold=%.2f → overriding to VETO",
                symbol, action, adj_conf, config.LLM_VETO_THRESHOLD,
            )
            action = "VETO"

        # Build rich reasoning with Athena's analysis
        parts = [data.get("reasoning", "No reasoning provided")]
        if data.get("leverage_recommendation"):
            parts.append(f"Leverage: {data['leverage_recommendation']}")
        if data.get("size_recommendation"):
            parts.append(f"Size: {data['size_recommendation']}")
        if data.get("support_levels"):
            parts.append(f"Support: {data['support_levels']}")
        if data.get("resistance_levels"):
            parts.append(f"Resistance: {data['resistance_levels']}")
        reasoning = " | ".join(parts)

        risk_flags = data.get("risk_flags", [])

        # ─── Parse Athena's suggested SL and Target ───────────────────────
        def _parse_price(val) -> float:
            """Extract a numeric price from Athena's response (handles '$1.2345 (note)' format)."""
            if val is None:
                return 0.0
            if isinstance(val, (int, float)):
                return float(val)
            # String: strip $, commas, trailing notes
            import re
            s = str(val).replace(',', '')
            m = re.search(r'\$?([\d.]+)', s)
            return float(m.group(1)) if m else 0.0

        suggested_sl = _parse_price(data.get("stop_loss"))
        suggested_tp = _parse_price(data.get("target"))

        decision = AthenaDecision(
            action=action,
            adjusted_confidence=adj_conf,
            reasoning=reasoning,
            risk_flags=risk_flags,
            athena_direction=raw_action,  # Preserve LONG/SHORT/SKIP
            model=config.LLM_MODEL,
            latency_ms=latency_ms,
            suggested_sl=suggested_sl,
            suggested_tp=suggested_tp,
        )
        # Store entry price for logging/display
        suggested_entry = _parse_price(data.get("entry_price"))
        decision.suggested_entry = suggested_entry

        # Cache and log (scoped to symbol:segment:side context)
        _cache_key = "{}:{}:{}".format(
            symbol,
            ctx.get("segment", "ALL"),
            ctx.get("side", "BUY"),
        )
        self._set_cache(_cache_key, decision)
        self._log_decision(symbol, ctx, decision)

        logger.info(
            "🏛️ Athena [%s] → %s (conf=%.2f, %dms) SL=%.4f TP=%.4f — %s",
            symbol, action, adj_conf, latency_ms,
            suggested_sl, suggested_tp, reasoning[:80],
        )

        return decision

    @staticmethod
    def _extract_json(raw: str):
        """Extract JSON from response text, handling prose, markdown, and truncation."""
        import re

        # Stage 1: Direct parse
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            pass

        # Stage 2: Find JSON between outermost braces (handles prose before/after)
        brace_start = raw.find('{')
        bracket_start = raw.find('[')
        # Pick whichever comes first
        start = -1
        if brace_start >= 0 and bracket_start >= 0:
            start = min(brace_start, bracket_start)
        elif brace_start >= 0:
            start = brace_start
        elif bracket_start >= 0:
            start = bracket_start

        if start >= 0:
            end_char = '}' if raw[start] == '{' else ']'
            end = raw.rfind(end_char)
            if end > start:
                try:
                    return json.loads(raw[start:end + 1])
                except (json.JSONDecodeError, ValueError):
                    pass

        # Stage 3: Truncated JSON repair — find opening brace, close it
        if brace_start >= 0:
            fragment = raw[brace_start:]
            # Try to close truncated strings and the object
            # Count unclosed quotes
            in_string = False
            for ch in fragment:
                if ch == '"' and (not fragment or fragment[fragment.index(ch)-1:fragment.index(ch)] != '\\'):
                    in_string = not in_string
            repair = fragment
            if in_string:
                repair += '"'
            # Close any open arrays
            open_brackets = repair.count('[') - repair.count(']')
            repair += ']' * max(0, open_brackets)
            # Close any open objects
            open_braces = repair.count('{') - repair.count('}')
            repair += '}' * max(0, open_braces)
            try:
                return json.loads(repair)
            except (json.JSONDecodeError, ValueError):
                pass

        return None

    def _build_prompt(self, ctx: dict) -> str:
        """Build the user prompt with all enriched signal context."""

        # Helper to format a price or return "N/A" if None
        def _p(val, decimals=4):
            if val is None:
                return "N/A"
            return f"${val:,.{decimals}f}"

        # Conviction tier label
        conv = ctx.get("conviction", 0)
        if conv >= 80:
            conv_label = "STRONG ★★★"
        elif conv >= 60:
            conv_label = "MEDIUM ★★"
        elif conv >= 40:
            conv_label = "WEAK ★"
        else:
            conv_label = "LOW"

        # Per-TF breakdown string
        tf_bd = ctx.get("tf_breakdown", {})
        tf_lines = []
        for tf_name, tf_info in tf_bd.items():
            regime = tf_info.get("regime", "?")
            margin = tf_info.get("margin", 0)
            tf_lines.append(f"    {tf_name:>4s}: {regime:<10s}  (margin={margin:.3f})")
        tf_str = "\n".join(tf_lines) if tf_lines else "    N/A"

        ticker_short = ctx.get("ticker", "COIN").replace("USDT", "")
        dist_vwap = ctx.get("dist_vwap_pct")
        dist_str = (f"{dist_vwap:+.2f}%" if dist_vwap is not None else "N/A")
        vwap_direction = ""
        if dist_vwap is not None:
            if dist_vwap > 1.5:
                vwap_direction = "  ← ABOVE VWAP (bullish bias)"
            elif dist_vwap < -1.5:
                vwap_direction = "  ← BELOW VWAP (bearish bias)"
            else:
                vwap_direction = "  ← AT VWAP (neutral)"

        # ── Derivatives context ─────────────────────────────────────────────────
        side        = ctx.get("side", "BUY")
        fr          = ctx.get("funding_rate")
        oi          = ctx.get("oi_change")
        of_score    = ctx.get("orderflow_score")

        # Funding rate annotation
        if fr is None:
            fr_str = "N/A"
        else:
            fr_pct = fr * 100
            if side == "BUY":
                fr_note = "✅ longs paid" if fr < 0 else ("⚠️ crowded longs" if fr > 0.0003 else "neutral")
            else:
                fr_note = "✅ shorts paid" if fr > 0 else ("⚠️ crowded shorts" if fr < -0.0003 else "neutral")
            fr_str = f"{fr_pct:.4f}%  ({fr_note})"

        # OI change annotation
        if oi is None:
            oi_str = "N/A"
        else:
            if side == "BUY":
                oi_note = "✅ fresh longs" if oi > 0.02 else ("⚠️ unwinding" if oi < -0.02 else "neutral")
            else:
                oi_note = "✅ fresh shorts" if oi < -0.02 else ("⚠️ covering" if oi > 0.02 else "neutral")
            oi_str = f"{oi:+.4f}  ({oi_note})"

        # Orderflow score annotation
        if of_score is None:
            of_str = "N/A"
        elif of_score > 0.5:
            of_str = f"{of_score:+.3f}  ✅ strong buy pressure"
        elif of_score > 0.2:
            of_str = f"{of_score:+.3f}  mild buy pressure"
        elif of_score > -0.2:
            of_str = f"{of_score:+.3f}  neutral flow"
        elif of_score > -0.5:
            of_str = f"{of_score:+.3f}  ⚠️ mild sell pressure"
        else:
            of_str = f"{of_score:+.3f}  🔴 strong sell pressure"

        derivatives_block = (
            f"- Funding Rate     : {fr_str}\n"
            f"- OI Change        : {oi_str}\n"
            f"- Orderflow Score  : {of_str}"
        )

        return f"""## Signal Under Review: {ctx.get('ticker', 'N/A')}

### ── HMM Quantitative Signal (40% weight) ──
- Signal Direction : {ctx.get('side', 'N/A')}  ({ctx.get('signal_type', 'N/A')})
- HMM Regime       : {ctx.get('hmm_regime', 'N/A')}
- HMM Confidence   : {ctx.get('hmm_confidence', 0):.4f}  (margin best vs 2nd-best state)
- Multi-TF Conviction: {conv:.1f}/100  [{conv_label}]
- TF Agreement     : {ctx.get('tf_agreement', 0)}/3 timeframes agree

### ── Per-Timeframe Breakdown ──
{tf_str}

### ── Price & Market Structure ──
- Current Price    : {_p(ctx.get('current_price'), 4)}
- Trend Alignment  : {ctx.get('trend', 'N/A')}

### ── BTC Macro Context ──
- BTC Regime       : {ctx.get('btc_regime', 'N/A')}
- BTC HMM Margin   : {ctx.get('btc_margin', 0):.3f}
- BTC Correlation  : {f"{ctx['btc_correlation']:.3f}  ({'HIGH β — BTC regime is very relevant' if ctx['btc_correlation'] >= 0.75 else 'MEDIUM β — partial BTC influence' if ctx['btc_correlation'] >= 0.45 else 'LOW β — coin trades on own merit'})" if ctx.get('btc_correlation') is not None else 'N/A'}

### ── Derivatives Context ──
{derivatives_block}

### ── Key Price Structure Levels ──
| Level              | Price                              | Notes                    |
|--------------------|-------------------------------------|--------------------------|
| PWH (Prev Wk High) | {_p(ctx.get('pwh'), 4):<35} | Major weekly resistance  |
| PWL (Prev Wk Low)  | {_p(ctx.get('pwl'), 4):<35} | Major weekly support     |
| PDH (Prev Day High)| {_p(ctx.get('pdh'), 4):<35} | Daily resistance         |
| PDL (Prev Day Low) | {_p(ctx.get('pdl'), 4):<35} | Daily support            |
| VWAP (24h)         | {_p(ctx.get('vwap'), 4):<35} | Institutional ref{vwap_direction} |
| Dist from VWAP     | {dist_str:<35} | +above / -below          |
| Swing High 3       | {_p(ctx.get('swing_high_3'), 4):<35} | Recent 3-bar fractal high|
| Swing Low  3       | {_p(ctx.get('swing_low_3'), 4):<35} | Recent 3-bar fractal low |
| Swing High 5       | {_p(ctx.get('swing_high_5'), 4):<35} | Recent 5-bar fractal high|
| Swing Low  5       | {_p(ctx.get('swing_low_5'), 4):<35} | Recent 5-bar fractal low |
| 7D ATH             | {_p(ctx.get('ath_7d'), 4):<35} | 7-day all-time high      |
| 7D ATL             | {_p(ctx.get('atl_7d'), 4):<35} | 7-day all-time low       |

### ── Order Flow Zones ──
| Zone                   | Price                              | Notes                         |
|------------------------|------------------------------------|-------------------------------|
| Nearest Bullish OB     | {_p(ctx.get('nearest_bullish_ob'), 4):<35} | Demand zone (OB) — LONG-favoring |
| Nearest Bearish OB     | {_p(ctx.get('nearest_bearish_ob'), 4):<35} | Supply zone (OB) — SHORT-favoring |
| Nearest Bid Wall       | {_p(ctx.get('nearest_bid_wall'), 4):<35} | Strong buy support wall     |
| Nearest Ask Wall       | {_p(ctx.get('nearest_ask_wall'), 4):<35} | Strong sell resistance wall |

### ── Your Tasks ──
1. Assess if current price is at a KEY S/R zone (PDH/PDL/PWH/PWL/VWAP)
2. Check VWAP positioning — above = bullish context, below = bearish context
3. Verify swing structure — are we making higher highs or lower lows? (breaking swing high = LONG momentum signal)
4. **Apply BTC Alignment scoring:** BTC aligns → +15% confidence. BTC opposes → -20% confidence. NEVER skip solely due to BTC.
5. **Assess derivatives context** — funding rate, OI change, orderflow for confirmation

6. **Apply Trade-Type Adaptive Logic FIRST:**
   - If Signal Type = TREND_FOLLOW: ignore 1 Tier-2 condition, allow VWAP extension to 5%, do not penalize proximity to swing highs/lows
   - If Signal Type = REVERSAL: enforce full proximity rules, require VWAP mean reversion context
   - **REVERSAL Validity:** Require at least ONE of: VWAP reclaim/rejection, clear PDH/PDL/PWH/PWL rejection, or opposing swing failure. If none → reduce confidence −30% or SKIP.

7. **Check MOMENTUM OVERRIDE** (before entry gate):
   If HMM Confidence ≥ 0.65 AND Conviction ≥ 70 AND TF Agreement ≥ 2 AND price breaking recent swing high/low:
   → Ignore up to 2 Tier-2 warnings. Allow near PDH/PWH entry.
   → **VETO threshold raised to 4+ conditions** (or 3+ if at least 1 is a Tier-3 extreme).

8. **ENTRY QUALITY GATE — Tiered entry check (apply after adaptive logic + override):**

   **→ Tier 1: Order Block Zones** *(only if OB data is NOT N/A)*
   - LONG: price inside/above **Bearish OB** (supply zone) → reduce confidence **20%** (noisy signal; crypto trades through OBs).
   - SHORT: price inside/below **Bullish OB** (demand zone) → reduce confidence **20%**.
   - SKIP only if: OB conflict + **2 additional conditions** AND conviction < 60.
   - If both OBs are N/A → skip Tier 1, move directly to Tier 2.

   **→ Tier 2: Swing High/Low + Key S/R Proximity** *(always run)*
   - LONG: current price within **0.8%** of 5-bar Swing High → flag, reduce confidence. Within **0.3%** → SKIP (unless TREND_FOLLOW or Momentum Override).
   - SHORT: current price within **0.8%** of 5-bar Swing Low → flag, reduce confidence. Within **0.3%** → SKIP (unless TREND_FOLLOW or Momentum Override).
   - LONG: price within **0.8%** of PDH or PWH → reduce size, note the zone. Do NOT skip.
   - SHORT: price within **0.8%** of PDL or PWL → reduce size, note the zone. Do NOT skip.
   - If Swing Highs/Lows are N/A, use PDH/PDL/PWH/PWL as sole S/R reference.

   **→ Tier 3: VWAP & Orderbook Walls** *(always run — adaptive tolerance)*
   - **TREND_FOLLOW or MOMENTUM OVERRIDE:** Allow up to **+5% VWAP deviation**. Reduce confidence **10–15%** only.
   - **REVERSAL:** Strict **3.5% limit**. Reduce confidence 25% if breached.
   - LONG: within **0.5%** of Ask Wall → tighten stop-loss recommendation. Cite wall price.
   - SHORT: within **0.5%** of Bid Wall → tighten stop-loss recommendation. Cite wall price.

   **Condition Bucket Prioritization (prevents artificial stacking):**
   - **Structural bucket**: swing proximity + PDH/PWH + OB → counts as **1 condition**
   - **Extension bucket**: VWAP stretch + overextension → counts as **1 condition**
   - **Microstructure bucket**: walls → counts as **1 condition**
   Maximum distinct conditions = 3 (one per bucket). Swing high + PDH + VWAP stretch = 2 distinct conditions, NOT 3.

   **⚡ VETO PRECEDENCE: If MOMENTUM OVERRIDE is active, its VETO logic overrides all standard VETO rules.**
   **Standard VETO:** SKIP if **3+ independent conditions** (across buckets) OR **2 conditions AND (Confidence < 0.55 AND Conviction < 60)**.
   **Override VETO:** SKIP only if **4+ conditions** OR **3 conditions including ≥1 Tier-3 extreme**.
   For all other imperfect setups: reduce size (30–50%), reduce leverage, lower confidence — but EXECUTE.
   Always cite the specific price levels that triggered each condition.

9. **Apply Confidence Scaling:**
   - 0 conditions: full size, recommended leverage, confidence 0.85–1.0
   - 1 minor condition: reduce size 20%, confidence 0.65–0.84
   - 2 conditions (strong HMM/conviction): reduce size 40–50%, halve leverage, confidence 0.45–0.64
   - 3+ conditions or weak conviction: SKIP

9a. **Execution Bias (HMM≥60% + Conviction≥65):** Default to EXECUTE over SKIP. Burden of proof is on SKIP.
    If 3 conditions are clustered → count as 2, reduce size 40–50%, EXECUTE. Only SKIP for structurally independent, clearly invalid conditions.

9b. **Confidence Mapping (anchor your score):**
    Base = HMM_Confidence × 0.40 + (Conviction/100) × 0.60
    Adjustments: each distinct condition −10 to −15 pts | BTC aligns +10 | BTC opposes −15 | Momentum Override +10 | Reversal no-validity −30
    Clamp final adjusted_confidence: **0.30 – 0.95**.

10. **Write your reasoning as a complete analytical synthesis** — embed all risk identifiers, BTC alignment, confidence/size adjustments, and entry quality findings naturally INSIDE the reasoning paragraph
11. Give FINAL CONVICTION: LONG, SHORT, or SKIP
12. Recommend LEVERAGE and POSITION SIZE

Return your analysis as a single JSON object."""

    def _check_cache(self, cache_key: str) -> Optional[AthenaDecision]:
        """Return cached decision if still valid AND has real reasoning.
        
        Cache key is 'symbol:segment:side' — scoped to routing context
        to prevent cross-bot cache collisions.
        """
        if cache_key in self._cache:
            decision, expiry = self._cache[cache_key]
            if time.time() < expiry:
                # Evict stale reasoning — treat as cache miss to force fresh API call
                _STALE = (
                    not decision.reasoning or
                    decision.reasoning in ("No reasoning provided", "", "N/A") or
                    decision.reasoning.startswith("Auto-approve:") or
                    decision.reasoning.startswith("REST API error")
                )
                if _STALE:
                    del self._cache[cache_key]
                    logger.debug("🏛️ Athena [%s] cache evicted — empty reasoning, forcing fresh call", cache_key)
                    return None
                cached_decision = AthenaDecision(
                    action=decision.action,
                    adjusted_confidence=decision.adjusted_confidence,
                    reasoning=decision.reasoning,
                    risk_flags=decision.risk_flags,
                    model=decision.model,
                    latency_ms=0,
                    cached=True,
                )
                return cached_decision
            else:
                del self._cache[cache_key]
        return None

    def _set_cache(self, cache_key: str, decision: AthenaDecision):
        """Cache a decision for LLM_CACHE_MINUTES. Key is 'symbol:segment:side'."""
        expiry = time.time() + config.LLM_CACHE_MINUTES * 60
        self._cache[cache_key] = (decision, expiry)

    def _default_execute(self, symbol: str, reason: str = "") -> AthenaDecision:
        """Return a default EXECUTE decision (fail-open)."""
        return AthenaDecision(
            action="EXECUTE",
            adjusted_confidence=1.0,
            reasoning=f"Auto-approve: {reason}",
            risk_flags=[],
        )

    def _log_decision(self, symbol: str, ctx: dict, decision: AthenaDecision):
        """Persist decision to disk for analysis."""
        entry = {
            "symbol": symbol,
            "time": datetime.now(timezone.utc).isoformat(),
            "side": ctx.get("side"),
            "conviction": ctx.get("conviction"),
            "action": decision.action,
            "adjusted_confidence": decision.adjusted_confidence,
            "reasoning": decision.reasoning,
            "risk_flags": decision.risk_flags,
            "model": decision.model,
            "latency_ms": decision.latency_ms,
            "entry_price": getattr(decision, "suggested_entry", None),
            "stop_loss": getattr(decision, "suggested_sl", None),
            "target": getattr(decision, "suggested_tp", None),
        }

        # In-memory buffer
        self._decision_log.append(entry)
        if len(self._decision_log) > 50:
            self._decision_log = self._decision_log[-50:]

        # Write to disk (append to JSON array)
        try:
            log_path = config.LLM_LOG_FILE
            existing = []
            if os.path.exists(log_path):
                with open(log_path, "r") as f:
                    existing = json.loads(f.read())
            existing.append(entry)
            # Keep last 200 entries
            if len(existing) > 200:
                existing = existing[-200:]
            with open(log_path, "w") as f:
                f.write(json.dumps(existing, indent=2))
        except Exception as e:
            logger.debug("Athena log write failed: %s", e)


    # ─── Dashboard State ──────────────────────────────────────────────────────


    def get_state(self) -> dict:
        """Return current Athena state for dashboard display."""
        fail_count = len(self._error_log)
        status = "ok" if fail_count == 0 else ("degraded" if fail_count < 5 else "down")
        return {
            "enabled": config.LLM_REASONING_ENABLED and bool(config.LLM_API_KEY),
            "model": config.LLM_MODEL,
            "initialized": self._initialized,
            "cycle_calls": self._cycle_call_count,
            "cache_size": len(self._cache),
            "recent_decisions": self._decision_log[-50:],
            "status": status,
            "fail_count": fail_count,
            "recent_errors": self._error_log[-20:],
        }

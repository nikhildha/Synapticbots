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
        import os
        import config
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
    model: str = ""         # Model used (e.g. "gemini-2.5-flash")
    latency_ms: int = 0     # API call duration
    cached: bool = False    # Whether this was a cache hit
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


# ─── System Prompt ────────────────────────────────────────────────────────────

ATHENA_SYSTEM_PROMPT = """You are the **Lead Investment Officer (Athena)**. Below is a list of crypto assets that have passed our HMM-Score threshold (>50%).

## Your Goal

Analyze the following for EACH coin presented:

1. **Technical Price Action Analysis** — Study recent price action, candlestick patterns, and momentum
2. **Support & Resistance** — Is price approaching key support or resistance levels? How close?
3. **FVG (Fair Value Gaps)** — Are there unfilled fair value gaps above or below the current price?
4. **Order Blocks** — Identify institutional order blocks that could act as magnets or barriers
5. **Global News** — Search for any breaking news, macro events, regulatory actions, or token-specific events
6. **BTC Macro Regime** — Ensure the trade aligns with BTC's current regime (if BTC is bearish, be cautious on long altcoin trades)

## Your Output

For each coin, provide:
- **Final Conviction**: LONG or SHORT (or SKIP if neither)
- **Confidence Rating**: 1-10 (10 = extremely confident)
- **Leverage Recommendation**: Suggested leverage (e.g., 3x, 5x, 10x, 20x)
- **Size Recommendation**: What % of available capital (e.g., 25%, 50%, 100%)
- **GIVE 40% BIAS TO HMM OUTPUT AS WELL** — The HMM model's signal direction and conviction score should carry 40% weight in your final decision. Your own analysis (price action, news, S/R, etc.) carries 60%.
- **Key Reasoning**: 2-3 sentence summary of your analysis

## Constraints

- Ensure the BTC Macro Regime aligns with the trade
- Be SPECIFIC — cite price levels, news events, pattern names
- If news is negative for a coin, recommend SKIP regardless of HMM score
- Search for REAL current news and data, do not make assumptions
- The HMM output carries 40% weight — respect its signal direction unless your 60% analysis strongly contradicts it

## Response Format

Return ONLY a valid JSON object:
{
  "ticker": "BTCUSDT",
  "action": "LONG" | "SHORT" | "SKIP",
  "confidence_rating": 1-10,
  "adjusted_confidence": 0.0-1.0,
  "leverage_recommendation": "5x",
  "size_recommendation": "50%",
  "reasoning": "Brief 2-3 sentence analysis.",
  "risk_flags": ["flag1", "flag2"],
  "support_levels": "$80,000, $78,500",
  "resistance_levels": "$85,000, $87,200"
}

IMPORTANT: Return ONLY the JSON object. No markdown, no backticks, no extra text."""


# ─── Main Engine ──────────────────────────────────────────────────────────────

class AthenaEngine:
    """
    LLM-powered reasoning layer that validates HMM trade signals.

    Thread-safe for single-process use (trading bot is single-threaded).
    Caches decisions per-coin, rate-limits API calls, and logs all decisions.
    """

    def __init__(self):
        self._model = None
        self._cache: Dict[str, tuple] = {}  # symbol → (AthenaDecision, expiry_time)
        self._cycle_call_count = 0
        self._cycle_start = 0.0
        self._initialized = False
        self._decision_log = []  # In-memory log (last 50)

    def _ensure_initialized(self):
        """Lazy-init the Gemini REST client."""
        if self._initialized:
            return True
        if not config.LLM_API_KEY:
            logger.warning("🏛️ Athena disabled — no GEMINI_API_KEY configured")
            return False
        self._initialized = True
        logger.info("🏛️ Athena initialized — model: %s (REST API)", config.LLM_MODEL)
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
            vol_percentile, sentiment (optional dict)

        Returns
        -------
        AthenaDecision — always returns a decision (fail-open on errors)
        """
        symbol = signal_context.get("ticker", "UNKNOWN")

        # 1. Check cache first
        cached = self._check_cache(symbol)
        if cached:
            logger.info("🏛️ Athena [%s] → %s (cached)", symbol, cached.action)
            return cached

        # 2. Rate limit check
        if self._cycle_call_count >= config.LLM_MAX_CALLS_PER_CYCLE:
            logger.debug("🏛️ Athena [%s] → EXECUTE (rate limited)", symbol)
            return self._default_execute(symbol, reason="Rate limit reached")

        # 3. Init check
        if not self._ensure_initialized():
            return self._default_execute(symbol, reason="Not initialized")

        # 4. Call Gemini
        try:
            return self._call_gemini(symbol, signal_context)
        except Exception as e:
            logger.warning("🏛️ Athena [%s] API error (fail-open): %s", symbol, e)
            return self._default_execute(symbol, reason=f"API error: {str(e)[:100]}")

    def _call_gemini(self, symbol: str, ctx: dict) -> AthenaDecision:
        """Make the actual Gemini API call using REST."""
        import requests
        
        prompt = self._build_prompt(ctx)
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{config.LLM_MODEL}:generateContent?key={config.LLM_API_KEY}"
        
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "systemInstruction": {"parts": [{"text": ATHENA_SYSTEM_PROMPT}]},
            "generationConfig": {
                "temperature": 0.3,
                "maxOutputTokens": 4096,
            }
        }

        start = time.time()
        try:
            resp = requests.post(url, json=payload, headers={"Content-Type": "application/json"}, timeout=30)
            resp.raise_for_status()
            resp_data = resp.json()
        except Exception as e:
            logger.warning("🏛️ Athena [%s] REST error (fail-open): %s", symbol, e)
            return self._default_execute(symbol, reason=f"REST API error: {str(e)[:80]}")

        latency_ms = int((time.time() - start) * 1000)
        self._cycle_call_count += 1

        raw = ""
        try:
            candidates = resp_data.get("candidates", [])
            if candidates:
                parts = candidates[0].get("content", {}).get("parts", [])
                if parts:
                    raw = parts[0].get("text", "").strip()

            if not raw:
                logger.warning("🏛️ Athena [%s] empty response (latency=%dms)", symbol, latency_ms)
                return self._default_execute(symbol, reason="Empty API response")

            # Strip markdown code fences if present
            if raw.startswith("```"):
                raw = raw.split("\n", 1)[-1]
                raw = raw.rsplit("```", 1)[0].strip()

            # Try to extract valid JSON from the response
            data = self._extract_json(raw)
            if data is None:
                logger.warning("🏛️ Athena [%s] could not extract JSON | raw=%s", symbol, repr(raw[:400]))
                return self._default_execute(symbol, reason="Could not extract JSON from response")
        except Exception as e:
            logger.warning("🏛️ Athena [%s] response error: %s", symbol, str(e)[:100])
            return self._default_execute(symbol, reason=f"Response error: {str(e)[:80]}")

        # Handle JSON array (prompt asks for array format) — take first element
        if isinstance(data, list):
            data = data[0] if data else {}

        # Map LONG/SHORT/SKIP → EXECUTE/REDUCE_SIZE/VETO for engine compatibility
        raw_action = data.get("action", "SKIP").upper()
        if raw_action in ("LONG", "SHORT"):
            action = "EXECUTE"
        elif raw_action == "SKIP":
            action = "VETO"
        else:
            action = raw_action  # fallback: EXECUTE/REDUCE_SIZE/VETO

        # Use confidence_rating (1-10) → adjusted_confidence (0-1)
        conf_rating = data.get("confidence_rating", 5)
        adj_conf = float(data.get("adjusted_confidence", conf_rating / 10.0))
        adj_conf = max(0.0, min(1.0, adj_conf))

        # Apply veto threshold
        if adj_conf < config.LLM_VETO_THRESHOLD and action != "VETO":
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

        decision = AthenaDecision(
            action=action,
            adjusted_confidence=adj_conf,
            reasoning=reasoning,
            risk_flags=risk_flags,
            athena_direction=raw_action,  # Preserve LONG/SHORT/SKIP
            model=config.LLM_MODEL,
            latency_ms=latency_ms,
        )

        # Cache and log
        self._set_cache(symbol, decision)
        self._log_decision(symbol, ctx, decision)

        logger.info(
            "🏛️ Athena [%s] → %s (conf=%.2f, %dms) — %s",
            symbol, action, adj_conf, latency_ms, reasoning[:80],
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
        """Build the user prompt with all signal context."""
        sentiment_str = "Not available"
        if ctx.get("sentiment"):
            s = ctx["sentiment"]
            if hasattr(s, "score"):
                sentiment_str = f"score={s.score:.2f}, alert={s.alert}, articles={getattr(s, 'article_count', 0)}"
            elif isinstance(s, dict):
                sentiment_str = f"score={s.get('score', 'N/A')}, alert={s.get('alert', False)}"

        return f"""The following crypto asset has passed our HMM-Score threshold. Perform your full analysis.

## Asset Under Review
- **Ticker**: {ctx.get('ticker', 'N/A')}
- **HMM Signal Direction**: {ctx.get('side', 'N/A')}
- **HMM Regime**: {ctx.get('hmm_regime', 'N/A')}
- **HMM Confidence**: {ctx.get('hmm_confidence', 0):.4f}
- **Multi-TF Conviction Score**: {ctx.get('conviction', 0):.1f}/100
- **Timeframe Agreement**: {ctx.get('tf_agreement', 0)}/3 timeframes agree
- **Current Price**: ${ctx.get('current_price', 0):,.4f}
- **ATR (hourly)**: ${ctx.get('atr', 0):,.4f}
- **Volatility Percentile**: {ctx.get('vol_percentile', 0):.1%}

## BTC Macro Context
- **BTC Regime**: {ctx.get('btc_regime', 'N/A')}
- **BTC Margin**: {ctx.get('btc_margin', 0):.3f}

## Your Tasks
1. Analyze the PRICE ACTION for {ctx.get('ticker', 'this coin').replace('USDT', '')} — recent candles, patterns, momentum
2. Identify KEY SUPPORT & RESISTANCE levels
3. Check for FVG (Fair Value Gaps) and ORDER BLOCKS
4. Search for CURRENT NEWS about {ctx.get('ticker', 'this coin').replace('USDT', '')} and the broader crypto market
5. Verify BTC macro regime alignment
6. Give your FINAL CONVICTION: LONG, SHORT, or SKIP
7. Recommend LEVERAGE and POSITION SIZE

Return your analysis as a JSON object (single object, not array)."""

    def _check_cache(self, symbol: str) -> Optional[AthenaDecision]:
        """Return cached decision if still valid."""
        if symbol in self._cache:
            decision, expiry = self._cache[symbol]
            if time.time() < expiry:
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
                del self._cache[symbol]
        return None

    def _set_cache(self, symbol: str, decision: AthenaDecision):
        """Cache a decision for LLM_CACHE_MINUTES."""
        expiry = time.time() + config.LLM_CACHE_MINUTES * 60
        self._cache[symbol] = (decision, expiry)

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
        return {
            "enabled": config.LLM_REASONING_ENABLED and bool(config.LLM_API_KEY),
            "model": config.LLM_MODEL,
            "initialized": self._initialized,
            "cycle_calls": self._cycle_call_count,
            "cache_size": len(self._cache),
            "recent_decisions": self._decision_log[-5:],
        }

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

# ─── Output dataclass ────────────────────────────────────────────────────────

@dataclass
class AthenaDecision:
    """Result of Athena's analysis of an HMM trade signal."""
    action: str             # EXECUTE, REDUCE_SIZE, or VETO
    adjusted_confidence: float  # 0.0–1.0 (multiplied against conviction)
    reasoning: str          # Human-readable explanation
    risk_flags: list        # List of identified risk factors
    model: str = ""         # Model used (e.g. "gemini-2.0-flash")
    latency_ms: int = 0     # API call duration
    cached: bool = False    # Whether this was a cache hit
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


# ─── System Prompt ────────────────────────────────────────────────────────────

ATHENA_SYSTEM_PROMPT = """You are **Athena**, a strategic AI risk analyst for a crypto futures trading engine.

Your role: Validate trade signals from a Hidden Markov Model (HMM) and decide whether to EXECUTE, REDUCE_SIZE, or VETO.

## Your Decision Framework

1. **EXECUTE** — The signal is solid. Market conditions support the trade.
   - HMM regime aligns with broader context
   - No major adverse events detected
   - Risk/reward is acceptable

2. **REDUCE_SIZE** — The signal has merit but warrants caution.
   - Assign `adjusted_confidence` between 0.30 and 0.85
   - Use when: mixed signals, approaching key events, elevated volatility

3. **VETO** — The signal is likely to fail. Block the trade.
   - Assign `adjusted_confidence` below 0.30
   - Use when: signal contradicts strong fundamental evidence, major event risk,
     or extreme market conditions that the HMM cannot capture

## What to Evaluate

Given the HMM signal context, reason about:
- **Regime Validity**: Is the detected regime (BULL/BEAR) a fundamental shift or noise?
- **Macro Context**: Is BTC trending in a way that supports altcoin trades?
- **Volatility Assessment**: Is current volatility normal or extreme?
- **Event Risk**: Are there imminent events (Fed meetings, CPI, token unlocks, exchange issues)?
- **Over-Crowding**: Does the funding rate suggest crowded positioning?
- **Technical Confluence**: Do multiple timeframes agree genuinely, or is it random alignment?

## Important Rules

- You are a RISK FILTER, not a signal generator. Only validate or reject signals.
- Be decisive. If you're uncertain, use REDUCE_SIZE, not VETO.
- Never VETO based solely on "I'm not sure." Only VETO when you have specific contrary evidence.
- Keep reasoning to 1-2 SHORT sentences. Do NOT write paragraphs.
- Your adjusted_confidence should reflect how much you trust the HMM signal:
  - 1.0 = full trust, proceed at full conviction
  - 0.5 = half trust, reduce position size
  - 0.0 = no trust, veto the trade

## Response Format

You MUST respond with ONLY valid JSON (no markdown, no backticks):
{
  "action": "EXECUTE" | "REDUCE_SIZE" | "VETO",
  "adjusted_confidence": 0.0 to 1.0,
  "reasoning": "Brief explanation (1-3 sentences)",
  "risk_flags": ["flag1", "flag2"]
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
        self._cache: Dict[str, tuple] = {}  # symbol → (AthenaDecision, expiry_time)
        self._cycle_call_count = 0
        self._cycle_start = 0.0
        self._initialized = False
        self._decision_log = []  # In-memory log (last 50)

    def _ensure_initialized(self):
        """Lazy-init the Gemini client (new google.genai SDK)."""
        if self._initialized:
            return True
        try:
            from google import genai
            if not config.LLM_API_KEY:
                logger.warning("🏛️ Athena disabled — no GEMINI_API_KEY configured")
                return False
            self._client = genai.Client(api_key=config.LLM_API_KEY)
            self._initialized = True
            logger.info("🏛️ Athena initialized — model: %s (google.genai SDK)", config.LLM_MODEL)
            return True
        except ImportError:
            logger.warning("🏛️ Athena disabled — google-genai not installed")
            return False
        except Exception as e:
            logger.warning("🏛️ Athena init failed: %s", e)
            return False

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
        """Make the actual Gemini API call and parse the response."""
        from google.genai import types

        # Build the prompt with signal context
        prompt = self._build_prompt(ctx)

        start = time.time()
        response = self._client.models.generate_content(
            model=config.LLM_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=ATHENA_SYSTEM_PROMPT,
                temperature=0.3,
                max_output_tokens=2048,
                response_mime_type="application/json",
            ),
        )
        latency_ms = int((time.time() - start) * 1000)

        self._cycle_call_count += 1

        # Extract text from response (new SDK response object)
        raw = ""
        try:
            # Primary: response.text (new SDK property)
            if hasattr(response, 'text') and response.text:
                raw = response.text.strip()
            # Fallback: candidates → parts → text
            elif hasattr(response, 'candidates') and response.candidates:
                for candidate in response.candidates:
                    if hasattr(candidate, 'content') and candidate.content:
                        for part in candidate.content.parts:
                            if hasattr(part, 'text') and part.text:
                                raw = part.text.strip()
                                break
                    if raw:
                        break

            if not raw:
                logger.warning("🏛️ Athena [%s] empty response (latency=%dms)", symbol, latency_ms)
                return self._default_execute(symbol, reason="Empty API response")

            # Strip markdown code fences if present
            if raw.startswith("```"):
                raw = raw.split("\n", 1)[-1]
                raw = raw.rsplit("```", 1)[0].strip()

            data = json.loads(raw)
        except (json.JSONDecodeError, ValueError) as e:
            logger.warning("🏛️ Athena [%s] malformed response: %s | raw=%s", symbol, str(e)[:80], repr(raw[:200] if raw else '<empty>'))
            return self._default_execute(symbol, reason=f"Parse error: {str(e)[:80]}")
        except Exception as e:
            logger.warning("🏛️ Athena [%s] response error: %s", symbol, str(e)[:100])
            return self._default_execute(symbol, reason=f"Response error: {str(e)[:80]}")

        # Build decision
        action = data.get("action", "EXECUTE").upper()
        if action not in ("EXECUTE", "REDUCE_SIZE", "VETO"):
            action = "EXECUTE"

        adj_conf = float(data.get("adjusted_confidence", 1.0))
        adj_conf = max(0.0, min(1.0, adj_conf))

        # Apply veto threshold
        if adj_conf < config.LLM_VETO_THRESHOLD and action != "VETO":
            action = "VETO"

        reasoning = data.get("reasoning", "No reasoning provided")
        risk_flags = data.get("risk_flags", [])

        decision = AthenaDecision(
            action=action,
            adjusted_confidence=adj_conf,
            reasoning=reasoning,
            risk_flags=risk_flags,
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

    def _build_prompt(self, ctx: dict) -> str:
        """Build the user prompt with all signal context."""
        sentiment_str = "Not available"
        if ctx.get("sentiment"):
            s = ctx["sentiment"]
            if hasattr(s, "score"):
                sentiment_str = f"score={s.score:.2f}, alert={s.alert}, articles={getattr(s, 'article_count', 0)}"
            elif isinstance(s, dict):
                sentiment_str = f"score={s.get('score', 'N/A')}, alert={s.get('alert', False)}"

        return f"""Analyze this trade signal and decide: EXECUTE, REDUCE_SIZE, or VETO.

## HMM Signal
- **Ticker**: {ctx.get('ticker', 'N/A')}
- **Side**: {ctx.get('side', 'N/A')}
- **HMM Regime**: {ctx.get('hmm_regime', 'N/A')}
- **HMM Confidence**: {ctx.get('hmm_confidence', 0):.4f}
- **Multi-TF Conviction**: {ctx.get('conviction', 0):.1f}/100
- **TF Agreement**: {ctx.get('tf_agreement', 0)}/3 timeframes agree

## Market Context
- **Current Price**: ${ctx.get('current_price', 0):,.2f}
- **ATR (hourly)**: ${ctx.get('atr', 0):,.4f}
- **BTC Regime**: {ctx.get('btc_regime', 'N/A')} (margin: {ctx.get('btc_margin', 0):.3f})
- **Volatility Percentile**: {ctx.get('vol_percentile', 0):.1%}

## Brain Selection
- **Active Brain**: {ctx.get('brain_id', 'N/A')}
- **Sentiment**: {sentiment_str}

Given this data, should this trade be executed?"""

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

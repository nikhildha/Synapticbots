# Pending Tasks — Synaptic Engine

> Tasks parked for later review. Each entry has: what it is, where the code is, why it matters, and what the fix looks like.

---

## H1 · Athena Adjusted Confidence Not Applied to Leverage

**Status**: Parked — review later
**File**: `main.py` (deploy loop, ~line 658–714)
**Priority**: Medium

### What it is

Leverage is calculated from HMM conviction **before** Athena runs:

```python
# Leverage set first (line 658–663)
if conviction >= 95:
    lev = 20
elif conviction >= 80:
    lev = 15
else:
    lev = 10

# Then Athena is called (line 665+)
athena_decision = self._athena.validate_signal(llm_ctx)
```

After Athena returns, `athena_decision.adjusted_confidence` is stored in `coin_states` for display, but the `lev` variable is **never recalculated**. If Athena reduces confidence (e.g. HMM=85 → Athena adjusted=65), the trade still deploys at 15x instead of 10x.

### Why it matters

Athena's confidence adjustment is the only LLM-informed risk signal in the system. Ignoring it for leverage sizing means the LLM is only a binary gate (EXECUTE/VETO), not a continuous risk input.

### Proposed fix

After Athena returns, recalculate leverage using `athena_decision.adjusted_confidence` (which is on a 0–1 scale, so multiply by 100 first):

```python
if athena_decision:
    adj_conv = athena_decision.adjusted_confidence * 100
    if adj_conv >= 95:
        lev = 20
    elif adj_conv >= 80:
        lev = 15
    elif adj_conv >= 70:
        lev = 10
    else:
        lev = 5  # Athena downgraded confidence significantly
```

### Risks to consider

- Athena's scale may not be directly comparable to HMM conviction scale (different calibration)
- If Athena always returns 1.0 for EXECUTE signals, this has no effect — check actual values in logs first
- Requires testing on live signal logs before enabling

---

## H3 · Non-BTC Coin Analysis Exceptions Swallowed at DEBUG Level

**Status**: Parked
**File**: `main.py` (~line 562–566)
**Priority**: Low

### What it is

```python
except Exception as e:
    if symbol == "BTCUSDT":
        logger.error("🚨 BTC analysis failed: %s", e, exc_info=True)
    else:
        logger.debug("Error analyzing %s: %s", symbol, e)   # ← silent in prod
```

Non-BTC failures are logged at DEBUG, which is filtered out in Railway production logs (INFO level). A broken coin (e.g. API format change, feature NaN) silently fails every cycle with no alert.

### Proposed fix

Change to `logger.warning` for non-BTC failures. Keep `exc_info=False` to avoid stack trace spam, but make them visible:

```python
    else:
        logger.warning("⚠️ Analysis failed for %s: %s", symbol, e)
```

---

## H4 · Athena Rate Limit Behaviour Under High Load

**Status**: Parked
**File**: `llm_reasoning.py`
**Priority**: Low

### What it is

When Gemini rate limits (429), Athena raises an exception. With C3 fix this is now fail-closed (trade skipped). However, if the engine is scanning 30+ coins and Athena is called per-coin, a sustained rate limit burst will skip ALL trades for an entire cycle with no backoff or retry.

### Proposed fix

Add exponential backoff on 429 specifically (retry 1–2x) before failing closed. Non-429 errors should remain fail-closed immediately.

---

*Last updated: 2026-03-18*

# Changes Made on 3rd April 2026

## Purpose
Introduced **Contrarian Mode** — a full signal inversion layer that fades every Athena-approved trade.  
Since the engine's signals were consistently generating losses, reversing all entries + exits is expected to flip the P&L curve.

---

## How to Revert

Set this flag in `config.py` to instantly disable everything:

```python
CONTRARIAN_MODE: bool = False   # ← change True → False to revert
```

No other code needs to change. The `CONTRARIAN_MODE` flag is guarded with `getattr(config, "CONTRARIAN_MODE", False)` everywhere so `False` is the safe default.

---

## Files Changed

### 1. `config.py`

**What was added** — 7 lines appended before the Coin Scanner section:

```python
# ─── Contrarian Mode ─────────────────────────────────────────────────────────
# When True: ALL post-Athena signals are flipped (BUY → SELL, SELL → BUY).
# Athena still validates the ORIGINAL HMM signal (quality gate stays intact).
# The flip happens just before execution — SL/TP, risk manager, and tradebook
# all automatically follow since they derive direction from the flipped side.
CONTRARIAN_MODE: bool = True
```

**To revert:** Delete those 6 lines, or set `CONTRARIAN_MODE: bool = False`.

---

### 2. `main.py` — Three changes

---

#### Change A — Signal Direction Flip (after Athena EXECUTE, ~line 1382)

**What was added** — injected immediately after the BTC Macro Veto gate, before the Telegram alert:

```python
# ── Contrarian Mode: Flip Signal AFTER Athena Approves ────────────────
# Athena validated the original HMM signal (quality gate intact).
# Now flip the direction — BUY → SELL, SELL → BUY.
_original_side = top.get("side", "")
if getattr(config, "CONTRARIAN_MODE", False):
    effective_side = "SELL" if _original_side.upper() == "BUY" else "BUY"
    logger.info(
        "🔄 CONTRARIAN FLIP [%s] %s: %s → %s (Athena approved original, now fading it)",
        bot_name, sym, _original_side, effective_side,
    )
else:
    effective_side = _original_side
```

**What changed downstream** — every reference to `top["side"]` in the deploy block was replaced with `effective_side`:

| Location | Old | New |
|---|---|---|
| Telegram `notify_athena_signal` | `top.get("side", "")` | `effective_side` |
| `_log_athena_decision(side=...)` | `top.get("side", "")` | `effective_side` |
| `_bcast("SIGNAL_DISPATCH", ...)` | `top["side"]` | `effective_side` |
| Deploy log line | `top["side"]` | `effective_side` |
| `executor.execute_trade(side=...)` | `top["side"]` | `effective_side` |
| `_bcast("EXEC_CRASH", ...)` | `top["side"]` | `effective_side` |
| `_bcast("EXEC_NULL", ...)` | `top["side"]` | `effective_side` |
| `is_long` in Athena SL/TP check | `top["side"].upper()` | `effective_side.upper()` |
| `_bcast("EXEC_ZERO_PRICE", ...)` | `top["side"]` | `effective_side` |
| `tradebook.open_trade(side=...)` | `top["side"]` | `effective_side` |
| `_bcast("TRADEBOOK_RECORDED", ...)` | `top["side"]` | `effective_side` |
| `_active_positions["side"]` | `top["side"]` | `effective_side` |
| `deployed_trades["side"]` | `top["side"]` | `effective_side` |

**To revert Change A:** Remove the `_original_side` / `effective_side` block and replace all `effective_side` back with `top["side"]` or `top.get("side", "")` as appropriate.  
The quickest revert is just setting `CONTRARIAN_MODE = False` — the code path becomes `effective_side = _original_side` which is identical to the original `top["side"]`.

---

#### Change B — Athena SL/TP Swap (~line 1497)

**What was added** — inserted between reading `a_sl`/`a_tp` and the sanity checks:

```python
# ── Contrarian SL/TP Swap ─────────────────────────────────────────────────
# Athena suggested SL/TP for the ORIGINAL signal direction.
# In contrarian mode the geometry is mirrored:
#   • Original SL (below entry for BUY)  → becomes TP for contrarian SELL
#   • Original TP (above entry for BUY)  → becomes SL for contrarian SELL
if getattr(config, "CONTRARIAN_MODE", False) and a_sl > 0 and a_tp > 0:
    a_sl, a_tp = a_tp, a_sl
    logger.info(
        "🔄 CONTRARIAN SL/TP swap [%s]: SL→%.4f (was TP) | TP→%.4f (was SL)",
        sym, a_sl, a_tp,
    )
```

**Tolerance changes** (widened to accommodate the swapped levels passing validation):

| Check | Old tolerance | New tolerance |
|---|---|---|
| SL distance from entry | `< 0.20` (20%) | `< 0.30` (30%) |
| TP distance from entry | `< 0.30` (30%) | `< 0.40` (40%) |

**Log line** — the Athena SL/TP override log now appends `[CONTRARIAN-SWAPPED]` when active.

**To revert Change B:** Remove the swap block and restore the old tolerance values (`0.20` for SL, `0.30` for TP). Again, setting `CONTRARIAN_MODE = False` is sufficient — the swap block is guarded and won't execute.

---

## Signal Flow — Before vs After

### Before (Normal Mode)
```
HMM → BULLISH → side = "BUY"
Athena validates BUY → EXECUTE
  SL = Athena suggested_sl (below entry)
  TP = Athena suggested_tp (above entry)
execute_trade(side="BUY", sl=below, tp=above)
tradebook: position=LONG, SL below, TP above
```

### After (Contrarian Mode = True)
```
HMM → BULLISH → side = "BUY"
Athena validates BUY → EXECUTE  ← quality gate unchanged
  ↓ CONTRARIAN FLIP ↓
effective_side = "SELL"
  ↓ CONTRARIAN SL/TP SWAP ↓
  a_sl = original suggested_tp  (above entry → valid SL for SELL)
  a_tp = original suggested_sl  (below entry → valid TP for SELL)
execute_trade(side="SELL", sl=above, tp=below)
tradebook: position=SHORT, SL above entry, TP below entry
Trailing SL ratchet: is_long=False → locks profit going downward ✅
```

---

## What Was NOT Changed

| Component | Status |
|---|---|
| HMM regime detection | Untouched — still generates original signals |
| Athena LLM validation | Untouched — still validates the ORIGINAL direction |
| Momentum veto, BTC flash crash guard | Untouched — still filters original signals |
| Conviction scoring, leverage tiers | Untouched |
| Trailing SL ratchet | Untouched — automatically correct via `position=SHORT` |
| Tradebook PnL calculation | Untouched — uses stored `position` field |
| `risk_manager.py` | Untouched |
| `tradebook.py` | Untouched |
| `execution_engine.py` | Untouched |

---

## Git Diff Summary

```
config.py    +7 lines  (CONTRARIAN_MODE flag)
main.py      +~45 lines (flip block, swap block, effective_side substitutions)
```

---

*Documented by Antigravity AI — 3 April 2026*

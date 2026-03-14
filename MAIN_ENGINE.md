# Synaptic — Main Engine Deep Reference (`main.py`)

**Author:** Quant Lead  
**Version:** March 2026 — v3 Signal Pipeline  
**File:** `main.py` (~2,200 lines), class `RegimeMasterBot`

---

## Table of Contents

1. [Engine Overview](#1-engine-overview)
2. [Startup Sequence](#2-startup-sequence)
3. [Timing Architecture](#3-timing-architecture)
4. [_tick() — The Core 5-Minute Cycle](#4-_tick----the-core-5-minute-cycle)
   - 4.1 [Phase 1: Coin Scanner](#41-phase-1-coin-scanner)
   - 4.2 [Phase 2: HMM Analysis — parallel per coin](#42-phase-2-hmm-analysis--parallel-per-coin)
   - 4.3 [Phase 3: Segment-First Selection](#43-phase-3-segment-first-selection)
   - 4.4 [Phase 4: Deploy Loop (per bot)](#44-phase-4-deploy-loop-per-bot)
   - 4.5 [Phase 5: Athena Gating](#45-phase-5-athena-gating)
   - 4.6 [Phase 6: Trade Execution](#46-phase-6-trade-execution)
   - 4.7 [Phase 7: Post-Cycle Snapshot](#47-phase-7-post-cycle-snapshot)
5. [_analyze_coin() — Per-Coin Intelligence](#5-_analyze_coin----per-coin-intelligence)
   - 5.1 [Data Fetching](#51-data-fetching)
   - 5.2 [HMM Training & Prediction](#52-hmm-training--prediction)
   - 5.3 [MTF Tiered Signal Logic](#53-mtf-tiered-signal-logic)
   - 5.4 [Conviction Scoring](#54-conviction-scoring)
   - 5.5 [Return Dict](#55-return-dict)
6. [Position Management (_manage_positions)](#6-position-management-_manage_positions)
7. [Trade Sizing & Leverage](#7-trade-sizing--leverage)
8. [Kill Switch & Risk Guards](#8-kill-switch--risk-guards)
9. [State Persistence & Dashboard Sync](#9-state-persistence--dashboard-sync)
10. [Engine API (Flask)](#10-engine-api-flask)
11. [Bot Registration & Segment Filtering](#11-bot-registration--segment-filtering)
12. [Coin States Reference](#12-coin-states-reference)

---

## 1. Engine Overview

`RegimeMasterBot` is a single Python class that runs as a background thread on the Railway server. It manages the entire trading lifecycle:

```
┌──────────────────────────────────────────────────────────┐
│                    RegimeMasterBot                       │
│                                                          │
│  Thread 1: _heartbeat() — every 30s                     │
│    ├── Read commands.json (START/STOP/PAUSE/CLOSE_ALL)   │
│    ├── Check position SL/TP on open trades               │
│    └── Every 300s: trigger _tick() analysis cycle        │
│                                                          │
│  Thread 2: Flask API — port 5000                        │
│    └── /api/bot-state, /api/trades, /api/close-trade    │
└──────────────────────────────────────────────────────────┘
```

**Key architectural property:** The engine is stateful — it maintains `_coin_states`, `_active_positions`, `_mtf_brains` as in-memory dictionaries that persist across cycles.

---

## 2. Startup Sequence

```python
bot = RegimeMasterBot()
bot.run()
```

1. Load config from environment variables
2. Initialize `AthenaEngine` (Gemini AI gatekeeper)
3. Initialize `SentimentEngine`, `OrderFlowEngine`
4. Load existing `tradebook.json` into `_active_positions`
5. Start Flask API thread (port 5000)
6. Begin `_heartbeat()` loop

---

## 3. Timing Architecture

```
Wall clock
  │
  ├── Every 30s: _heartbeat()
  │     ├── _process_commands()
  │     ├── _manage_positions()  ← SL/TP checks on ALL open trades
  │     ├── _update_engine_state()
  │     └── If time since last_cycle > 300s: → _tick()
  │
  └── Every 300s (5 min): _tick()
        ├── Phase 1: Coin scanner refresh (every 4 cycles = 20 min)
        ├── Phase 2: HMM analysis (parallel, ThreadPoolExecutor)
        ├── Phase 3: Segment selection (top 1 coin per segment)
        ├── Phase 4: Bot deploy loop (per registered bot)
        │     ├── Athena gate (per bot × coin)
        │     └── execute_trade() if approved
        └── Phase 5: Post-cycle snapshot → bot_state.json
```

---

## 4. _tick() — The Core 5-Minute Cycle

This is where all intelligence lives. Every 5 minutes, the engine scans coins, runs HMM, selects candidates, and deploys trades.

---

### 4.1 Phase 1: Coin Scanner

```python
# Refresh every SCAN_INTERVAL_CYCLES (4 cycles = 20 min)
if self._cycle_count % SCAN_INTERVAL_CYCLES == 0:
    scan_results = coin_scanner.get_top_coins()  # fetches Binance volume data
    self._scan_list = scan_results[:TOP_COINS_LIMIT]  # e.g., top 25
```

**What `get_top_coins()` does:**
1. Fetch top 50 coins by 24h USDT futures volume from Binance
2. Exclude Tier C coins (poor backtested performance from `coin_tiers.csv`)
3. Sort: Tier A first, then Tier B by volume
4. Return top N

---

### 4.2 Phase 2: HMM Analysis — parallel per coin

```python
raw_results = []
with ThreadPoolExecutor(max_workers=8) as executor:
    futures = {executor.submit(self._analyze_coin, sym): sym 
               for sym in self._scan_list}
    for future in as_completed(futures):
        result = future.result()
        if result:
            raw_results.append(result)

# Sort by conviction score (descending) — best opportunities first
raw_results.sort(key=lambda x: x["conviction"], reverse=True)
```

**Important:** `_analyze_coin()` returns `None` for coins that fail any filter (CHOP, MTF_CONFLICT, low conviction, vol filter). Only coins that pass all pre-filters make it into `raw_results`.

---

### 4.3 Phase 3: Segment-First Selection

The heatmap identifies which market segments are active. Only the **top 1 coin per segment** is selected from `raw_results`.

```python
top_coins_by_segment = {}  # segment → top result

for result in raw_results:  # already sorted by conviction (best first)
    segment = get_segment_for_coin(result["symbol"])
    if segment not in top_coins_by_segment:
        top_coins_by_segment[segment] = result  # take only the best per segment

top_coins = list(top_coins_by_segment.values())
```

**Why 1 coin per segment?**
- High intra-segment correlation: DeFi coins move together. Two DeFi entries = concentrated sector risk.
- Capital efficiency: one high-conviction bet per sector > two correlated bets.
- Cleaner signal: the top coin per segment passed the most conviction factors.

---

### 4.4 Phase 4: Deploy Loop (per bot)

```python
deployed_trades = []

for bot in self._registered_bots:
    bot_id = bot["bot_id"]
    segment_filter = bot["segment_filter"]   # e.g., "defi", "layer1", "meme"

    # Filter top_coins to this bot's assigned segment
    bot_coins = [t for t in top_coins 
                 if get_segment_for_coin(t["symbol"]) == segment_filter]

    if not bot_coins:
        logger.info("No HMM signal in segment [%s] this cycle", segment_filter)
        continue

    top = bot_coins[0]  # the top coin for this bot's segment
    sym = top["symbol"]
    conviction = top["conviction"]

    # Gate 1: Minimum conviction
    if conviction < MIN_CONVICTION_FOR_DEPLOY:
        continue

    # Gate 2: No duplicate trade (same bot + same coin already open)
    active_key = f"{bot_id}:{sym}"
    if active_key in self._active_positions:
        continue

    # → Proceed to Athena (Phase 5)
```

---

### 4.5 Phase 5: Athena Gating

```python
atr_val      = top.get("atr", 0)
current_price = self._coin_states.get(sym, {}).get("price", 0)

llm_ctx = {
    "ticker":       sym,
    "side":         top["side"],
    "leverage":     leverage,
    "hmm_confidence": top["confidence"],
    "hmm_regime":   top.get("regime_name", ""),
    "conviction":   conviction,
    "current_price": current_price,
    "atr":          atr_val,
    "atr_pct":      (atr_val / max(current_price, 0.0001)) * 100,
    "trend":        trend_alignment,
    "signal_type":  top.get("signal_type", "TREND_FOLLOW"),
    "ema_15m_20":   top.get("ema_15m_20"),
    # + BTC regime, funding rate, other context
}

athena_decision = self._athena.validate_signal(llm_ctx)

if athena_decision.action == "VETO":
    logger.warning("ATHENA_VETO [%s]: %s", sym, athena_decision.reasoning)
    self._coin_states[sym]["deploy_status"] = "ATHENA_VETOED"
    continue  # ← skip this trade

# EXECUTE → proceed to trade deployment
logger.info("ATHENA_DECISION: EXECUTE [%s] confidence=%.2f", sym, 
            athena_decision.adjusted_confidence)
```

**Fail-open:** If Athena raises an exception, the trade proceeds with `action = "EXECUTE"` to avoid missing opportunities due to API failure.

---

### 4.6 Phase 6: Trade Execution

```python
# Trade parameters
capital  = CAPITAL_PER_TRADE   # $100 fixed per trade
leverage = risk_manager.get_leverage_band(conviction)
sl_mult  = risk_manager.get_sl_multiplier(leverage)  # ATR-based
tp_mult  = sl_mult * 2.0       # 1:2 risk-reward minimum

sl_price = entry - (atr_val × sl_mult) if BUY else entry + (atr_val × sl_mult)
tp_price = entry + (atr_val × tp_mult) if BUY else entry - (atr_val × tp_mult)

# Execute via execution_engine
trade_result = execution_engine.execute_trade(
    symbol=sym, side=top["side"], capital=capital,
    leverage=leverage, sl=sl_price, tp=tp_price,
    mode=bot["mode"]   # "paper" or "live"
)

# Record in tradebook
tradebook.open_trade({...})
```

**Modes:**
- `paper`: Simulated execution at current price. Stored in `tradebook.json`.
- `live`: Real order placed on CoinDCX via REST API.

---

### 4.7 Phase 7: Post-Cycle Snapshot

```python
self._post_cycle_snapshot(deployed_trades)
# → Writes engine_state.json (read by Flask API → Next.js dashboard)

# Summary log
logger.info(
    "CYCLE_SUMMARY bots=%d signals=%d deployed=%d duration=%.1fs",
    len(registered_bots), len(top_coins), len(deployed_trades), cycle_duration
)

# Telegram batch alert (if any trades deployed)
if deployed_trades:
    send_batch_telegram_alert(deployed_trades)
```

---

## 5. _analyze_coin() — Per-Coin Intelligence

This method runs in a thread pool. Each call is fully independent.

**Signature:**
```python
def _analyze_coin(self, symbol: str) -> dict | None:
```

Returns a result dict if the coin passes all filters, or `None` if blocked.

---

### 5.1 Data Fetching

```python
df_15m  = fetch_klines(symbol, "15m", limit=500)
df_1h   = fetch_klines(symbol, "1h",  limit=500)
df_4h   = fetch_klines(symbol, "4h",  limit=500)
btc_df  = fetch_klines("BTCUSDT", "1h", limit=100)

# Compute features for each timeframe
df_15m_feat = compute_all_features(df_15m)
df_1h_feat  = compute_all_features(df_1h)
df_4h_feat  = compute_all_features(df_4h)
```

`compute_all_features()` adds both HMM features (for model input) and TA indicators (RSI, ATR, Bollinger Bands, EMA) to the DataFrame.

---

### 5.2 HMM Training & Prediction

```python
mtf_brain = self._mtf_brains.setdefault(symbol, MultiTFHMMBrain(symbol))

# Retrain if stale (>24h since last training)
for tf, brain, df in [("15m", brain_15m, df_15m_feat), 
                       ("1h",  brain_1h,  df_1h_feat),
                       ("4h",  brain_4h,  df_4h_feat)]:
    if brain.needs_retrain():
        brain.train(df)
    mtf_brain.set_brain(tf, brain)

# Predict current regime per timeframe
mtf_brain.predict({"15m": df_15m_feat, "1h": df_1h_feat, "4h": df_4h_feat})

# Get combined conviction score (weighted vote across 3 TFs)
conviction, side, tf_agreement = mtf_brain.get_conviction()
```

The `side` returned here is the **multi-TF consensus direction** ("BUY", "SELL", or `None`).

---

### 5.3 MTF Tiered Signal Logic

This is where the Tier 1/2A/2B/3 decision happens. See `BRAIN_DEEP_DIVE.md §8-9` for full detail.

```python
# Extract individual TF regimes
regime_1h = mtf_brain._predictions.get("1h", (None, 0))[0]
regime_4h = mtf_brain._predictions.get("4h", (None, 0))[0]
regime    = mtf_brain._predictions.get("15m", (None, 0))[0]  # primary

# ── Tier 3: 1H and 4H direct conflict → hard block ──
if regime_1h != regime_4h and both are non-CHOP:
    action = "MTF_CONFLICT" → return None

# ── Tier 2A: 15m reversed vs 1H+4H → ATR pullback on 15m ──
if 15m is BULL and (1H and 4H are both BEAR):
    check EMA20_15m ± ATR_15m zone
    if not in zone: action = "REVERSAL_WAIT_PULLBACK" → return None
    if in zone: conviction = min(conviction, 55.0)

# ── Tier 2B: 15m+4H agree, 1H lagging → ATR pullback on 1H ──
if (15m == 4H direction) and (1H is opposite):
    check EMA20_1h ± ATR_1h zone
    if not in zone: action = "TIER2B_WAIT_PULLBACK" → return None
    if in zone: conviction = min(conviction, 60.0)

# ── Tier 1: no conflict detected → normal full conviction ──
```

Each blocked path sets `self._coin_states[symbol]["action"]` for dashboard visibility.

---

### 5.4 Conviction Scoring

After MTF checks pass, the coin enters the 8-factor conviction scoring:

```python
score = risk_manager.validate_signal({
    "symbol":     symbol,
    "side":       side,
    "regime":     regime,
    "confidence": hmm_margin,
    "atr":        current_atr,
    "sr_pos":     sr_pos_4h,
    "vwap_pos":   vwap_pos_4h,
    "sentiment":  sentiment_signal,
    "orderflow":  orderflow_signal,
    "funding":    funding_rate,
    "open_interest": oi_data,
    "btc_regime": btc_regime,
})
conviction = score["conviction"]
```

If `conviction < brain_cfg["conviction_min"]` (e.g., 60) → return None.

---

### 5.5 Return Dict

```python
return {
    "symbol":       symbol,
    "side":         side,            # "BUY" or "SELL"
    "atr":          current_atr,
    "ema_15m_20":   ema_15m_20,      # for Tier 2A pullback reference
    "regime":       regime,          # int regime constant
    "regime_name":  regime_name,     # "BULLISH" or "BEARISH"
    "confidence":   hmm_margin,      # raw margin confidence (0-1)
    "conviction":   conviction,      # 0–100 score
    "brain_id":     brain_id,
    "brain_cfg":    brain_cfg,
    "tf_agreement": tf_agreement,    # how many TFs agree (0-3)
    "athena":       pre_athena_opinion,
    "signal_type":  "TREND_FOLLOW" | "REVERSAL_PULLBACK" | "TREND_RESUME_PULLBACK",
    "reason":       "{label} | {regime_summary} | conv={score} TF={n}/3",
}
```

---

## 6. Position Management (_manage_positions)

Called every 30 seconds in the heartbeat loop.

```
For each open trade in _active_positions:

  Fetch current price (live price query)
  
  ── SL Check ──
  if (BUY and price ≤ sl_price) or (SELL and price ≥ sl_price):
      close_trade(reason="STOP_LOSS")
  
  ── T1 Check (25% partial booking) ──
  if not t1_hit and (BUY and price ≥ t1_price):
      book 25% at T1 price
      t1_hit = True
      sl_price = entry_price  # Move SL to breakeven
  
  ── T2 Check (50% of remaining) ──
  if t1_hit and not t2_hit and (BUY and price ≥ t2_price):
      book 50% of remaining at T2
      t2_hit = True
  
  ── T3 Full Close ──
  if t2_hit and (BUY and price ≥ t3_price):
      close remaining position (100%)
  
  ── Trailing SL ──
  if trailing_active:
      new_sl = peak_price - (TRAILING_SL_DISTANCE_ATR × atr)
      update sl_price = max(current_sl, new_sl)  # never move SL backward
  
  ── Max Loss Guard ──
  if pnl_pct < -MAX_LOSS_PCT (-15%): close_trade("MAX_LOSS")
  
  ── Kill Switch ──
  if portfolio drawdown in 24h >= 10%: kill_all_positions()
```

---

## 7. Trade Sizing & Leverage

**Philosophy:** Fixed capital per trade (`CAPITAL_PER_TRADE = $100`). The leverage band determines the traded notional value.

```python
leverage = get_leverage_band(conviction)
# conviction 40-54 → 10x → $1000 notional
# conviction 55-69 → 15x → $1500 notional
# conviction 70-84 → 25x → $2500 notional
# conviction 85-100 → 35x → $3500 notional

sl_multiplier = {
    range(1, 5):   1.5,
    range(5, 10):  1.2,
    range(10, 25): 1.0,
    range(25, 50): 0.7,
    range(50, 101): 0.5,
}[leverage]

sl_distance = atr × sl_multiplier
sl_price    = entry ± sl_distance
tp_price    = entry ± (sl_distance × 2.0)   # 1:2 R:R

quantity = capital × leverage / entry_price  # units of coin
```

**Multi-target partial booking (T1/T2/T3):**
```
T1 = entry ± (sl_distance × MT_T1_FRAC × MT_RR_RATIO)  → book 25%
T2 = entry ± (sl_distance × MT_T2_FRAC × MT_RR_RATIO)  → book 50% of remaining
T3 = entry ± (sl_distance × MT_RR_RATIO)               → close rest
```

---

## 8. Kill Switch & Risk Guards

**Layer 1: Per-trade minimum conviction**
```python
MIN_CONVICTION_FOR_DEPLOY = 0.60  # or 60 on 0-100 scale
```

**Layer 2: Volatility filter**
```python
if atr_pct < VOL_MIN_ATR_PCT:    # 0.3% — too quiet, no edge
    return None
if atr_pct > VOL_MAX_ATR_PCT:    # 6.0% — too chaotic, unpredictable
    return None
```

**Layer 3: BTC Flash Crash guard**
```python
if btc_flash_crash and side == "BUY":
    action = "MACRO_VETO_BTC_CRASH"
    return None
```

**Layer 4: Sentiment hard veto**
```python
if sentiment.alert:  # hack/exploit/black-swan detected
    conviction = 0   # no trade possible this cycle
```

**Layer 5: Portfolio Kill Switch**
```python
drawdown_24h = (portfolio_24h_ago - portfolio_now) / portfolio_24h_ago
if drawdown_24h >= KILL_SWITCH_DRAWDOWN:  # 10%
    self._killed = True
    close_all_positions()
    send_telegram("⚠️ KILL SWITCH TRIGGERED")
```

---

## 9. State Persistence & Dashboard Sync

The engine writes its state to `data/bot_state.json` after every cycle. The Flask API serves this file to the Next.js dashboard.

```json
{
  "cycle": 42,
  "cycle_duration_s": 18.3,
  "last_cycle_utc": "2026-03-14T07:30:00Z",
  "coin_states": {
    "IMXUSDT": {
      "regime": "BULLISH",
      "confidence": 0.71,
      "conviction": 68.0,
      "action": "DEPLOY_QUEUED",
      "signal_type": "TREND_FOLLOW",
      "price": 1.831,
      "ta_multi": {...},
      "athena_decision": "EXECUTE",
      "tf_agreement": 3
    }
  },
  "active_positions": {...},
  "engine_status": "running",
  "registered_bots": [...]
}
```

The `action` field values visible on the dashboard:

| Action | Meaning |
|---|---|
| `DEPLOY_QUEUED` | Athena approved, trade submitted |
| `TRADEBOOK_RECORDED` | Trade opened and logged |
| `ATHENA_VETOED` | Athena blocked the trade |
| `MTF_CONFLICT` | 1H and 4H directly contradict |
| `REVERSAL_WAIT_PULLBACK` | Tier 2A: price not yet at 15m EMA20 zone |
| `REVERSAL_PULLBACK_CONFIRMED` | Tier 2A: pullback zone met, trade allowed |
| `TIER2B_WAIT_PULLBACK` | Tier 2B: price not yet at 1H EMA20 zone |
| `TIER2B_RESUME_CONFIRMED` | Tier 2B: pullback zone met, trend resume trade |
| `MACRO_VETO_BTC_CRASH` | BTC flash crash detected, BUY blocked |
| `SENTIMENT_VETO` | Hack/exploit alert, all trades blocked |
| `VOL_TOO_LOW` / `VOL_TOO_HIGH` | Volatility outside tradeable range |
| `LOW_CONVICTION:XX<YY` | HMM conviction below minimum threshold |

---

## 10. Engine API (Flask)

**File:** `engine_api.py`  
**Port:** 5000

| Endpoint | Method | Description |
|---|---|---|
| `/api/health` | GET | Engine uptime, status, last cycle time |
| `/api/bot-state` | GET | Full `bot_state.json` (30s cache) |
| `/api/trades` | GET | All trades from `tradebook.json` |
| `/api/close-trade` | POST | Close specific trade `{symbol, bot_id}` |
| `/api/close-all` | POST | Emergency close all positions |
| `/api/register-bot` | POST | Register a new bot with segment filter |

---

## 11. Bot Registration & Segment Filtering

Bots register with the engine at startup via the dashboard's toggle API:

```python
# POST /api/register-bot
{
    "bot_id":         "bot_abc123",
    "user_id":        "user_xyz",
    "segment_filter": "defi",       # which market segment this bot covers
    "mode":           "paper",      # or "live"
    "capital":        100,          # per-trade capital in USD
}
```

In `_tick()`, each bot only sees coins from its assigned segment:

```python
bot_coins = [t for t in top_coins
             if get_segment_for_coin(t["symbol"]) == bot["segment_filter"]]
```

This is the core of the **multi-bot, segment-specialized** design: DeFi bot only deploys on DeFi coins, Layer1 bot on L1s, etc. Each bot has a focused, expert mandate.

---

## 12. Coin States Reference

`self._coin_states` is an in-memory `dict[symbol → state_dict]`. Updated every cycle by `_analyze_coin()`. Full schema:

```python
{
  "IMXUSDT": {
    "symbol":       "IMXUSDT",
    "regime":       "BULLISH",           # human-readable 
    "regime_full":  "15m=BULL 1h=BULL 4h=BULL",
    "confidence":   0.71,                # HMM margin confidence
    "conviction":   68.0,                # multi-factor score
    "price":        1.831,               # last known price
    "side":         "BUY",
    "action":       "TRADEBOOK_RECORDED",
    "signal_type":  "TREND_FOLLOW",
    "tf_agreement": 3,                   # TFs agreeing with direction
    "atr":          0.042,
    "deploy_status": "DEPLOY_QUEUED",
    "athena_decision": "EXECUTE",
    "athena_state": {
      "action":     "EXECUTE",
      "confidence": 0.82,
      "reasoning":  "Strong bullish alignment across...",
      "risk_flags": []
    },
    "ta_multi": {
      "price": 1.831,
      "1h":    {"rsi": 62.1, "atr": 0.042, "trend": "UP", ...},
      "4h":    {"rsi": 58.3, "atr": 0.051, "trend": "UP", ...},
      "15m":   {"rsi": 71.2, ...}
    },
    "features": {
      "log_return":     0.0028,
      "volatility":     0.021,
      "volume_change":  0.14,
      ...
    }
  }
}
```

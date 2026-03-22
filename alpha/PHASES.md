# Alpha Module — Phased Build Plan

**Project:** Alpha standalone trading engine
**Strategy:** QUAD vol=1.5 | 1h HMM | SL=3.5×ATR | TP=9×ATR | BE@3.0 | 25x flat
**Repository:** Synaptic monorepo (`alpha/` subdirectory)
**Last updated:** 2026-03-23

---

## Overview: 6 Phases

```
Phase 0 — Foundation & Docs          (done — you are reading the output)
Phase 1 — Core Python Engine          (data → features → HMM → signals → risk → tradebook)
Phase 2 — Paper Broker + Loop         (broker sim → engine loop → local paper run)
Phase 3 — API + Audit Layer           (Flask API → audit checks → data routing tests)
Phase 4 — NextJS UI                   (proxy routes → /alpha page → nav link)
Phase 5 — Railway Deployment          (Dockerfile → railway.toml → env vars → deploy)
Phase 6 — Paper Trading Validation    (2–4 week paper run → sign-off → live flip)
```

Each phase has:
- Files to build
- Acceptance criteria (must all pass before moving to next phase)
- Audit checks (isolation + data routing)
- What to never do (common agent mistakes to prevent)

---

## Phase 0 — Foundation & Documentation ✓ COMPLETE

### Deliverables
- [x] `alpha/` directory created
- [x] `alpha/__init__.py`
- [x] `alpha/data/.gitkeep`
- [x] `alpha/README.md` — isolation contract for developers and AI agents
- [x] `alpha/STRATEGY.md` — full R1–R13 backtest history + validated parameters
- [x] `alpha/PHASES.md` — this document

### Purpose
Any developer or AI agent picking up this codebase must be able to read README.md,
understand the isolation rules, read STRATEGY.md, and understand the strategy before
writing a single line of code.

---

## Phase 1 — Core Python Engine

### Goal
Build the standalone Python modules: config → logger → features → data → HMM → signals → risk → tradebook.
No execution, no loop, no Flask. Pure computation and persistence only.

### Files to Build (in order)

#### 1.1 `alpha/alpha_config.py`
All constants. Zero imports from project root. Single source of truth for Alpha.

```python
# Key values to define:
ALPHA_COINS = ["AAVEUSDT", "SNXUSDT", "COMPUSDT", "BNBUSDT"]
ALPHA_LEVERAGE = 25
ALPHA_SL_ATR   = 3.5
ALPHA_TP_ATR   = 9.0
ALPHA_BE_ATR   = 3.0
ALPHA_VOL_THRESH      = 1.5
ALPHA_REGIME_MARGIN   = 0.10
ALPHA_FEE_PER_LEG     = 0.0005
ALPHA_HMM_LOOKBACK    = 250      # bars
ALPHA_LOOP_SECONDS    = 900      # 15 minutes
ALPHA_CAPITAL_PER_COIN = 500.0   # USD per coin slot
ALPHA_DATA_DIR        = "alpha/data"
ALPHA_TRADEBOOK_FILE  = "alpha/data/tradebook.json"
ALPHA_STATE_FILE      = "alpha/data/state.json"
ALPHA_LOG_FILE        = "alpha/data/alpha.log"
ALPHA_PORT            = 5001
ALPHA_PAPER_MODE      = True     # override via env
ALPHA_INTERNAL_KEY    = ""       # override via env — required for close endpoints
```

#### 1.2 `alpha/alpha_logger.py`
Rotating file logger to `alpha/data/alpha.log`. Daily rotation, 7-day retention.

#### 1.3 `alpha/alpha_features.py`
Self-contained feature computation. Duplicates math from `feature_engine.py` — intentional isolation.

Functions to implement:
- `compute_atr(df, length=14) → pd.Series`
- `compute_vol_zscore(df, lookback=24) → pd.Series`
- `compute_log_return(df) → pd.Series`
- `compute_volatility(df) → pd.Series`
- `compute_liquidity_vacuum(df) → pd.Series`
- `compute_amihud(df) → pd.Series`
- `compute_volume_trend_intensity(df) → pd.Series`
- `compute_all_features(df) → pd.DataFrame`  ← main entry point, adds all cols to df

Reference formulas (copy precisely from `feature_engine.py`):
```python
vol_zscore = (volume - volume.rolling(24).mean()) / volume.rolling(24).std()
vol_zscore = vol_zscore.clip(-5, 5)

atr = pd.concat([high-low, (high-close.shift()).abs(), (low-close.shift()).abs()], axis=1).max(axis=1)
atr = atr.ewm(alpha=1/length, adjust=False).mean()  # Wilder smoothing

liquidity_vacuum = (log_return.abs() / (atr/close)).clip(0, 5)

amihud = (log_return.abs() / (close * volume)).replace([np.inf, -np.inf], 0).clip(0, 10) * 1e8
```

#### 1.4 `alpha/alpha_data.py`
Wraps `tools/data_cache.load_all_tf()`. Applies features. Returns processed DataFrames.

```python
# Permitted import:
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from tools.data_cache import load_all_tf   # READ-ONLY — never call fill_cache or write methods
```

Functions:
- `get_data(symbol, force_refresh=False) → dict[str, pd.DataFrame] | None`
  Returns `{"4h": df, "1h": df, "15m": df}` with all features applied.
- `get_all_alpha_data(force_refresh=False) → dict[str, dict]`
  Returns data for all 4 ALPHA_COINS. Skips failures gracefully.
- `get_latest_price(symbol) → float | None`
  Bybit REST mark price. Used for paper fills.

#### 1.5 `alpha/alpha_hmm.py`
2-state GaussianHMM trained on 1h bars. Returns BULL/BEAR + margin.

```python
# HMM features used (7 features — matches coin-specific subsets from experiments)
ALPHA_HMM_FEATURES = [
    "log_return", "volatility", "volume_change", "vol_zscore",
    "liquidity_vacuum", "amihud_illiquidity", "volume_trend_intensity"
]

class AlphaHMM:
    def train(self, df_1h: pd.DataFrame) -> bool
    def predict(self, df_1h: pd.DataFrame) -> dict | None
        # returns: {regime, regime_id, margin, passes_filter}
    def needs_retrain(self, hours=1.0) -> bool
    def to_dict(self) -> dict        # serialise for state.json
    def from_dict(cls, d) -> AlphaHMM  # restore from state.json
```

State mapping: sort raw HMM states by mean log_return of training data.
Highest mean → BULL(0). Lowest mean → BEAR(1). (Same logic as `hmm_brain.py` lines ~60–90.)

#### 1.6 `alpha/alpha_signals.py`
Entry condition and exit condition logic.

```python
def check_entry_signal(df_15m, regime) -> dict:
    # Checks last 2 CLOSED 15m bars:
    # 1. vol_zscore[-2] > ALPHA_VOL_THRESH AND vol_zscore[-1] > ALPHA_VOL_THRESH
    # 2. Direction match:
    #    BULL → close[-2] > open[-2] AND close[-1] > open[-1]
    #    BEAR → close[-2] < open[-2] AND close[-1] < open[-1]
    # Returns: {signal, side, vol_zscore_last, reason}

def check_exit(trade, current_price) -> dict:
    # Returns: {should_exit, reason}  reason ∈ {SL, TP, BE_SL, None}
    # BE_SL = breakeven stop was triggered previously; now price hit that SL
```

#### 1.7 `alpha/alpha_risk.py`
ATR-based stops, BE update, PnL calculation.

```python
def compute_stops(entry_price, atr, side) -> dict:
    # {stop_loss, take_profit, be_trigger, atr_used}
    # LONG: sl = entry - 3.5*atr, tp = entry + 9.0*atr, be_trigger = entry + 3.0*atr
    # SHORT: sl = entry + 3.5*atr, tp = entry - 9.0*atr, be_trigger = entry - 3.0*atr

def apply_breakeven(trade, current_price) -> dict:
    # If price has crossed be_trigger and BE not yet activated:
    #   trade["stop_loss"] = trade["entry_price"]
    #   trade["be_activated"] = True
    # Returns updated trade dict (does not mutate in place)

def compute_pnl(entry, exit_price, side, capital, leverage=25) -> dict:
    # {gross_pnl, fee_entry, fee_exit, net_pnl, net_pnl_pct, r_multiple}

def compute_unrealized(trade, current_price) -> dict:
    # {unrealized_pnl, unrealized_pnl_pct}
```

#### 1.8 `alpha/alpha_tradebook.py`
Persistent trade journal. Writes ONLY to `alpha/data/tradebook.json`.

Trade record schema:
```json
{
  "trade_id":          "A-0001",
  "symbol":            "AAVEUSDT",
  "side":              "LONG",
  "regime":            "BULL",
  "hmm_margin":        0.23,
  "entry_price":       95.40,
  "stop_loss":         90.08,
  "take_profit":       130.50,
  "be_trigger":        103.98,
  "be_activated":      false,
  "atr_at_entry":      1.40,
  "capital":           500.0,
  "leverage":          25,
  "quantity":          130.89,
  "status":            "ACTIVE",
  "mode":              "paper",
  "entry_time":        "2026-03-23T10:15:00Z",
  "exit_time":         null,
  "exit_price":        null,
  "exit_reason":       null,
  "fee_entry":         0.25,
  "fee_exit":          null,
  "gross_pnl":         null,
  "net_pnl":           null,
  "net_pnl_pct":       null,
  "unrealized_pnl":    12.50,
  "unrealized_pnl_pct": 2.50,
  "vol_zscore_entry":  1.87,
  "current_price":     96.90,
  "last_updated":      "2026-03-23T10:30:00Z"
}
```

Functions:
```python
def open_trade(trade_data: dict) -> dict
def update_trade(trade_id: str, updates: dict) -> bool
def close_trade(trade_id: str, exit_price: float, exit_reason: str) -> dict | None
def get_open_trades() -> list[dict]
def get_all_trades(limit=200) -> list[dict]
def get_summary() -> dict
    # {total, active, closed, wins, losses, win_rate,
    #  total_realized_pnl, total_unrealized_pnl, total_fees, profit_factor}
def can_open_trade(symbol: str) -> bool
    # False if an ACTIVE trade already exists for this symbol
```

### Phase 1 Acceptance Criteria

All of these must pass before moving to Phase 2:

```
[ ] python -c "from alpha.alpha_config import ALPHA_COINS, ALPHA_SL_ATR; print(ALPHA_COINS)"
    → ['AAVEUSDT', 'SNXUSDT', 'COMPUSDT', 'BNBUSDT']

[ ] python -c "from alpha.alpha_data import get_data; d = get_data('AAVEUSDT'); print(list(d.keys()))"
    → ['4h', '1h', '15m']

[ ] python -c "from alpha.alpha_data import get_data; d = get_data('AAVEUSDT'); print('vol_zscore' in d['15m'].columns, 'atr' in d['15m'].columns)"
    → True True

[ ] AlphaHMM("AAVEUSDT").train(df_1h) returns True (no crash)

[ ] AlphaHMM("AAVEUSDT").predict(df_1h) returns dict with keys: regime, margin, passes_filter

[ ] alpha_risk.compute_stops(100.0, 1.5, "LONG") == {
      stop_loss: 94.75, take_profit: 113.5, be_trigger: 104.5 }

[ ] alpha_tradebook: open_trade → get_open_trades returns 1 → close_trade → get_open_trades returns 0
    → alpha/data/tradebook.json exists and contains correct data

[ ] grep -r "import config" alpha/ → no results
[ ] grep -r "import tradebook" alpha/ → no results
[ ] grep -r "import hmm_brain" alpha/ → no results
[ ] grep -r "import engine_api" alpha/ → no results
[ ] grep -r "import main" alpha/ → no results (except README/docs)
```

### Phase 1 Audit Checks

**Data routing:**
```
alpha_data.get_data()
  → calls tools.data_cache.load_all_tf(symbol, exchange="bybit")
  → reads from data_cache/{bybit}_{symbol}_{tf}.parquet
  → applies alpha_features.compute_all_features()
  → returns enriched DataFrames
  NEVER writes to data_cache/
  NEVER calls Binance API
  NEVER reads from data/ (root data directory)
```

**State routing:**
```
alpha_tradebook writes → alpha/data/tradebook.json  ✓
alpha_tradebook reads  → alpha/data/tradebook.json  ✓
                  NEVER → data/tradebook.json        ✗
alpha_logger writes    → alpha/data/alpha.log        ✓
                  NEVER → data/bot.log               ✗
```

### What NOT to Do in Phase 1

- Do NOT import `feature_engine` — duplicate the math inline in `alpha_features.py`
- Do NOT import `config` — all constants live in `alpha_config.py`
- Do NOT import `hmm_brain` — `alpha_hmm.py` is its own 2-state implementation
- Do NOT write to `data/tradebook.json` from `alpha_tradebook.py`
- Do NOT add `n_mix=3` to the HMM if training fails — fall back to `n_mix=2` then plain `GaussianHMM`

---

## Phase 2 — Paper Broker + Engine Loop

### Goal
Add the paper broker and the 15-minute engine loop. Run Alpha end-to-end locally in paper mode.

### Files to Build

#### 2.1 `alpha/alpha_paper_broker.py`
Simulated order fills. No real API calls.

```python
PAPER_SLIPPAGE_PCT = 0.0005  # ±0.05%

def fill_entry(symbol, side, price, capital) -> dict:
    # filled_price = price * (1 + slip) for LONG, (1 - slip) for SHORT
    # quantity = (capital * ALPHA_LEVERAGE) / filled_price
    # Returns: {symbol, side, filled_price, quantity, fill_time, mode: "paper"}

def fill_exit(symbol, side, price, quantity) -> dict:
    # filled_price = price * (1 - slip) for LONG TP/SL exit
    # Returns: {symbol, side, filled_price, quantity, fill_time}
```

#### 2.2 `alpha/alpha_live_broker.py`
Bybit V5 live order stubs. Active only when `ALPHA_PAPER_MODE=false`.

```python
def place_market_order(symbol, side, qty, reduce_only=False) -> dict:
    """Bybit V5 /v5/order/create. Raises NotImplementedError in paper mode."""

def set_leverage(symbol, leverage) -> bool:
    """Set ISOLATED leverage via /v5/position/set-leverage"""

def get_position(symbol) -> dict | None:
    """Fetch current position from /v5/position/list"""
```

#### 2.3 `alpha/alpha_loop.py`
The 15-minute engine loop. Alpha's `main.py`.

```python
# Module-level state (in-memory, not global across processes)
_hmm_models: dict[str, AlphaHMM] = {}   # one per coin
_cycle_count: int = 0
_last_cycle_time: datetime | None = None
_running: bool = False

def run() -> None:
    """Start the engine. Blocks forever. Called from alpha_api.py in a bg thread."""

def run_once() -> dict:
    """
    Run exactly one cycle. Returns cycle summary dict.
    Used for testing and manual cycle trigger.
    """

def stop() -> None:
    """Signal the loop to stop after current cycle completes."""

def get_status() -> dict:
    """
    Returns current engine state (for API):
    {cycle, last_cycle_time, next_cycle_in_s, mode, coin_states, summary}
    """
```

**Cycle logic (see STRATEGY.md §1 and README.md for full detail):**
1. Fetch data for all 4 coins (parallel)
2. Retrain HMM if needed (1h interval)
3. Predict regime per coin
4. Exit check for all open trades (BE update, SL/TP check)
5. Entry scan for coins with valid regime + no open position
6. Save state.json
7. Sleep until next 15m boundary

**15m wall-clock alignment:**
```python
def _sleep_to_next_15m():
    now = datetime.utcnow()
    seconds_past = (now.minute % 15) * 60 + now.second + now.microsecond / 1e6
    sleep_for = 900 - seconds_past + 5  # +5s candle-close buffer
    time.sleep(max(sleep_for, 60))
```

#### 2.4 `alpha/alpha_telegram.py`
**Required** trade notifications via a dedicated Alpha Telegram bot.
Uses `ALPHA_TELEGRAM_BOT_TOKEN` — must NOT be the same token as the main engine's bot.
Silently logs a warning (does not crash) if token is not set.

```python
# Message formats:

def notify_trade_open(trade: dict) -> None:
    # 🟢 ALPHA OPENED
    # AAVEUSDT LONG @ $95.40
    # SL: $90.08 (−5.6%) | TP: $130.50 (+36.7%)
    # vol_z: 1.92 | Regime: BULL (margin 0.23)
    # Capital: $500 @ 25x | #A-0047

def notify_trade_close(trade: dict) -> None:
    # TP:  🔴 ALPHA CLOSED | AAVEUSDT | TP HIT ✅ | +$178.40 (+35.7%) | 14h 35m | #A-0047
    # SL:  🔴 ALPHA CLOSED | BNBUSDT  | SL HIT ❌ | −$57.30 (−11.5%)  | 2h 10m  | #A-0048
    # BE:  🟡 ALPHA CLOSED | SNXUSDT  | BE SL ↗   | +$0.00 (breakeven)| 5h 22m  | #A-0049

def notify_breakeven_activated(trade: dict) -> None:
    # ⚡ ALPHA BREAKEVEN | SNXUSDT | SL moved to entry $2.41 | Running: +$0 locked | #A-0049

def notify_cycle_summary(status: dict) -> None:
    # Sent every 4 hours (not every cycle — avoid Telegram spam)
    # ⚡ ALPHA CYCLE #143 | Active: 2 | AAVE: BULL ✓ | SNX: CHOP | COMP: BULL ✓ | BNB: BEAR ✓

def notify_error(msg: str) -> None:
    # ⚠️ ALPHA ERROR | <message>
```

**Rate limiting:** Cycle summary sent max once per 4 hours. Trade open/close sent immediately.
Never send more than 10 messages in any 60-second window (Telegram rate limit).

### Phase 2 Acceptance Criteria

```
[ ] python -c "from alpha.alpha_loop import run_once; result = run_once(); print(result['cycle'])"
    → 1  (no crash, cycle completes)

[ ] After run_once():
    alpha/data/state.json exists
    state.json contains: cycle, last_cycle_time, coin_states (4 entries)

[ ] After run_once() with a valid signal:
    alpha/data/tradebook.json contains at least 1 trade with status=ACTIVE

[ ] Paper fills include slippage:
    fill_entry("AAVEUSDT", "LONG", 100.0, 500.0)["filled_price"] != 100.0

[ ] No writes to data/ (root directory):
    ls data/tradebook.json → unchanged timestamp after run_once()

[ ] alpha/data/alpha.log exists and contains cycle log entries
```

### Phase 2 Audit Checks

**Execution routing:**
```
ALPHA_PAPER_MODE=true:
  alpha_loop → alpha_paper_broker.fill_entry()   ✓ simulated
                NEVER alpha_live_broker            ✗

ALPHA_PAPER_MODE=false:
  alpha_loop → alpha_live_broker.place_market_order()  ✓ real Bybit
               NEVER alpha_paper_broker                  ✗
```

**State file routing:**
```
alpha_loop writes → alpha/data/state.json       ✓
                    NEVER data/bot_state.json   ✗

alpha_tradebook writes → alpha/data/tradebook.json  ✓
                         NEVER data/tradebook.json  ✗
```

**HMM data routing:**
```
alpha_hmm trains on:
  → df_1h from alpha_data.get_data(symbol)["1h"]  ✓
  → sourced from Bybit cache ONLY                  ✓
  NEVER from Binance API                            ✗
  NEVER from feature_engine or data_pipeline        ✗
```

### What NOT to Do in Phase 2

- Do NOT start the engine loop in `alpha_loop.py` at module import time
  (it must be started explicitly by `alpha_api.py`)
- Do NOT share the `_hmm_models` dict with any other module via global import tricks
- Do NOT call `get_latest_price()` for exit checks — use the 15m close price from df
  (real-time price is only needed for entry fills; exit conditions are bar-level)
- Do NOT use `time.sleep(900)` — use wall-clock alignment to avoid drift

---

## Phase 3 — Flask API + Audit Layer

### Goal
Expose Alpha's state and trades via a Flask app on port 5001.
Add an audit layer that validates data routing at startup and periodically.

### Files to Build

#### 3.1 `alpha/alpha_api.py`
Flask app. Starts engine loop in background thread.

```python
# Pattern mirrors engine_api.py startup — but isolated on port 5001
app = Flask(__name__)
_ENGINE_INITIALIZED = False

@app.before_first_request
def _startup():
    global _ENGINE_INITIALIZED
    if not _ENGINE_INITIALIZED:
        _ENGINE_INITIALIZED = True
        threading.Thread(target=alpha_loop.run, daemon=True).start()

# Endpoints (all under /api/alpha/):
GET  /api/alpha/health
GET  /api/alpha/status
GET  /api/alpha/trades
GET  /api/alpha/trades/<trade_id>
POST /api/alpha/close         (requires X-Alpha-Key header)
POST /api/alpha/close-all     (requires X-Alpha-Key header)
GET  /api/alpha/logs          (requires X-Alpha-Key header)
POST /api/alpha/cycle/trigger (requires X-Alpha-Key header — manual cycle for testing)
```

**CORS:** Allow-all in dev (matches existing engine pattern). In production, restrict to Railway internal only.

**Response shape for /api/alpha/status:**
```json
{
  "ok": true,
  "cycle": 42,
  "last_cycle_time": "2026-03-23T10:15:05Z",
  "next_cycle_in_s": 485,
  "mode": "paper",
  "uptime_s": 38220,
  "coins": {
    "AAVEUSDT": {
      "regime": "BULL",
      "margin": 0.23,
      "passes_filter": true,
      "vol_zscore_last": 1.92,
      "signal": false,
      "open_trade": null,
      "hmm_last_trained": "2026-03-23T09:15:00Z"
    }
  },
  "summary": {
    "total_trades": 12,
    "active_trades": 2,
    "closed_trades": 10,
    "wins": 7,
    "losses": 3,
    "win_rate": 70.0,
    "total_realized_pnl": 142.50,
    "total_unrealized_pnl": 24.10,
    "total_fees_paid": 8.20,
    "profit_factor": 2.14
  }
}
```

#### 3.2 `alpha/alpha_audit.py`
Startup and periodic audit checks. Validates isolation and data routing are intact.

```python
def run_startup_audit() -> dict:
    """
    Called once at alpha_api.py startup. Checks:
    1. alpha/data/ exists and is writable
    2. data/ (root) tradebook.json is NOT touched by any alpha module
    3. No root-engine imports leaked into alpha (import inspection)
    4. Bybit cache has fresh data for all 4 coins (< 23h old)
    5. Port 5001 is not already in use
    Returns: {ok: bool, checks: [{name, passed, detail}]}
    """

def run_data_routing_check() -> dict:
    """
    Called every 12 hours. Verifies:
    1. alpha/data/tradebook.json is the only tradebook being written
    2. data/tradebook.json mtime has not changed since last check
    3. All 4 Bybit cache files still exist and are readable
    4. alpha/data/state.json is being updated (mtime < 20 minutes ago)
    Returns: {ok: bool, checks: [...], timestamp: ISO}
    Writes result to alpha/data/audit_log.json
    """

def check_import_isolation() -> dict:
    """
    Inspects all alpha/*.py files for forbidden imports.
    Forbidden: config, main, engine_api, tradebook, hmm_brain,
               execution_engine, risk_manager, feature_engine
    Returns: {ok: bool, violations: [{file, import, line}]}
    """
```

### Phase 3 Acceptance Criteria

```
[ ] curl http://localhost:5001/api/alpha/health
    → {"ok": true, "status": "running", ...}

[ ] curl http://localhost:5001/api/alpha/status
    → {"ok": true, "coins": {4 entries}, "summary": {...}}

[ ] curl http://localhost:5001/api/alpha/trades
    → {"ok": true, "trades": [...], "count": N}

[ ] curl -X POST http://localhost:5001/api/alpha/close \
         -H "X-Alpha-Key: wrong-key" \
         -d '{"trade_id": "A-0001"}'
    → 403 Forbidden

[ ] curl -X POST http://localhost:5001/api/alpha/close \
         -H "X-Alpha-Key: $ALPHA_INTERNAL_KEY" \
         -d '{"trade_id": "A-0001"}'
    → 200 {"ok": true} OR 404 if no such trade

[ ] alpha_audit.run_startup_audit()["ok"] == True
    → all checks pass, especially "tradebook isolation" check

[ ] alpha_audit.check_import_isolation()["violations"] == []
    → no forbidden imports found in any alpha/*.py file

[ ] After 1 hour of running:
    alpha_audit.run_data_routing_check()["ok"] == True
    data/tradebook.json mtime is unchanged
```

### Phase 3 Audit Checks

**API routing:**
```
Port 5001:  alpha_api.py Flask app
Port 3001:  engine_api.py Flask app  ← completely separate process
Port 8080:  NextJS SaaS

NextJS calls engine_api:
  /api/bots, /api/trades, /api/bot-state → PORT 3001  ✓

NextJS calls alpha_api:
  /api/alpha/* → PORT 5001  ✓

NEVER: NextJS calls /api/alpha/* on PORT 3001  ✗
NEVER: alpha_api adds routes to engine_api's Flask app  ✗
```

**Auth routing:**
```
Read endpoints (GET /api/alpha/*):  No auth required (Railway internal network)
Write endpoints (POST /api/alpha/close, /close-all, /cycle/trigger):
  X-Alpha-Key header required
  Validated against ALPHA_INTERNAL_KEY env var
  Returns 403 if missing or wrong
```

### What NOT to Do in Phase 3

- Do NOT register any `/api/alpha/*` routes in `engine_api.py`
- Do NOT start `alpha_loop.run()` from `engine_api.py`
- Do NOT use `engine_api.py`'s Flask `app` object — `alpha_api.py` has its own
- Do NOT skip the `_ENGINE_INITIALIZED` guard — prevents double-starting the loop
- Do NOT expose `/api/alpha/logs` without auth (contains trade data)

---

## Phase 4 — NextJS UI

### Goal
Add the `/alpha` page to the SaaS dashboard. The page shows live regime status, signals,
open trades, and trade history. All data comes from the Alpha engine API via proxy routes.

### Files to Build

#### 4.1 `sentinel-saas/nextjs_space/lib/alpha-url.ts`
```typescript
/**
 * Alpha engine URL resolver.
 * ENGINE_ALPHA_URL → Alpha engine (port 5001)
 * Completely separate from ENGINE_API_URL and ENGINE_API_URL_PAPER.
 */
const ALPHA_URL = process.env.ENGINE_ALPHA_URL || '';

export function getAlphaEngineUrl(): string {
    if (!ALPHA_URL) throw new Error('ENGINE_ALPHA_URL not configured');
    return ALPHA_URL;
}
```

#### 4.2 `sentinel-saas/nextjs_space/app/api/alpha/status/route.ts`
Proxy: `GET /api/alpha/status → ENGINE_ALPHA_URL/api/alpha/status`

#### 4.3 `sentinel-saas/nextjs_space/app/api/alpha/trades/route.ts`
Proxy: `GET /api/alpha/trades → ENGINE_ALPHA_URL/api/alpha/trades`

#### 4.4 `sentinel-saas/nextjs_space/app/api/alpha/close/route.ts`
Proxy: `POST /api/alpha/close → ENGINE_ALPHA_URL/api/alpha/close`
Adds `X-Alpha-Key` header from env var `ALPHA_INTERNAL_KEY`.

#### 4.5 `sentinel-saas/nextjs_space/app/alpha/page.tsx`
Server component. Auth guard + initial data fetch.

```tsx
export default async function AlphaPage() {
    const session = await getServerSession();
    if (!session) redirect('/login');

    const status = await fetch(`${getAlphaEngineUrl()}/api/alpha/status`);
    const trades = await fetch(`${getAlphaEngineUrl()}/api/alpha/trades?limit=50`);
    return <AlphaClient initialStatus={...} initialTrades={...} />;
}
```

#### 4.6 `sentinel-saas/nextjs_space/app/alpha/alpha-client.tsx`
Client component. Polls every 15 seconds.

**Components:**
- `AlphaHeader` — strategy name, mode badge (PAPER/LIVE), cycle number, time to next cycle
- `AlphaStats` — 4 cards: Total PnL | Win Rate | Active Trades | Fees Paid
- `AlphaQuadGrid` — 2×2 grid, one card per coin
- `AlphaCoinCard` — regime, margin, vol_zscore, signal status, open trade PnL if active
- `AlphaTradeTable` — sortable history table (symbol, side, entry, exit, PnL, reason, duration)

**Colour coding:**
- BULL regime → green border/badge
- BEAR regime → red border/badge
- CHOP / margin below threshold → grey (no trade)
- PROFIT → green PnL
- LOSS → red PnL

#### 4.7 Add Alpha nav link
In `sentinel-saas/nextjs_space/components/Header.tsx` (or equivalent nav file):
```tsx
<Link href="/alpha">Alpha</Link>
```
Place after the existing nav items. Do not reorder or remove existing items.

### Phase 4 Acceptance Criteria

```
[ ] http://localhost:8080/alpha loads without error

[ ] Page shows 4 coin cards, each with regime/margin data

[ ] Page auto-refreshes every 15 seconds (verify via network tab)

[ ] /api/alpha/status (NextJS proxy) returns same data as
    http://localhost:5001/api/alpha/status (direct Alpha API)

[ ] /api/alpha/close with wrong key → 403 from NextJS proxy

[ ] Alpha nav link appears in header and is clickable

[ ] No fetch calls from /alpha page to ENGINE_API_URL or ENGINE_API_URL_PAPER:
    Check network tab — all alpha API calls go to /api/alpha/* (NextJS proxy)
    which proxies to ENGINE_ALPHA_URL, never to ENGINE_API_URL
```

### Phase 4 Audit Checks

**UI data routing:**
```
/alpha page:
  fetches → /api/alpha/status   (NextJS proxy route)    ✓
  fetches → /api/alpha/trades   (NextJS proxy route)    ✓
  NEVER fetches → /api/bot-state                        ✗
  NEVER fetches → /api/trades   (main engine trades)    ✗

/api/alpha/* proxy routes:
  forward to → ENGINE_ALPHA_URL (Alpha engine, port 5001)  ✓
  NEVER forward to → ENGINE_API_URL (main engine)           ✗
```

**State isolation:**
```
Alpha trade data:  displayed on /alpha ONLY
Main trade data:   displayed on /trades ONLY
No crossover.
```

### What NOT to Do in Phase 4

- Do NOT fetch from `getEngineUrl()` on the `/alpha` page — use `getAlphaEngineUrl()`
- Do NOT add Alpha trade data to the main `/trades` page
- Do NOT add Alpha routes to `engine-url.ts` — use the dedicated `alpha-url.ts`
- Do NOT show Alpha positions on the main `/dashboard` page's trade list

---

## Phase 5 — Railway Deployment

### Goal
Deploy Alpha as a third Railway service. Connect to the existing NextJS service via internal network.

### Files to Build

#### 5.1 `alpha/requirements.alpha.txt`
```
flask>=3.0.0
hmmlearn>=0.3.0
pandas>=2.0.0
numpy>=1.24.0
requests>=2.31.0
python-dotenv>=1.0.0
pyarrow>=14.0.0
scikit-learn>=1.3.0
```

Note: This is a subset of `requirements.txt`. Does NOT include:
`python-binance`, `google-genai`, `praw`, `vaderSentiment`, `plotly` — none needed by Alpha.

#### 5.2 `alpha/Dockerfile.alpha`
```dockerfile
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ && rm -rf /var/lib/apt/lists/*

COPY alpha/requirements.alpha.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy ONLY what Alpha needs — intentional isolation
COPY alpha/ ./alpha/
COPY tools/ ./tools/
COPY data_cache/ ./data_cache/

# Create runtime state directory
RUN mkdir -p /app/alpha/data

ENV PORT=5001
ENV PYTHONUNBUFFERED=1
EXPOSE 5001

CMD ["python", "alpha/alpha_api.py"]
```

**What is NOT copied (isolation enforced at container level):**
- `config.py` ✗
- `main.py` ✗
- `engine_api.py` ✗
- `tradebook.py` ✗
- `hmm_brain.py` ✗
- `execution_engine.py` ✗
- `risk_manager.py` ✗
- `feature_engine.py` ✗
- `segment_features.py` ✗
- `sentinel-saas/` ✗

#### 5.3 `alpha/railway.alpha.toml`
```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "alpha/Dockerfile.alpha"

[deploy]
startCommand = "python alpha/alpha_api.py"
healthcheckPath = "/api/alpha/health"
healthcheckTimeout = 600
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 3
```

### Railway Setup Steps (manual — done by you in the dashboard)

```
Step 1 — Create Alpha service
  Railway dashboard → Project: Synaptic
  + New Service → GitHub Repo (same repo)
  Name: "alpha-engine"
  Build → Dockerfile path: alpha/Dockerfile.alpha
  Build → Watch paths: alpha/**

Step 2 — Alpha service env vars
  ALPHA_PAPER_MODE=true
  ALPHA_PORT=5001
  ALPHA_INTERNAL_KEY=<openssl rand -hex 32>
  ALPHA_TELEGRAM_BOT_TOKEN=          (optional, leave blank)
  ALPHA_TELEGRAM_CHAT_ID=            (optional, leave blank)
  ALPHA_BYBIT_API_KEY=               (leave blank for paper mode)
  ALPHA_BYBIT_API_SECRET=            (leave blank for paper mode)

Step 3 — NextJS service env var (add ONE new var)
  ENGINE_ALPHA_URL=https://alpha-engine.railway.internal:5001

Step 4 — Push code
  git push → Railway builds alpha/Dockerfile.alpha automatically

Step 5 — Verify
  curl https://alpha-engine.railway.internal:5001/api/alpha/health
  (or from Railway logs: look for "Alpha engine started")
```

### Phase 5 Acceptance Criteria

```
[ ] docker build -f alpha/Dockerfile.alpha . succeeds locally

[ ] docker run -p 5001:5001 -e ALPHA_PAPER_MODE=true <image>
    → curl http://localhost:5001/api/alpha/health returns {"ok": true}

[ ] Railway alpha-engine service health check passes (green in Railway dashboard)

[ ] Railway logs show: "Alpha engine started" + "Cycle 1 complete"

[ ] From NextJS service: fetch to ENGINE_ALPHA_URL/api/alpha/health succeeds
    (Railway internal network connectivity confirmed)

[ ] Main engine service (port 3001) is unaffected — its health check still passes

[ ] /alpha page on production NextJS URL shows live data from Alpha engine
```

### Phase 5 Audit Checks

**Deployment isolation:**
```
Alpha Railway service:
  Image contains: alpha/, tools/, data_cache/          ✓
  Image DOES NOT contain: config.py, main.py, etc.     ✓
  Port: 5001                                           ✓
  Start command: python alpha/alpha_api.py             ✓

Main engine Railway service:
  Unchanged — same Dockerfile.engine, same port 3001   ✓
  No reference to alpha/ in its build                  ✓
```

**Network routing (Railway internal):**
```
NextJS → ENGINE_API_URL       → main engine (3001)   ✓
NextJS → ENGINE_ALPHA_URL     → alpha engine (5001)  ✓

Alpha engine → Bybit REST API (external)              ✓
Alpha engine → Binance API (external)                 ✗ Never calls Binance
Alpha engine → Main engine API (3001)                 ✗ Never calls
```

### What NOT to Do in Phase 5

- Do NOT merge Alpha's `requirements.alpha.txt` into the root `requirements.txt`
  (it would inflate the main engine's Docker image with unnecessary deps)
- Do NOT add Alpha to the main engine's `Dockerfile.engine`
- Do NOT use `COPY *.py` in `Dockerfile.alpha` (would copy config.py, etc.)
- Do NOT set `ALPHA_BYBIT_API_KEY` until Phase 6 go-live decision

---

## Phase 6 — Paper Trading Validation

### Goal
Run Alpha in paper mode for 2–4 weeks of real market time. Compare live signal quality
against backtest expectations. Sign off before switching to live capital.

### Validation Checklist (track weekly)

#### Week 1
```
[ ] Engine runs 24/7 without crashes (check Railway uptime)
[ ] All 4 coins producing regime signals (no coin stuck in CHOP permanently)
[ ] Entry signals firing at expected frequency (~6–8/coin/week)
[ ] Tradebook updating correctly (entries, unrealized PnL, BE triggers)
[ ] Telegram notifications firing (if enabled)
[ ] /alpha page showing live data
[ ] No writes to data/tradebook.json (audit check)
```

#### Week 2–3
```
[ ] Compare trade frequency to backtest (~80 trades/month for 4 coins)
    Tolerance: ±40% (live markets differ from backtest period)

[ ] Compare win rate to backtest (expect 40–45%)
    Red flag: < 30% over 20+ trades → investigate signal quality

[ ] Compare exit reason distribution to backtest:
    Expected: DIR_FLIP ~82%, SL ~15%, TP ~3%
    Red flag: SL% > 30% → SL too tight, regime changes too fast

[ ] Slippage check:
    Compare filled_price to signal_price for last 20 entries
    Acceptable: ≤ 0.15% average slippage
    Red flag: > 0.3% → Bybit liquidity issue for these coins

[ ] BE trigger firing correctly:
    At least some closed trades should show be_activated=True + exit_reason=BE_SL
```

#### Week 4 — Sign-off Decision
```
[ ] 30+ paper trades completed
[ ] Win rate ≥ 35% (lower bound — below backtest but acceptable in live)
[ ] Profit factor ≥ 1.10 (after paper slippage)
[ ] No engine crashes in 7 days
[ ] Audit checks all passing

SIGN-OFF: If all above pass → proceed to live flip
HOLD: If any fail → investigate before going live
```

### Going Live (after sign-off)

```
Step 1 — Create Bybit sub-account (recommended)
  Bybit → Account → Sub-accounts → Create "Alpha Trading"
  Fund with $2,000–$2,500 USDT
  Enable futures trading

Step 2 — Generate Bybit API key
  Bybit → API Management → Create Key
  Permissions: READ + TRADE (no withdrawal)
  IP whitelist: Railway Alpha service IP (optional but recommended)

Step 3 — Update Railway Alpha service env vars
  ALPHA_BYBIT_API_KEY=<your key>
  ALPHA_BYBIT_API_SECRET=<your secret>
  ALPHA_PAPER_MODE=false

Step 4 — Railway auto-restarts Alpha service

Step 5 — Verify first live trade
  Check Bybit sub-account for open position
  Check /alpha page shows ACTIVE trade with mode="live"
  Check alpha/data/tradebook.json trade has mode="live"
```

### Ongoing Monitoring

**Daily:** Check /alpha page for open positions, unrealized PnL
**Weekly:** Review closed trades — win rate, profit factor, max drawdown trend
**Monthly:** Compare to backtest expectations; consider parameter re-evaluation if large deviation

**Kill conditions (when to stop Alpha immediately):**
1. Drawdown > $600 (30% of $2,000 capital) in any rolling 30-day window
2. Win rate < 25% over 30 consecutive trades
3. Engine crashes > 3 times in 24 hours
4. Bybit API errors on more than 10% of order placements

---

## Summary: Phase Completion Checklist

```
[ ] Phase 0 — Docs and structure          COMPLETE (2026-03-23)
[ ] Phase 1 — Core Python engine           PENDING
[ ] Phase 2 — Paper broker + loop          PENDING
[ ] Phase 3 — Flask API + audit layer      PENDING
[ ] Phase 4 — NextJS UI                    PENDING
[ ] Phase 5 — Railway deployment           PENDING
[ ] Phase 6 — Paper validation + live flip PENDING
```

---

## Appendix: Environment Variables Reference

### Alpha Engine Service (Railway)
| Variable | Required | Phase | Description |
|----------|----------|-------|-------------|
| `ALPHA_PAPER_MODE` | No | P5 | `true`=paper, `false`=live. Default: `true` |
| `ALPHA_PORT` | No | P5 | Default: `5001` |
| `ALPHA_INTERNAL_KEY` | **Yes** | P5 | Secure random 32-byte hex. Guards write endpoints. Run: `openssl rand -hex 32` |
| `ALPHA_BYBIT_API_KEY` | P6 only | P6 | Bybit read+trade API key (sub-account recommended). Leave blank for paper. |
| `ALPHA_BYBIT_API_SECRET` | P6 only | P6 | Bybit API secret |
| `ALPHA_TELEGRAM_BOT_TOKEN` | **Yes** | P5 | **MUST be a dedicated Alpha bot** — create at t.me/BotFather. Do NOT reuse main engine's token. |
| `ALPHA_TELEGRAM_CHAT_ID` | **Yes** | P5 | Your Telegram user/group chat ID |

**Exchange decision: Bybit is locked in for Alpha.**
- Binance is not used by Alpha for any purpose (data or execution)
- Bybit is validated across R13 (30/30 profitable configs)
- Bybit is completely separate from the main engine (which uses CoinDCX/Binance)
- Data cache is already populated from Bybit (data_cache/bybit_*.parquet)

**Telegram bot setup (Alpha-specific):**
1. Message @BotFather on Telegram → /newbot → name it "Alpha Synaptic" (or similar)
2. Copy the token → set as ALPHA_TELEGRAM_BOT_TOKEN
3. Send a message to the bot → get your chat ID from https://api.telegram.org/bot<TOKEN>/getUpdates
4. This bot is completely separate from the main engine's TELEGRAM_BOT_TOKEN

### NextJS Service (add 1 new var)
| Variable | Required | Phase | Description |
|----------|----------|-------|-------------|
| `ENGINE_ALPHA_URL` | **Yes** | P5 | `https://alpha-engine.railway.internal:5001` |

---

## Appendix: Quick Data Flow Diagram

```
Bybit REST API
    ↓ (OHLCV)
data_cache/*.parquet  (Bybit parquet files, written by data_cache.py)
    ↓ (read-only via load_all_tf)
alpha_data.get_data()
    ↓ (enriched DataFrames with features)
alpha_hmm.predict()      alpha_signals.check_entry()
    ↓ (regime, margin)       ↓ (signal, side)
         ↓──────────────────↓
         alpha_loop (15m cycle)
              ↓ (trade decision)
         alpha_paper_broker.fill_entry()   OR   alpha_live_broker.place_order()
              ↓ (filled price, quantity)
         alpha_tradebook.open_trade()
              → alpha/data/tradebook.json  (Alpha ONLY — never data/tradebook.json)
              → alpha/data/state.json
              → alpha/data/alpha.log
              ↓
         alpha_api.py (Flask, port 5001)
              ↓ (JSON responses)
         NextJS /api/alpha/* proxy routes
              ↓
         /alpha page (browser)
```

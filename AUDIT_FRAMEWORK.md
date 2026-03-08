# HMMBOT Master Daily Audit Framework

> **Purpose**: Comprehensive daily health check covering every layer of the system — Python engine, SaaS platform, and cross-system integration. Runs at 04:00 UTC. Outputs PASS / WARN / FAIL per check. Sends Telegram alert on any FAIL.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Daily Audit Pipeline                      │
│                    04:00 UTC (Railway Cron)                  │
│                                                              │
│   tools/daily_audit.py          POST /api/admin/audit        │
│   (Python Engine: P1–P12)       (SaaS: S1–S13 + I1–I6)      │
│            │                            │                    │
│            └──────────── merge ─────────┘                    │
│                            │                                 │
│                  tools/audit_runner.sh                       │
│                            │                                 │
│           ┌────────────────┼─────────────────┐              │
│        Railway          DB: AuditReport    Telegram          │
│         Logs           (history store)   (FAIL only)         │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Files

```
HMMBOT/
├── tools/
│   ├── daily_audit.py          ← Python engine checks (P1–P12, I4, I7–I10)
│   └── audit_runner.sh         ← Orchestrator: runs both sides, merges, Telegram
│
└── sentinel-saas/nextjs_space/
    └── app/api/admin/
        └── audit/
            └── route.ts        ← SaaS + integration checks (S1–S13, I1–I6)
```

---

## Output Format

```
═══════════════════════════════════════════════════════════════
  HMMBOT MASTER AUDIT REPORT — 2026-03-08 04:00 UTC
═══════════════════════════════════════════════════════════════

  SECTION P — Python Engine
  ✅ P1  Config Integrity         8/8 checks
  ✅ P2  HMM Model Integrity      3 states · 6 features · transitions valid
  ⚠️  P3  Tradebook Integrity     1 trade missing bot_id [T-abc123]
  ❌ P4  Exchange Sync            1 ghost: BTCUSDT in tradebook, not on CoinDCX
  ✅ P5  bot_id Stamping          All 5 trades stamped ✓
  ✅ P6  Mode Consistency         PAPER=true · engine_mode.json=paper ✓
  ✅ P7  API Health               4/4 endpoints OK (avg 210ms)
  ✅ P8  Data Pipeline            BTC klines OK · HMM→CHOP
  ⚠️  P9  Coin Tiers             scanner_state.json missing
  ✅ P10 Risk Manager             Weights=100 · leverage bands OK
  ✅ P11 Process Health           Alive · heartbeat 28s ago · 1,247 cycles
  ⚠️  P12 Log Quality            3 ERRORs in last 500 lines

  SECTION S — SaaS Platform
  ✅ S1  DB Integrity             0 orphans · all tables present
  ✅ S2  User Isolation           0 leaks · 0 null botIds
  ⚠️  S3  Bot State Consistency  1 bot isActive=true, engine unreachable
  ✅ S4  Session Lifecycle        All sessions valid
  ❌ S5  Auth Coverage           /api/admin/engine/health — no auth check
  ✅ S6  Engine URL Routing       Both engines configured and responding
  ⚠️  S7  Trade Sync Layer       12 trades uppercase mode='PAPER' (case drift)
  ✅ S8  PnL Calculations         10/10 sampled trades correct
  ❌ S9  Mode Case Consistency   Mixed: 34 lowercase · 12 uppercase in DB
  ❌ S10 Admin Route Security    /api/admin/engine/health missing role check
  ✅ S11 API Response Shape       All 5 critical routes correct
  ✅ S12 Dependency Hygiene       0 PrismaClient leaks · 0 env var leaks
  ✅ S13 Subscription Enforcement Tier limits applied correctly

  SECTION I — Integration
  ❌ I1  Live Close Loop         ETHUSDT: tradebook CLOSED, CoinDCX OPEN
  ✅ I2  bot_id Cross-System     ENGINE_BOT_ID matches DB ✓
  ✅ I3  Mode Cross-System       Engine=paper · DB=paper · routing=paper ✓
  ⚠️  I4  Trade Count Match      Engine: 5 open · DB: 4 active (sync lag)
  ✅ I5  Balance Accuracy        CoinDCX diff: $0.23 ✓
  ✅ I6  Timestamp Consistency   All UTC ISO 8601 ✓
  ✅ I7  Leverage Bounds         All in {10, 15, 25, 35}
  ✅ I8  Coin Tier Compliance    0 Tier C coins in active trades
  ⚠️  I9  SL/TP Validity        PEPEUSDT: current_price past SL (not closed yet)
  ✅ I10 HMM Signal Quality      Avg conf 0.52 · no degenerate states

  ─────────────────────────────────────────────────────────────
  SUMMARY   ✅ PASS: 22   ⚠️  WARN: 7   ❌ FAIL: 4
  CRITICAL FAILS:
    P4  — Ghost position (live close loop re-registered)
    S5/S10 — Admin routes missing authentication
    S9  — Mode case inconsistency (breaks closeBotSession)
    I1  — ETHUSDT exchange position not closed
  Telegram alert: SENT → CHAT_ID
═══════════════════════════════════════════════════════════════
```

---

## SECTION P — Python Engine (12 Checks)

### P1 · Config Integrity

**File**: `config.py`
**What it checks**:
- All required env vars present: `BINANCE_API_KEY`, `BINANCE_API_SECRET`, `COINDCX_API_KEY`, `COINDCX_API_SECRET`, `ENGINE_BOT_ID`, `ENGINE_BOT_NAME`
- `PAPER_TRADE` is parseable (`"true"` or `"false"`)
- `HMM_N_STATES == 3` (not 4 — CRASH state removed)
- `HMM_FEATURES` is exactly `["log_return", "volatility", "volume_change", "rsi_norm", "funding_proxy", "adx"]`
- `DATA_DIR` exists on disk
- `COIN_TIER_FILE` (`data/coin_tiers.csv`) exists
- No debug `print()` statements present in `config.py`

**Pass criteria**: All 8 sub-checks green
**Severity if failed**: CRITICAL

---

### P2 · HMM Model Integrity

**File**: `hmm_brain.py`, model pickle file
**What it checks**:
- Model file loadable without exception
- `model.n_components == 3`
- `model.n_features_in_ == 6`
- Each row of `model.transmat_` sums to `1.0 ± 0.001`
- Emission means within sane ranges (no NaN, no ±Inf)
- State labels map to exactly `{BULL, CHOP, BEAR}`
- `HMM_CONF_TIER` thresholds present: `HIGH=0.60`, `MED_HIGH=0.40`, `MED=0.25`, `LOW=0.10`

**Pass criteria**: Model loads, all structural checks valid
**Severity if failed**: CRITICAL — bot cannot trade

---

### P3 · Tradebook Integrity

**File**: `tradebook.py`, `data/tradebook.json`
**What it checks**:
- `tradebook.json` is valid JSON and parseable
- No duplicate `trade_id` values
- All open trades have required fields: `trade_id`, `symbol`, `side`, `entry_price`, `leverage`, `sl`, `tp`, `mode`, `bot_id`, `bot_name`, `entry_time`
- SL/TP logic: BUY → `tp > entry_price > sl`; SELL → `sl > entry_price > tp`
- No trade open longer than 72 hours (stuck position)
- Closed trades: `exit_price > 0` and `exit_time >= entry_time`
- Open trade PnL sanity: `|unrealized_pnl| < capital × leverage` (impossible to lose more than position)

**Pass criteria**: 0 violations across all trades
**Severity if failed**: HIGH

---

### P4 · Exchange Position Sync *(LIVE mode only)*

**Files**: `coindcx_client.py`, `tradebook.py`, `main.py` (`_sync_coindcx_positions`)
**What it checks**:
- For each open LIVE trade in tradebook → CoinDCX position exists with matching symbol
- For each open CoinDCX position → tradebook entry exists (no orphaned exchange positions)
- Quantity match: `|tradebook_qty - exchange_qty| / exchange_qty < 5%`
- Side match: BUY ↔ long, SELL ↔ short
- Leverage match: within 2x tolerance

**Pass criteria**: 0 ghost positions, 0 orphaned exchange positions
**Severity if failed**: CRITICAL — capital locked on exchange with no bot tracking it

---

### P5 · bot_id Stamping

**Files**: `tradebook.py`, `engine_api.py`, Railway env vars
**What it checks**:
- `ENGINE_BOT_ID` env var is set (non-empty)
- `ENGINE_BOT_NAME` env var is set (non-empty)
- 100% of tradebook trades have `bot_id == ENGINE_BOT_ID`
- 100% of tradebook trades have `bot_name == ENGINE_BOT_NAME`
- No trade with `bot_id = null` or `bot_id = ""`

**Pass criteria**: 0 unstamped trades
**Severity if failed**: HIGH — data isolation breaks, trades attributed to wrong user

---

### P6 · Mode Consistency

**Files**: `config.py`, `data/engine_mode.json`, `tradebook.json`
**What it checks**:
- `config.PAPER_TRADE` current value
- `data/engine_mode.json` current `mode` field
- Both agree (`PAPER_TRADE=True` ↔ `mode="paper"`)
- All open tradebook trades match current mode
- If `PAPER_TRADE=False`: `EXCHANGE_LIVE` env var must be set to `"coindcx"` or `"binance"`
- No mixed-mode trades (paper and live trades open simultaneously)

**Pass criteria**: 3-way agreement, no mixed mode
**Severity if failed**: CRITICAL — live orders placed in wrong mode

---

### P7 · API Health

**File**: `engine_api.py` (Flask, port 3001)
**What it checks**:
- `GET /api/health` → 200 OK, response time < 5s
- `GET /api/all` → 200 OK, response has `tradebook`, `multi_bot_state`, `engine_state` keys
- `GET /api/logs` → 200 OK, returns array of log strings
- `GET /api/validate-exchange` → 200 OK (or auth error, not 500)
- Average response time across all endpoints < 2s

**Pass criteria**: 4/4 endpoints healthy
**Severity if failed**: HIGH — SaaS cannot sync trades or control bot

---

### P8 · Data Pipeline

**Files**: `data_pipeline.py`, `feature_engine.py`, `hmm_brain.py`
**What it checks**:
- CoinDCX OHLCV fetch for BTCUSDT: ≥100 candles returned, `close` column has no NaN
- Binance fallback fetch for BTCUSDT: same checks
- `compute_hmm_features(df)` produces all 6 features in output DataFrame
- No NaN values in last 20 rows of any feature column
- `HMMBrain.predict(features)` returns one of `{0, 1, 2}` (BULL/CHOP/BEAR)
- End-to-end latency < 30s for single coin

**Pass criteria**: Full pipeline executes without error
**Severity if failed**: CRITICAL — bot cannot classify regimes, no trades placed

---

### P9 · Coin Tier Integrity

**Files**: `data/coin_tiers.csv`, `coin_scanner.py`, `tools/weekly_reclassify.py`
**What it checks**:
- `data/coin_tiers.csv` exists and is valid CSV
- Has required columns: `symbol`, `tier`, `pattern`
- Tier A count ≥ 5 (enough tradeable coins)
- Tier C coins: none are currently in active tradebook positions
- `data/scanner_state.json` parseable (if it exists)
- `weekly_reclassify` last ran < 8 days ago (stale tier detection)

**Pass criteria**: All structural checks pass, no Tier C trades
**Severity if failed**: MEDIUM

---

### P10 · Risk Manager Integrity

**File**: `risk_manager.py`
**What it checks**:
- Conviction score weights sum to exactly 100:
  `HMM(44) + BTC_macro(7) + Funding(11) + SR_VWAP(2) + OI(11) + Vol(0) + Sentiment(15) + OrderFlow(10) = 100`
- Leverage bands are monotonically increasing: `score<40→0x, 40-54→10x, 55-69→15x, 70-84→25x, 85+→35x`
- Kill switch state: if triggered, no new trades opened in last full cycle
- Total open positions ≤ `config.MAX_POSITIONS`
- No single position exceeds `config.MAX_CAPITAL_PER_TRADE`

**Pass criteria**: Weights = 100, 0 violations
**Severity if failed**: HIGH — incorrect position sizing or kill switch ignored

---

### P11 · Process Health

**Files**: `main.py`, `bot.log`, Railway process
**What it checks**:
- Bot process is alive (PID file or Railway process check)
- Last heartbeat timestamp: `now - last_heartbeat < 120s`
- Cycle count > 0 and increasing
- No log silence: at least 1 log line in last 10 minutes
- Error rate: ERROR lines / total lines in last 10 min < 5%

**Pass criteria**: Alive + healthy log rate
**Severity if failed**: CRITICAL — bot has crashed or frozen

---

### P12 · Log Quality

**File**: `bot.log` (last 500 lines)
**What it checks**:
- Total ERROR lines: threshold < 10
- Detect critical patterns: `"CRASH"`, `"Traceback"`, `"kill switch triggered"`, `"Forced CLOSE"`
- Detect repeated error: same error message appearing > 5× in last 100 lines (stuck loop)
- Detect log storm: > 200 lines in last 5 minutes (runaway logging)
- Detect frozen bot: 0 lines in last 10 minutes

**Pass criteria**: ERROR < 10, no critical patterns, no loops, no silence
**Severity if failed**: HIGH

---

## SECTION S — SaaS Next.js (13 Checks)

### S1 · Database Integrity

**File**: `lib/prisma.ts`, Prisma schema
**What it checks**:
- Prisma connects without error
- All required tables exist: `User`, `Bot`, `Trade`, `BotSession`, `ExchangeApiKey`, `Subscription`
- 0 `Trade` records with `userId = null` (via bot chain)
- 0 `Bot` records with `userId = null`
- 0 `BotSession` records with `botId` pointing to non-existent bot

**Pass criteria**: 0 orphans, all tables present
**Severity if failed**: CRITICAL

---

### S2 · User Data Isolation

**File**: `lib/sync-engine-trades.ts`, `app/api/trades/route.ts`
**What it checks**:
- No `Trade.botId` links to a bot owned by a different user
- 0 trades with `botId = null` in DB (post-D3 fix)
- `getUserTrades(userA)` returns 0 trades from userB's bots
- Cross-user leakage test: select 5 trade IDs from userA → verify userB `GET /api/trades` returns none of those IDs
- No raw engine trades accessible to non-admin users

**Pass criteria**: 0 leaks, 0 null botIds
**Severity if failed**: CRITICAL — financial data privacy breach

---

### S3 · Bot State Consistency

**File**: `app/api/bots/toggle/route.ts`, Prisma `Bot` model
**What it checks**:
- `isActive=true` bots: have `startedAt`, do NOT have `stoppedAt`
- `isActive=false` bots: have `stoppedAt`, and `stoppedAt > startedAt`
- `isActive=true` bots: engine `/api/health` is reachable
- No bot with both `isActive=true` AND `stoppedAt` set simultaneously
- No bot with `startedAt` in the future (clock skew / data corruption)

**Pass criteria**: 0 contradictions
**Severity if failed**: HIGH

---

### S4 · BotSession Lifecycle

**File**: `lib/bot-session.ts`
**What it checks**:
- All `status='active'` sessions: `endedAt = null`
- All `status='closed'` sessions: `endedAt` is set and `endedAt > startedAt`
- No session with `endedAt < startedAt` (time reversal — data corruption)
- Active session count matches active bot count (1:1)
- No `BotSession` records for bots that no longer exist

**Pass criteria**: 0 invalid sessions
**Severity if failed**: MEDIUM

---

### S5 · Authentication Coverage *(static analysis)*

**Files**: All `app/api/**/route.ts`
**What it checks**:
- Every exported HTTP handler (`GET`, `POST`, `DELETE`, `PUT`) calls `getServerSession(authOptions)` before any business logic
- All routes under `app/api/admin/**` additionally check `role === 'admin'`
- Specifically verify (known issues):
  - `app/api/admin/engine/health/route.ts` — has auth?
  - `app/api/admin/engine/route.ts` — has role check?
  - `app/api/debug/route.ts` — has auth?
  - `app/api/coindcx/prices/route.ts` — intentionally public (no auth needed, no private data)

**Pass criteria**: 0 unprotected routes (excluding intentionally public routes)
**Severity if failed**: HIGH — unauthorized access to admin/user data

---

### S6 · Engine URL Routing

**File**: `lib/engine-url.ts`
**What it checks**:
- `ENGINE_API_URL` env var set (live engine URL)
- `getEngineUrl('live')` returns non-null value
- `getEngineUrl('paper')` returns a value (may fall back to live URL if `ENGINE_API_URL_PAPER` not set)
- Both URLs respond to `/api/health` within 5s
- Static scan: `grep -r "process.env.ENGINE_API_URL"` outside `lib/engine-url.ts` = 0 results
- Static scan: `grep -r "process.env.ENGINE_API_URL_PAPER"` outside `lib/engine-url.ts` = 0 results

**Pass criteria**: All routing resolves, 0 direct env var leaks
**Severity if failed**: HIGH — trades synced to wrong engine

---

### S7 · Trade Sync Layer

**File**: `lib/sync-engine-trades.ts`
**What it checks**:
- 0 DB trades with `entryTime` in the future
- 0 DB trades with `exitTime < entryTime` (impossible timeline)
- 0 duplicate `trade_id` values across all DB trades
- No active DB trade whose engine counterpart shows `status: 'closed'` (stale record)
- `syncEngineTrades` idempotent: running twice does not create duplicate records (upsert check)

**Pass criteria**: 0 stale or corrupted records
**Severity if failed**: HIGH

---

### S8 · PnL Calculation Accuracy

**File**: `app/api/trades/route.ts`, `lib/bot-session.ts`
**What it checks**:
- Sample 10 closed trades with known `entryPrice`, `exitPrice`, `leverage`, `capital`
- LONG formula: `pnl = (exit - entry) / entry × leverage × capital`
- SHORT formula: `pnl = (entry - exit) / entry × leverage × capital`
- Tolerance: `|calculated - stored| < 0.1%`
- 0 trades with `capital ≤ 0`
- 0 trades with `leverage > 35` or `leverage < 1`
- 0 trades with `totalPnl > capital × leverage` (mathematically impossible without liquidation)

**Pass criteria**: All 10 sampled trades correct within tolerance
**Severity if failed**: HIGH — P&L reporting inaccurate

---

### S9 · Mode Case Consistency

**Files**: `lib/sync-engine-trades.ts`, `lib/bot-session.ts`, `app/api/trades/route.ts`
**What it checks**:
- Engine writes mode as uppercase: `"PAPER"` / `"LIVE"`
- Prisma `Trade.mode` field: check distribution of all stored values
- Flag if both lowercase (`paper`/`live`) and uppercase (`PAPER`/`LIVE`) exist in DB
- `closeBotSession` queries `where: { mode: 'paper' }` — verify this returns correct records
- `exit-all/route.ts` condition `trade.mode === 'live'` — flag if uppercase trades would be missed

**Pass criteria**: Mode values are case-uniform across all records
**Severity if failed**: CRITICAL — `closeBotSession` silently fails to close paper trades on bot stop

---

### S10 · Admin Route Security

**Files**: All `app/api/admin/**`
**What it checks**:
- Every admin route verifies `(session.user as any).role === 'admin'` before returning data
- Specifically check: `admin/engine/health`, `admin/engine`, `admin/backfill-bot`, `admin/cleanup-trades`, `admin/stats`, `admin/users`, `admin/bots`
- No admin route returns data if user is authenticated but not admin (403 vs 401 distinction)
- `app/api/debug/route.ts` — has auth check

**Pass criteria**: 0 admin routes accessible to non-admin authenticated users
**Severity if failed**: HIGH

---

### S11 · API Response Shape

**Files**: All major API routes
**What it checks**:
- `GET /api/bot-state` → has `isActive`, `regime`, `trades`, `engineState` keys
- `GET /api/trades` → has `trades: []`, `pagination: { page, limit, total, totalPages }` keys
- `GET /api/wallet-balance` → has `binance: number`, `coindcx: number` keys
- `GET /api/bots` → returns array with each bot having `id`, `name`, `status`, `isActive`, `mode`
- `GET /api/sessions` → returns sessions with `startedAt`, `endedAt`, `totalPnl`, `winRate`
- No route returns raw Prisma model fields that expose internal IDs or sensitive data unexpectedly

**Pass criteria**: All 5+ critical routes return expected shapes
**Severity if failed**: MEDIUM — UI breaks silently

---

### S12 · Dependency Hygiene *(static analysis)*

**Files**: All TypeScript files
**What it checks**:
- `grep -r "new PrismaClient()"` → 0 results outside `lib/prisma.ts` and `prisma/seed.ts`
- `grep -r "process.env.ENGINE_API_URL"` → 0 results outside `lib/engine-url.ts`
- `grep -r "process.env.ENGINE_API_URL_PAPER"` → 0 results outside `lib/engine-url.ts`
- No `import { PrismaClient } from '@prisma/client'` outside singleton file

**Pass criteria**: All counts = 0
**Severity if failed**: HIGH — connection pool exhaustion or wrong engine targeted

---

### S13 · Subscription & Tier Enforcement

**File**: `lib/subscription.ts`, `lib/subscription-limits.ts`, `app/api/bots/toggle/route.ts`
**What it checks**:
- Free tier users: `liveTrading=false` enforced — `/api/bots/toggle` rejects live mode start
- `maxBots=1` enforced on bot creation for free tier
- Trial expired users: `isActive=false` → all protected endpoints return 403
- Expired paid plan: same behavior as expired trial
- Ultra tier: `maxBots=999`, `liveTrading=true`, `apiAccess=true` all verified
- Tier limits from `TIER_LIMITS` match enforcement logic (no drift)

**Pass criteria**: Tier limits enforced at all entry points
**Severity if failed**: HIGH — free users access paid features

---

## SECTION I — Integration / Cross-System (10 Checks)

### I1 · Live Close Loop *(LIVE mode only)*

**Files**: `main.py` (`_sync_coindcx_positions`), `engine_api.py` (`/api/close-trade`), `coindcx_client.py`
**What it checks**:
- All trades closed in tradebook (mode=LIVE) in last 24h: CoinDCX position is also closed
- All open CoinDCX positions: matching open tradebook entry exists
- No position re-appearing in tradebook after being manually closed (re-registration bug)
- `api/close-trade` calls `cdx.exit_position()` before `tb.close_trade()` for live trades

**Pass criteria**: 0 ghost positions, 0 re-registrations
**Severity if failed**: CRITICAL — capital locked on exchange, re-opened phantom trades accumulate losses

---

### I2 · bot_id Cross-System Consistency

**Files**: Railway env vars, `engine_api.py`, `lib/sync-engine-trades.ts`, Prisma `Bot`
**What it checks**:
- `ENGINE_BOT_ID` env var value is known
- DB has `Bot.id = ENGINE_BOT_ID` (bot record exists)
- `Bot.userId` is a valid, non-deleted user
- All open engine tradebook trades have `bot_id = ENGINE_BOT_ID`
- All DB `Trade.botId` for this bot reference the correct `Bot.id`

**Pass criteria**: Full 5-link chain consistent
**Severity if failed**: HIGH — trades orphaned or attributed to wrong user

---

### I3 · Mode Cross-System Consistency

**Files**: `config.py`, `data/engine_mode.json`, `lib/engine-url.ts`, Prisma `BotConfig`
**What it checks**:
- Engine side: `config.PAPER_TRADE` + `engine_mode.json` agree
- SaaS side: active bot's `BotConfig.mode` field
- Routing side: `getEngineUrl()` returns correct URL for bot mode
- All three layers agree (`paper`/`live` consistent)
- Flag: live engine running + paper bot recorded in DB → mode drift

**Pass criteria**: 3-way agreement on mode
**Severity if failed**: CRITICAL — live trades placed while UI shows paper, or vice versa

---

### I4 · Trade Count Consistency

**Files**: Engine `/api/all`, Prisma `Trade`
**What it checks**:
- Fetch open trade count from engine: `tradebook.trades.filter(status='open').length`
- Fetch active trade count from DB for same bot: `Trade.count(botId, status='active')`
- Tolerance: `|engine_count - db_count| ≤ 2` (allow 1-2 cycle sync lag)
- If > 2 apart: report both counts and list discrepant trade IDs
- Growing divergence over multiple days = structural sync bug

**Pass criteria**: Counts within ±2
**Severity if failed**: HIGH

---

### I5 · Balance Accuracy

**Files**: `coindcx_client.py` (`get_usdt_balance`), `app/api/wallet-balance/route.ts`
**What it checks**:
- Engine CoinDCX balance: `cdx.get_usdt_balance()` value
- SaaS CoinDCX balance: `GET /api/wallet-balance` → `coindcx` field
- `|engine_balance - saas_balance| < $10` (allow for in-flight orders)
- Binance testnet balance > $0 if paper mode is active
- Stale cache detection: SaaS balance timestamp < 5 min old

**Pass criteria**: Balances agree within $10
**Severity if failed**: MEDIUM — misleading capital display

---

### I6 · Timestamp Consistency

**Files**: `tradebook.py`, `lib/sync-engine-trades.ts`, Prisma `Trade`
**What it checks**:
- All engine `entry_time` values are valid ISO 8601 strings
- All DB `entryTime` values are parseable `Date` objects
- Engine → Prisma timestamp conversion accuracy: `|engine_ts - db_ts| < 2 seconds`
- All timestamps are UTC (no timezone offset in stored strings)
- No `entry_time` before `2024-01-01` (bad epoch / millisecond-as-seconds bug)

**Pass criteria**: All timestamps valid UTC, conversion accurate
**Severity if failed**: MEDIUM — wrong trade history display, incorrect `startedAt` filtering

---

### I7 · Risk & Leverage Bounds

**Files**: `risk_manager.py`, `tradebook.json`, Prisma `Trade`
**What it checks**:
- All active trades: `leverage ∈ {10, 15, 25, 35}` (defined bands only)
- No trade with `leverage = 0` (would mean no position sizing)
- No trade with `leverage > 35` (max configured)
- Position notional `qty × entry_price ≤ MAX_CAPITAL`
- Total open positions count ≤ `MAX_POSITIONS`
- No position with `qty = 0` while marked as open

**Pass criteria**: All risk bounds respected
**Severity if failed**: HIGH — capital at risk beyond limits

---

### I8 · Coin Tier Compliance

**Files**: `data/coin_tiers.csv`, `coin_scanner.py`, `tradebook.json`
**What it checks**:
- All active LIVE trades: symbol is NOT in Tier C list
- All active trades: symbol exists in `coin_tiers.csv` (known coin)
- `weekly_reclassify` last run timestamp < 8 days (tier list is current)
- Tier A coin count ≥ 5 (sufficient trading universe)
- No Tier C symbol appears in `multi_bot_state` scan results as a selected trade candidate

**Pass criteria**: 0 Tier C trades, reclassify current
**Severity if failed**: MEDIUM — low-quality coin being traded

---

### I9 · SL/TP Validity

**Files**: `tradebook.json`, `coindcx_client.py` (live price), `data_pipeline.py`
**What it checks**:
- All active trades: `sl_price > 0` and `tp_price > 0`
- BUY positions: `tp_price > entry_price > sl_price`
- SELL positions: `sl_price > entry_price > tp_price`
- Fetch current market price for each active coin
- **Missed close detection**: if `current_price` has crossed `sl_price` but trade still open → CRITICAL FLAG
- **Missed TP detection**: if `current_price` has hit `tp_price` but trade still open → flag
- Trailing SL: if `trailingActive=true`, verify `trailingSl` is moving in correct direction

**Pass criteria**: 0 missed closes, all SL/TP geometrically valid
**Severity if failed**: CRITICAL — unmanaged position bleeding losses past stop

---

### I10 · HMM Signal Quality

**Files**: `hmm_brain.py`, `tradebook.json`, `data/scanner_state.json`
**What it checks**:
- Last 20 opened trades: average confidence > 0.25 (above LOW threshold)
- No trade in tradebook opened with `confidence < 0.10` (below minimum)
- Regime transition frequency in last 24h < 20 switches per coin (oscillating = unstable model)
- State distribution in last 50 HMM observations not degenerate: no single state > 90% of predictions
- Conviction score distribution: average > 40 (minimum deploy threshold)

**Pass criteria**: Signal healthy, no degenerate states
**Severity if failed**: MEDIUM — model degrading, low-confidence trades being placed

---

## Priority Matrix

```
┌──────────────────────────────────────────────────────────────┐
│  SEVERITY TIER       │ Checks            │ Alert response     │
├──────────────────────┼───────────────────┼────────────────────┤
│  CRITICAL            │ P1, P2, P4, P6,   │ Telegram + stop    │
│  (fix immediately)   │ P8, P11, I1, I3,  │ bot if live        │
│                      │ I9, S2, S9        │                    │
├──────────────────────┼───────────────────┼────────────────────┤
│  HIGH                │ P3, P5, P7, P10,  │ Telegram alert     │
│  (fix within 24h)    │ P12, S1, S3, S6,  │                    │
│                      │ S7, S8, S10, S12, │                    │
│                      │ S13, I2, I4, I7   │                    │
├──────────────────────┼───────────────────┼────────────────────┤
│  MEDIUM              │ P9, S4, S11, I5,  │ Log only           │
│  (fix within week)   │ I6, I8, I10       │                    │
├──────────────────────┼───────────────────┼────────────────────┤
│  LOW / INFO          │ S5 (static)       │ Weekly review      │
│                      │ S12 (static)      │                    │
└──────────────────────┴───────────────────┴────────────────────┘
```

---

## Scheduling

| Method | Config |
|--------|--------|
| **Railway Cron** | `0 4 * * *` → runs `tools/audit_runner.sh` |
| **Manual (admin)** | `POST /api/admin/audit` (admin session required) |
| **CLI (local)** | `python tools/daily_audit.py --section P` |
| **CLI (full)** | `python tools/daily_audit.py --section all` |
| **GitHub Actions** | `.github/workflows/daily-audit.yml` — secondary runner |

---

## Implementation Spec: `tools/daily_audit.py`

```python
"""
HMMBOT Daily Audit — Python Engine Checks (P1–P12) + Integration (I4, I7–I10)
Run: python tools/daily_audit.py [--section P] [--section all]
"""

from dataclasses import dataclass
from enum import Enum
from typing import List, Optional

class Status(Enum):
    PASS = "✅"
    WARN = "⚠️ "
    FAIL = "❌"

@dataclass
class AuditResult:
    id: str                 # e.g. "P1"
    name: str               # e.g. "Config Integrity"
    status: Status
    details: str            # human-readable summary
    critical: bool          # triggers Telegram alert if FAIL
    sub_checks: List[str]   # individual check descriptions

class AuditRunner:
    checks = [
        check_p1_config,
        check_p2_hmm_model,
        check_p3_tradebook,
        check_p4_exchange_sync,     # live only
        check_p5_bot_id_stamping,
        check_p6_mode_consistency,
        check_p7_api_health,
        check_p8_data_pipeline,
        check_p9_coin_tiers,
        check_p10_risk_manager,
        check_p11_process_health,
        check_p12_log_quality,
    ]

    def run_all(self) -> AuditReport: ...
    def send_telegram(self, report: AuditReport): ...  # FAIL items only
    def write_report(self, report: AuditReport):       # data/audit_YYYYMMDD.json
```

---

## Implementation Spec: `/api/admin/audit/route.ts`

```typescript
/**
 * POST /api/admin/audit
 * Admin-only. Runs SaaS checks (S1–S13) + integration checks (I1–I6).
 * Returns: { summary, checks: AuditCheck[], failCount, warnCount, passCount }
 */

interface AuditCheck {
    id: string;           // "S1", "I3", etc.
    name: string;
    status: 'pass' | 'warn' | 'fail';
    details: string;
    critical: boolean;
    subChecks: string[];
}
```

---

## Implementation Spec: `tools/audit_runner.sh`

```bash
#!/bin/bash
# HMMBOT Audit Orchestrator
# 1. Run Python audit → data/audit_YYYYMMDD.json
# 2. POST /api/admin/audit → saas_audit.json
# 3. Merge reports → combined_audit.json
# 4. Send Telegram if any FAIL (critical ones immediately)
# 5. Archive to data/audit_history/YYYYMMDD/

DATE=$(date +%Y%m%d_%H%M)
PYTHON_REPORT="data/audit_${DATE}_engine.json"
SAAS_REPORT="data/audit_${DATE}_saas.json"

# --- Step 1: Engine audit
python tools/daily_audit.py --output "$PYTHON_REPORT"

# --- Step 2: SaaS audit (admin JWT required)
curl -s -X POST "$SAAS_URL/api/admin/audit" \
    -H "Cookie: $ADMIN_SESSION_COOKIE" \
    -o "$SAAS_REPORT"

# --- Step 3: Merge + print summary
python tools/daily_audit.py --merge "$PYTHON_REPORT" "$SAAS_REPORT"

# --- Step 4: Archive
mkdir -p data/audit_history/$DATE
mv "$PYTHON_REPORT" "$SAAS_REPORT" data/audit_history/$DATE/
```

---

## Report Storage (Optional DB Table)

```prisma
model AuditReport {
    id         String   @id @default(cuid())
    runAt      DateTime @default(now())
    passCount  Int
    warnCount  Int
    failCount  Int
    critFails  String[] // list of check IDs that critically failed
    reportJson Json     // full report blob
    sentAlert  Boolean  @default(false)
    @@index([runAt])
}
```

---

## Quick Reference: All 35 Checks

| # | ID | Name | Section | Severity |
|---|----|------|---------|---------|
| 1 | P1 | Config Integrity | Engine | CRITICAL |
| 2 | P2 | HMM Model Integrity | Engine | CRITICAL |
| 3 | P3 | Tradebook Integrity | Engine | HIGH |
| 4 | P4 | Exchange Position Sync | Engine (live) | CRITICAL |
| 5 | P5 | bot_id Stamping | Engine | HIGH |
| 6 | P6 | Mode Consistency | Engine | CRITICAL |
| 7 | P7 | API Health | Engine | HIGH |
| 8 | P8 | Data Pipeline | Engine | CRITICAL |
| 9 | P9 | Coin Tier Integrity | Engine | MEDIUM |
| 10 | P10 | Risk Manager Integrity | Engine | HIGH |
| 11 | P11 | Process Health | Engine | CRITICAL |
| 12 | P12 | Log Quality | Engine | HIGH |
| 13 | S1 | DB Integrity | SaaS | CRITICAL |
| 14 | S2 | User Data Isolation | SaaS | CRITICAL |
| 15 | S3 | Bot State Consistency | SaaS | HIGH |
| 16 | S4 | BotSession Lifecycle | SaaS | MEDIUM |
| 17 | S5 | Auth Coverage (static) | SaaS | HIGH |
| 18 | S6 | Engine URL Routing | SaaS | HIGH |
| 19 | S7 | Trade Sync Layer | SaaS | HIGH |
| 20 | S8 | PnL Calculation Accuracy | SaaS | HIGH |
| 21 | S9 | Mode Case Consistency | SaaS | CRITICAL |
| 22 | S10 | Admin Route Security | SaaS | HIGH |
| 23 | S11 | API Response Shape | SaaS | MEDIUM |
| 24 | S12 | Dependency Hygiene (static) | SaaS | HIGH |
| 25 | S13 | Subscription Enforcement | SaaS | HIGH |
| 26 | I1 | Live Close Loop | Integration | CRITICAL |
| 27 | I2 | bot_id Cross-System | Integration | HIGH |
| 28 | I3 | Mode Cross-System | Integration | CRITICAL |
| 29 | I4 | Trade Count Consistency | Integration | HIGH |
| 30 | I5 | Balance Accuracy | Integration | MEDIUM |
| 31 | I6 | Timestamp Consistency | Integration | MEDIUM |
| 32 | I7 | Risk & Leverage Bounds | Integration | HIGH |
| 33 | I8 | Coin Tier Compliance | Integration | MEDIUM |
| 34 | I9 | SL/TP Validity | Integration | CRITICAL |
| 35 | I10 | HMM Signal Quality | Integration | MEDIUM |

---

*Last updated: 2026-03-08 · 35 checks · 3 sections · 04:00 UTC daily run*

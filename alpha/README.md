# Alpha Module — Synaptic

> **DEPLOYMENT STATUS: 🟡 PHASE 5 — Railway deployment in progress**
> `Dockerfile.alpha` and `railway.alpha.toml` exist at repo root. Ready to deploy.
> Deploy via Railway dashboard: New Service → this repo → config file = `railway.alpha.toml`
> See Phase 5 deployment steps below.

---

## What Is This?

Alpha is a **fully standalone, systematic trading engine** living inside the Synaptic monorepo.
It trades a fixed set of 4 coins using a validated quantitative strategy derived from 13 rounds of
backtesting (~390 configs). It runs as its own process, on its own port, with its own data files,
and its own Railway service.

**It has zero runtime dependency on the main Synaptic engine.**

---

## For Developers and AI Agents — Read Before Touching Anything

### THE ISOLATION CONTRACT

```
╔══════════════════════════════════════════════════════════════════════╗
║  Alpha is ISOLATED from the main engine. This is intentional and    ║
║  must be preserved. Multiple agents and developers work on this     ║
║  codebase simultaneously. Cross-contamination will break both       ║
║  systems and is extremely difficult to untangle.                    ║
╠══════════════════════════════════════════════════════════════════════╣
║                                                                      ║
║  FROM ALPHA, YOU MUST NEVER:                                         ║
║  ✗ import config           (root config.py)                          ║
║  ✗ import main             (root main.py)                            ║
║  ✗ import engine_api       (root engine_api.py)                      ║
║  ✗ import tradebook        (root tradebook.py)                       ║
║  ✗ import hmm_brain        (root hmm_brain.py)                       ║
║  ✗ import execution_engine (root execution_engine.py)                ║
║  ✗ import risk_manager     (root risk_manager.py)                    ║
║  ✗ import feature_engine   (root feature_engine.py)                  ║
║  ✗ Read from data/tradebook.json                                     ║
║  ✗ Write to data/tradebook.json                                      ║
║  ✗ Read from data/bot_state.json                                     ║
║  ✗ Write to data/bot_state.json                                      ║
║  ✗ Write to any file in /data/ (root data directory)                 ║
║  ✗ Share a Flask app instance with engine_api.py                     ║
║  ✗ Register routes on the main engine's port (3001)                  ║
║                                                                      ║
║  FROM ALPHA, YOU MAY:                                                ║
║  ✓ Import from alpha/* only (alpha_config, alpha_hmm, etc.)          ║
║  ✓ Call tools/data_cache.load_all_tf() — read-only, no side effects  ║
║  ✓ Read parquet files from data_cache/ — never write to them         ║
║  ✓ Write to alpha/data/ — this is Alpha's exclusive state directory  ║
║  ✓ Expose endpoints on port 5001 only                                ║
║                                                                      ║
║  FROM THE MAIN ENGINE, YOU MUST NEVER:                               ║
║  ✗ Import anything from alpha/                                        ║
║  ✗ Read from alpha/data/                                             ║
║  ✗ Call Alpha's API endpoints as part of the main engine loop        ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
```

---

## Directory Structure

```
alpha/
├── README.md                  ← you are here
├── STRATEGY.md                ← full backtest history + validated strategy params
├── PHASES.md                  ← phased build plan + audit/routing checks per phase
├── __init__.py
│
├── alpha_config.py            ← all constants (no root imports)
├── alpha_features.py          ← vol_zscore, ATR, HMM feature computation (standalone math)
├── alpha_data.py              ← Bybit data via tools/data_cache only
├── alpha_hmm.py               ← 2-state 1h GMMHMM (BULL/BEAR)
├── alpha_signals.py           ← 2-bar vol_zscore entry signal + exit check
├── alpha_risk.py              ← SL/TP/BE/PnL calculator (ATR-based)
├── alpha_tradebook.py         ← trade journal → alpha/data/tradebook.json only
├── alpha_paper_broker.py      ← simulated fills + slippage
├── alpha_live_broker.py       ← Bybit V5 live orders (activated by ALPHA_PAPER_MODE=false)
├── alpha_loop.py              ← 15-minute engine loop (Alpha's main.py)
├── alpha_api.py               ← Flask app port 5001, all /api/alpha/* endpoints
├── alpha_telegram.py          ← Alpha-only Telegram notifications
├── alpha_logger.py            ← rotating logger → alpha/data/alpha.log
│
├── data/                      ← Alpha-exclusive runtime state (never shared)
│   ├── .gitkeep
│   ├── tradebook.json         ← created at runtime
│   ├── state.json             ← created at runtime
│   └── alpha.log              ← created at runtime
│
├── Dockerfile.alpha           ← standalone image (copies alpha/, tools/, data_cache/ only)
├── railway.alpha.toml         ← Railway service config (port 5001, separate service)
└── requirements.alpha.txt     ← minimal deps: flask, hmmlearn, pandas, requests, pyarrow
```

---

## Strategy Summary

| Parameter | Value |
|-----------|-------|
| Coins | AAVEUSDT, SNXUSDT, COMPUSDT, BNBUSDT (fixed, never dynamic) |
| Direction | 1h HMM regime — BULL or BEAR, margin ≥ 0.10 |
| Entry | vol_zscore > 1.5, 2 consecutive 15m bars confirming direction |
| Stop Loss | 3.5 × ATR (from entry) |
| Take Profit | 9.0 × ATR (from entry) |
| Breakeven | Move SL to entry when price reaches 3.0 × ATR in favour |
| Leverage | Flat 25x (never dynamic) |
| Fee | 0.05% per leg (Bybit taker) |
| Data | Bybit linear perpetuals (via disk cache) |
| Mode | Paper first → Live after validation |

Full backtest history and parameter validation in [STRATEGY.md](./STRATEGY.md).
Phased build plan in [PHASES.md](./PHASES.md).

---

## Ports

| Service | Port |
|---------|------|
| Main Engine | 3001 |
| **Alpha Engine** | **5001** |
| NextJS SaaS | 8080 |

---

## Running Alpha Locally

```bash
# Paper mode (default)
ALPHA_PAPER_MODE=true python alpha/alpha_api.py

# Health check
curl http://localhost:5001/api/alpha/health

# Status (all 4 coins, regimes, open trades)
curl http://localhost:5001/api/alpha/status
```

---

## Environment Variables

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `ALPHA_PAPER_MODE` | No | `true` | Set `false` to go live |
| `ALPHA_PORT` | No | `5001` | Don't change unless conflicting |
| `ALPHA_INTERNAL_KEY` | **Yes** | — | `openssl rand -hex 32` — guards close/admin endpoints |
| `ALPHA_BYBIT_API_KEY` | Live only | — | Read + trade permissions. No withdrawal. Sub-account recommended |
| `ALPHA_BYBIT_API_SECRET` | Live only | — | |
| `ALPHA_TELEGRAM_BOT_TOKEN` | **Yes** | — | **Dedicated Alpha bot only** — create at t.me/BotFather. Do NOT reuse main engine token |
| `ALPHA_TELEGRAM_CHAT_ID` | **Yes** | — | Your Telegram user or group chat ID |

**Exchange: Bybit only.** Alpha never calls Binance. Bybit validated in R13 (30/30 profitable).
**Telegram: Dedicated bot required.** Alpha sends trade open/close/BE/error messages.
The main engine has its own `TELEGRAM_BOT_TOKEN`. Alpha's bot is separate by isolation contract.

---

## Railway Deployment

Alpha deploys as a **third service** in the existing Synaptic Railway project.

1. Add service → GitHub Repo → Dockerfile path: `alpha/Dockerfile.alpha`
2. Set env vars above on the Alpha service
3. Add `ENGINE_ALPHA_URL=https://alpha-engine.railway.internal:5001` to the NextJS service
4. Push code → Railway builds and deploys automatically

See [PHASES.md](./PHASES.md) Phase 6 for the full deployment checklist.

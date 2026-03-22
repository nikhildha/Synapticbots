"""
╔══════════════════════════════════════════════════════════════════════════════╗
║                        ALPHA MODULE — SYNAPTIC                              ║
║                                                                              ║
║  Module : alpha/alpha_config.py                                              ║
║  Purpose: All Alpha constants and settings. Single source of truth.          ║
║           No imports from project root — fully self-contained.               ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  STRATEGY OVERVIEW                                                           ║
║  Coins: AAVE + SNX + COMP + BNB (fixed QUAD, never dynamic)                 ║
║  Entry: vol_zscore > 1.5 on 2 consecutive 15m bars + 1h HMM regime          ║
║  SL: 3.5×ATR | TP: 9.0×ATR | BE: @3.0×ATR | Leverage: 25x flat             ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  ISOLATION CONTRACT                                                          ║
║  ✗ DO NOT import config, main, engine_api, tradebook, hmm_brain, etc.       ║
║  ✓ This file is imported by all other alpha/* modules                        ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load alpha/.env (local dev). In production, Railway injects env vars directly.
_env_path = Path(__file__).parent / ".env"
if _env_path.exists():
    load_dotenv(_env_path)

# ── Deployment guard ──────────────────────────────────────────────────────────
# Checked at startup to prevent accidental production runs
DEPLOYMENT_LOCKED: bool = Path(__file__).parent.joinpath("DEPLOYMENT_LOCKED").exists()

# ── Coin universe (fixed — do not change without full re-backtest) ────────────
ALPHA_COINS: list[str] = ["AAVEUSDT", "SNXUSDT", "COMPUSDT", "BNBUSDT"]

# ── Exchange (Bybit only — validated in R13) ──────────────────────────────────
ALPHA_EXCHANGE: str = "bybit"          # never "binance" or "coindcx"

# ── Strategy parameters (validated R9–R13, see STRATEGY.md) ──────────────────
ALPHA_LEVERAGE: int   = 25             # flat 25x, never dynamic
ALPHA_SL_ATR: float   = 3.5            # stop loss multiplier (R13: peak at 3.5)
ALPHA_TP_ATR: float   = 9.0            # take profit multiplier (R12/R13: TP=9 best)
ALPHA_BE_ATR: float   = 3.0            # breakeven trigger multiplier (R12: BE@3 best)
ALPHA_VOL_THRESH: float = 1.5          # vol_zscore threshold (R11: 1.5 is sweet spot)
ALPHA_VOL_BARS: int   = 2              # consecutive bars required (R10: 2 > 3)
ALPHA_REGIME_MARGIN: float = 0.10      # min HMM margin to trade (R10: 0.10 irrelevant above)
ALPHA_FEE_PER_LEG: float = 0.0005     # 0.05% Bybit taker fee per leg

# ── Capital allocation ────────────────────────────────────────────────────────
ALPHA_CAPITAL_PER_COIN: float = 500.0  # USD per coin slot
ALPHA_TOTAL_CAPITAL: float    = ALPHA_CAPITAL_PER_COIN * len(ALPHA_COINS)  # $2,000

# ── HMM configuration ────────────────────────────────────────────────────────
ALPHA_HMM_LOOKBACK: int    = 250       # training bars (1h bars)
ALPHA_HMM_RETRAIN_H: float = 1.0       # retrain every 1 hour
ALPHA_HMM_N_STATES: int    = 2         # BULL=0, BEAR=1 (no CHOP state in Alpha)

# HMM features — 7 proven features from R11/R12 experimentation
ALPHA_HMM_FEATURES: list[str] = [
    "log_return",
    "volatility",
    "volume_change",
    "vol_zscore",
    "liquidity_vacuum",
    "amihud_illiquidity",
    "volume_trend_intensity",
]

# ── Engine timing ─────────────────────────────────────────────────────────────
ALPHA_LOOP_SECONDS: int       = 900    # 15-minute cycle
ALPHA_CANDLE_BUFFER_S: int    = 5      # seconds after 15m boundary before reading bar
ALPHA_TELEGRAM_SUMMARY_H: int = 4      # send cycle summary every 4 hours max

# ── Paths (all relative to alpha/data/ — never write to root data/) ──────────
_BASE_DIR: Path = Path(__file__).parent
ALPHA_DATA_DIR: str       = str(_BASE_DIR / "data")
ALPHA_TRADEBOOK_FILE: str = str(_BASE_DIR / "data" / "tradebook.json")
ALPHA_STATE_FILE: str     = str(_BASE_DIR / "data" / "state.json")
ALPHA_AUDIT_LOG_FILE: str = str(_BASE_DIR / "data" / "audit_log.json")
ALPHA_LOG_FILE: str       = str(_BASE_DIR / "data" / "alpha.log")

# ── Server ────────────────────────────────────────────────────────────────────
ALPHA_PORT: int = int(os.getenv("PORT", os.getenv("ALPHA_PORT", "5001")))

# ── Mode ──────────────────────────────────────────────────────────────────────
ALPHA_PAPER_MODE: bool = os.getenv("ALPHA_PAPER_MODE", "true").lower() == "true"
ALPHA_PAPER_SLIPPAGE: float = 0.0005   # ±0.05% simulated slippage in paper mode

# ── Security ──────────────────────────────────────────────────────────────────
ALPHA_INTERNAL_KEY: str = os.getenv("ALPHA_INTERNAL_KEY", "")

# ── Exchange credentials (Bybit) ──────────────────────────────────────────────
ALPHA_BYBIT_API_KEY: str    = os.getenv("ALPHA_BYBIT_API_KEY", "")
ALPHA_BYBIT_API_SECRET: str = os.getenv("ALPHA_BYBIT_API_SECRET", "")
ALPHA_BYBIT_BASE_URL: str   = "https://api.bybit.com"   # mainnet
ALPHA_BYBIT_INTERVALS: dict[str, str] = {
    "4h":  "240",
    "1h":  "60",
    "15m": "15",
}

# ── Telegram ──────────────────────────────────────────────────────────────────
ALPHA_TELEGRAM_TOKEN: str   = os.getenv("ALPHA_TELEGRAM_BOT_TOKEN", "")
ALPHA_TELEGRAM_CHAT_ID: str = os.getenv("ALPHA_TELEGRAM_CHAT_ID", "")
ALPHA_TELEGRAM_ENABLED: bool = bool(ALPHA_TELEGRAM_TOKEN and ALPHA_TELEGRAM_CHAT_ID)

# ── Ensure data directory exists at import time ───────────────────────────────
os.makedirs(ALPHA_DATA_DIR, exist_ok=True)

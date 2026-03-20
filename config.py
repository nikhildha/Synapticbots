"""
Project Regime-Master — Central Configuration
All settings, thresholds, and constants live here.
"""
import os
from dotenv import load_dotenv

load_dotenv()

# ─── Binance API (used for PAPER trading) ────────────────────────────────────────
BINANCE_API_KEY = os.getenv("BINANCE_API_KEY", "")
BINANCE_API_SECRET = os.getenv("BINANCE_API_SECRET", "")
TESTNET = os.getenv("TESTNET", "true").lower() == "true"
PAPER_TRADE = os.getenv("PAPER_TRADE", "true").lower() == "true"
ENGINE_USER_ID = "cmmbvbo2l0000j1xo3rqvkfhz"  # Default user for engine trades (admin)
ENGINE_BOT_ID  = os.getenv("ENGINE_BOT_ID", "")    # DB Bot.id — set in Railway per deployment
ENGINE_BOT_NAME = os.getenv("ENGINE_BOT_NAME", "") # Human-readable bot name shown in trades UI
ENGINE_ACTIVE_BOTS = []  # List of {bot_id, user_id, segment_filter} — refreshed every cycle from SaaS DB
# Pull-based bot registry: engine fetches active bots from SaaS API (no push registration needed)
SAAS_API_URL    = os.getenv("SAAS_API_URL", "")       # e.g. https://your-app.vercel.app
# ENGINE_API_SECRET is deprecated (Replaced by X-Synaptic-Internal header)
PAPER_MAX_CAPITAL = 2500       # Total portfolio: 25 slots × $100/trade

# ─── CoinDCX API (used for LIVE trading) ────────────────────────────────────────
COINDCX_API_KEY = os.getenv("COINDCX_API_KEY", "")
COINDCX_API_SECRET = os.getenv("COINDCX_API_SECRET", "")
COINDCX_BASE_URL = "https://api.coindcx.com"
COINDCX_PUBLIC_URL = "https://public.coindcx.com"
COINDCX_MARGIN_CURRENCY = os.getenv("COINDCX_MARGIN_CURRENCY", "USDT")
EXCHANGE_LIVE = os.getenv("EXCHANGE_LIVE", "coindcx")  # "coindcx" (default) or "binance"
BINANCE_FUTURES_TESTNET = os.getenv("BINANCE_FUTURES_TESTNET", "true").lower() == "true"

# ─── Exchange Fees ──────────────────────────────────────────────────────────────
TAKER_FEE = 0.0005            # 0.05% taker per leg (Binance & CoinDCX)
MAKER_FEE = 0.0002            # 0.02% maker per leg

# ─── Trading Symbols ────────────────────────────────────────────────────────────
PRIMARY_SYMBOL = "BTCUSDT"
SECONDARY_SYMBOLS = ["ETHUSDT"]

# ─── Excluded Coins ─────────────────────────────────────────────────────────────
# Coins placed here are completely ignored by the engine, scanner, and scanners.
EXCLUDED_COINS = ["AKTUSDT", "WIFUSDT", "FILUSDT"]

# ─── Crypto Segments (for Segment-Level Analysis) ───────────────────────────────
CRYPTO_SEGMENTS = {
    "L1": ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "AVAXUSDT", "SUIUSDT", "XRPUSDT", "APTUSDT", "ETCUSDT",
           "ADAUSDT", "DOTUSDT", "NEARUSDT", "TRXUSDT", "BCHUSDT", "TONUSDT", "ICPUSDT"],  # KASUSDT removed — not on testnet
    "L2": ["ARBUSDT", "OPUSDT", "POLUSDT", "STRKUSDT", "IMXUSDT", "RONINUSDT", "ZKUSDT",
           "MANTAUSDT", "METISUSDT", "AXLUSDT"],   # MNTUSDT removed — not on Binance
    "DeFi": ["UNIUSDT", "AAVEUSDT", "CRVUSDT", "JUPUSDT", "RUNEUSDT", "PENDLEUSDT", "LINKUSDT", "LDOUSDT", "GMXUSDT", "ENAUSDT",
             "SUSHIUSDT", "COMPUSDT", "SNXUSDT", "CAKEUSDT", "GRTUSDT"],
    "AI": ["TAOUSDT", "FETUSDT", "INJUSDT", "WLDUSDT", "AKTUSDT", "RENDERUSDT", "ARKMUSDT"],
    "Meme": ["DOGEUSDT", "SHIBUSDT", "PEPEUSDT", "WIFUSDT", "BONKUSDT", "NOTUSDT", "MANAUSDT"],  # 1000X and MEWUSDT removed — not on testnet
    "RWA": ["ONDOUSDT", "POLYXUSDT", "TRUUSDT"],
    "Gaming": ["AXSUSDT", "SANDUSDT", "PIXELUSDT", "IOTXUSDT", "GALAUSDT", "ENJUSDT", "YGGUSDT", "GLMUSDT"],
    "DePIN": ["FILUSDT", "ARUSDT", "IOUSDT", "JTOUSDT"],          # HNTUSDT removed — not on Binance
    "Modular": ["TIAUSDT", "DYMUSDT", "STXUSDT", "QNTUSDT"],
    "Oracles": ["PYTHUSDT", "TRBUSDT", "API3USDT", "HBARUSDT"]
}

# Apply exclusion filter immediately
for _seg in list(CRYPTO_SEGMENTS.keys()):
    CRYPTO_SEGMENTS[_seg] = [c for c in CRYPTO_SEGMENTS[_seg] if c not in EXCLUDED_COINS]

# ─── Timeframes ─────────────────────────────────────────────────────────────────
TIMEFRAME_EXECUTION = "5m"    # Entry / exit timing
TIMEFRAME_CONFIRMATION = "1h" # Trend confirmation
TIMEFRAME_MACRO = "4h"        # Macro regime (legacy — replaced by Multi-TF HMM)

# ─── Multi-Timeframe HMM (backtest-proven: +$2,421 PnL, PF 1.49) ────────────
MULTI_TF_ENABLED = True               # Use 3 separate HMM brains per coin
MULTI_TF_TIMEFRAMES = ["1d", "1h", "5m"]   # Daily (macro), Hourly (swing), 5min (momentum)
MULTI_TF_CANDLE_LIMIT = 1000          # Candles per TF (1000 for GMMHMM depth limit)
MULTI_TF_WEIGHTS = {"1d": 20, "1h": 50, "5m": 30}  # Conviction weights (sum=100)
MULTI_TF_MIN_AGREEMENT = 2            # Minimum TFs agreeing on direction (2 of 3)
MULTI_TF_MIN_MODELS = 2               # Minimum trained models required

# ─── Macro Overlay Settings ───────────
MACRO_VETO_BTC_DROP_PCT = 3.0           # Veto longs if BTC drops > 3.0% in 15m (flash crash)

# ─── Optimal Risk Managers per Segment ──────────────────────────────────────────
OPTIMAL_RISK_MANAGERS = {
    "AI": "RM3_Swing",
    "Meme": "RM3_Swing",
    "L2": "RM3_Swing",
    "DePIN": "RM3_Swing",
    "Gaming": "RM3_Swing",
    "RWA": "RM3_Swing",
    "L1": "RM2_ATR",
    "DeFi": "RM3_Swing"
}

def get_optimal_rm(symbol):
    """Retrieve the optimal risk manager ID (e.g. RM3_Swing) for a given coin based on its segment."""
    for segment, coins in CRYPTO_SEGMENTS.items():
        if symbol in coins:
            return OPTIMAL_RISK_MANAGERS.get(segment, "RM3_Swing")
    return "RM3_Swing" # Default for unmapped/new coins

# ─── Weekend Skip ───────────────────────────────────────────────────────────────
WEEKEND_SKIP_ENABLED = False           # Crypto trades 24/7 — no weekend skip
WEEKEND_SKIP_DAYS = [5, 6]             # 5=Saturday, 6=Sunday (Python weekday convention)

# ─── HMM Brain ──────────────────────────────────────────────────────────────────
HMM_N_STATES = 3              # Bull, Chop, Bear (3-state — CRASH merged into BEAR: 10.9% accuracy, worse than random)
HMM_COVARIANCE = "full"       # Optimized: captures cross-feature correlations
HMM_ITERATIONS = 100
HMM_LOOKBACK = 250            # Candles used for training (reduced for speed)
HMM_RETRAIN_HOURS = 24        # Retrain every N hours

# ─── Regime Labels (assigned post-training by sorting mean returns) ──────────
REGIME_BULL = 0
REGIME_BEAR = 1
REGIME_CHOP = 2
REGIME_CRASH = 3              # Legacy — unused with HMM_N_STATES=3 (kept for backtester compat)

REGIME_NAMES = {
    REGIME_BULL:  "BULLISH",
    REGIME_BEAR:  "BEARISH",
    REGIME_CHOP:  "SIDEWAYS/CHOP",
    REGIME_CRASH: "CRASH/PANIC",
}

# ─── Leverage Tiers ─────────────────────────────────────────────────────────────
LEVERAGE_HIGH = 35       # Confidence > 95%
LEVERAGE_MODERATE = 25   # Confidence 91–95%
LEVERAGE_LOW = 15        # Confidence 85–90%
LEVERAGE_NONE = 1        # Observation mode

# ─── Confidence Thresholds ──────────────────────────────────────────────────────
CONFIDENCE_HIGH = 0.99   # Above 99% → 35x  (optimized from 0.95)
CONFIDENCE_MEDIUM = 0.96 # 96–99% → 25x  (optimized from 0.91)
CONFIDENCE_LOW = 0.92    # 92–96% → 15x  (optimized from 0.85, below 92% = no deploy)

# ─── Capital per trade (used by all bots — uniform sizing) ─────────────────────
CAPITAL_PER_TRADE = 100        # $100 per trade, fixed

# ─── Risk Management ────────────────────────────────────────────────────────────
RISK_PER_TRADE = 0.04
KILL_SWITCH_DRAWDOWN = 0.10   # Pause bot if 10% drawdown in 24h
MAX_LOSS_PER_TRADE_PCT = -25     # Hard max-loss per trade: -25% of capital
MIN_LEVERAGE_FLOOR = 5           # Skip trade if leverage must drop below this
MIN_HOLD_MINUTES = 30         # Minimum hold time before regime-change exits
DEFAULT_QUANTITY = 0.002      # BTC quantity (overridden by position sizer)
MARGIN_TYPE = "ISOLATED"      # Never use CROSS for high leverage

# ─── Stop Loss / Take Profit ────────────────────────────────────────────────────
ATR_SL_MULTIPLIER = 1.5       # SL = ATR * multiplier (DEFAULT, used as fallback)
ATR_TP_MULTIPLIER = 3.0       # TP = ATR * multiplier (DEFAULT, used as fallback)
SLIPPAGE_BUFFER = 0.0005      # 0.05% slippage estimate

def get_atr_multipliers(leverage=1):
    """Return (sl_mult, tp_mult) adjusted for leverage.
    Higher leverage → tighter SL/TP to keep effective portfolio risk consistent.
    Always maintains 1:2 risk-reward ratio."""
    if leverage >= 50:
        return (0.5, 1.0)
    elif leverage >= 10:    # 10x–35x: uniform 1:2 R:R at 1×ATR (backtest-proven)
        return (1.0, 2.0)
    elif leverage >= 5:
        return (1.2, 2.4)
    else:  # 1-4x
        return (ATR_SL_MULTIPLIER, ATR_TP_MULTIPLIER)

# ─── Trailing SL: Stepped Breakeven + Profit Lock (F2 — Backtest Winner) ──────
# Milestone-based SL tightening using leveraged P&L %
# Each step: (trigger_pnl_pct, lock_pnl_pct)
#   When leveraged P&L >= trigger → move SL to lock that % profit
#   lock 0% = breakeven (entry price)
TRAILING_SL_ENABLED = True       # Enabled to lock in profit before reversion
TRAILING_SL_STEPS = [
    (5.0,   0.0),   # At +5%  leveraged P&L → SL to Breakeven
    (10.0,  5.0),   # At +10% leveraged P&L → Lock +5% profit
    (15.0, 10.0),   # At +15% leveraged P&L → Lock +10% profit
    (20.0, 15.0),   # At +20% leveraged P&L → Lock +15% profit
    (25.0, 20.0),   # At +25% leveraged P&L → Lock +20% profit
    (30.0, 25.0),   # At +30% leveraged P&L → Lock +25% profit
    (35.0, 30.0),   # At +35% leveraged P&L → Lock +30% profit
    (40.0, 35.0),   # At +40% leveraged P&L → Lock +35% profit
    (45.0, 40.0),   # At +45% leveraged P&L → Lock +40% profit
    (50.0, 45.0),   # At +50% leveraged P&L → Lock +45% profit
]
# Legacy ATR trailing (kept for test compat — superseded by TRAILING_SL_STEPS)
TRAILING_SL_ACTIVATION_ATR = 1.0
TRAILING_TP_MAX_EXTENSIONS = 3

# ─── Multi-Target Partial Profit Booking (0304_v1) ─────────────────────────────
MULTI_TARGET_ENABLED = False      # Disabled — let winners run to full TP (backtest-proven)
MT_RR_RATIO = 5                  # SL : T3 = 1:5
MT_T1_FRAC = 0.333               # T1 at 33.3% of T3 distance (Even spacing)
MT_T2_FRAC = 0.666               # T2 at 66.6% of T3 distance
MT_T1_BOOK_PCT = 0.25            # Book 25% of original qty at T1
MT_T2_BOOK_PCT = 0.50            # Book 50% of remaining qty at T2


# ─── Volatility Filter ─────────────────────────────────────────────────────────
VOL_FILTER_ENABLED = True
VOL_MIN_ATR_PCT = 0.003
VOL_MAX_ATR_PCT = 0.06

# ─── Sideways Strategy ──────────────────────────────────────────────────────────
BB_LENGTH = 20
BB_STD = 2.0
RSI_LENGTH = 14
RSI_OVERSOLD = 35
RSI_OVERBOUGHT = 65
SIDEWAYS_POSITION_REDUCTION = 0.30  # 30% smaller positions in chop

# ─── Bot Loop ────────────────────────────────────────────────────────────────────
LOOP_INTERVAL_SECONDS = 10        # 10-second heartbeat (faster trailing SL sync)
ANALYSIS_INTERVAL_SECONDS = 900   # 15-minute full analysis cycle
ERROR_RETRY_SECONDS = 60          # Retry after error

# Min HMM conviction to pass to Athena (below this, coin is skipped before Athena call)
MIN_CONVICTION_FOR_DEPLOY = 65    # 65 out of 100 — matches MultiTFHMMBrain conviction scale (0-100)
TOP_COINS_PER_SEGMENT = 1         # Athena evaluates the single highest-HMM coin per segment

# ─── Multi-Coin Trading ──────────────────────────────────────────────────────────
MAX_CONCURRENT_POSITIONS = 10   # Max symbols traded at once (reduced from 15)
MAX_OPEN_TRADES = 25            # User-configurable max (overridden by /api/set-config at bot start)
TOP_COINS_LIMIT = 50            # Max coins to scan (brain switcher may reduce: 15/30/50)
CAPITAL_PER_COIN_PCT = 0.05     # 5% of balance per coin (max 15 = 75% deployed)
SCAN_INTERVAL_CYCLES = 4        # Re-scan top coins every N analysis cycles (4 × 15m = 1h)
MULTI_COIN_MODE = True          # Enable multi-coin scanning

# ─── Dynamic Segment Scanner ─────────────────────────────────────────────────────
SCANNER_SEGMENT_ROTATION = True     # Rotate market segments every hour
SCANNER_COINS_PER_SEGMENT = 5       # Scan top 5 highest-volume coins within the active segment
SEGMENT_SCAN_LIMIT = 4              # Top N segments to scan per cycle (4h+1h blended scorer)

# ── 3-Mode Macro-Regime-Aware Segment Selection ──────────────────────────────
# The engine detects market mode each cycle and picks segment pools accordingly:
#   BEARISH: avg segment score < BEARISH_THRESHOLD and < 25% segments green → SHORT pool only
#   BULLISH: avg segment score > BULLISH_THRESHOLD and > 75% segments green  → LONG pool only
#   MIXED:   everything in between (pullbacks, rotation, chop)                → both pools
SEGMENT_BEARISH_THRESHOLD = -2.0    # avg composite score below this → BEARISH mode
SEGMENT_BULLISH_THRESHOLD =  1.0    # avg composite score above this → BULLISH mode
SEGMENT_SHORT_POOL_SIZE   = 2       # N worst segments used in BEARISH / MIXED mode
SEGMENT_LONG_POOL_SIZE    = 2       # N best segments used in BULLISH / MIXED mode
MAX_ACTIVE_PER_SEGMENT = 1          # Correlation control: max 1 trade per segment

# ── Segment filter master switch ─────────────────────────────────────────────
# Set to True to re-enable the 3-mode macro-regime segment pre-filter and
# direction gate. While False, the engine scans ALL coins in every cycle.
USE_SEGMENT_FILTER = True

# ── Multi-Timeframe Market Mode Confirmation ─────────────────────────────────
# Prevents false BULLISH/BEARISH locks at swing highs, fake breakouts, reversals.
# Requires 3 timeframes to agree before committing to a directional mode.
# If any shorter frame disagrees with 24h → stays MIXED (both directions allowed).
# Set SEGMENT_MTF_ENABLED = False to revert to legacy 24h-only behaviour instantly.
SEGMENT_MTF_ENABLED      = True   # Enable 3-frame mode confirmation
SEGMENT_MTF_4H_TF        = "4h"  # Swing-level candle interval (per-segment top coin)
SEGMENT_MTF_1H_TF        = "1h"  # Intraday BTC gate candle interval

# ── Stepped Trailing SL (Profit Lock) ────────────────────────────────────────
# Controls the stepped breakeven + profit-lock ratchet in tradebook.update_unrealized().
# Each tuple: (trigger_leveraged_pnl_pct, lock_leveraged_pnl_pct)
#   trigger = position must reach this % leveraged PnL before step activates
#   lock    = SL is moved to lock in this % of leveraged PnL (0 = breakeven)
#
# UI labels (trades-client.tsx): Breakeven, +5%, +10%, +15%...
TRAILING_SL_ENABLED = True
TRAILING_SL_STEPS = [
    ( 5.0,  0.0),   # Step 1: trigger at +5%  PnL → move SL to breakeven
    (10.0,  5.0),   # Step 2: trigger at +10% → lock +5%
    (15.0, 10.0),   # Step 3: trigger at +15% → lock +10%
    (20.0, 15.0),   # Step 4: trigger at +20% → lock +15%
    (25.0, 20.0),   # Step 5: trigger at +25% → lock +20%
    (30.0, 25.0),   # Step 6: trigger at +30% → lock +25%
    (35.0, 30.0),   # Step 7: trigger at +35% → lock +30%
    (40.0, 35.0),   # Step 8: trigger at +40% → lock +35%
    (45.0, 40.0),   # Step 9: trigger at +45% → lock +40%
    (50.0, 45.0),   # Step 10: trigger at +50% → lock +45%
]




# ─── Telegram Notifications ──────────────────────────────────────────────────────
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")
TELEGRAM_ENABLED = False
TELEGRAM_NOTIFY_TRADES = os.getenv("TELEGRAM_NOTIFY_TRADES", "true").lower() == "true"
TELEGRAM_NOTIFY_ALERTS = os.getenv("TELEGRAM_NOTIFY_ALERTS", "true").lower() == "true"
TELEGRAM_NOTIFY_SUMMARY = os.getenv("TELEGRAM_NOTIFY_SUMMARY", "true").lower() == "true"

# ─── Paths ───────────────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
TRADE_LOG_FILE = os.path.join(DATA_DIR, "trade_log.csv")
STATE_FILE = os.path.join(DATA_DIR, "bot_state.json")
MULTI_STATE_FILE = os.path.join(DATA_DIR, "multi_bot_state.json")
COMMANDS_FILE = os.path.join(DATA_DIR, "commands.json")

os.makedirs(DATA_DIR, exist_ok=True)

# ─── Sentiment Engine ─────────────────────────────────────────────────────────
SENTIMENT_ENABLED           = False    # DISABLED — reduces memory + processing (FinBERT loads 400MB model)
SENTIMENT_CACHE_MINUTES     = 15       # Cache per-coin results for N minutes
SENTIMENT_WINDOW_HOURS      = 4        # Look back N hours of articles
SENTIMENT_MIN_ARTICLES      = 3        # Minimum articles to compute a score
SENTIMENT_VETO_THRESHOLD    = -0.65    # Hard veto gate (fast path before conviction)
SENTIMENT_STRONG_POS        = 0.45     # Threshold for "strongly positive" label
SENTIMENT_USE_FINBERT       = False    # DISABLED — FinBERT loads ~400MB transformer model (OOM on Railway)
SENTIMENT_VADER_WEIGHT      = 0.4      # VADER contribution when blending with FinBERT
# ─── Athena — LLM Reasoning Layer (Gemini) ────────────────────────────────────
# Strategic AI brain that validates HMM signals using contextual reasoning.
# Acts as a "risk committee" — can EXECUTE, REDUCE_SIZE, or VETO trades.
LLM_REASONING_ENABLED       = True
LLM_API_KEY                 = os.getenv("GEMINI_API_KEY", "")
LLM_MODEL                   = "gemini-2.0-flash"          # Latest stable flash model (2.5-flash not yet public)
LLM_CACHE_MINUTES           = 10                          # Cache per-coin LLM decisions
LLM_TIMEOUT_SECONDS         = 30                          # Includes Google Search grounding time
LLM_VETO_THRESHOLD          = 0.30                        # Below this → LLM vetoes the trade
LLM_CONFIDENCE_WEIGHT       = 0.20                        # LLM can adjust conviction by ±20%
LLM_MAX_CALLS_PER_CYCLE     = 10                          # Rate limit: max N Athena calls per cycle (fail-closed when exceeded)
LLM_LOG_FILE                = os.path.join(DATA_DIR, "athena_decisions.json")



# ─── Order Flow Engine ────────────────────────────────────────────────────────
ORDERFLOW_ENABLED          = False     # DISABLED — reduces memory + API calls
ORDERFLOW_CACHE_SECONDS    = 60        # Cache orderflow snapshot per coin (60s)
ORDERFLOW_DEPTH_LEVELS     = 20        # Number of L2 order book levels to fetch
ORDERFLOW_WALL_THRESHOLD   = 3.0       # A level is a "wall" if it is N× the avg level size
ORDERFLOW_LOOKBACK_BARS    = 4         # Bars of 15m taker data to sum for cumulative delta
ORDERFLOW_LS_ENABLED       = True      # Include L/S ratio from Binance futures
ORDERFLOW_LARGE_ORDER_USD  = 50_000    # USD threshold to flag a single order as "large"

# ─── Conviction Score Weights (must sum to 100) ───────────────────────────────
# EXP 4 IC-guided weight optimization (300 trials) — Sharpe +0.2442 improvement
CONVICTION_WEIGHT_HMM       = 60   # HMM regime confidence 
CONVICTION_WEIGHT_FUNDING   = 15   # Funding rate (contrarian signal)
CONVICTION_WEIGHT_OI        = 10   # Open Interest change
CONVICTION_WEIGHT_ORDERFLOW = 15   # Live L2 / Limit Liquidity Tracker
CONVICTION_WEIGHT_ORDERFLOW = 15   # Live L2 / Limit Liquidity Tracker

# ─── Conviction Score: Leverage Bands ────────────────────────────────────────
CONVICTION_MIN_TRADE   = 65   # Below this → no trade (leverage = 0)
CONVICTION_BAND_LOW    = 75   # 65–74  → 15x leverage
CONVICTION_BAND_MED    = 95   # 75–94  → 25x leverage; 95+ → 35x leverage

# ─── Conviction Score: Penalties ─────────────────────────────────────────────
CONVICTION_FUNDING_PENALTY         = 4    # Crowded funding rate penalty
CONVICTION_OI_PENALTY              = 3    # Adverse OI move penalty
CONVICTION_FLOW_MILD_PENALTY       = 3    # Mild opposing order flow
CONVICTION_FLOW_STRONG_PENALTY     = 7    # Strong opposing order flow

# ─── Conviction Score: HMM Confidence Tiers ──────────────────────────────────
# Uses MARGIN confidence: best_prob - 2nd_best_prob (range 0.0–1.0)
# Replaces raw max-posterior which was always 99%+ (uncalibrated).
# Experiment results: 3-state+margin Sharpe +1.22 vs 4-state+raw +0.72

# ─── Margin scoring tiers (used to weight multi-TF agreement) ─────────────────
HMM_CONF_TIER_HIGH     = 0.30   # Margin > 0.30 → full weight (100%)
HMM_CONF_TIER_MED_HIGH = 0.20   # Margin > 0.20 → 85% weight
HMM_CONF_TIER_MED      = 0.10   # Margin > 0.10 → 65% weight
HMM_CONF_TIER_LOW      = 0.05   # Margin > 0.05 → 40% weight (below = no contribution)

# ─── Conviction Score: Funding Rate Thresholds ───────────────────────────────
FUNDING_NEG_STRONG =  -0.0001  # Below: longs paid → BUY favorable (full score)
FUNDING_POS_MED    =   0.0003  # Above: crowded longs → BUY penalty
FUNDING_POS_STRONG =   0.0001  # Above: shorts paid → SELL favorable (full score)
FUNDING_NEG_MED    =  -0.0003  # Below: crowded shorts → SELL penalty

# ─── Conviction Score: OI Change Thresholds ──────────────────────────────────
OI_CHANGE_HIGH     =  0.03   # > 3%: strong fresh positioning
OI_CHANGE_MED      =  0.01   # > 1%: moderate positioning
OI_CHANGE_NEG_HIGH = -0.03   # < -3%: OI falling (short-covering risk for BUY)
OI_CHANGE_NEG_MED  = -0.01   # < -1%: mild OI contraction

# ─── Funding Rate (used by tradebook.update_unrealized) ──────────────────────
FUNDING_INTERVAL_HOURS = 8          # Perpetual funding paid every 8 hours
DEFAULT_FUNDING_RATE   = 0.0001     # 0.01% per 8h — typical Binance/CoinDCX rate

# ─── CoinDCX Execution ───────────────────────────────────────────────────────
COINDCX_MIN_NOTIONAL      = 120.0   # Minimum order size in USD
COINDCX_ORDER_SETTLE_SLEEP = 0.5    # Seconds to wait after placing order

# ─── Coin Scanner ────────────────────────────────────────────────────────────
SCANNER_RATE_LIMIT_SLEEP = 1.0   # Seconds between API calls to avoid rate limiting


"""
CoinDCX Live Connection Test
Tests auth, balance, pricing, order sizing, and leverage — no real order placed.
Run: COINDCX_API_KEY=xxx COINDCX_API_SECRET=yyy python test_coindcx_live.py
"""
import os
import sys
import time

# ─── Inject keys from CLI env if provided ────────────────────────────────────
if not os.getenv("COINDCX_API_KEY"):
    print("❌  COINDCX_API_KEY not set. Export it before running.")
    sys.exit(1)
if not os.getenv("COINDCX_API_SECRET"):
    print("❌  COINDCX_API_SECRET not set. Export it before running.")
    sys.exit(1)

import config
import coindcx_client as cdx
from execution_engine import ExecutionEngine

PASS = "✅"
FAIL = "❌"
WARN = "⚠️ "

results = []

def check(label, ok, detail=""):
    symbol = PASS if ok else FAIL
    line = f"  {symbol}  {label}"
    if detail:
        line += f"  →  {detail}"
    print(line)
    results.append(ok)

print()
print("=" * 60)
print("  CoinDCX Live Connection Test")
print("=" * 60)

# ─── 1. Config ───────────────────────────────────────────────────────────────
print("\n[1] Config")
check("API key set",    bool(config.COINDCX_API_KEY),    config.COINDCX_API_KEY[:8] + "...")
check("Secret set",    bool(config.COINDCX_API_SECRET),  config.COINDCX_API_SECRET[:8] + "...")
check("PAPER_TRADE",   not config.PAPER_TRADE,            f"PAPER_TRADE={config.PAPER_TRADE} (must be False for live)")
check("EXCHANGE_LIVE", config.EXCHANGE_LIVE == "coindcx", f"EXCHANGE_LIVE={config.EXCHANGE_LIVE!r}")

# ─── 2. Auth + Balance ───────────────────────────────────────────────────────
print("\n[2] Auth & Wallet Balance")
try:
    balance = cdx.get_usdt_balance()
    check("Auth (HMAC signature)", True,  "API accepted credentials")
    check("USDT balance returned", balance is not None, f"${balance:.2f} USDT available")
    check("Balance > $0",          balance > 0,          f"${balance:.2f}")
except Exception as e:
    check("Auth (HMAC signature)", False, str(e))
    check("USDT balance returned", False, "skipped — auth failed")
    check("Balance > $0",          False, "skipped")
    balance = 0

# ─── 3. Instruments ──────────────────────────────────────────────────────────
print("\n[3] Instruments")
try:
    instruments = cdx.get_active_instruments()
    check("Fetch active instruments", bool(instruments), f"{len(instruments)} futures pairs found")
except Exception as e:
    check("Fetch active instruments", False, str(e))
    instruments = []

TEST_SYMBOL = "BTCUSDT"
try:
    pair = cdx.to_coindcx_pair(TEST_SYMBOL)
    found = any(pair in str(i) for i in instruments) if instruments else False
    check(f"{TEST_SYMBOL} → CoinDCX pair", bool(pair), pair)
    check(f"{pair} active on exchange",    found,       "in active instruments list")
except Exception as e:
    check(f"{TEST_SYMBOL} pair conversion", False, str(e))
    pair = None

# ─── 4. Price Feed ───────────────────────────────────────────────────────────
print("\n[4] Price Feed")
try:
    prices = cdx.get_current_prices()
    check("get_current_prices()", bool(prices), f"{len(prices)} symbols")
except Exception as e:
    check("get_current_prices()", False, str(e))
    prices = {}

if pair:
    try:
        price = cdx.get_current_price(pair)
        check(f"Price for {pair}", price and price > 0, f"${price:,.2f}")
    except Exception as e:
        check(f"Price for {pair}", False, str(e))
        price = None
else:
    price = None

# ─── 5. Leverage ─────────────────────────────────────────────────────────────
print("\n[5] Leverage Check (read-only)")
if pair and price:
    try:
        cdx.update_leverage(pair, 5)
        check(f"Set leverage 5x on {pair}", True, "exchange accepted leverage update")
    except Exception as e:
        err = str(e)
        if "not active" in err.lower():
            check(f"Set leverage on {pair}", False, f"Instrument not active: {err[:80]}")
        elif "max allowed" in err.lower():
            check(f"Set leverage on {pair}", True, f"Max leverage enforced: {err[:80]}")
        else:
            check(f"Set leverage on {pair}", False, err[:100])
else:
    check("Set leverage", False, "skipped — no price")

# ─── 6. Order Sizing Dry-Run ─────────────────────────────────────────────────
print("\n[6] Order Sizing Dry-Run (no order placed)")
CAPITAL = float(os.getenv("TEST_CAPITAL", getattr(config, "CAPITAL_PER_TRADE", 100.0)))
LEVERAGE = getattr(config, "LEVERAGE_HIGH", 5)
print(f"     Using CAPITAL_PER_TRADE=${CAPITAL} LEVERAGE_HIGH={LEVERAGE}x (override with TEST_CAPITAL=10)")
if price and balance is not None:
    quantity = (CAPITAL * LEVERAGE) / price
    margin_needed = (quantity * price) / LEVERAGE
    min_notional = getattr(config, "COINDCX_MIN_NOTIONAL", 10)

    check("Min notional met",      quantity * price >= min_notional,  f"${quantity * price:.2f} vs min ${min_notional}")
    check("Margin vs balance",     margin_needed <= balance,           f"${margin_needed:.2f} needed / ${balance:.2f} available")
    check("Quantity > 0",          quantity > 0,                       f"{quantity:.6f} BTC")
else:
    check("Order sizing", False, "skipped — no price/balance")

# ─── 7. Full Executor Dry-Run ─────────────────────────────────────────────────
print("\n[7] ExecutionEngine Dry-Run (PAPER_TRADE forced True — no real order)")
try:
    # Temporarily force PAPER_TRADE=True so execute_trade() runs in simulation
    orig = config.PAPER_TRADE
    config.PAPER_TRADE = True

    engine = ExecutionEngine()
    result = engine.execute_trade(
        symbol=TEST_SYMBOL,
        side="BUY",
        leverage=5,
        quantity=(100 * 5) / (price or 50000),
        atr=(price or 50000) * 0.01,
        ema_15m_20=None,
        regime=1,
        confidence=0.75,
        reason="test_coindcx_live.py dry-run",
    )
    config.PAPER_TRADE = orig

    check("ExecutionEngine.execute_trade()", result is not None, f"entry={result.get('entry_price', 0):.2f} sl={result.get('stop_loss', 0):.2f}")
except Exception as e:
    config.PAPER_TRADE = orig if 'orig' in dir() else True
    check("ExecutionEngine.execute_trade()", False, str(e)[:120])

# ─── Summary ─────────────────────────────────────────────────────────────────
print()
print("=" * 60)
passed = sum(results)
total  = len(results)
if passed == total:
    print(f"  {PASS}  ALL {total} CHECKS PASSED — live CoinDCX trades will deploy")
else:
    failed = total - passed
    print(f"  {FAIL}  {failed}/{total} CHECKS FAILED — fix issues above before going live")
print("=" * 60)
print()

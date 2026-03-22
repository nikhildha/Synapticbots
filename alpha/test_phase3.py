"""
Alpha Phase 3 — Acceptance Tests
Run: python alpha/test_phase3.py
"""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

PASS = 0
FAIL = 0

def ok(msg):
    global PASS; PASS += 1; print(f"    OK  | {msg}")

def fail(msg):
    global FAIL; FAIL += 1; print(f"    FAIL| {msg}")

print("=== ALPHA PHASE 3 — ACCEPTANCE TESTS ===\n")

# ── 1: alpha_bybit imports ────────────────────────────────────────────────────
print("[ 1/7] alpha_bybit imports ...")
try:
    from alpha.alpha_bybit import (
        place_market_order, close_position, update_stop_loss,
        get_position, check_connectivity, set_leverage,
    )
    ok("all execution functions importable")
except Exception as e:
    fail(f"alpha_bybit import: {e}")

# ── 2: Paper mode place_market_order ─────────────────────────────────────────
print("[ 2/7] place_market_order (paper mode) ...")
try:
    from alpha.alpha_config import ALPHA_PAPER_MODE
    assert ALPHA_PAPER_MODE == True, "Must be in paper mode for these tests"

    fill = place_market_order(
        symbol="AAVEUSDT", side="LONG", qty=131.03,
        stop_loss=85.95, take_profit=119.70, entry_price=95.40,
    )
    assert fill is not None, "fill should not be None in paper mode"
    assert fill["mode"] == "PAPER"
    assert fill["side"] == "LONG"
    assert fill["symbol"] == "AAVEUSDT"
    assert fill["qty"] == 131.03
    assert abs(fill["fill_price"] - 95.40) < 0.10   # slippage < 10 cents
    ok(f"LONG fill @ {fill['fill_price']:.4f} (entry 95.40, slippage OK)")

    fill_short = place_market_order(
        symbol="BNBUSDT", side="SHORT", qty=20.0,
        stop_loss=650.0, take_profit=550.0, entry_price=610.0,
    )
    assert fill_short["side"] == "SHORT"
    assert fill_short["fill_price"] <= 610.0   # adverse slippage for SHORT = lower
    ok(f"SHORT fill @ {fill_short['fill_price']:.4f} (entry 610.0, slippage OK)")
except Exception as e:
    fail(f"place_market_order: {e}")

# ── 3: Paper mode close_position ─────────────────────────────────────────────
print("[ 3/7] close_position (paper mode) ...")
try:
    fill_close = close_position(
        symbol="AAVEUSDT", side="LONG", qty=131.03,
        exit_price=119.70, reason="TP",
    )
    assert fill_close is not None
    assert fill_close["mode"] == "PAPER"
    assert fill_close["reason"] == "TP"
    assert fill_close["fill_price"] <= 119.70   # adverse slippage for LONG close = lower
    ok(f"LONG close fill @ {fill_close['fill_price']:.4f} (expected ~119.70)")

    fill_sl = close_position("AAVEUSDT", "LONG", 131.03, 85.95, reason="SL")
    assert fill_sl["reason"] == "SL"
    ok(f"SL close fill @ {fill_sl['fill_price']:.4f}")
except Exception as e:
    fail(f"close_position: {e}")

# ── 4: Paper mode update_stop_loss ───────────────────────────────────────────
print("[ 4/7] update_stop_loss (paper mode) ...")
try:
    result = update_stop_loss("AAVEUSDT", "LONG", new_sl=95.40)
    assert result == True
    ok("update_stop_loss returns True in paper mode")
except Exception as e:
    fail(f"update_stop_loss: {e}")

# ── 5: check_connectivity (paper mode) ───────────────────────────────────────
print("[ 5/7] check_connectivity (paper mode) ...")
try:
    ok_conn = check_connectivity()
    assert ok_conn == True
    ok("check_connectivity returns True in paper mode")
except Exception as e:
    fail(f"check_connectivity: {e}")

# ── 6: Engine run_once with bybit paper fills ─────────────────────────────────
print("[ 6/7] engine.run_once with bybit paper execution ...")
try:
    import numpy as np, pandas as pd
    import unittest.mock as mock
    from alpha.alpha_features import compute_all_features
    from alpha.alpha_engine import AlphaEngine

    np.random.seed(99)
    n = 300
    close = 100 + np.cumsum(np.random.randn(n) * 0.5)
    df_raw = pd.DataFrame({
        "open":   close * (1 + np.random.randn(n)*0.001),
        "high":   close * (1 + abs(np.random.randn(n)*0.002)),
        "low":    close * (1 - abs(np.random.randn(n)*0.002)),
        "close":  close,
        "volume": abs(np.random.randn(n) * 1000) + 500,
    })
    df_feat = compute_all_features(df_raw)

    # Force a strong BULL signal on last 2 bars
    df_signal = df_feat.copy()
    df_signal.iloc[-1, df_signal.columns.get_loc("vol_zscore")] = 2.5
    df_signal.iloc[-2, df_signal.columns.get_loc("vol_zscore")] = 2.0
    df_signal.iloc[-1, df_signal.columns.get_loc("close")] = df_signal.iloc[-1]["open"] * 1.005
    df_signal.iloc[-2, df_signal.columns.get_loc("close")] = df_signal.iloc[-2]["open"] * 1.003

    mock_data = {sym: {"4h": df_feat, "1h": df_feat, "15m": df_signal}
                 for sym in ["AAVEUSDT", "SNXUSDT", "COMPUSDT", "BNBUSDT"]}

    # Mock regime to BULL with margin=0.30 (passes filter) for all coins
    mock_regime = {"regime": "BULL", "margin": 0.30, "passes_filter": True}

    engine = AlphaEngine()

    with mock.patch("alpha.alpha_engine.get_all_alpha_data", return_value=mock_data), \
         mock.patch("alpha.alpha_engine.get_latest_price", return_value=95.40), \
         mock.patch.object(engine._hmms["AAVEUSDT"], "needs_retrain", return_value=False), \
         mock.patch.object(engine._hmms["AAVEUSDT"], "predict", return_value=mock_regime), \
         mock.patch.object(engine._hmms["SNXUSDT"],  "needs_retrain", return_value=False), \
         mock.patch.object(engine._hmms["SNXUSDT"],  "predict", return_value=mock_regime), \
         mock.patch.object(engine._hmms["COMPUSDT"], "needs_retrain", return_value=False), \
         mock.patch.object(engine._hmms["COMPUSDT"], "predict", return_value=mock_regime), \
         mock.patch.object(engine._hmms["BNBUSDT"],  "needs_retrain", return_value=False), \
         mock.patch.object(engine._hmms["BNBUSDT"],  "predict", return_value=mock_regime), \
         mock.patch("alpha.alpha_telegram.requests.post") as mp:
        mp.return_value.ok = True
        result = engine.run_once()

    # Should have opened trades (signal forced BULL + bars aligned)
    ok(f"run_once: entries={len(result['entries'])} exits={len(result['exits'])} errors={result['errors']}")

    # Verify tradebook recorded trades with A- prefix and source=alpha
    from alpha.alpha_tradebook import get_open_trades
    open_trades = get_open_trades()
    for t in open_trades:
        assert t["trade_id"].startswith("A-"), f"Bad trade_id: {t['trade_id']}"
        assert t["source"] == "alpha"
        assert t["paper_mode"] == True
    if open_trades:
        ok(f"Tradebook: {len(open_trades)} open trades, all A- prefixed, source=alpha")

    # Cleanup tradebook
    tb_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "tradebook.json")
    if os.path.exists(tb_file): os.remove(tb_file)

except Exception as e:
    import traceback; traceback.print_exc()
    fail(f"engine.run_once with bybit: {e}")

# ── 7: Isolation check ────────────────────────────────────────────────────────
print("[ 7/7] isolation check ...")
try:
    with open("alpha/alpha_bybit.py") as f:
        src = f.read()
    banned = ["import config", "from config import", "import tradebook",
              "import hmm_brain", "import feature_engine", "import data_pipeline"]
    violations = []
    for b in banned:
        for line in src.splitlines():
            s = line.strip()
            if (s.startswith("import ") or s.startswith("from ")) and b in s:
                violations.append(f"alpha_bybit.py: '{b}'")
    assert not violations, "\n".join(violations)
    ok("alpha_bybit.py passes isolation check")

    # Verify engine imports alpha_bybit (not raw requests for order placement)
    with open("alpha/alpha_engine.py") as f:
        eng_src = f.read()
    assert "from alpha.alpha_bybit import" in eng_src, "Engine must import alpha_bybit"
    assert "place_market_order" in eng_src, "Engine must call place_market_order"
    assert "close_position" in eng_src, "Engine must call close_position"
    assert "update_stop_loss" in eng_src, "Engine must call update_stop_loss"
    ok("alpha_engine.py correctly wired to alpha_bybit")
except Exception as e:
    fail(f"isolation: {e}")

print()
print("══════════════════════════════════════════════════")
if FAIL == 0:
    print(f" ALL {PASS}/{PASS+FAIL} TESTS PASSED — Phase 3 Bybit execution OK")
else:
    print(f" {PASS} passed / {FAIL} FAILED")
print("══════════════════════════════════════════════════")
sys.exit(0 if FAIL == 0 else 1)

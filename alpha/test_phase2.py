"""
Alpha Phase 2 — Acceptance Tests
Run: python alpha/test_phase2.py
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

PASS = 0
FAIL = 0

def ok(msg):
    global PASS; PASS += 1; print(f"    OK  | {msg}")

def fail(msg):
    global FAIL; FAIL += 1; print(f"    FAIL| {msg}")

print("=== ALPHA PHASE 2 — ACCEPTANCE TESTS ===\n")

# ── 1: Telegram module imports ────────────────────────────────────────────────
print("[ 1/6] alpha_telegram imports ...")
try:
    from alpha.alpha_telegram import (
        notify_trade_opened, notify_trade_closed, notify_breakeven,
        notify_cycle_summary, notify_engine_start, notify_error,
    )
    ok("all notification functions importable")
except Exception as e:
    fail(f"alpha_telegram import: {e}")

# ── 2: Telegram send (dry-run — just confirms no crash, no real send in test) ─
print("[ 2/6] alpha_telegram dry-run (no actual send) ...")
try:
    import unittest.mock as mock

    # Patch requests.post so we never actually call Telegram during tests
    sample_trade = {
        "trade_id": "A-TEST", "symbol": "AAVEUSDT", "side": "LONG",
        "entry_price": 95.40, "stop_loss": 85.95, "take_profit": 119.70,
        "be_trigger": 103.50, "margin_usdt": 500, "vol_zscore": 2.1,
        "regime": "BULL", "regime_margin": 0.23, "fee_open_usdt": 6.25,
        "exit_price": 119.70, "exit_reason": "TP", "net_pnl": 287.50,
        "pnl_pct": 57.5, "fee_close_usdt": 5.99,
        "opened_at": "2026-03-23T00:00:00+00:00",
        "closed_at": "2026-03-23T14:30:00+00:00",
    }

    with mock.patch("requests.post") as mock_post:
        mock_post.return_value.ok = True
        notify_trade_opened(sample_trade)
        notify_trade_closed(sample_trade)
        notify_breakeven(sample_trade, 103.50)
        notify_engine_start(1)
        notify_error("test context", "test error")
        assert mock_post.call_count == 5, f"Expected 5 sends, got {mock_post.call_count}"

    ok("5 Telegram messages formatted and sent without error")

    # cycle_summary
    with mock.patch("requests.post") as mock_post:
        mock_post.return_value.ok = True
        notify_cycle_summary(
            cycle=5,
            regime_map={
                "AAVEUSDT": {"regime":"BULL","margin":0.23,"passes_filter":True},
                "SNXUSDT":  {"regime":"BEAR","margin":0.11,"passes_filter":True},
                "COMPUSDT": {"regime":"BULL","margin":0.08,"passes_filter":False},
                "BNBUSDT":  {"regime":"BEAR","margin":0.31,"passes_filter":True},
            },
            open_trades=[sample_trade],
            portfolio={"open_count":1,"closed_count":3,"win_count":2,"loss_count":1,
                       "win_rate":66.7,"total_net_pnl":542.10,"total_fees":24.5},
        )
        assert mock_post.call_count == 1
    ok("cycle_summary formatted correctly")
except Exception as e:
    fail(f"alpha_telegram dry-run: {e}")

# ── 3: Engine imports ─────────────────────────────────────────────────────────
print("[ 3/6] alpha_engine imports ...")
try:
    from alpha.alpha_engine import AlphaEngine
    engine = AlphaEngine()
    assert hasattr(engine, "run")
    assert hasattr(engine, "run_once")
    assert len(engine._hmms) == 4, f"Expected 4 HMMs, got {len(engine._hmms)}"
    ok(f"AlphaEngine instantiated with {len(engine._hmms)} HMM instances")
except Exception as e:
    fail(f"alpha_engine import: {e}")

# ── 4: Engine run_once with mocked data ───────────────────────────────────────
print("[ 4/6] alpha_engine.run_once (mocked data + mocked price) ...")
try:
    import numpy as np
    import pandas as pd
    import unittest.mock as mock
    from alpha.alpha_features import compute_all_features

    np.random.seed(42)
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
    mock_data = {sym: {"4h": df_feat, "1h": df_feat, "15m": df_feat}
                 for sym in ["AAVEUSDT","SNXUSDT","COMPUSDT","BNBUSDT"]}

    from alpha.alpha_engine import AlphaEngine
    engine2 = AlphaEngine()

    with mock.patch("alpha.alpha_engine.get_all_alpha_data", return_value=mock_data), \
         mock.patch("alpha.alpha_engine.get_latest_price", return_value=95.40), \
         mock.patch("alpha.alpha_telegram.requests.post") as mp:
        mp.return_value.ok = True
        result = engine2.run_once()

    assert "cycle" in result
    assert result["cycle"] == 1
    assert set(result["data_ok"]) == set(["AAVEUSDT","SNXUSDT","COMPUSDT","BNBUSDT"])
    assert len(result["data_fail"]) == 0
    ok(f"run_once completed: cycle={result['cycle']} entries={len(result['entries'])} exits={len(result['exits'])}")
except Exception as e:
    fail(f"alpha_engine.run_once: {e}")

# ── 5: State file written ─────────────────────────────────────────────────────
print("[ 5/6] state file written ...")
try:
    state_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "state.json")
    assert os.path.exists(state_path), "state.json not created"
    with open(state_path) as f:
        state = json.load(f)
    assert state["cycle"] >= 1
    assert "hmm_states" in state
    assert "AAVEUSDT" in state["hmm_states"]
    ok(f"state.json: cycle={state['cycle']} hmm_states={list(state['hmm_states'].keys())}")
except Exception as e:
    fail(f"state file: {e}")

# ── 6: Isolation check (Phase 2 modules) ─────────────────────────────────────
print("[ 6/6] isolation check (Phase 2 modules) ...")
try:
    phase2_files = [
        "alpha/alpha_telegram.py",
        "alpha/alpha_engine.py",
        "alpha/run_alpha.py",
    ]
    banned = [
        "import config", "from config import",
        "import tradebook", "from tradebook import",
        "import hmm_brain", "from hmm_brain",
        "import feature_engine", "from feature_engine",
        "import data_pipeline",
    ]
    violations = []
    for fpath in phase2_files:
        with open(fpath) as f:
            src = f.read()
        for b in banned:
            for line in src.splitlines():
                stripped = line.strip()
                if (stripped.startswith("import ") or stripped.startswith("from ")):
                    if b in stripped:
                        violations.append(f"{fpath}: '{b}'")
    assert not violations, "Isolation violations:\n" + "\n".join(violations)
    ok(f"All {len(phase2_files)} Phase 2 modules pass isolation check")
except Exception as e:
    fail(f"isolation: {e}")

print()
print("══════════════════════════════════════════════════")
if FAIL == 0:
    print(f" ALL {PASS}/{PASS+FAIL} TESTS PASSED — Phase 2 engine OK")
else:
    print(f" {PASS} passed / {FAIL} FAILED")
print("══════════════════════════════════════════════════")
sys.exit(0 if FAIL == 0 else 1)

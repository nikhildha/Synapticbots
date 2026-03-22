"""
Alpha Phase 1 — Acceptance Tests
Run: python alpha/test_phase1.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
import pandas as pd

PASS = 0
FAIL = 0

def ok(msg):
    global PASS
    PASS += 1
    print(f"    OK  | {msg}")

def fail(msg):
    global FAIL
    FAIL += 1
    print(f"    FAIL| {msg}")

print("=== ALPHA PHASE 1 — ACCEPTANCE TESTS ===\n")

# ── 1: Config ──────────────────────────────────────────────────────────────────
print("[ 1/8] alpha_config ...")
try:
    from alpha.alpha_config import (
        ALPHA_COINS, ALPHA_EXCHANGE, ALPHA_SL_ATR, ALPHA_TP_ATR, ALPHA_BE_ATR,
        ALPHA_LEVERAGE, ALPHA_VOL_THRESH, ALPHA_TELEGRAM_ENABLED, ALPHA_PAPER_MODE,
        ALPHA_INTERNAL_KEY, ALPHA_BYBIT_API_KEY, DEPLOYMENT_LOCKED,
    )
    assert ALPHA_COINS == ["AAVEUSDT","SNXUSDT","COMPUSDT","BNBUSDT"]
    assert ALPHA_EXCHANGE == "bybit"
    assert ALPHA_SL_ATR == 3.5
    assert ALPHA_TP_ATR == 9.0
    assert ALPHA_BE_ATR == 3.0
    assert ALPHA_LEVERAGE == 25
    assert ALPHA_VOL_THRESH == 1.5
    assert ALPHA_TELEGRAM_ENABLED == True
    assert ALPHA_PAPER_MODE == True
    assert len(ALPHA_INTERNAL_KEY) == 64
    assert ALPHA_BYBIT_API_KEY != ""
    ok(f"coins={ALPHA_COINS} exchange={ALPHA_EXCHANGE} SL={ALPHA_SL_ATR} TP={ALPHA_TP_ATR}")
    ok(f"telegram_enabled={ALPHA_TELEGRAM_ENABLED} deploy_locked={DEPLOYMENT_LOCKED} paper={ALPHA_PAPER_MODE}")
except Exception as e:
    fail(f"alpha_config: {e}")

# ── 2: Logger ─────────────────────────────────────────────────────────────────
print("[ 2/8] alpha_logger ...")
try:
    from alpha.alpha_logger import get_logger
    log = get_logger("test")
    log.info("logger test OK")
    ok("logger writing to alpha/data/alpha.log")
except Exception as e:
    fail(f"alpha_logger: {e}")

# ── 3: Features ───────────────────────────────────────────────────────────────
print("[ 3/8] alpha_features ...")
try:
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
    required = ["vol_zscore","atr","log_return","liquidity_vacuum","amihud_illiquidity","volume_trend_intensity"]
    missing_cols = [c for c in required if c not in df_feat.columns]
    assert not missing_cols, f"Missing: {missing_cols}"
    assert len(df_feat) > 250
    assert not df_feat["atr"].isna().any()
    ok(f"{len(df_feat)} rows, {len(df_feat.columns)} columns, no NaN in key features")
except Exception as e:
    fail(f"alpha_features: {e}")

# ── 4: Signals ────────────────────────────────────────────────────────────────
print("[ 4/8] alpha_signals ...")
try:
    from alpha.alpha_signals import check_entry_signal, check_exit

    df_sig = df_feat.copy()
    df_sig.iloc[-1, df_sig.columns.get_loc("vol_zscore")] = 2.0
    df_sig.iloc[-2, df_sig.columns.get_loc("vol_zscore")] = 1.8
    df_sig.iloc[-1, df_sig.columns.get_loc("close")] = df_sig.iloc[-1]["open"] * 1.005
    df_sig.iloc[-2, df_sig.columns.get_loc("close")] = df_sig.iloc[-2]["open"] * 1.003

    result = check_entry_signal(df_sig, "BULL")
    assert result["signal"] == True, f"Expected signal: {result}"
    assert result["side"] == "LONG"
    ok(f"BULL LONG signal detected vol_z={result['vol_zscore_last']:.2f}")

    df_no = df_feat.copy()
    df_no.iloc[-1, df_no.columns.get_loc("vol_zscore")] = 0.5
    result_no = check_entry_signal(df_no, "BULL")
    assert result_no["signal"] == False
    ok("No signal on low vol_zscore (0.5 < 1.5)")

    fake = {"side":"LONG","stop_loss":90.0,"take_profit":130.0,"be_activated":False}
    assert check_exit(fake, 131.0)["reason"] == "TP"
    assert check_exit(fake, 88.0)["reason"] == "SL"
    assert check_exit(fake, 110.0)["should_exit"] == False
    ok("Exit checks TP/SL/no-exit all correct")
except Exception as e:
    fail(f"alpha_signals: {e}")

# ── 5: Risk ───────────────────────────────────────────────────────────────────
print("[ 5/8] alpha_risk ...")
try:
    from alpha.alpha_risk import calc_position_size, calc_levels, calc_pnl

    pos = calc_position_size(entry_price=95.40, atr=2.7)
    assert pos["qty"] > 0
    assert pos["notional_usdt"] == 500 * 25
    assert pos["margin_usdt"] == 500.0
    ok(f"qty={pos['qty']:.4f} notional={pos['notional_usdt']:,.0f} margin={pos['margin_usdt']}")

    lvls = calc_levels(entry_price=95.40, atr=2.7, side="LONG")
    assert lvls["stop_loss"] < 95.40
    assert lvls["take_profit"] > 95.40
    assert abs(lvls["stop_loss"]   - (95.40 - 3.5*2.7)) < 0.001
    assert abs(lvls["take_profit"] - (95.40 + 9.0*2.7)) < 0.001
    assert lvls["rr_ratio"] == round(9.0/3.5, 2)
    ok(f"LONG SL={lvls['stop_loss']:.4f} TP={lvls['take_profit']:.4f} BE@{lvls['be_trigger']:.4f} RR={lvls['rr_ratio']}")

    lvls_s = calc_levels(entry_price=95.40, atr=2.7, side="SHORT")
    assert lvls_s["stop_loss"] > 95.40 and lvls_s["take_profit"] < 95.40
    ok("SHORT levels correct")

    dummy = {**pos, **lvls, "side":"LONG","entry_price":95.40,"fee_open_usdt":pos["fee_open_usdt"]}
    pnl_tp = calc_pnl(dummy, lvls["take_profit"])
    pnl_sl = calc_pnl(dummy, lvls["stop_loss"])
    assert pnl_tp["net_pnl"] > 0
    assert pnl_sl["net_pnl"] < 0
    ok(f"TP pnl=${pnl_tp['net_pnl']:.2f} | SL pnl=${pnl_sl['net_pnl']:.2f}")
except Exception as e:
    fail(f"alpha_risk: {e}")

# ── 6: HMM ────────────────────────────────────────────────────────────────────
print("[ 6/8] alpha_hmm ...")
try:
    from alpha.alpha_hmm import AlphaHMM
    hmm = AlphaHMM("AAVEUSDT")
    assert hmm.needs_retrain() == True
    assert hmm.predict(df_feat) is None
    ok("AlphaHMM instantiated, needs_retrain=True, predict→None before training")
except Exception as e:
    fail(f"alpha_hmm: {e}")

# ── 7: Tradebook ──────────────────────────────────────────────────────────────
print("[ 7/8] alpha_tradebook ...")
tb_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "tradebook.json")
if os.path.exists(tb_file):
    os.remove(tb_file)
try:
    from alpha.alpha_tradebook import (
        open_trade, close_trade, get_open_trades, get_open_symbols, portfolio_summary
    )
    t = open_trade(
        symbol="AAVEUSDT", side="LONG", entry_price=95.40, qty=130.89,
        stop_loss=85.95, take_profit=119.70, be_trigger=103.50,
        notional_usdt=12500, margin_usdt=500, fee_open_usdt=6.25,
        atr=2.7, regime="BULL", regime_margin=0.23, vol_zscore=2.1,
    )
    assert t["trade_id"].startswith("A-")
    assert t["source"] == "alpha"
    assert t["paper_mode"] == True
    assert "AAVEUSDT" in get_open_symbols()
    ok(f"opened trade {t['trade_id']} source=alpha paper=True")

    closed = close_trade(t["trade_id"], exit_price=119.70, exit_reason="TP",
                         net_pnl=287.50, pnl_pct=57.5, fee_close_usdt=5.99)
    assert closed is not None
    assert closed["exit_reason"] == "TP"
    assert closed["status"] == "CLOSED"
    assert len(get_open_trades()) == 0
    s = portfolio_summary()
    assert s["closed_count"] == 1 and s["win_count"] == 1 and s["win_rate"] == 100.0
    ok(f"closed trade | win_rate={s['win_rate']}% pnl=${s['total_net_pnl']:.2f}")
except Exception as e:
    fail(f"alpha_tradebook: {e}")
finally:
    if os.path.exists(tb_file):
        os.remove(tb_file)

# ── 8: Isolation check ────────────────────────────────────────────────────────
print("[ 8/8] isolation check ...")
try:
    alpha_files = [
        "alpha/alpha_config.py", "alpha/alpha_logger.py", "alpha/alpha_features.py",
        "alpha/alpha_hmm.py", "alpha/alpha_signals.py", "alpha/alpha_risk.py",
        "alpha/alpha_tradebook.py",
    ]
    banned_imports = [
        "import config", "from config import",
        "import tradebook", "from tradebook import",
        "import hmm_brain", "from hmm_brain",
        "import feature_engine", "from feature_engine",
        "import data_pipeline", "from data_pipeline",
    ]
    def _has_real_import(src: str, banned: str) -> bool:
        """Return True only if banned is an actual import statement (not comment/docstring)."""
        for line in src.splitlines():
            stripped = line.strip()
            # Only flag lines that are actual import statements
            if stripped.startswith("import ") or stripped.startswith("from "):
                if banned in stripped:
                    return True
        return False

    violations = []
    for fpath in alpha_files:
        with open(fpath) as f:
            src = f.read()
        for b in banned_imports:
            if _has_real_import(src, b):
                violations.append(f"{fpath}: '{b}'")
    # alpha_data.py: only tools.data_cache allowed
    with open("alpha/alpha_data.py") as f:
        data_src = f.read()
    for b in ["import config", "from config import", "import tradebook", "import hmm_brain"]:
        if _has_real_import(data_src, b):
            violations.append(f"alpha/alpha_data.py: '{b}'")
    assert not violations, f"Isolation violations:\n" + "\n".join(violations)
    ok(f"All {len(alpha_files)+1} modules pass isolation check")
except Exception as e:
    fail(f"isolation: {e}")

# ── Summary ───────────────────────────────────────────────────────────────────
print()
print("══════════════════════════════════════════════════")
if FAIL == 0:
    print(f" ALL {PASS}/{PASS+FAIL} TESTS PASSED — Phase 1 core modules OK")
else:
    print(f" {PASS} passed / {FAIL} FAILED — fix above before Phase 2")
print("══════════════════════════════════════════════════")
sys.exit(0 if FAIL == 0 else 1)

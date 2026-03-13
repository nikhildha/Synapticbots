"""
tools/backtest_segment.py
Walk-forward backtest comparing Generic HMM vs Segment-Specific HMMs.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
import pandas as pd
from hmmlearn.hmm import GaussianHMM
from sklearn.preprocessing import StandardScaler

import config
from data_pipeline import _parse_klines_df
from feature_engine import compute_hmm_features
from segment_features import ALL_HMM_FEATURES, get_features_for_segment, get_segment_for_coin

# ── Backtest Settings ─────────────────────────────────────────────────────────
SYMBOLS    = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "WIFUSDT", "DOGEUSDT", "FETUSDT"]
INTERVAL   = "4h"        # 4h candles
START_DATE = "1 Jan, 2024"
TRAIN_BARS = 180         # 30 days of 4h candles per training window
TEST_BARS  = 42          # 7 days per test window
STEP_BARS  = 42          # slide by 7 days
FWD_BARS   = 12          # forward horizon for ground truth (12×4h = 48h)
N_STATES   = config.HMM_N_STATES

def fetch_historical(symbol, interval, start_date):
    from binance.client import Client
    client = Client(tld="com")
    interval_map = {"1h": Client.KLINE_INTERVAL_1HOUR, "4h": Client.KLINE_INTERVAL_4HOUR, "1d": Client.KLINE_INTERVAL_1DAY,}
    binance_interval = interval_map.get(interval, interval)
    print(f"  Fetching {symbol} {interval} from {start_date}...")
    try:
        klines = client.get_historical_klines(symbol, binance_interval, start_date)
        if not klines: return None
        df = _parse_klines_df(klines)
        return df
    except Exception as e:
        print(f"  ERROR: {e}")
        return None

def compute_ground_truth(df, fwd_bars=FWD_BARS):
    lr = np.log(df["close"] / df["close"].shift(1))
    fwd_ret = lr.rolling(fwd_bars).sum().shift(-fwd_bars)
    fwd_vol = lr.rolling(fwd_bars).std().shift(-fwd_bars)

    n = len(df)
    labels = np.full(n, config.REGIME_CHOP, dtype=int)
    for i in range(n):
        r, v = fwd_ret.iloc[i], fwd_vol.iloc[i]
        if pd.isna(r) or pd.isna(v): labels[i] = -1; continue
        if r < -0.06 or (r < -0.02 and v > 0.04): labels[i] = config.REGIME_CRASH
        elif r < -0.02: labels[i] = config.REGIME_BEAR
        elif r > 0.03 and v < 0.025: labels[i] = config.REGIME_BULL
    return labels

def train_hmm_model(X_train):
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X_train)
    model = GaussianHMM(n_components=N_STATES, covariance_type="full", n_iter=100, random_state=42)
    model.fit(X_scaled)
    return model, scaler

def build_state_map(model):
    order = np.argsort(model.means_[:, 0])[::-1]
    if N_STATES == 3:
        canonical = [config.REGIME_BULL, config.REGIME_CHOP, config.REGIME_BEAR]
    else:
        canonical = [config.REGIME_BULL, config.REGIME_BEAR, config.REGIME_CHOP, config.REGIME_CRASH]
    return {int(raw): canonical[i] for i, raw in enumerate(order)}

def predict_regimes(model, scaler, state_map, X_test):
    X_scaled = scaler.transform(X_test)
    raw_states = model.predict(X_scaled)
    proba = model.predict_proba(X_scaled)
    canonical = np.array([state_map[s] for s in raw_states], dtype=int)
    confidence = np.array([proba[i, s] for i, s in enumerate(raw_states)])
    return canonical, confidence

def walk_forward(df_feat, feat_cols, gt_labels, log_returns):
    n = len(df_feat)
    all_preds, all_confs, all_true, all_pnl, all_bh = [], [], [], [], []

    for start in range(0, n - TRAIN_BARS - TEST_BARS, STEP_BARS):
        train_end = start + TRAIN_BARS
        test_end  = min(train_end + TEST_BARS, n - 1)

        train_df = df_feat[feat_cols].iloc[start:train_end].dropna()
        test_df  = df_feat[feat_cols].iloc[train_end:test_end].dropna()

        if len(train_df) < 50 or len(test_df) < 5: continue

        try:
            model, scaler = train_hmm_model(train_df.values)
        except Exception: continue

        state_map = build_state_map(model)
        preds, confs = predict_regimes(model, scaler, state_map, test_df.values)

        test_pos = test_df.index.tolist()
        true = gt_labels[test_pos]

        strategy_pnl, bh_pnl_list = [], []
        for j, pos in enumerate(test_pos):
            next_pos = pos + 1
            if next_pos >= n:
                strategy_pnl.append(0.0)
                bh_pnl_list.append(0.0)
                continue
            next_ret = log_returns[next_pos]
            if preds[j] == config.REGIME_BULL: strategy_pnl.append(next_ret)
            elif preds[j] in (config.REGIME_BEAR, config.REGIME_CRASH): strategy_pnl.append(-next_ret)
            else: strategy_pnl.append(0.0)
            bh_pnl_list.append(next_ret)

        known_mask = true != -1
        if known_mask.sum() < 5: continue

        all_preds.extend(preds[known_mask].tolist())
        all_confs.extend(confs[known_mask].tolist())
        all_true.extend(true[known_mask].tolist())
        all_pnl.extend(np.array(strategy_pnl)[known_mask].tolist())
        all_bh.extend(np.array(bh_pnl_list)[known_mask].tolist())

    return (np.array(all_preds), np.array(all_confs), np.array(all_true), np.array(all_pnl), np.array(all_bh))

def compute_metrics(preds, confs, true, pnl, bh_pnl):
    acc = np.mean(preds == true) * 100
    mean_conf = np.mean(confs) * 100
    total_ret = np.sum(pnl) * 100
    bh_ret = np.sum(bh_pnl) * 100
    bars_per_year = 2190
    sharpe = (pnl.mean() / pnl.std() * np.sqrt(bars_per_year) if pnl.std() > 1e-10 else 0)
    return {"accuracy": acc, "mean_conf": mean_conf, "total_ret": total_ret, "bh_ret": bh_ret, "sharpe": sharpe, "n_samples": len(preds)}

def run():
    print("=== SEGMENT BACKTEST: GENERIC vs SPECIFIC ===")
    summary_generic = {k: [] for k in ("accuracy","total_ret","sharpe")}
    summary_specific = {k: [] for k in ("accuracy","total_ret","sharpe")}

    for symbol in SYMBOLS:
        print(f"\n--- {symbol} ---")
        df_raw = fetch_historical(symbol, INTERVAL, START_DATE)
        if df_raw is None or len(df_raw) < TRAIN_BARS + TEST_BARS * 3: continue

        print("  Computing features...")
        # Since we use BTC as baseline, we need it. For simplicity we'll just not pass btc_df for now, allowing random walk baseline.
        df_feat = compute_hmm_features(df_raw)
        gt_labels = compute_ground_truth(df_feat)
        log_returns = np.log(df_feat["close"] / df_feat["close"].shift(1)).fillna(0).values

        segment = get_segment_for_coin(symbol)
        seg_features = get_features_for_segment(segment)

        print(f"  Segment: {segment} ({len(seg_features)} features)")
        print(f"  Generic test (ALL 13 features)...")
        gen_preds, gen_confs, gen_true, gen_pnl, gen_bh = walk_forward(df_feat, ALL_HMM_FEATURES, gt_labels, log_returns)
        
        print(f"  Specific test ({segment} {len(seg_features)} features)...")
        spec_preds, spec_confs, spec_true, spec_pnl, spec_bh = walk_forward(df_feat, seg_features, gt_labels, log_returns)

        if len(gen_preds) == 0 or len(spec_preds) == 0: continue

        gm = compute_metrics(gen_preds, gen_confs, gen_true, gen_pnl, gen_bh)
        sm = compute_metrics(spec_preds, spec_confs, spec_true, spec_pnl, spec_bh)

        print(f"  Results:")
        print(f"    Generic  | Acc: {gm['accuracy']:.1f}% | PnL: {gm['total_ret']:.1f}% | Sharpe: {gm['sharpe']:.2f}")
        print(f"    Specific | Acc: {sm['accuracy']:.1f}% | PnL: {sm['total_ret']:.1f}% | Sharpe: {sm['sharpe']:.2f}")

        for k in summary_generic:
            summary_generic[k].append(gm[k])
            summary_specific[k].append(sm[k])

    if any(len(v) > 0 for v in summary_generic.values()):
        print(f"\n{'='*50}")
        print("  CROSS-SYMBOL AVERAGE")
        print(f"  {'Metric':<15} {'GENERIC':>10} {'SPECIFIC':>10} {'Δ':>8}")
        print(f"  {'-'*50}")
        for label, key in [("Accuracy", "accuracy"), ("Strategy P&L", "total_ret"), ("Sharpe", "sharpe")]:
            gv = np.mean(summary_generic[key])
            sv = np.mean(summary_specific[key])
            print(f"  {label:<15} {gv:10.2f} {sv:10.2f} {sv-gv:+8.2f}")

if __name__ == "__main__":
    run()

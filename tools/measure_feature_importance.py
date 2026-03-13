import sys
import os
import pandas as pd
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config
from data_pipeline import _parse_klines_df
from feature_engine import compute_hmm_features
from hmm_brain import HMMBrain, HMM_FEATURES
from brain_switcher import BrainSwitcher
from backtest_adaptive_engine import fetch_klines, SYMBOL, INTERVAL, START_DATE, TRAIN_BARS, TEST_BARS

def run_backtest_with_states(test_df, states, confs):
    prices = test_df["close"].values
    atrs = test_df["atr"].values if "atr" in test_df.columns else (prices * 0.02)
    
    switcher = BrainSwitcher()
    
    STARTING_CAPITAL = 1000.0
    capital = STARTING_CAPITAL
    
    in_position = False
    pos_side = None
    pos_margin = 0.0
    pos_leverage = 0
    pos_entry_price = 0.0
    
    for i in range(len(test_df) - 1):
        if capital <= 0:
            break
            
        state = states[i]
        conf = confs[i]
        price = float(prices[i])
        atr = float(atrs[i])
        
        if state == config.REGIME_BULL:
            target_side = "BUY"
        elif state == config.REGIME_BEAR or state == config.REGIME_CRASH:
            target_side = "SELL"
        else:
            target_side = "CHOP"
            
        vol_pct = (atr / price) / 0.05
        vol_pct = min(1.0, max(0.0, vol_pct))
        
        if conf >= config.HMM_CONF_TIER_HIGH:
            mult = 1.0
        elif conf >= config.HMM_CONF_TIER_MED_HIGH:
            mult = 0.85
        elif conf >= config.HMM_CONF_TIER_MED:
            mult = 0.65
        elif conf >= config.HMM_CONF_TIER_LOW:
            mult = 0.40
        else:
            mult = 0.20
            
        btc_margin = mult * 100
        btc_regime = "BULL" if state == config.REGIME_BULL else ("BEAR" if state in (config.REGIME_BEAR, config.REGIME_CRASH) else "CHOP")
        
        active_brain_id = switcher.select_brain(btc_regime, btc_margin, vol_pct, tf_agreement=3)
        brain_cfg = config.BRAIN_PROFILES[active_brain_id]
        
        if in_position:
            if target_side != pos_side:
                if pos_side == "BUY":
                    price_pct_move = (price - pos_entry_price) / pos_entry_price
                else:
                    price_pct_move = (pos_entry_price - price) / pos_entry_price
                    
                total_fee = pos_margin * pos_leverage * config.TAKER_FEE * 2
                raw_pnl = pos_margin * pos_leverage * price_pct_move
                net_pnl = raw_pnl - total_fee
                
                if config.TRAILING_SL_ENABLED:
                    leveraged_pnl_pct = (price_pct_move * pos_leverage) * 100
                    locked_pct = None
                    for trigger, lock in reversed(config.TRAILING_SL_STEPS):
                        if leveraged_pnl_pct >= trigger:
                            locked_pct = lock
                            break
                    if locked_pct is not None and (net_pnl / pos_margin * 100) < locked_pct:
                         net_pnl = pos_margin * (locked_pct / 100.0)
                
                net_pnl_pct = (net_pnl / pos_margin) * 100
                if net_pnl_pct <= config.MAX_LOSS_PER_TRADE_PCT * 100:
                    net_pnl = pos_margin * config.MAX_LOSS_PER_TRADE_PCT
                    
                switcher.record_trade_result(net_pnl)
                capital += net_pnl
                in_position = False
                pos_side = None
                
        if not in_position:
            if btc_margin < brain_cfg["conviction_min"] or state == config.REGIME_CHOP:
                continue
            leverage = brain_cfg["leverage"]
            if leverage <= 0: continue
            
            budget = brain_cfg["capital_per_trade"]
            pos_margin = min(budget, capital * config.CAPITAL_PER_COIN_PCT)
            pos_leverage = leverage
            pos_side = target_side
            pos_entry_price = price
            in_position = True

    return capital

def main():
    print("Fetching data...")
    df_raw = fetch_klines(SYMBOL, INTERVAL, START_DATE)
    if df_raw is None: return
    
    df_feat = compute_hmm_features(df_raw)
    df_feat = df_feat.dropna().reset_index(drop=True)
    
    train_df = df_feat.iloc[:TRAIN_BARS]
    test_df = df_feat.iloc[TRAIN_BARS:].copy()
    
    print(f"Training Real HMMBrain on {len(train_df)} samples...")
    print(f"Features: {HMM_FEATURES}")
    brain = HMMBrain()
    brain.train(train_df)
    
    test_X = test_df[HMM_FEATURES].values
    test_X_scaled = (test_X - brain._feat_mean) / brain._feat_std
    
    baseline_score = brain.model.score(test_X_scaled)
    
    states = brain.predict_all(test_df)
    probs = brain.predict_proba_all(test_df)
    
    confs = []
    for prob in probs:
        sorted_p = np.sort(prob)[::-1]
        confs.append(float(sorted_p[0] - sorted_p[1]) if len(sorted_p) >= 2 else float(sorted_p[0]))
        
    baseline_pnl = run_backtest_with_states(test_df, states, confs)
    
    print("\nBaseline Results:")
    print(f"Log Likelihood: {baseline_score:.4f}")
    print(f"Ending Capital: ${baseline_pnl:.2f}")
    print("\n--- Feature Importance (Permutation) ---")
    
    np.random.seed(42)
    importance_lik = {}
    importance_pnl = {}
    
    for i, feature in enumerate(HMM_FEATURES):
        shuffled_df = test_df.copy()
        shuffled_df[feature] = np.random.permutation(shuffled_df[feature].values)
        
        shuffled_X = shuffled_df[HMM_FEATURES].values
        shuffled_X_scaled = (shuffled_X - brain._feat_mean) / brain._feat_std
        shuffled_score = brain.model.score(shuffled_X_scaled)
        
        s_states = brain.predict_all(shuffled_df)
        s_probs = brain.predict_proba_all(shuffled_df)
        s_confs = []
        for prob in s_probs:
            sorted_p = np.sort(prob)[::-1]
            s_confs.append(float(sorted_p[0] - sorted_p[1]) if len(sorted_p) >= 2 else float(sorted_p[0]))
            
        shuffled_pnl = run_backtest_with_states(shuffled_df, s_states, s_confs)
        
        drop_lik = baseline_score - shuffled_score
        drop_pnl = baseline_pnl - shuffled_pnl
        
        importance_lik[feature] = drop_lik
        importance_pnl[feature] = drop_pnl
        
        print(f"Feature: {feature:15s} | Likelihood Drop: {drop_lik:8.2f} | PnL Drop: ${drop_pnl:8.2f}")
        
    print("\nConclusion:")
    print("Features descending by Log-Likelihood importance:")
    for f in sorted(importance_lik, key=importance_lik.get, reverse=True):
        print(f"  {f:15s}: {importance_lik[f]:.2f}")

    print("\nFeatures descending by PnL outcome importance:")
    for f in sorted(importance_pnl, key=importance_pnl.get, reverse=True):
        print(f"  {f:15s}: {importance_pnl[f]:.2f}")

if __name__ == '__main__':
    main()

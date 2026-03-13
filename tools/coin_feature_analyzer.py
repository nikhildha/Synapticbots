"""
tools/coin_feature_analyzer.py

Analyzes institutional features for each independent coin across all 24 supported assets.
Uses HMM Likelihood Permutation Importance to rank the 13 available features per-coin on the 15m timeframe.
"""
import sys
import os
import pandas as pd
import numpy as np
import json
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config
from data_pipeline import fetch_klines
from feature_engine import compute_hmm_features
from hmm_brain import HMMBrain, HMM_FEATURES

# Standardize on a large sample for permutation testing (e.g. 6 months of 15m data)
TIMEFRAME = "15m"
LIMIT = 17280

def build_coin_dataset(coin, interval, limit):
    """Fetch and prepare data for a single coin."""
    btc_df = None
    if coin != config.PRIMARY_SYMBOL:
        btc_df = fetch_klines(config.PRIMARY_SYMBOL, interval, limit=limit)
        
    print(f"  Fetching {coin} on {interval}...")
    df_raw = fetch_klines(coin, interval, limit=limit)
    if df_raw is None or df_raw.empty:
        return None
        
    # Determine the correct btc_df to pass
    current_btc = df_raw if coin == config.PRIMARY_SYMBOL else btc_df
    
    df_feat = compute_hmm_features(df_raw, current_btc)
    df_feat = df_feat.dropna().reset_index(drop=True)
    
    return df_feat

def measure_feature_importance(brain, test_df, target_features):
    """Measure importance of features based on Log-Likelihood drops."""
    test_X = test_df[target_features].values
    test_X_scaled = (test_X - brain._feat_mean) / brain._feat_std
    
    baseline_score = brain.model.score(test_X_scaled)
    
    importance_lik = {}
    np.random.seed(42)
    
    for feature in target_features:
        shuffled_df = test_df.copy()
        shuffled_df[feature] = np.random.permutation(shuffled_df[feature].values)
        
        shuffled_X = shuffled_df[target_features].values
        shuffled_X_scaled = (shuffled_X - brain._feat_mean) / brain._feat_std
        shuffled_score = brain.model.score(shuffled_X_scaled)
        
        drop_lik = baseline_score - shuffled_score
        importance_lik[feature] = drop_lik
        
    return importance_lik, baseline_score


def run_coin_analysis():
    results = {}
    
    print("Starting Coin-Level Feature Analysis...\n")
    
    all_coins = []
    for segment_name, coins in config.CRYPTO_SEGMENTS.items():
        all_coins.extend(coins)
        
    # Remove duplicates if any
    all_coins = list(set(all_coins))
    all_coins.sort()
    
    for coin in all_coins:
        print(f"=== Analyzing Coin: {coin} ===")
        
        # 1. Fetch data
        df = build_coin_dataset(coin, TIMEFRAME, LIMIT)
        if df is None or len(df) < 100:
            print(f"   Not enough data for {coin}. Skipping.")
            continue
            
        # 2. Split train/test (80/20)
        split_idx = int(len(df) * 0.8)
        train_df = df.iloc[:split_idx]
        test_df = df.iloc[split_idx:].copy()
        
        # 3. Train Coin-specific Model
        from segment_features import ALL_HMM_FEATURES
        brain = HMMBrain(features_list=ALL_HMM_FEATURES)
        brain.train(train_df)
        
        # 4. Measure Importance
        # Make sure measure_feature_importance knows what features to test
        importance, baseline_score = measure_feature_importance(brain, test_df, ALL_HMM_FEATURES)
        
        # Output
        sorted_imp = {k: v for k, v in sorted(importance.items(), key=lambda item: item[1], reverse=True)}
        
        results[coin] = {
            "samples": len(df),
            "baseline_ll": baseline_score,
            "importance": sorted_imp
        }
        
        print(f"   Top Feature: {list(sorted_imp.keys())[0]} (Drop: {list(sorted_imp.values())[0]:.2f})")
            
    # Save Report
    os.makedirs(os.path.join(config.DATA_DIR, "audit_reports"), exist_ok=True)
    report_path = os.path.join(config.DATA_DIR, "audit_reports", "coin_feature_analysis.json")
    with open(report_path, "w") as f:
        json.dump(results, f, indent=4)
        
    # Generate Output format directly configured for segment_features.py
    print("\n\n" + "="*80)
    print("🎯 OPTIMAL COIN FEATURES MAPPING DICTIONARY GENERATED:")
    print("="*80 + "\n")
    
    output_dict = "COIN_FEATURES = {\n"
    for coin, data in results.items():
        # Select Top 7 predictive features
        top_7 = list(data['importance'].keys())[:7]
        # Format strings nicely
        formatted_list = ",\n        ".join([f'"{f}"' for f in top_7])
        output_dict += f'    "{coin}": [\n        {formatted_list}\n    ],\n'
    output_dict += "}\n\n"
    
    print(output_dict)
    
    # Optionally save to a raw text file locally for copy-paste convenience
    with open(os.path.join(config.DATA_DIR, "audit_reports", "coin_features_dict.py.txt"), "w") as f:
        f.write(output_dict)

if __name__ == "__main__":
    run_coin_analysis()

"""
tools/segment_feature_analyzer.py

Analyzes institutional features across different crypto segments (L1, L2, DeFi, AI, Meme)
and multiple timeframes (1d, 4h, 1h, 15m) using HMM Likelihood Permutation Importance.
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

TIMEFRAMES = ["1d", "4h", "1h", "15m"]
# How many bars to fetch based on timeframe to cover roughly last ~6 months
TF_LIMITS = {
    "1d":  180,
    "4h":  1080,
    "1h":  4320,
    "15m": 17280
}

def build_segment_dataset(segment_coins, interval, limit):
    """Fetch and combine data for all coins in a segment."""
    segment_dfs = []
    
    # We need BTC data for the rel_strength_btc feature
    btc_df = None
    if config.PRIMARY_SYMBOL not in segment_coins:
        btc_df = fetch_klines(config.PRIMARY_SYMBOL, interval, limit=limit)
        
    for coin in segment_coins:
        print(f"  Fetching {coin} on {interval}...")
        df_raw = fetch_klines(coin, interval, limit=limit)
        if df_raw is None or df_raw.empty:
            continue
            
        # Determine the correct btc_df to pass
        current_btc = df_raw if coin == config.PRIMARY_SYMBOL else btc_df
        
        df_feat = compute_hmm_features(df_raw, current_btc)
        df_feat = df_feat.dropna().reset_index(drop=True)
        segment_dfs.append(df_feat)
        
    if not segment_dfs:
        return None
        
    # Concatenate all coins in the segment vertically to train a unified segment model
    return pd.concat(segment_dfs, axis=0).reset_index(drop=True)


def measure_feature_importance(brain, test_df):
    """Measure importance of features based on Log-Likelihood drops."""
    test_X = test_df[HMM_FEATURES].values
    test_X_scaled = (test_X - brain._feat_mean) / brain._feat_std
    
    baseline_score = brain.model.score(test_X_scaled)
    
    importance_lik = {}
    np.random.seed(42)
    
    for feature in HMM_FEATURES:
        shuffled_df = test_df.copy()
        shuffled_df[feature] = np.random.permutation(shuffled_df[feature].values)
        
        shuffled_X = shuffled_df[HMM_FEATURES].values
        shuffled_X_scaled = (shuffled_X - brain._feat_mean) / brain._feat_std
        shuffled_score = brain.model.score(shuffled_X_scaled)
        
        drop_lik = baseline_score - shuffled_score
        importance_lik[feature] = drop_lik
        
    return importance_lik, baseline_score


def run_segment_analysis():
    results = {}
    
    print("Starting Segment-Level Feature Analysis...\n")
    
    for segment_name, coins in config.CRYPTO_SEGMENTS.items():
        print(f"=== Segment: {segment_name} ({len(coins)} coins) ===")
        results[segment_name] = {}
        
        for tf in TIMEFRAMES:
            print(f"-> Timeframe: {tf}")
            limit = TF_LIMITS[tf]
            
            # 1. Fetch data
            combined_df = build_segment_dataset(coins, tf, limit)
            if combined_df is None or len(combined_df) < 100:
                print(f"   Not enough data for {segment_name} on {tf}. Skipping.")
                continue
                
            # 2. Split train/test (80/20)
            split_idx = int(len(combined_df) * 0.8)
            train_df = combined_df.iloc[:split_idx]
            test_df = combined_df.iloc[split_idx:].copy()
            
            # 3. Train Segment Model
            brain = HMMBrain()
            brain.train(train_df)
            
            # 4. Measure Importance
            importance, baseline_score = measure_feature_importance(brain, test_df)
            
            # Output
            sorted_imp = {k: v for k, v in sorted(importance.items(), key=lambda item: item[1], reverse=True)}
            
            results[segment_name][tf] = {
                "samples": len(combined_df),
                "baseline_ll": baseline_score,
                "importance": sorted_imp
            }
            
            print(f"   Top Feature: {list(sorted_imp.keys())[0]} (Drop: {list(sorted_imp.values())[0]:.2f})")
            
    # Save Report
    os.makedirs(os.path.join(config.DATA_DIR, "audit_reports"), exist_ok=True)
    report_path = os.path.join(config.DATA_DIR, "audit_reports", "segment_feature_analysis.json")
    with open(report_path, "w") as f:
        json.dump(results, f, indent=4)
        
    # Generate Markdown Summary
    md_path = os.path.join(config.DATA_DIR, "audit_reports", "segment_feature_analysis.md")
    with open(md_path, "w") as f:
        f.write("# Segment-Level Feature Importance Report\n\n")
        f.write(f"*Generated on: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}*\n\n")
        
        for segment, tf_data in results.items():
            f.write(f"## {segment} Segment\n")
            for tf, data in tf_data.items():
                f.write(f"### Timeframe: {tf} (Samples: {data['samples']})\n")
                f.write(f"*Baseline Log-Likelihood: {data['baseline_ll']:.2f}*\n\n")
                f.write("| Rank | Feature | Likelihood Drop |\n")
                f.write("|---|---|---|\n")
                for rank, (feat, drop) in enumerate(data['importance'].items(), 1):
                    f.write(f"| {rank} | `{feat}` | {drop:.2f} |\n")
                f.write("\n")
                
    print(f"\nAnalysis Complete. Reports saved to:")
    print(f"  - {report_path}")
    print(f"  - {md_path}")

if __name__ == "__main__":
    run_segment_analysis()

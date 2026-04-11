import sys
import os
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import warnings

warnings.filterwarnings('ignore')

# Setup path
sys.path.append(os.path.abspath(os.path.dirname(__file__)))

from data_pipeline import fetch_klines
from hmm_brain import HMMBrain
from feature_engine import compute_all_features, compute_ema, compute_trend
import config
import logging
logging.basicConfig(level=logging.INFO)

def get_aligned_data(symbol, limits):
    """Fetch and prepare Multi-TF data."""
    data = {}
    for tf, limit in limits.items():
        df = fetch_klines(symbol, tf, limit=limit)
        if df is None or len(df) < 50:
            print(f"Failed to fetch {tf} for {symbol}.")
            return None
        data[tf] = df
    return data

def run_audit():
    print("="*60)
    print(" 🛠 SYNAPTIC STRICT-GATE BACKTESTER (Last ~80 hours) ")
    print("="*60)
    
    # We use limit=1000 for 5m which is ~3.4 days (83 hours) of data.
    # We will step hourly for the last 80 hours.
    
    limits = {
        "4h": 300,   # > 30 days
        "1h": 300,   # 12.5 days
        "15m": 1000, # 10.4 days
        "5m": 1000   # 3.4 days (The limiting factor without pagination)
    }
    
    btc_data = get_aligned_data("BTCUSDT", limits)
    if not btc_data:
        return
        
    alt_symbols = ["SOLUSDT", "ETHUSDT", "DOGEUSDT", "BNBUSDT", "XRPUSDT"]
    alts_data = {}
    for sym in alt_symbols:
        alts_data[sym] = get_aligned_data(sym, limits)
        
    # --- 1. Train BTC 4H Brain ---
    print("\n[1] Training HMM Brains (Offline Mode)...")
    btc_4h_feat = compute_all_features(btc_data["4h"])
    btc_brain = HMMBrain("BTCUSDT")
    btc_brain._tf_str = "4h"
    btc_brain.train(btc_4h_feat)
    
    # --- 2. Train Altcoin MTF Brains ---
    alt_brains = {} # sym -> {tf -> brain}
    for sym in alt_symbols:
        if not alts_data[sym]: continue
        alt_brains[sym] = {}
        for tf in ["4h", "1h", "15m"]:
            feat = compute_all_features(alts_data[sym][tf])
            b = HMMBrain(sym)
            b.train(feat)
            alt_brains[sym][tf] = (b, feat)
            
    # --- 3. Run Hourly Simulation ---
    print("\n[2] Executing Simulation Over Last 80 Hours...")
    
    # We step through 5m timestamps, but only trigger "Cycles" at the top of the hour.
    timestamps_5m = btc_data["5m"]["timestamp"].tolist()
    
    total_cycles = 0
    btc_chop_blocks = 0
    mtf_fails = 0
    momentum_fails = 0
    passed_trades = 0
    
    # Start simulating from index 100 in 5m to have enough lookback
    for i in range(100, len(timestamps_5m)):
        current_ts = timestamps_5m[i]
        
        # Only simulate hourly ticks
        if current_ts.minute != 0:
            continue
            
        total_cycles += 1
        
        # --- GATE 1: BTC MACRO VETO ---
        # Get state of BTC 4H at this exact time (or closest previous 4h candle)
        btc_4h_slice = btc_4h_feat[btc_4h_feat["timestamp"] <= current_ts]
        if len(btc_4h_slice) < 50:
            continue
            
        regime_btc, conf_btc = btc_brain.predict(btc_4h_slice)
        btc_is_chop = (regime_btc == config.REGIME_CHOP)
        
        if btc_is_chop:
            btc_chop_blocks += 1
            # We don't short-circuit anymore, we just track it so we can see what 
            # WOULD have happened if BTC was clear.
            
        # BTC is clear, scan altcoins
        for sym in alt_symbols:
            if not alts_data[sym]: continue
            
            # --- GATE 2: MTF AGREEMENT ---
            directions = []
            margins = []
            
            for tf in ["4h", "1h", "15m"]:
                brain, feat_full = alt_brains[sym][tf]
                feat_slice = feat_full[feat_full["timestamp"] <= current_ts]
                if len(feat_slice) < 50:
                    continue
                r, c = brain.predict(feat_slice)
                directions.append(r)
                if r != config.REGIME_CHOP:
                    margins.append(c)
                    
            if len(directions) < 3:
                continue
                
            bulls = directions.count(config.REGIME_BULL)
            bears = directions.count(config.REGIME_BEAR)
            
            target_regime = None
            if bulls >= 2: target_regime = config.REGIME_BULL
            elif bears >= 2: target_regime = config.REGIME_BEAR
            
            # HMM Margin > 60 logic natively handled by engine
            if target_regime is None:
                mtf_fails += 1
                continue
                
            avg_margin = np.mean([m for m in margins if m >= 60]) if margins else 0
            if avg_margin < 60:
                mtf_fails += 1
                continue
                
            # --- GATE 3: 5M MOMENTUM ---
            # Get 5m data up to this point
            df_5m_full = alts_data[sym]["5m"]
            df_5m_slice = df_5m_full[df_5m_full["timestamp"] <= current_ts]
            if len(df_5m_slice) < 60:
                continue
                
            current_trend = compute_trend(df_5m_slice)
            trade_side = "BUY" if target_regime == config.REGIME_BULL else "SELL"
            
            if trade_side == "BUY" and current_trend == "DOWN":
                momentum_fails += 1
                continue
            elif trade_side == "SELL" and current_trend == "UP":
                momentum_fails += 1
                continue
                
            # --- PASSED ALL GATES ---
            if btc_is_chop:
                print(f"[⚠️ VETOED BY BTC] {current_ts} | {sym} | {trade_side} (MTF {bulls}-{bears}, 5m Trend: {current_trend})")
            else:
                passed_trades += 1
                print(f"[✅ SIGNAL FIRED] {current_ts} | {sym} | {trade_side} (BTC Clear, MTF {bulls}-{bears}, 5m Trend: {current_trend})")

    print("\n" + "="*60)
    print(" 📊 BACKTEST RESULTS (Last ~83 Hours) ")
    print("="*60)
    print(f"Total Hourly Cycles Evaluated: {total_cycles}")
    print(f"Total Setup Attempts across 5 coins: {total_cycles * 5}")
    print("-" * 60)
    print(f"⛔ GATE 1: BTC Chop Blocks  : {btc_chop_blocks} cycles ({(btc_chop_blocks/total_cycles)*100:.1f}% of total time)")
    print(f"⛔ GATE 2: MTF/Margin Fails : {mtf_fails} setups")
    print(f"⛔ GATE 3: 5m Momentum Fails: {momentum_fails} setups")
    print("-" * 60)
    print(f"🎯 Total Valid Trades Passed (Assuming BTC Clear): {passed_trades}")
    print("="*60)

if __name__ == "__main__":
    run_audit()

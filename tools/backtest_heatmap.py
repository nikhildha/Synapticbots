"""
tools/backtest_heatmap.py

3-Month Historical Multi-Risk Backtester for the Segment Heatmap Strategy.
Simulates 15-minute executions across 8 segments using 5 unique Risk Managers.
Outputs Performance, Win Rates, Latency processing, and useless coin exclusions.
"""

import sys
import os
import time
import json
from collections import defaultdict
from datetime import datetime, timedelta
import warnings

# Suppress sklearn/numpy warnings for cleaner output
warnings.filterwarnings("ignore")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
import pandas as pd
from hmmlearn.hmm import GaussianHMM
from sklearn.preprocessing import StandardScaler

import config
from data_pipeline import _parse_klines_df
from feature_engine import compute_hmm_features
from segment_features import get_features_for_segment

# ─── Settings ───────────────────────────────────────────────────────────────
SEGMENT_COINS = {
    "L1": ["BTCUSDT", "ETHUSDT"],
    "L2": ["ARBUSDT", "OPUSDT"],
    "DeFi": ["UNIUSDT", "AAVEUSDT"],
    "AI": ["FETUSDT", "RNDRUSDT"],
    "Meme": ["DOGEUSDT", "PEPEUSDT"],
    "RWA": ["ONDOUSDT", "LINKUSDT"],
    "Gaming": ["GALAUSDT", "SANDUSDT"],
    "DePIN": ["FILUSDT", "RUNEUSDT"]
}

FETCH_DAYS = "120 days ago UTC" # 30 for initial train, 90 for backtest
TEST_DAYS = 90
INTERVAL = "15m"
BARS_PER_DAY = 96
TRAIN_BARS = 30 * BARS_PER_DAY
STEP_BARS = 7 * BARS_PER_DAY
LEVERAGE = 5.0

FEE = 0.0004 # 0.04% taker fee

# ─── Data & Feature Prep ────────────────────────────────────────────────────
def fetch_data(symbol):
    from binance.client import Client
    client = Client(tld="com")
    interval_map = {"15m": Client.KLINE_INTERVAL_15MINUTE}
    print(f"  📥 Fetching {symbol} ({FETCH_DAYS})...")
    try:
        klines = client.get_historical_klines(symbol, interval_map[INTERVAL], FETCH_DAYS)
        if not klines: return None
        df = _parse_klines_df(klines)
        # Add basic ATR and Swing LH
        df['tr0'] = abs(df['high'] - df['low'])
        df['tr1'] = abs(df['high'] - df['close'].shift())
        df['tr2'] = abs(df['low'] - df['close'].shift())
        df['tr'] = df[['tr0', 'tr1', 'tr2']].max(axis=1)
        df['atr'] = df['tr'].rolling(14).mean()
        df['swing_l'] = df['low'].rolling(10).min()
        df['swing_h'] = df['high'].rolling(10).max()
        
        # Add HMM features
        df_feat = compute_hmm_features(df)
        return df_feat.dropna().reset_index(drop=True)
    except Exception as e:
        print(f"  ❌ Failed {symbol}: {e}")
        return None

# ─── Trade Tracking ─────────────────────────────────────────────────────────
class Trade:
    def __init__(self, rm_id, segment, symbol, entry_idx, entry_time, entry_price, direction, atr, swing_lh):
        self.rm_id = rm_id
        self.segment = segment
        self.symbol = symbol
        self.entry_idx = entry_idx
        self.entry_time = entry_time
        self.entry_price = entry_price
        self.direction = direction  # 1 for Long, -1 for Short
        self.atr = atr
        
        self.status = "OPEN"
        self.exit_price = None
        self.pnl_unlev = 0.0
        
        self.highest_high = entry_price
        self.lowest_low = entry_price
        self.half_booked = False
        
        # SL Setup
        if rm_id == "RM1_Static":
            self.sl_price = entry_price * (1 - direction * 0.05)
        elif rm_id == "RM2_ATR":
            m = 3.5 if segment in ["Meme", "AI"] else 2.5
            self.sl_price = entry_price - direction * (m * atr)
        elif rm_id == "RM3_Swing":
            self.sl_price = swing_lh
        elif rm_id == "RM4_HMM":
            self.sl_price = None
        elif rm_id == "RM5_Trailing":
            self.sl_price = entry_price - direction * (1.5 * atr)
            self.target_1 = entry_price * (1 + direction * 0.02)
            self.trail_pct = 0.02

    def update(self, idx, high, low, close, current_regime):
        if self.status != "OPEN": return
        
        if high > self.highest_high: self.highest_high = high
        if low < self.lowest_low: self.lowest_low = low
        
        # 1. pure HMM Exit
        if self.rm_id == "RM4_HMM":
            if self.direction == 1 and current_regime not in [config.REGIME_BULL]:
                self.close_trade(close, "HMM Flip - Long")
            elif self.direction == -1 and current_regime not in [config.REGIME_BEAR, config.REGIME_CRASH]:
                self.close_trade(close, "HMM Flip - Short")
            return
            
        # Hard SL Checks
        if self.sl_price:
            if self.direction == 1 and low <= self.sl_price:
                self.close_trade(self.sl_price, "Hit SL")
                return
            if self.direction == -1 and high >= self.sl_price:
                self.close_trade(self.sl_price, "Hit SL")
                return
            
        # Trailing/Target Checks
        if self.rm_id == "RM5_Trailing":
            if not self.half_booked:
                if (self.direction == 1 and high >= self.target_1) or (self.direction == -1 and low <= self.target_1):
                    self.half_booked = True
                    self.sl_price = self.entry_price
                    self.pnl_unlev += 0.5 * 0.02 * self.direction
            else:
                if self.direction == 1:
                    new_sl = self.highest_high * (1 - self.trail_pct)
                    if new_sl > self.sl_price: self.sl_price = new_sl
                else:
                    new_sl = self.lowest_low * (1 + self.trail_pct)
                    if new_sl < self.sl_price: self.sl_price = new_sl

    def close_trade(self, price, reason):
        self.status = "CLOSED"
        self.exit_price = price
        
        ret = (self.exit_price - self.entry_price) / self.entry_price
        gross_pnl = ret * self.direction
        
        if self.rm_id == "RM5_Trailing" and self.half_booked:
            self.pnl_unlev += 0.5 * gross_pnl - (2 * FEE)
        else:
            self.pnl_unlev += gross_pnl - (2 * FEE)

def train_hmm(df, segment):
    features = get_features_for_segment(segment)
    # Ensure all required features are present
    missing = [f for f in features if f not in df.columns]
    if missing:
        return None, None
        
    X = df[features].values
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    
    model = GaussianHMM(n_components=config.HMM_N_STATES, covariance_type="full", n_iter=50, random_state=42)
    try:
        model.fit(X_scaled)
        
        order = np.argsort(model.means_[:, 0])[::-1]
        if config.HMM_N_STATES == 3:
            canonical = [config.REGIME_BULL, config.REGIME_CHOP, config.REGIME_BEAR]
        else:
            canonical = [config.REGIME_BULL, config.REGIME_BEAR, config.REGIME_CHOP, config.REGIME_CRASH]
        state_map = {int(raw): canonical[i] for i, raw in enumerate(order)}
        
        return model, (scaler, state_map, features)
    except:
        return None, None

def run_simulation():
    print("="*80)
    print("🚀 INITIALIZING MULTI-RISK HEATMAP BACKTEST (3 MONTHS, 15m INTERVALS)")
    print("="*80)
    
    data = {}
    for seg, coins in SEGMENT_COINS.items():
        for coin in coins:
            df = fetch_data(coin)
            if df is not None:
                data[coin] = df

    # We need a common timeline
    if not data:
        print("No data fetched.")
        return
        
    # Find common min/max timestamp
    min_len = min(len(df) for df in data.values())
    for coin in data:
        # keep last min_len rows to align roughly
        data[coin] = data[coin].iloc[-min_len:].reset_index(drop=True)
        
    total_bars = min_len
    if total_bars <= TRAIN_BARS:
        print("Data length insufficient for train + test.")
        return
        
    print(f"\n✅ Data aligned: {total_bars} candles per coin (~{total_bars//96} days).")
    
    trades = []
    
    # Track performance variables
    simulations_durations = []
    
    # ─── Walk-Forward Simulation Loop ──────────────────────────────────────────
    # Step through every 7 days, training on past 30 days
    start_time_glob = time.time()
    
    for block_start in range(TRAIN_BARS, total_bars, STEP_BARS):
        block_end = min(block_start + STEP_BARS, total_bars)
        
        print(f"\n🔄 Training models for block {block_start} -> {block_end}")
        
        # Train models for each segment using the first coin's data as segment proxy
        models = {}
        for seg, coins in SEGMENT_COINS.items():
            primary_coin = coins[0]
            if primary_coin in data:
                train_df = data[primary_coin].iloc[block_start - TRAIN_BARS : block_start]
                mod, meta = train_hmm(train_df, seg)
                if mod:
                    models[seg] = (mod, meta)
                    
        # Simulate 15m intervals inside the block
        for i in range(block_start, block_end):
            t0 = time.time()
            # 1. Compute Heat (Roll 24h vol_zscore = 96 bars)
            heats = {}
            for seg, coins in SEGMENT_COINS.items():
                c = coins[0]
                if c in data and i > 96:
                    # proxy heat by primary coin's 24h vol zscore mean
                    heats[seg] = data[c]['vol_zscore'].iloc[i-96:i].mean()
                else: heats[seg] = -999
                
            sorted_segs = sorted(heats.items(), key=lambda x: x[1], reverse=True)
            active_segs = [s[0] for s in sorted_segs[:2]] # Top 2
            
            # 2. Get predictions and manage trades
            for seg in active_segs:
                if seg not in models: continue
                mod, (scaler, state_map, features) = models[seg]
                
                for coin in SEGMENT_COINS[seg]:
                    if coin not in data: continue
                    bar = data[coin].iloc[i]
                    
                    # Predict Regime
                    X = bar[features].values.reshape(1, -1)
                    X_sca = scaler.transform(X)
                    pred = mod.predict(X_sca)[0]
                    regime = state_map[pred]
                    
                    # Update active trades for this coin
                    coin_trades = [t for t in trades if t.symbol == coin and t.status == "OPEN"]
                    for t in coin_trades:
                        t.update(i, bar['high'], bar['low'], bar['close'], regime)
                        
                    # Check Entry
                    # If not already in a trade of that direction, enter across all 5 RMs
                    has_long = any(t.direction == 1 for t in coin_trades)
                    has_short = any(t.direction == -1 for t in coin_trades)
                    
                    if regime == config.REGIME_BULL and not has_long:
                        for rm in ["RM1_Static", "RM2_ATR", "RM3_Swing", "RM4_HMM", "RM5_Trailing"]:
                            sl = bar['swing_l'] if not np.isnan(bar['swing_l']) else bar['close'] * 0.95
                            t = Trade(rm, seg, coin, i, bar['timestamp'], bar['close'], 1, bar['atr'], sl)
                            trades.append(t)
                            
                    elif regime in [config.REGIME_BEAR, config.REGIME_CRASH] and not has_short:
                        for rm in ["RM1_Static", "RM2_ATR", "RM3_Swing", "RM4_HMM", "RM5_Trailing"]:
                            sl = bar['swing_h'] if not np.isnan(bar['swing_h']) else bar['close'] * 1.05
                            t = Trade(rm, seg, coin, i, bar['timestamp'], bar['close'], -1, bar['atr'], sl)
                            trades.append(t)
            
            simulations_durations.append(time.time() - t0)

    # Force close all remaining open trades
    for t in trades:
        if t.status == "OPEN":
            last_close = data[t.symbol].iloc[-1]['close']
            t.close_trade(last_close, "EOF")

    glob_time = time.time() - start_time_glob
    
    # ─── Analytics ─────────────────────────────────────────────────────────────
    print("\n" + "="*80)
    print(f"📊 BACKTEST COMPLETED IN {glob_time:.2f} SECONDS")
    print(f"   Average 15m Loop Execution Time: {np.mean(simulations_durations):.4f}s")
    print(f"   Max 15m Loop Execution Time:     {np.max(simulations_durations):.4f}s")
    print("="*80)
    
    # 1. Risk Manager Matrix Output
    print("\n🎯 RISK MANAGER TO SEGMENT MATRIX (5x LEVERAGE)")
    
    # Compute stats per specific grouping
    stats = defaultdict(lambda: {"pnl": [], "win": 0, "loss": 0})
    for t in trades:
        lev_pnl = t.pnl_unlev * LEVERAGE * 100
        key = (t.segment, t.rm_id)
        stats[key]["pnl"].append(lev_pnl)
        if lev_pnl > 0: stats[key]["win"] += 1
        elif lev_pnl < 0: stats[key]["loss"] += 1
        
    all_rms = ["RM1_Static", "RM2_ATR", "RM3_Swing", "RM4_HMM", "RM5_Trailing"]
    for seg in SEGMENT_COINS.keys():
        print(f"\n--- {seg} Segment ---")
        print(f"    {'Manager':<15} | {'Trades':<6} | {'Win Rate':<8} | {'Net PnL %':<10} | {'Sharpe':<6}")
        for rm in all_rms:
            key = (seg, rm)
            p_list = stats[key]["pnl"]
            trades_cnt = len(p_list)
            if trades_cnt == 0: continue
            
            win_r = stats[key]["win"] / trades_cnt * 100
            net_pnl = sum(p_list)
            
            # Rough annualized sharpe (approximation based on trade returns)
            std = np.std(p_list)
            sharpe = (np.mean(p_list) / std * np.sqrt(trades_cnt)) if std > 1e-5 else 0
            
            print(f"    {rm:<15} | {trades_cnt:<6} | {win_r:>7.1f}% | {net_pnl:>9.1f}% | {sharpe:>6.2f}")

    # 2. Exclusion Hitlist
    print("\n🗑️  USELESS COINS HITLIST (Negative Net PnL across all metrics)")
    coin_pnl = defaultdict(float)
    for t in trades:
        coin_pnl[t.symbol] += t.pnl_unlev
    
    useless_coins = [c for c, p in coin_pnl.items() if p < 0]
    if useless_coins:
        print("    Add these to config.COIN_EXCLUDE:", useless_coins)
    else:
        print("    All coins generated profitable profiles. No exclusions needed.")

    print("\n" + "="*80)
    
if __name__ == "__main__":
    run_simulation()

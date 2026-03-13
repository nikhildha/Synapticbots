"""
tools/backtest_leverage.py

Advanced Multi-Leverage Backtester for the Segment Heatmap Strategy.
Simulates trades with $100 per trade, testing leverages: 1x, 5x, 10x, 15x, 20x, 35x, 50x, 100x.
Calculates Max Drawdown, Max Concurrent Trades, PF, RR, and Sharpe.
Excludes mathematically toxic coins.
"""

import sys
import os
import time
from collections import defaultdict
from datetime import datetime
import warnings

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

# Pruned out the useless tokens (BTC, ETH, L2s, RWA, Gaming, etc)
SEGMENT_COINS = {
    "L1": ["SOLUSDT"],
    "L2": [],
    "DeFi": ["UNIUSDT"],
    "AI": ["FETUSDT", "RNDRUSDT"],
    "Meme": ["DOGEUSDT", "PEPEUSDT", "WIFUSDT"],
    "RWA": [],
    "Gaming": ["IMXUSDT"],
    "DePIN": ["RUNEUSDT"]
}

FETCH_DAYS = "90 days ago UTC"
TEST_DAYS = 60
INTERVAL = "15m"
BARS_PER_DAY = 96
TRAIN_BARS = 30 * BARS_PER_DAY
STEP_BARS = 7 * BARS_PER_DAY

LEVERAGES = [1, 5, 10, 15, 20, 35, 50, 100]
MARGIN_PER_TRADE = 100.0
FEE = 0.0005 

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

class Trade:
    def __init__(self, rm_id, segment, symbol, entry_idx, entry_time, entry_price, direction, atr, swing_lh):
        self.rm_id = rm_id
        self.segment = segment
        self.symbol = symbol
        self.entry_idx = entry_idx
        self.entry_time = entry_time
        self.entry_price = entry_price
        self.direction = direction
        self.atr = atr
        self.status = "OPEN"
        self.highest_high = entry_price
        self.lowest_low = entry_price
        self.half_booked = False
        
        self.max_adverse_excursion = 0.0 # for liquidation checks
        self.returns = [] # Store tuple of (portion_size, pct_return)
        
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
        
        # Track MAE
        adv_p = low if self.direction == 1 else high
        mae = ((adv_p - self.entry_price) / self.entry_price) * self.direction
        if mae < self.max_adverse_excursion:
            self.max_adverse_excursion = mae
        
        # 1. pure HMM Exit
        if self.rm_id == "RM4_HMM":
            if self.direction == 1 and current_regime not in [config.REGIME_BULL]:
                self.close_trade(close, idx)
            elif self.direction == -1 and current_regime not in [config.REGIME_BEAR, config.REGIME_CRASH]:
                self.close_trade(close, idx)
            return
            
        # Hard SL Checks
        if self.sl_price:
            if self.direction == 1 and low <= self.sl_price:
                self.close_trade(self.sl_price, idx)
                return
            if self.direction == -1 and high >= self.sl_price:
                self.close_trade(self.sl_price, idx)
                return
            
        # Trailing/Target Checks
        if self.rm_id == "RM5_Trailing":
            if not self.half_booked:
                if (self.direction == 1 and high >= self.target_1) or (self.direction == -1 and low <= self.target_1):
                    self.half_booked = True
                    self.sl_price = self.entry_price
                    self.returns.append((0.5, 0.02 * self.direction))
            else:
                if self.direction == 1:
                    new_sl = self.highest_high * (1 - self.trail_pct)
                    if new_sl > self.sl_price: self.sl_price = new_sl
                else:
                    new_sl = self.lowest_low * (1 + self.trail_pct)
                    if new_sl < self.sl_price: self.sl_price = new_sl

    def close_trade(self, price, exit_idx):
        if self.status != "OPEN": return
        self.status = "CLOSED"
        self.exit_price = price
        self.exit_idx = exit_idx
        
        ret = (self.exit_price - self.entry_price) / self.entry_price
        if self.rm_id == "RM5_Trailing" and self.half_booked:
            self.returns.append((0.5, ret * self.direction))
        else:
            self.returns.append((1.0, ret * self.direction))
            
    def calculate_pnl(self, leverage):
        # Apply liquidation logic first
        # Margin call happens if return * lev <= -1  (i.e. -100%)
        # Actually Binance liquidates slightly before, but we'll use -100% of margin
        if self.max_adverse_excursion * leverage <= -1.0:
            # Liquidated
            return -MARGIN_PER_TRADE  
            
        gross_pnl = 0.0
        total_fees = 0.0
        for portion, ret in self.returns:
            pos_size = MARGIN_PER_TRADE * leverage * portion
            gross_pnl += pos_size * ret
            # entry and exit fee
            total_fees += pos_size * FEE * 2 
            
        net = gross_pnl - total_fees
        return max(net, -MARGIN_PER_TRADE) # Can't lose more than margin if not liquidated previously

def train_hmm(df, segment):
    features = get_features_for_segment(segment)
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
    print("🚀 INITIALIZING ADVANCED LEVERAGE MATRIX BACKTEST ($100 MARGIN/TRADE)")
    print("="*80)
    
    data = {}
    for seg, coins in SEGMENT_COINS.items():
        if not coins: continue
        for coin in coins:
            df = fetch_data(coin)
            if df is not None:
                data[coin] = df

    if not data:
        print("No data fetched.")
        return
        
    min_len = min(len(df) for df in data.values())
    for coin in data:
        data[coin] = data[coin].iloc[-min_len:].reset_index(drop=True)
        
    total_bars = min_len
    if total_bars <= TRAIN_BARS:
        print("Data length insufficient for train + test.")
        return
        
    print(f"\n✅ Data aligned: {total_bars} candles per coin (~{total_bars//96} days).")
    
    trades = []
    
    # Track metrics
    max_concurrent_trades = 0
    concurrent_trades_history = []
    trades_per_period = defaultdict(int)
    
    for block_start in range(TRAIN_BARS, total_bars, STEP_BARS):
        block_end = min(block_start + STEP_BARS, total_bars)
        print(f"🔄 Processing block {block_start} -> {block_end}")
        
        models = {}
        for seg, coins in SEGMENT_COINS.items():
            if not coins: continue
            primary_coin = coins[0]
            if primary_coin in data:
                train_df = data[primary_coin].iloc[block_start - TRAIN_BARS : block_start]
                mod, meta = train_hmm(train_df, seg)
                if mod:
                    models[seg] = (mod, meta)
                    
        for i in range(block_start, block_end):
            # Compute concurrent trades checking length of OPEN trades
            open_count = len([t for t in trades if t.status == "OPEN"])
            concurrent_trades_history.append(open_count)
            if open_count > max_concurrent_trades:
                max_concurrent_trades = open_count
                
            new_opens = 0
            
            heats = {}
            for seg, coins in SEGMENT_COINS.items():
                if not coins: continue
                c = coins[0]
                if c in data and i > 96:
                    heats[seg] = data[c]['vol_zscore'].iloc[i-96:i].mean()
                else: heats[seg] = -999
                
            sorted_segs = sorted(heats.items(), key=lambda x: x[1], reverse=True)
            active_segs = [s[0] for s in sorted_segs[:2]]
            
            for seg in active_segs:
                if seg not in models: continue
                mod, (scaler, state_map, features) = models[seg]
                
                for coin in SEGMENT_COINS[seg]:
                    if coin not in data: continue
                    bar = data[coin].iloc[i]
                    
                    X = bar[features].values.reshape(1, -1)
                    X_sca = scaler.transform(X)
                    pred = mod.predict(X_sca)[0]
                    regime = state_map[pred]
                    
                    coin_trades = [t for t in trades if t.symbol == coin and t.status == "OPEN"]
                    for t in coin_trades:
                        t.update(i, bar['high'], bar['low'], bar['close'], regime)
                        
                    has_long = any(t.direction == 1 for t in coin_trades)
                    has_short = any(t.direction == -1 for t in coin_trades)
                    
                    if regime == config.REGIME_BULL and not has_long:
                        for rm in ["RM1_Static", "RM2_ATR", "RM3_Swing", "RM4_HMM", "RM5_Trailing"]:
                            sl = bar['swing_l'] if not pd.isna(bar['swing_l']) else bar['close'] * 0.95
                            t = Trade(rm, seg, coin, i, bar['timestamp'], bar['close'], 1, bar['atr'], sl)
                            trades.append(t)
                            new_opens += 1
                            
                    elif regime in [config.REGIME_BEAR, config.REGIME_CRASH] and not has_short:
                        for rm in ["RM1_Static", "RM2_ATR", "RM3_Swing", "RM4_HMM", "RM5_Trailing"]:
                            sl = bar['swing_h'] if not pd.isna(bar['swing_h']) else bar['close'] * 1.05
                            t = Trade(rm, seg, coin, i, bar['timestamp'], bar['close'], -1, bar['atr'], sl)
                            trades.append(t)
                            new_opens += 1
            
            if new_opens > 0:
                trades_per_period[i] += new_opens
                
    for t in trades:
        if t.status == "OPEN":
            last_close = data[t.symbol].iloc[-1]['close']
            t.close_trade(last_close, total_bars)

    print("\n" + "="*80)
    print("🚀 SIMULATION COMPLETED")
    
    hold_times = [(t.exit_idx - t.entry_idx) * 15 for t in trades if getattr(t, 'exit_idx', None)]
    avg_hold_minutes = np.mean(hold_times) if hold_times else 0
    avg_concurrent = np.mean(concurrent_trades_history) if concurrent_trades_history else 0
    
    print(f"Max Concurrent Open Trades Across Any 15m Frame: {max_concurrent_trades}")
    print(f"Average Concurrent Open Trades Per 15m Frame:    {avg_concurrent:.2f}")
    print(f"Average Trade Hold Time:                       {avg_hold_minutes:.1f} minutes ({avg_hold_minutes/60:.2f} hours)")
    print(f"Max New Trades Opened in a Single 15m Frame:    {max(trades_per_period.values()) if trades_per_period else 0}")
    print("="*80)
    
    # ─── Leverage Loop Analytics ───────────────────────────────────────────────
    print("\n📊 LEVERAGE PERFORMANCE MATRIX (Segment + Risk Manager Combos)")
    
    # Pre-group trades
    group_trades = defaultdict(list)
    for t in trades:
        group_trades[(t.segment, t.rm_id)].append(t)

    for (seg, rm_id), st_trades in group_trades.items():
        if not st_trades: continue
        
        print(f"\n--- {seg} | {rm_id} ---")
        print(f"{'Lev':<5} | {'Net PnL ($)':<12} | {'Max DD ($)':<11} | {'Win%':<6} | {'PF':<6} | {'R/R':<6} | {'Sharpe':<6}")
        
        # Sort trades by exit time to calculate true Max DD on cumulative $
        st_trades.sort(key=lambda x: x.exit_idx)
        
        for lev in LEVERAGES:
            cum_pnl = 0.0
            max_cum = 0.0
            max_dd = 0.0
            
            wins = []
            losses = []
            trade_pnls = []
            
            for t in st_trades:
                pnl = t.calculate_pnl(lev)
                trade_pnls.append(pnl)
                cum_pnl += pnl
                if cum_pnl > max_cum:
                    max_cum = cum_pnl
                dd = max_cum - cum_pnl
                if dd > max_dd:
                    max_dd = dd
                    
                if pnl > 0: wins.append(pnl)
                elif pnl < 0: losses.append(abs(pnl))
                
            win_rate = len(wins) / len(st_trades) * 100
            pf = sum(wins) / sum(losses) if losses else 999.0
            avg_win = np.mean(wins) if wins else 0
            avg_loss = np.mean(losses) if losses else 0
            rr = avg_win / avg_loss if avg_loss else 999.0
            
            std = np.std(trade_pnls)
            sharpe = (np.mean(trade_pnls) / std * np.sqrt(len(st_trades))) if std > 1e-5 else 0
            
            print(f"{lev:<4}x | ${cum_pnl:<11.2f} | ${max_dd:<10.2f} | {win_rate:>5.1f}% | {pf:>4.2f} | {rr:>4.2f} | {sharpe:>5.2f}")

if __name__ == "__main__":
    run_simulation()

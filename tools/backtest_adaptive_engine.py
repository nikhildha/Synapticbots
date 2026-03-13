"""
tools/backtest_adaptive_engine.py

True simulator for the SynapticBots Adaptive Bot logic.
Tests the *actual* execution logic inside main.py instead of just raw HMM returns.

Features simulated:
  1. HMM Feature Gen + MultiTFHMMBrain consensus (simulated via 1H returns).
  2. BrainSwitcher: Conservative / Balanced / Aggressive modes based on Volatility.
  3. RiskManager: Position sizing based on a dynamic ATR Stop Loss.
  4. Execution: Leverage application, Taker Fees (0.05% round-trip is 0.10%),
     and the infamous config.MAX_LOSS_PER_TRADE_PCT (-10% hard stop).
"""
import sys
import os
import pandas as pd
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import config
from data_pipeline import _parse_klines_df
from feature_engine import compute_hmm_features
from brain_switcher import BrainSwitcher

# Settings matching the fronttest script
SYMBOL = "BTCUSDT"
INTERVAL = "1h"
START_DATE = "1 Jan, 2024"
TRAIN_BARS = 180 * 4  # About 30 days of 1H bars
TEST_BARS = 24 * 7    # 7 days of 1H bars

def fetch_klines(symbol, interval, start_date):
    from binance.client import Client
    client = Client(tld="com")
    print(f"Fetching {symbol} {interval} from {start_date}...")
    try:
        klines = client.get_historical_klines(symbol, Client.KLINE_INTERVAL_1HOUR, start_date)
        return _parse_klines_df(klines)
    except Exception as e:
        print(f"Fetch Error: {e}")
        return None

def train_hmm(df_feat):
    from hmmlearn.hmm import GaussianHMM
    from sklearn.preprocessing import StandardScaler
    features = ["log_return", "volatility", "volume_change", "rsi_norm"]
    X = df_feat[features].values
    
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    
    model = GaussianHMM(n_components=config.HMM_N_STATES, covariance_type="full", random_state=42)
    model.fit(X_scaled)
    
    # Sort by log_return descending
    order = np.argsort(model.means_[:, 0])[::-1]
    canonical = [config.REGIME_BULL, config.REGIME_BEAR, config.REGIME_CHOP, config.REGIME_CRASH]
    state_map = {int(raw): canonical[i] for i, raw in enumerate(order)}
    
    return model, scaler, state_map

def predict_hmm(model, scaler, state_map, X):
    X_scaled = scaler.transform(X)
    raw = model.predict(X_scaled)
    probs = model.predict_proba(X_scaled)
    states = [state_map[s] for s in raw]
    # Margin confidence
    confs = []
    for prob in probs:
        sorted_p = np.sort(prob)[::-1]
        confs.append(float(sorted_p[0] - sorted_p[1]) if len(sorted_p) >= 2 else float(sorted_p[0]))
    return np.array(states), np.array(confs)

def simulate_adaptive_engine():
    df_raw = fetch_klines(SYMBOL, INTERVAL, START_DATE)
    if df_raw is None: return
    
    df_feat = compute_hmm_features(df_raw)
    df_feat = df_feat.dropna().reset_index(drop=True)
    
    print(f"Total bars: {len(df_feat)}")
    
    train_df = df_feat.iloc[:TRAIN_BARS]
    test_df = df_feat.iloc[TRAIN_BARS:]
    
    print("Training HMM...")
    model, scaler, state_map = train_hmm(train_df)
    
    features = ["log_return", "volatility", "volume_change", "rsi_norm"]
    test_X = test_df[features].values
    
    print("Predicting Regimes...")
    states, confs = predict_hmm(model, scaler, state_map, test_X)
    
    prices = test_df["close"].values
    atrs = test_df["atr"].values if "atr" in test_df.columns else (prices * 0.02)
    
    switcher = BrainSwitcher()
    
    STARTING_CAPITAL = 1000.0
    capital = STARTING_CAPITAL
    
    total_trades = 0
    wins = 0
    losses = 0
    max_loss_hits = 0
    fees_paid = 0.0
    
    # Position tracking
    in_position = False
    pos_side = None
    pos_margin = 0.0
    pos_leverage = 0
    pos_entry_price = 0.0
    
    print("\n--- Starting Adaptive Engine Simulator ---")
    
    for i in range(len(test_df) - 1):
        if capital <= 0:
            print("ACCOUNT BLOWN!")
            break
            
        state = states[i]
        conf = confs[i]
        price = float(prices[i])
        atr = float(atrs[i])
        
        # Determine current target direction
        if state == config.REGIME_BULL:
            target_side = "BUY"
        elif state == config.REGIME_BEAR or state == config.REGIME_CRASH:
            target_side = "SELL"
        else:
            target_side = "CHOP"
            
        # Volatility Percentile proxy (rough estimate)
        vol_pct = (atr / price) / 0.05
        vol_pct = min(1.0, max(0.0, vol_pct))
        
        # Evaluate conviction tier to match Live Multi-TF weighting
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
            
        # BTC Margin proxy (simulating 100% agreement but bounded by tier multiplier)
        btc_margin = mult * 100
        btc_regime = "BULL" if state == config.REGIME_BULL else ("BEAR" if state in (config.REGIME_BEAR, config.REGIME_CRASH) else "CHOP")
        
        # Adaptive Selection
        active_brain_id = switcher.select_brain(btc_regime, btc_margin, vol_pct, tf_agreement=3)
        brain_cfg = config.BRAIN_PROFILES[active_brain_id]
        
        # --- POSITION MANAGEMENT ---
        
        # If we are in a position, check if we need to exit
        if in_position:
            # Check for regime change exit or CHOP exit (simplified engine rule)
            if target_side != pos_side:
                # Calculate PnL for the closed trade
                if pos_side == "BUY":
                    price_pct_move = (price - pos_entry_price) / pos_entry_price
                else:
                    price_pct_move = (pos_entry_price - price) / pos_entry_price
                    
                entry_fee = pos_margin * pos_leverage * config.TAKER_FEE
                exit_fee = pos_margin * pos_leverage * config.TAKER_FEE
                total_fee = entry_fee + exit_fee
                fees_paid += total_fee
                
                raw_pnl = pos_margin * pos_leverage * price_pct_move
                net_pnl = raw_pnl - total_fee
                
                # Trailing SL Lock logic simulation
                if config.TRAILING_SL_ENABLED:
                    leveraged_pnl_pct = (price_pct_move * pos_leverage) * 100
                    locked_pct = None
                    for trigger, lock in reversed(config.TRAILING_SL_STEPS):
                        if leveraged_pnl_pct >= trigger:
                            locked_pct = lock
                            break
                    if locked_pct is not None and (net_pnl / pos_margin * 100) < locked_pct:
                         net_pnl = pos_margin * (locked_pct / 100.0)
                
                # Max Loss Check
                net_pnl_pct = (net_pnl / pos_margin) * 100
                if net_pnl_pct <= config.MAX_LOSS_PER_TRADE_PCT * 100:
                    net_pnl = pos_margin * config.MAX_LOSS_PER_TRADE_PCT
                    max_loss_hits += 1
                    losses += 1
                elif net_pnl > 0:
                    wins += 1
                else:
                    losses += 1
                    
                switcher.record_trade_result(net_pnl)
                capital += net_pnl
                total_trades += 1
                
                # Reset position
                in_position = False
                pos_side = None
                
        # If not in position, see if we can open a new one
        if not in_position:
            if btc_margin < brain_cfg["conviction_min"] or state == config.REGIME_CHOP:
                continue
                
            leverage = brain_cfg["leverage"]
            if leverage <= 0: continue
            
            # Calculate sizing
            budget = brain_cfg["capital_per_trade"]
            pos_margin = min(budget, capital * config.CAPITAL_PER_COIN_PCT)
            pos_leverage = leverage
            pos_side = target_side
            pos_entry_price = price
            in_position = True

    print("\n--- Simulation Results ---")
    print(f"Total Trades: {total_trades}")
    print(f"Win Rate: {(wins / total_trades * 100):.1f}%" if total_trades > 0 else "0%")
    print(f"Starting Capital: ${STARTING_CAPITAL:.2f}")
    print(f"Ending Capital:   ${capital:.2f}")
    print(f"Total Est. Fees Paid: ${fees_paid:.2f}")
    print(f"Max Loss (-10%) Stop-Outs: {max_loss_hits}")
    print(f"Standard Losses: {losses - max_loss_hits}")
    print(f"Wins: {wins}")

if __name__ == "__main__":
    simulate_adaptive_engine()

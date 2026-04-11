import pandas as pd
from strategies import bot_axiom
from data_pipeline import fetch_klines

def main():
    print("Testing bot_axiom with pandas DataFrame...")
    df = fetch_klines("BTCUSDT", "15m", limit=120)
    cache = {"BTCUSDT": df}
    prices = {"BTCUSDT": float(df["close"].iloc[-1])}
    
    signals = bot_axiom.get_signals(cache, prices)
    print("Found signals:", signals)

if __name__ == "__main__":
    main()

import pandas as pd
from strategies import bot_pyxis, bot_ratio
from data_pipeline import fetch_klines

def main():
    print("Testing bot_pyxis & bot_ratio with pandas DataFrame...")
    df = fetch_klines("BTCUSDT", "1h", limit=120)
    cache = {"BTCUSDT": df}
    prices = {"BTCUSDT": float(df["close"].iloc[-1])}
    
    signals1 = bot_pyxis.get_signals(cache, prices)
    print("Pyxis signals:", signals1)

    df2 = fetch_klines("BTCUSDT", "1d", limit=120)
    cache2 = {"BTCUSDT": df2}
    prices2 = {"BTCUSDT": float(df2["close"].iloc[-1])}
    
    signals2 = bot_ratio.get_signals(cache2, prices2)
    print("Ratio signals:", signals2)

if __name__ == "__main__":
    main()

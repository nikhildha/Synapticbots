import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from strategies.strategy_runner import StrategyRunner
import config
import asyncio

async def main():
    # Force load exactly what the engine would load
    import requests
    try:
        r = requests.get("http://127.0.0.1:3000/api/internal/active-bots", headers={"X-Synaptic-Internal": "engine-pull"})
        if r.status_code == 200:
            config.ENGINE_ACTIVE_BOTS = r.json().get("bots", [])
            print(f"Loaded {len(config.ENGINE_ACTIVE_BOTS)} active bots into memory.")
        else:
            print(f"Failed to fetch bots: {r.status_code} - {r.text}")
    except Exception as e:
        print("Could not fetch bots:", e)

    runner = StrategyRunner()
    print("Forcing Axiom run...")
    runner._run_axiom()
    
    # Check tradebook
    from tradebook import _load_book
    book = _load_book()
    trades = book.get("trades", [])
    print(f"Total trades in tradebook: {len(trades)}")
    
    if trades:
        for t in trades[-10:]:
            print(f"trade: {t.get('trade_id')} | bot_id: {t.get('bot_id')} | user_id: {t.get('user_id')} | sym: {t.get('symbol')}")

if __name__ == "__main__":
    asyncio.run(main())

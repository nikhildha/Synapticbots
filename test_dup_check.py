import sys
import logging
from tradebook import open_trade, _load_book, _save_book

logging.basicConfig(level=logging.DEBUG)

def run_test():
    # 1. Clean slate
    try:
        book = _load_book()
        print(f"Loaded existing book with {len(book.get('trades', []))} trades.")
    except Exception as e:
        book = {"trades": []}
        print("Fresh book created.")

    # We don't want to actually clear production books, so we just run the checks against the current data
    
    # Let's add a fake symbol "TESTDUP1USDT"
    symbol = "TESTDUP1USDT"

    # 2. Open first trade with Bot A, User 1
    print("\n--- TEST 1: First Bot (User 1) deploys TESTDUP1USDT ---")
    open_trade(symbol, "LONG", 10.0, 20.0, 200.0, 5.0, 
               "Bull", 90.0,
               bot_id="Bot_A_DeFi", user_id="user_1")
    
    # 3. Attempt duplicate trade with Bot B, User 1
    print("\n--- TEST 2: Second Bot (User 1) attempts TESTDUP1USDT (EXPECT SKIP) ---")
    open_trade(symbol, "LONG", 10.0, 20.0, 200.0, 5.0, 
               "Bull", 90.0,
               bot_id="Bot_B_ALL", user_id="user_1")

    # 4. Attempt trade with Bot C, User 2 (Should succeed)
    print("\n--- TEST 3: Third Bot (User 2) deploys TESTDUP1USDT (EXPECT SUCCESS) ---")
    open_trade(symbol, "LONG", 10.0, 20.0, 200.0, 5.0, 
               "Bull", 90.0,
               bot_id="Bot_C_AI", user_id="user_2")

    # 5. Verify book state
    final_book = _load_book()
    active_tests = [t for t in final_book["trades"] if t["symbol"] == symbol]
    print(f"\nFinal Active TESTDUP1USDT trades count: {len(active_tests)} (Expected 2)")
    for t in active_tests:
        print(f" -> User: {t['user_id']}, Bot: {t['bot_id']}")
    
    # Cleanup
    final_book["trades"] = [t for t in final_book["trades"] if t["symbol"] != symbol]
    _save_book(final_book)
    print("Test artifacts cleaned up.")

if __name__ == "__main__":
    run_test()

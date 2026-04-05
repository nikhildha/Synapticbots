import logging
from coin_scanner import get_hottest_segments

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")

print("Testing get_hottest_segments() with new ATR proxy...")
segments = get_hottest_segments(segment_limit=10)
print("\nReturned segments:", segments)

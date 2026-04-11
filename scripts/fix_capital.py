import sys
import os
import json
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import config

TRADEBOOK_FILE = os.path.join(config.DATA_DIR, "tradebook.json")

def fix():
    with open(TRADEBOOK_FILE, "r") as f:
        book = json.load(f)
        
    for t in book.get("trades", []):
        if t.get("capital", 0) > 200:
            t["capital"] = 100.0
            
    with open(TRADEBOOK_FILE, "w") as f:
        json.dump(book, f, indent=2)
        
    print("Fixed capital for bloated trades in tradebook.json")

if __name__ == "__main__":
    fix()

import sys
import os

# Ensure config.py can be loaded from the project root
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import config
from llm_reasoning import AthenaEngine

def main():
    engine = AthenaEngine()
    print("Testing Athena API...")
    
    # Check if API key is present
    if not config.LLM_API_KEY:
        print("API key missing in config.LLM_API_KEY")
        return
        
    print(f"Using Model: {config.LLM_MODEL}")
    
    try:
        decision = engine.validate_signal({
            "ticker": "BTCUSDT",
            "side": "LONG",
            "hmm_regime": "BULLISH",
            "hmm_confidence": 0.85,
            "conviction": 75,
            "tf_agreement": 3,
            "current_price": 65000,
            "atr": 500,
            "vol_percentile": 0.4
        })
        print(f"\nDecision: {decision.action}")
        print(f"Confidence: {decision.adjusted_confidence}")
        print(f"Reasoning: {decision.reasoning}")
    except Exception as e:
        print(f"\nCaught Exception from Athena: {e}")

if __name__ == "__main__":
    main()

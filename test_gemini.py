import json
import config
from llm_reasoning import AthenaEngine

# Mocking the request to pretend we hit the LLM and it returned a valid response
class MockResponse:
    def __init__(self, text_resp):
        self.text_resp = text_resp
    def raise_for_status(self): pass
    def json(self):
        return {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {"text": self.text_resp}
                        ]
                    }
                }
            ]
        }

valid_json = """```json
{
  "ticker": "BTCUSDT",
  "action": "LONG",
  "confidence_rating": 8,
  "adjusted_confidence": 0.8,
  "leverage_recommendation": "10x",
  "size_recommendation": "20%",
  "reasoning": "Strong momentum combined with high HMM confidence.",
  "risk_flags": ["High funding rate"],
  "support_levels": "$60,000",
  "resistance_levels": "$72,000"
}
```"""

import requests
# Monkeypatch requests.post
def mock_post(*args, **kwargs):
    return MockResponse(valid_json)
requests.post = mock_post

config.LLM_API_KEY = "test"
engine = AthenaEngine()

ctx = {
    "ticker": "BTCUSDT",
    "side": "LONG",
    "leverage": 10,
    "hmm_confidence": 0.85,
    "hmm_regime": "BULLISH",
    "conviction": 85.0,
    "current_price": 70000.0,
    "atr": 500.0,
    "atr_pct": 0.007,
    "trend": "LONG",
    "signal_type": "TREND_FOLLOW",
    "ema_15m_20": 69500.0,
    "tf_agreement": 3,
    "btc_regime": "BULLISH",
}
decision = engine.validate_signal(ctx)
print("ACTION:", decision.action)
print("REASONING:", decision.reasoning)

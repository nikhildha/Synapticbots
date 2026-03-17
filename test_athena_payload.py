import json
import config

# Provide a dummy API key just for formatting tests, or real one if needed
TEST_KEY = "test_key_not_real"
config.LLM_API_KEY = TEST_KEY
config.LLM_REASONING_ENABLED = True

from llm_reasoning import AthenaEngine

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
    "btc_margin": 0.90,
    "vol_percentile": 0.50
}

# Just test prompt generation natively without hitting network if possible
prompt = engine._build_prompt(ctx)
print("PROMPT SUCESSFULLY BUILT:")
print("="*40)
print(prompt)

import sys
import logging
from config import EXCLUDED_COINS
from feature_engine import compute_all_features
from data_pipeline import fetch_klines
from hmm_brain import HMMBrain

logging.basicConfig(level=logging.DEBUG)
df = fetch_klines("ONDOUSDT", "1h", limit=300)
if df is not None:
    feat = compute_all_features(df)
    brain = HMMBrain(symbol="ONDOUSDT")
    brain.train(feat)
    regime, conf = brain.predict(feat)
    print("SUCCESS")

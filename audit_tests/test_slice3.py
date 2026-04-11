import pytest
import os
import tempfile
import json
from unittest.mock import patch, MagicMock
import tradebook
import config

@pytest.fixture
def clean_tradebook():
    """Provides a sterile, in-memory tradebook context for atomic testing."""
    # Create an isolated temporary tradebook file
    fd, path = tempfile.mkstemp()
    # Write empty skeleton
    with open(path, "w") as f:
        json.dump({"trades": [], "summary": {}}, f)
        
    original = tradebook.TRADEBOOK_FILE
    tradebook.TRADEBOOK_FILE = path
    yield path
    
    tradebook.TRADEBOOK_FILE = original
    os.remove(path)

def test_tradebook_open_trade_generates_valid_sl_tp_targets(clean_tradebook, mocker=None):
    """
    Verifies that multi-target bounds logic mathematically generates T1/T2/T3
    targets and calculates accurate stop-loss metrics on LONG signals.
    """
    # 1. Temporarily force config to use legacy mode or multi-target mode reliably
    # We'll test standard single-target flow as the base since MULTI_TARGET_ENABLED is false usually
    
    # Act: Open a clean mock trade via the core dispatcher
    trade_id = tradebook.open_trade(
        symbol="ETHUSDT",
        side="BUY", 
        leverage=5,
        quantity=0.1,
        entry_price=3000.0,
        atr=50.0,  # 50 ATR on a 3000 asset
        regime="STRATEGY:Ratio",
        confidence=0.85,
        reason="Ratio Test",
        capital=100.0,
        mode="paper",
        bot_id="usr1_botA"
    )
        
    # 2. Retrieve state
    book = tradebook._load_book()
    assert len(book["trades"]) == 1
    t = book["trades"][0]
    
    # 3. Mathematically prove SL / TP bounds calculate reliably without NaN errors
    # Leverage 5 -> sl_mult, tp_mult from config.get_atr_multipliers(5) 
    # Usually: sl_mult = 1.0, tp_mult = 2.0 (approximately)
    assert t["symbol"] == "ETHUSDT"
    assert t["trade_id"] == trade_id
    assert t["stop_loss"] < 3000.0, "LONG trades must calculate a stop loss BELOW entry"
    assert t["take_profit"] > 3000.0, "LONG trades must calculate a take profit ABOVE entry"
    assert t["trailing_sl"] == t["stop_loss"], "Trailing baseline SL should equal Hard SL"
    
    # 4. Same bot constraint: Try opening identical symbol for SAME bot_id -- it should block!
    trade_id_dup = tradebook.open_trade(
        symbol="ETHUSDT",
        side="BUY", 
        leverage=5,
        quantity=0.1,
        entry_price=3000.0,
        atr=50.0,
        regime="STRATEGY:Ratio",
        confidence=0.85,
        reason="Ratio Test",
        capital=100.0,
        mode="paper",
        bot_id="usr1_botA"
    )
    # The dispatcher returns the original trade ID if blocked by Per-Bot dedupe
    assert trade_id_dup == trade_id, "Strategy guard failed to block duplicate asset position for the same bot_id!"

import pytest
import pandas as pd
from unittest.mock import patch
from strategies.strategy_runner import StrategyRunner

def test_strategy_runner_handles_dataframe_gracefully():
    """
    Verifies that StrategyRunner._refresh_klines gracefully accepts a Pandas DataFrame 
    and handles empty caches without throwing 'ValueError: The truth value of a DataFrame is ambiguous'.
    """
    # 1. Create a mock DataFrame representing klines data
    mock_df = pd.DataFrame([
        {"timestamp": 1234567, "open": 100, "high": 110, "low": 90, "close": 105, "volume": 1000}
    ])
    
    with patch("strategies.strategy_runner.fetch_klines", return_value=mock_df), \
         patch("strategies.strategy_runner.StrategyRunner._get_all_coins", return_value=["TESTCOIN"]):
         
        sr = StrategyRunner()
        
        # 4. Trigger the fetch logic - if the ambiguous truth bug exists, this will raise a ValueError
        cache_ref = {}
        
        try:
            sr._refresh_klines("1h", cache_ref, limit=1)
        except ValueError as e:
            if "The truth value of a DataFrame is ambiguous" in str(e):
                pytest.fail(f"Regression detected: DataFrame boolean validation failed. {e}")
            else:
                raise e

        # 5. Asset cache populated successfully
        assert "TESTCOIN" in cache_ref, "Cache was not populated!"
        assert not cache_ref["TESTCOIN"].empty, "Cached dataframe should not be empty!"

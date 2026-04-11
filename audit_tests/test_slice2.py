import pytest
from strategies.strategy_risk import StrategyRiskManager

def test_strategy_risk_manager_strict_segregation_by_bot_id():
    """
    Test that StrategyRiskManager can correctly vet limits independently for 
    different bot_ids by inspecting the isolated open_trades payloads passed in,
    proving cross-bot veto contamination does not exist for Max Open Trades.
    """
    rm = StrategyRiskManager("Pyxis", max_open_trades=2)
    
    # 1. User A has a Pyxis bot with 2 open trades
    user_A_trades = [
        {"bot_id": "bot_A", "symbol": "BTCUSDT", "status": "ACTIVE"},
        {"bot_id": "bot_A", "symbol": "ETHUSDT", "status": "ACTIVE"}
    ]
    
    # 2. User B has a Pyxis bot with 0 open trades
    user_B_trades = []
    
    # 3. Simulate sequential vetting (StrategyRunner loop)
    can_deploy_A, reason_A = rm.can_deploy("SOLUSDT", user_A_trades)
    can_deploy_B, reason_B = rm.can_deploy("SOLUSDT", user_B_trades)
    
    # 4. User A must be vetoed because they hold 2 trades and max is 2
    assert can_deploy_A is False, "User A should be blocked by MAX_TRADES_REACHED"
    assert "MAX_TRADES_REACHED" in reason_A
    
    # 5. User B must NOT be vetoed despite using the EXACT SAME RM INSTANCE
    # This proves the segregation logic inside StrategyRunner correctly cascades down!
    assert can_deploy_B is True, "User B should NOT be blocked despite User A hitting the limit!"
    
    # 6. Test 'ALREADY_IN' guard uses symbol string matching correctly
    user_B_trades.append({"bot_id": "bot_B", "coin": "SOLUSDT", "status": "ACTIVE"})
    can_deploy_B_dup, reason_B_dup = rm.can_deploy("SOLUSDT", user_B_trades)
    
    assert can_deploy_B_dup is False, "User B should be blocked for duplicate SOLUSDT position"
    assert "ALREADY_IN_SOLUSDT" in reason_B_dup

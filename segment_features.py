"""
Segment-Specific Feature Definitions

Determined via Likelihood Permutation Importance backtesting across 8 segments and 4 timeframes.
Removed noisy features (e.g. smart_money_cvd, taker_buy_ratio, vwap_dev) and prioritized the top drivers per segment.
"""

# The default all-inclusive feature set (legacy)
ALL_HMM_FEATURES = [
    "log_return", "volatility", "volume_change",
    "vol_zscore", "rel_strength_btc",
    "liquidity_vacuum", "exhaustion_tail",
    "amihud_illiquidity", "volume_trend_intensity"
]

# Optimal features identified per individual coin via 15m Permutation Likelihood
COIN_FEATURES = {
    "AAVEUSDT": [
        "vol_zscore",
        "liquidity_vacuum",
        "log_return",
        "amihud_illiquidity",
        "volume_trend_intensity",
        "rel_strength_btc",
        "exhaustion_tail"
    ],
    "ARBUSDT": [
        "vol_zscore",
        "log_return",
        "liquidity_vacuum",
        "rel_strength_btc",
        "volume_trend_intensity",
        "amihud_illiquidity",
        "exhaustion_tail"
    ],
    "ARUSDT": [
        "log_return",
        "vol_zscore",
        "rel_strength_btc",
        "liquidity_vacuum",
        "volume_trend_intensity",
        "exhaustion_tail",
        "amihud_illiquidity"
    ],
    "BTCUSDT": [
        "vol_zscore",
        "volume_trend_intensity",
        "liquidity_vacuum",
        "amihud_illiquidity",
        "exhaustion_tail",
        "volatility",
        "volume_change"
    ],
    "DOGEUSDT": [
        "vol_zscore",
        "volume_trend_intensity",
        "liquidity_vacuum",
        "log_return",
        "exhaustion_tail",
        "rel_strength_btc",
        "amihud_illiquidity"
    ],
    "ETHUSDT": [
        "vol_zscore",
        "liquidity_vacuum",
        "volume_trend_intensity",
        "amihud_illiquidity",
        "exhaustion_tail",
        "log_return",
        "volatility"
    ],
    "FETUSDT": [
        "vol_zscore",
        "liquidity_vacuum",
        "amihud_illiquidity",
        "volume_trend_intensity",
        "log_return",
        "exhaustion_tail",
        "rel_strength_btc"
    ],
    "FILUSDT": [
        "vol_zscore",
        "liquidity_vacuum",
        "amihud_illiquidity",
        "volume_trend_intensity",
        "log_return",
        "rel_strength_btc",
        "exhaustion_tail"
    ],
    "GALAUSDT": [
        "vol_zscore",
        "amihud_illiquidity",
        "liquidity_vacuum",
        "volume_trend_intensity",
        "log_return",
        "rel_strength_btc",
        "exhaustion_tail"
    ],
    "IMXUSDT": [
        "vol_zscore",
        "volume_trend_intensity",
        "log_return",
        "liquidity_vacuum",
        "rel_strength_btc",
        "amihud_illiquidity",
        "exhaustion_tail"
    ],
    "LDOUSDT": [
        "vol_zscore",
        "amihud_illiquidity",
        "liquidity_vacuum",
        "log_return",
        "volume_trend_intensity",
        "rel_strength_btc",
        "exhaustion_tail"
    ],
    "LINKUSDT": [
        "vol_zscore",
        "amihud_illiquidity",
        "liquidity_vacuum",
        "volume_trend_intensity",
        "exhaustion_tail",
        "volume_change",
        "log_return"
    ],
    "ONDOUSDT": [
        "vol_zscore",
        "log_return",
        "volume_trend_intensity",
        "amihud_illiquidity",
        "liquidity_vacuum",
        "rel_strength_btc",
        "exhaustion_tail"
    ],
    "OPUSDT": [
        "vol_zscore",
        "liquidity_vacuum",
        "volume_trend_intensity",
        "log_return",
        "amihud_illiquidity",
        "rel_strength_btc",
        "exhaustion_tail"
    ],
    "PENDLEUSDT": [
        "vol_zscore",
        "liquidity_vacuum",
        "amihud_illiquidity",
        "volume_trend_intensity",
        "log_return",
        "rel_strength_btc",
        "exhaustion_tail"
    ],
    "RUNEUSDT": [
        "vol_zscore",
        "volume_trend_intensity",
        "liquidity_vacuum",
        "exhaustion_tail",
        "amihud_illiquidity",
        "log_return",
        "volume_change"
    ],
    "SANDUSDT": [
        "vol_zscore",
        "liquidity_vacuum",
        "volume_trend_intensity",
        "log_return",
        "exhaustion_tail",
        "amihud_illiquidity",
        "rel_strength_btc"
    ],
    "SOLUSDT": [
        "vol_zscore",
        "liquidity_vacuum",
        "amihud_illiquidity",
        "volume_trend_intensity",
        "exhaustion_tail",
        "log_return",
        "rel_strength_btc"
    ],
    "UNIUSDT": [
        "log_return",
        "vol_zscore",
        "rel_strength_btc",
        "liquidity_vacuum",
        "amihud_illiquidity",
        "volume_trend_intensity",
        "exhaustion_tail"
    ],
    "WIFUSDT": [
        "vol_zscore",
        "log_return",
        "rel_strength_btc",
        "liquidity_vacuum",
        "volume_trend_intensity",
        "amihud_illiquidity",
        "exhaustion_tail"
    ]
}

def get_features_for_coin(coin: str) -> list:
    """Return the optimized feature list for a given coin, fallback to ALL if unknown."""
    return COIN_FEATURES.get(coin, ALL_HMM_FEATURES)

def get_segment_for_coin(coin: str) -> str:
    """Return the segment name for a giving coin from config.py."""
    import config
    for seg_name, coins in config.CRYPTO_SEGMENTS.items():
        if coin in coins:
            return seg_name
    return "L1"  # Default fallback

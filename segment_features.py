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
    "amihud_illiquidity", "volume_trend_intensity",
    "vwap_dist", "bb_width_norm", "rsi"
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
        "log_return",
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
    ],

    "API3USDT": [
        "vol_zscore",
        "log_return",
        "rel_strength_btc",
        "volume_trend_intensity",
        "liquidity_vacuum",
        "exhaustion_tail",
        "volume_change"
    ],
    "AVAXUSDT": [
        "vol_zscore",
        "liquidity_vacuum",
        "volume_trend_intensity",
        "amihud_illiquidity",
        "exhaustion_tail",
        "volume_change",
        "log_return"
    ],
    "AXSUSDT": [
        "vol_zscore",
        "log_return",
        "rel_strength_btc",
        "volume_trend_intensity",
        "exhaustion_tail",
        "liquidity_vacuum",
        "volume_change"
    ],
    "BNBUSDT": [
        "vol_zscore",
        "volume_trend_intensity",
        "exhaustion_tail",
        "volume_change",
        "liquidity_vacuum",
        "volatility",
        "log_return"
    ],
    "CRVUSDT": [
        "amihud_illiquidity",
        "exhaustion_tail",
        "vol_zscore",
        "log_return",
        "rel_strength_btc",
        "volume_trend_intensity",
        "liquidity_vacuum"
    ],
    "DYMUSDT": [
        "vol_zscore",
        "log_return",
        "rel_strength_btc",
        "volume_trend_intensity",
        "exhaustion_tail",
        "liquidity_vacuum",
        "volume_change"
    ],
    "INJUSDT": [
        "vol_zscore",
        "volume_trend_intensity",
        "liquidity_vacuum",
        "amihud_illiquidity",
        "log_return",
        "rel_strength_btc",
        "exhaustion_tail"
    ],
    "IOTXUSDT": [
        "vol_zscore",
        "log_return",
        "rel_strength_btc",
        "volume_trend_intensity",
        "exhaustion_tail",
        "volatility",
        "volume_change"
    ],
    "JUPUSDT": [
        "vol_zscore",
        "volume_trend_intensity",
        "liquidity_vacuum",
        "amihud_illiquidity",
        "log_return",
        "rel_strength_btc",
        "exhaustion_tail"
    ],
    "PIXELUSDT": [
        "log_return",
        "rel_strength_btc",
        "vol_zscore",
        "volume_trend_intensity",
        "exhaustion_tail",
        "volatility",
        "liquidity_vacuum"
    ],
    "POLUSDT": [
        "vol_zscore",
        "liquidity_vacuum",
        "volume_trend_intensity",
        "amihud_illiquidity",
        "log_return",
        "rel_strength_btc",
        "exhaustion_tail"
    ],
    "POLYXUSDT": [
        "vol_zscore",
        "volume_trend_intensity",
        "exhaustion_tail",
        "log_return",
        "rel_strength_btc",
        "volume_change",
        "liquidity_vacuum"
    ],
    "PYTHUSDT": [
        "vol_zscore",
        "log_return",
        "rel_strength_btc",
        "volume_trend_intensity",
        "liquidity_vacuum",
        "amihud_illiquidity",
        "exhaustion_tail"
    ],
    "RONINUSDT": [
        "vol_zscore",
        "log_return",
        "rel_strength_btc",
        "liquidity_vacuum",
        "volume_trend_intensity",
        "exhaustion_tail",
        "amihud_illiquidity"
    ],
    "STRKUSDT": [
        "vol_zscore",
        "volume_trend_intensity",
        "liquidity_vacuum",
        "amihud_illiquidity",
        "exhaustion_tail",
        "log_return",
        "rel_strength_btc"
    ],
    "SUIUSDT": [
        "vol_zscore",
        "liquidity_vacuum",
        "volume_trend_intensity",
        "log_return",
        "amihud_illiquidity",
        "rel_strength_btc",
        "exhaustion_tail"
    ],
    "TAOUSDT": [
        "vol_zscore",
        "liquidity_vacuum",
        "log_return",
        "rel_strength_btc",
        "amihud_illiquidity",
        "volume_trend_intensity",
        "exhaustion_tail"
    ],
    "TIAUSDT": [
        "vol_zscore",
        "amihud_illiquidity",
        "liquidity_vacuum",
        "volume_trend_intensity",
        "log_return",
        "rel_strength_btc",
        "exhaustion_tail"
    ],
    "TRBUSDT": [
        "vol_zscore",
        "liquidity_vacuum",
        "amihud_illiquidity",
        "volume_trend_intensity",
        "log_return",
        "rel_strength_btc",
        "exhaustion_tail"
    ],
    "TRUUSDT": [
        "vol_zscore",
        "rel_strength_btc",
        "volume_trend_intensity",
        "log_return",
        "exhaustion_tail",
        "volume_change",
        "liquidity_vacuum"
    ],
    "WLDUSDT": [
        "vol_zscore",
        "liquidity_vacuum",
        "volume_trend_intensity",
        "amihud_illiquidity",
        "exhaustion_tail",
        "log_return",
        "volume_change"
    ],
    "ADAUSDT": [
        "exhaustion_tail",
        "vol_zscore",
        "volume_trend_intensity",
        "volatility",
        "liquidity_vacuum",
        "log_return",
        "amihud_illiquidity",
        "vwap_dist",
        "bb_width_norm",
        "rel_strength_btc"
    ],
    "APTUSDT": [
        "log_return",
        "volatility",
        "volume_change",
        "vol_zscore",
        "rel_strength_btc",
        "liquidity_vacuum",
        "exhaustion_tail",
        "vwap_dist",
        "bb_width_norm"
    ],
    "BCHUSDT": [
        "log_return",
        "volatility",
        "volume_change",
        "vol_zscore",
        "rel_strength_btc",
        "liquidity_vacuum",
        "exhaustion_tail",
        "vwap_dist",
        "bb_width_norm"
    ],
    "DOTUSDT": [
        "exhaustion_tail",
        "vol_zscore",
        "volume_trend_intensity",
        "volatility",
        "liquidity_vacuum",
        "amihud_illiquidity",
        "log_return",
        "vwap_dist",
        "bb_width_norm",
        "rel_strength_btc"
    ],
    "ETCUSDT": [
        "exhaustion_tail",
        "vol_zscore",
        "amihud_illiquidity",
        "volatility",
        "volume_trend_intensity",
        "liquidity_vacuum",
        "vwap_dist",
        "bb_width_norm",
        "rel_strength_btc"
    ],
    "HBARUSDT": [
        "exhaustion_tail",
        "vol_zscore",
        "volume_trend_intensity",
        "liquidity_vacuum",
        "volatility",
        "log_return",
        "vwap_dist",
        "bb_width_norm",
        "rel_strength_btc"
    ],
    "ICPUSDT": [
        "exhaustion_tail",
        "amihud_illiquidity",
        "liquidity_vacuum",
        "vol_zscore",
        "log_return",
        "volume_trend_intensity",
        "rsi",
        "vwap_dist",
        "bb_width_norm",
        "rel_strength_btc"
    ],

    "NEARUSDT": [
        "exhaustion_tail",
        "vol_zscore",
        "vwap_dist",
        "volume_trend_intensity",
        "liquidity_vacuum",
        "amihud_illiquidity",
        "rsi",
        "bb_width_norm",
        "rel_strength_btc"
    ],
    "TONUSDT": [
        "exhaustion_tail",
        "amihud_illiquidity",
        "liquidity_vacuum",
        "vol_zscore",
        "log_return",
        "volatility",
        "volume_trend_intensity",
        "vwap_dist",
        "bb_width_norm",
        "rel_strength_btc"
    ],
    "TRXUSDT": [
        "exhaustion_tail",
        "vol_zscore",
        "volatility",
        "log_return",
        "liquidity_vacuum",
        "vwap_dist",
        "amihud_illiquidity",
        "bb_width_norm",
        "rel_strength_btc"
    ],
    "XRPUSDT": [
        "exhaustion_tail",
        "vol_zscore",
        "volume_trend_intensity",
        "amihud_illiquidity",
        "log_return",
        "volatility",
        "volume_change",
        "vwap_dist",
        "bb_width_norm",
        "rel_strength_btc"
    ],
    "MANTAUSDT": [
        "exhaustion_tail",
        "liquidity_vacuum",
        "amihud_illiquidity",
        "vol_zscore",
        "log_return",
        "volume_trend_intensity",
        "volatility",
        "vwap_dist",
        "bb_width_norm",
        "rel_strength_btc"
    ],
    "METISUSDT": [
        "exhaustion_tail",
        "amihud_illiquidity",
        "vol_zscore",
        "liquidity_vacuum",
        "log_return",
        "volume_trend_intensity",
        "volatility",
        "vwap_dist",
        "bb_width_norm",
        "rel_strength_btc"
    ],
    "ZKUSDT": [
        "exhaustion_tail",
        "vol_zscore",
        "volume_trend_intensity",
        "volatility",
        "liquidity_vacuum",
        "amihud_illiquidity",
        "log_return",
        "vwap_dist",
        "bb_width_norm",
        "rel_strength_btc"
    ],
    "CAKEUSDT": [
        "exhaustion_tail",
        "vol_zscore",
        "volatility",
        "log_return",
        "vwap_dist",
        "volume_trend_intensity",
        "bb_width_norm",
        "rel_strength_btc"
    ],
    "COMPUSDT": [
        "exhaustion_tail",
        "vol_zscore",
        "amihud_illiquidity",
        "liquidity_vacuum",
        "volume_trend_intensity",
        "log_return",
        "volume_change",
        "vwap_dist",
        "bb_width_norm",
        "rel_strength_btc"
    ],
    "GMXUSDT": [
        "exhaustion_tail",
        "amihud_illiquidity",
        "vol_zscore",
        "liquidity_vacuum",
        "volume_trend_intensity",
        "log_return",
        "volatility",
        "vwap_dist",
        "bb_width_norm",
        "rel_strength_btc"
    ],
    "JTOUSDT": [
        "exhaustion_tail",
        "vol_zscore",
        "volume_trend_intensity",
        "amihud_illiquidity",
        "liquidity_vacuum",
        "volatility",
        "log_return",
        "vwap_dist",
        "bb_width_norm",
        "rel_strength_btc"
    ],
    "SNXUSDT": [
        "exhaustion_tail",
        "rsi",
        "vwap_dist",
        "vol_zscore",
        "amihud_illiquidity",
        "log_return",
        "volume_trend_intensity",
        "bb_width_norm",
        "rel_strength_btc"
    ],
    "SUSHIUSDT": [
        "exhaustion_tail",
        "amihud_illiquidity",
        "liquidity_vacuum",
        "vol_zscore",
        "log_return",
        "volume_trend_intensity",
        "volatility",
        "vwap_dist",
        "bb_width_norm",
        "rel_strength_btc"
    ],
    "ARKMUSDT": [
        "exhaustion_tail",
        "vol_zscore",
        "volume_trend_intensity",
        "volatility",
        "amihud_illiquidity",
        "liquidity_vacuum",
        "log_return",
        "vwap_dist",
        "bb_width_norm",
        "rel_strength_btc"
    ],
    "GLMUSDT": [
        "exhaustion_tail",
        "vol_zscore",
        "volume_trend_intensity",
        "volatility",
        "liquidity_vacuum",
        "amihud_illiquidity",
        "log_return",
        "vwap_dist",
        "bb_width_norm",
        "rel_strength_btc"
    ],
    "GRTUSDT": [
        "exhaustion_tail",
        "vol_zscore",
        "volume_trend_intensity",
        "amihud_illiquidity",
        "liquidity_vacuum",
        "rsi",
        "log_return",
        "vwap_dist",
        "bb_width_norm",
        "rel_strength_btc"
    ],
    "IOUSDT": [
        "log_return",
        "volatility",
        "volume_change",
        "vol_zscore",
        "rel_strength_btc",
        "liquidity_vacuum",
        "exhaustion_tail",
        "vwap_dist",
        "bb_width_norm"
    ],
    "RENDERUSDT": [
        "log_return",
        "volatility",
        "volume_change",
        "vol_zscore",
        "rel_strength_btc",
        "liquidity_vacuum",
        "exhaustion_tail",
        "vwap_dist",
        "bb_width_norm"
    ],
    # NOTE: 1000BONKUSDT/PEPEUSDT/SHIBUSDT are futures-only — spot versions below
    # NOTE: MEWUSDT, AKTUSDT, KASUSDT not listed on Binance spot
    "NOTUSDT": [
        "exhaustion_tail",
        "vol_zscore",
        "amihud_illiquidity",
        "liquidity_vacuum",
        "log_return",
        "volume_trend_intensity",
        "volatility",
        "vwap_dist",
        "bb_width_norm",
        "rel_strength_btc"
    ],
    "ENJUSDT": [
        "log_return",
        "volatility",
        "volume_change",
        "vol_zscore",
        "rel_strength_btc",
        "liquidity_vacuum",
        "exhaustion_tail",
        "vwap_dist",
        "bb_width_norm"
    ],
    "MANAUSDT": [
        "exhaustion_tail",
        "vol_zscore",
        "amihud_illiquidity",
        "volume_trend_intensity",
        "liquidity_vacuum",
        "log_return",
        "volatility",
        "vwap_dist",
        "bb_width_norm",
        "rel_strength_btc"
    ],
    "YGGUSDT": [
        "exhaustion_tail",
        "amihud_illiquidity",
        "vol_zscore",
        "liquidity_vacuum",
        "volume_trend_intensity",
        "log_return",
        "volatility",
        "vwap_dist",
        "bb_width_norm",
        "rel_strength_btc"
    ],
    "AXLUSDT": [
        "exhaustion_tail",
        "liquidity_vacuum",
        "log_return",
        "amihud_illiquidity",
        "vol_zscore",
        "volume_trend_intensity",
        "volatility",
        "vwap_dist",
        "bb_width_norm",
        "rel_strength_btc"
    ],
    "QNTUSDT": [
        "exhaustion_tail",
        "vol_zscore",
        "amihud_illiquidity",
        "volume_trend_intensity",
        "liquidity_vacuum",
        "volatility",
        "log_return",
        "vwap_dist",
        "bb_width_norm",
        "rel_strength_btc"
    ],
    "STXUSDT": [
        "exhaustion_tail",
        "vol_zscore",
        "volume_trend_intensity",
        "amihud_illiquidity",
        "volatility",
        "volume_change",
        "liquidity_vacuum",
        "vwap_dist",
        "bb_width_norm",
        "rel_strength_btc"
    ],

    "ENAUSDT": [
        "vol_zscore",
        "amihud_illiquidity",
        "liquidity_vacuum",
        "log_return",
        "volume_trend_intensity",
        "exhaustion_tail",
        "vwap_dist",
        "bb_width_norm",
        "rel_strength_btc"
    ],

    # ── Meme: same-coin proxies (1000x denomination equivalents) ─────────────
    "BONKUSDT": [
        "log_return",
        "volatility",
        "volume_change",
        "vol_zscore",
        "rel_strength_btc",
        "liquidity_vacuum",
        "exhaustion_tail",
        "vwap_dist",
        "bb_width_norm"
    ],

    "PEPEUSDT": [
        "exhaustion_tail",
        "vol_zscore",
        "liquidity_vacuum",
        "volume_trend_intensity",
        "volatility",
        "log_return",
        "amihud_illiquidity",
        "vwap_dist",
        "bb_width_norm",
        "rel_strength_btc"
    ],

    "SHIBUSDT": [
        "exhaustion_tail",
        "vol_zscore",
        "amihud_illiquidity",
        "volume_trend_intensity",
        "liquidity_vacuum",
        "volatility",
        "log_return",
        "vwap_dist",
        "bb_width_norm",
        "rel_strength_btc"
    ],

    # ── L2: Mantle — thin L2 book, vacuum-dominant (proxy: OPUSDT) ───────────

    # ── DePIN: IoT/wireless infra — narrative-driven (proxy: ARUSDT) ─────────
    "HNTUSDT": [
        "log_return",
        "vol_zscore",
        "rel_strength_btc",
        "liquidity_vacuum",
        "volume_trend_intensity",
        "exhaustion_tail",
        "amihud_illiquidity",
        "vwap_dist",
        "bb_width_norm"
    ],
}

def get_features_for_coin(coin: str) -> list:
    """Return the optimized feature list plus the mandatory structural features.

    NOTE: rel_strength_btc is skipped for BTCUSDT — for BTC itself this feature
    is always ~0 (BTC vs BTC = noise, raw_std≈1e-6), which causes GMMHMM's
    log-likelihood to diverge to -inf → NaN in predict_proba → 0% confidence.
    """
    base = list(COIN_FEATURES.get(coin, ALL_HMM_FEATURES))
    # Ensure the new structural regime features are dynamically applied to every coin
    mandatory = ["vwap_dist", "bb_width_norm", "rel_strength_btc"]
    for f in mandatory:
        if f not in base:
            # rel_strength_btc is meaningless for BTCUSDT itself (zero variance → NaN)
            if f == "rel_strength_btc" and coin == "BTCUSDT":
                continue
            base.append(f)
    return base

def get_segment_for_coin(coin: str) -> str:
    """Return the segment name for a giving coin from config.py."""
    import config
    for seg_name, coins in config.CRYPTO_SEGMENTS.items():
        if coin in coins:
            return seg_name
    return "L1"  # Default fallback

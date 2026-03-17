"""
Project Regime-Master — Risk Manager
Position sizing, dynamic leverage, kill switch, and ATR-based stops.
"""
import json
import logging
import numpy as np
from datetime import datetime

import config

logger = logging.getLogger("RiskManager")


class RiskManager:
    """
    Enforces the "Anti-Liquidation" rules:
      • 2% risk per trade
      • Dynamic leverage based on HMM confidence
      • Kill switch on 10% drawdown in 24h
      • ATR-based stop-loss placement
    """

    def __init__(self):
        self.equity_history = []   # List of (timestamp, balance) tuples
        self._killed = False

    # ─── Dynamic Leverage ────────────────────────────────────────────────────

    @staticmethod
    def get_dynamic_leverage(confidence, regime):
        """
        Map HMM confidence and regime → leverage multiplier.

        Rules (updated):
          • Crash regime → 0 (stay out)
          • Chop regime  → 15x (mean reversion)
          • Trend (Bull/Bear):
              confidence ≥ 95%  → 35x
              confidence 91–95% → 25x
              confidence 85–90% → 15x
              confidence < 85%  → 0 (DO NOT DEPLOY)

        Parameters
        ----------
        confidence : float (0..1)
        regime : int (config.REGIME_*)

        Returns
        -------
        int : leverage value (0 = skip trade)
        """
        # NOTE: With HMM_N_STATES=3, CRASH is merged into BEAR — no separate check needed.

        # Chop regime → low leverage for mean reversion (still requires 85%+ confidence)
        if regime == config.REGIME_CHOP:
            return config.LEVERAGE_LOW if confidence >= config.CONFIDENCE_LOW else 0

        # Trend regimes (Bull / Bear) — scale by confidence
        # > 95% → 35x
        if confidence >= config.CONFIDENCE_HIGH:
            return config.LEVERAGE_HIGH
        # 91–95% → 25x
        elif confidence >= config.CONFIDENCE_MEDIUM:
            return config.LEVERAGE_MODERATE
        # 85–90% → 15x
        elif confidence >= config.CONFIDENCE_LOW:
            return config.LEVERAGE_LOW
        else:
            return 0  # Below 85% — do not deploy

    # ─── Position Sizing (2% Rule) ───────────────────────────────────────────

    @staticmethod
    def calculate_position_size(balance, entry_price, atr, leverage=1, risk_pct=None):
        """
        Position size so that a 1-ATR adverse move ≤ risk_pct of balance.
        
        Formula:
          risk_amount = balance * risk_pct
          stop_distance = atr * ATR_SL_MULTIPLIER
          raw_qty = risk_amount / stop_distance
          leveraged_qty = raw_qty  (leverage amplifies PnL, not qty)
        
        Returns
        -------
        float : quantity in base asset
        """
        risk_pct = risk_pct or config.RISK_PER_TRADE
        risk_amount = balance * risk_pct
        stop_distance = atr * config.get_atr_multipliers(leverage)[0]

        if stop_distance <= 0 or entry_price <= 0:
            return config.DEFAULT_QUANTITY

        quantity = risk_amount / stop_distance
        # Ensure we don't exceed balance even with leverage
        max_qty = (balance * leverage) / entry_price
        quantity = min(quantity, max_qty)

        # Round to reasonable precision
        quantity = round(quantity, 6)
        return max(quantity, 0.0001)  # Binance minimum

    # ─── Margin-First Position Sizing ────────────────────────────────────────

    @staticmethod
    def calculate_margin_first_position(margin, price, atr, conviction_leverage,
                                         max_risk_pct=None):
        """
        Margin-first position sizing: margin is fixed, leverage is reduced to
        keep SL loss ≤ max_risk_pct.

        Parameters
        ----------
        margin : float            User's capital_per_trade (e.g. $100)
        price : float             Current entry price
        atr : float               Current ATR value
        conviction_leverage : int  Desired leverage from conviction score
        max_risk_pct : float       Max loss % at SL (e.g. 15.0 = 15%)

        Returns
        -------
        (quantity: float, final_leverage: int)
            quantity=0 means trade should be skipped (risk too high even at floor)
        """
        max_risk = max_risk_pct or abs(config.MAX_LOSS_PER_TRADE_PCT)
        leverage_tiers = [35, 25, 15, 10, 5]

        final_leverage = 0
        for lev in leverage_tiers:
            if lev > conviction_leverage:
                continue
            sl_mult, _ = config.get_atr_multipliers(lev)
            loss_at_sl = (atr * sl_mult / price) * lev * 100  # % of margin
            if loss_at_sl <= max_risk:
                final_leverage = lev
                break

        if final_leverage < config.MIN_LEVERAGE_FLOOR:
            logger.info("⚠️ Leverage would be %dx (below floor %dx) — skipping trade "
                        "(ATR=%.6f, price=%.2f, conviction_lev=%dx)",
                        final_leverage, config.MIN_LEVERAGE_FLOOR, atr, price,
                        conviction_leverage)
            return 0.0, 0

        notional = margin * final_leverage
        quantity = notional / price
        quantity = round(quantity, 6)
        quantity = max(quantity, 0.0001)

        if final_leverage < conviction_leverage:
            logger.info("📉 Leverage reduced: %dx → %dx (ATR risk cap, "
                        "ATR=%.6f, price=%.2f)", conviction_leverage,
                        final_leverage, atr, price)

        return quantity, final_leverage

    # ─── ATR Stop Loss / Take Profit ─────────────────────────────────────────

    @staticmethod
    def calculate_atr_stops(entry_price, atr, side, leverage=1):
        """
        Compute SL and TP based on ATR, adjusted for leverage.
        
        Parameters
        ----------
        entry_price : float
        atr : float
        side : str ('BUY' or 'SELL')
        leverage : int
        
        Returns
        -------
        (stop_loss: float, take_profit: float)
        """
        sl_mult, tp_mult = config.get_atr_multipliers(leverage)
        sl_dist = atr * sl_mult
        tp_dist = atr * tp_mult

        # Adaptive precision: more decimals for cheaper coins
        if entry_price >= 100:
            decimals = 2
        elif entry_price >= 1:
            decimals = 4
        else:
            decimals = 6

        if side == "BUY":
            stop_loss   = round(entry_price - sl_dist, decimals)
            take_profit = round(entry_price + tp_dist, decimals)
        else:
            stop_loss   = round(entry_price + sl_dist, decimals)
            take_profit = round(entry_price - tp_dist, decimals)

        return stop_loss, take_profit

    @staticmethod
    def calculate_optimal_stops(symbol, entry_price, atr, side, leverage=1, swing_l=None, swing_h=None):
        """
        Compute Stop Loss and Take Profit optimally selected per coin segment.
        Returns (stop_loss, take_profit, rm_id).
        """
        rm_id = config.get_optimal_rm(symbol)
        
        if entry_price >= 100:
            decimals = 2
        elif entry_price >= 1:
            decimals = 4
        else:
            decimals = 6

        direction = 1 if side == "BUY" else -1

        if rm_id == "RM1_Static":
            sl = entry_price * (1 - direction * 0.05)
            tp = entry_price * (1 + direction * 0.10)
        elif rm_id == "RM2_ATR":
            segment = None
            for seg, coins in config.CRYPTO_SEGMENTS.items():
                if symbol in coins:
                    segment = seg
                    break
            m = 3.5 if segment in ["Meme", "AI"] else 2.5
            sl = entry_price - direction * (m * atr)
            tp = entry_price + direction * (m * 2.0 * atr)
        elif rm_id == "RM3_Swing":
            swing_lh = swing_l if side == "BUY" else swing_h
            if swing_lh is not None and not np.isnan(swing_lh) and swing_lh > 0:
                sl = swing_lh
                # Ensure the swing stop isn't placed ON the wrong side of the entry price (highly unlikely but protects bounds)
                if (side == "BUY" and sl >= entry_price) or (side == "SELL" and sl <= entry_price):
                    sl = entry_price - direction * (3.0 * atr)
            else:
                sl = entry_price - direction * (3.0 * atr)
            
            risk_dist = abs(entry_price - sl)
            tp = entry_price + direction * (risk_dist * 2.5) # Generous 2.5 RR for swings
        elif rm_id == "RM5_Trailing":
            sl = entry_price - direction * (1.5 * atr)
            tp = entry_price + direction * (5.0 * atr) # Actual trailing happens dynamically in tradebook
        else:
            # Fallback
            sl_val, tp_val = RiskManager.calculate_atr_stops(entry_price, atr, side, leverage)
            return sl_val, tp_val, rm_id

        return round(sl, decimals), round(tp, decimals), rm_id

    # ─── Kill Switch ─────────────────────────────────────────────────────────

    def record_equity(self, balance):
        """Record current equity for drawdown monitoring."""
        self.equity_history.append((datetime.utcnow(), balance))
        # Keep only last 24h
        cutoff = datetime.utcnow().timestamp() - 86400
        self.equity_history = [
            (t, b) for t, b in self.equity_history
            if t.timestamp() > cutoff
        ]

    def check_kill_switch(self):
        """
        If portfolio dropped ≥ KILL_SWITCH_DRAWDOWN (10%) in the last 24h → KILL.
        
        Returns
        -------
        bool : True if kill switch triggered
        """
        if self._killed:
            return True

        if len(self.equity_history) < 2:
            return False

        peak = max(b for _, b in self.equity_history)
        current = self.equity_history[-1][1]

        drawdown = (peak - current) / peak if peak > 0 else 0

        if drawdown >= config.KILL_SWITCH_DRAWDOWN:
            logger.critical(
                "KILL SWITCH TRIGGERED! Drawdown: %.2f%% (peak=%.2f, now=%.2f)",
                drawdown * 100, peak, current,
            )
            self._killed = True
            # Write kill command
            self._write_kill_command()
            return True

        return False

    def _write_kill_command(self):
        """Persist kill command so dashboard can detect it."""
        try:
            with open(config.COMMANDS_FILE, "w") as f:
                json.dump({"command": "KILL", "timestamp": datetime.utcnow().isoformat()}, f)
        except Exception as e:
            logger.error("Failed to write kill command: %s", e)

    def reset_kill_switch(self):
        """Manual reset (via dashboard)."""
        self._killed = False
        self.equity_history.clear()
        logger.info("Kill switch reset.")

    @property
    def is_killed(self):
        return self._killed

    # ─── Conviction Scoring (8-factor, 0-100) ─────────────────────────────────

    @staticmethod
    def _score_hmm(confidence: float) -> float:
        """Factor 1: HMM confidence quality (max 22 pts).
        Higher confidence = stronger regime signal = higher score contribution."""
        if confidence is None:
            return 0.0
        w = config.CONVICTION_WEIGHT_HMM
        if confidence >= config.HMM_CONF_TIER_HIGH:
            return w
        elif confidence >= config.HMM_CONF_TIER_MED_HIGH:
            return w * 0.85
        elif confidence >= config.HMM_CONF_TIER_MED:
            return w * 0.65
        elif confidence >= config.HMM_CONF_TIER_LOW:
            return w * 0.40
        return 0.0  # below minimum confidence — no contribution

    @staticmethod
    def _score_btc_macro(btc_regime, regime: int, side: str) -> float:
        """Factor 2: BTC macro regime alignment (max pts).
        Penalises trading against macro trend."""
        w = config.CONVICTION_WEIGHT_BTC_MACRO
        if btc_regime is None:
            return w * 0.50  # no BTC data — neutral half
        # NOTE: With HMM_N_STATES=3, CRASH is merged into BEAR — no separate crash penalty
        if (side == "BUY"  and btc_regime == config.REGIME_BULL) or \
           (side == "SELL" and btc_regime == config.REGIME_BEAR):
            return w           # aligned with macro
        if (side == "BUY"  and btc_regime == config.REGIME_BEAR) or \
           (side == "SELL" and btc_regime == config.REGIME_BULL):
            return -config.CONVICTION_MACRO_FIGHT_PENALTY
        return w * 0.35        # chop / unknown — small boost

    @staticmethod
    def _score_funding(funding_rate, side: str) -> float:
        """Factor 3: Funding rate carry signal (max 12 pts).
        Negative funding favours longs; positive funding favours shorts."""
        w = config.CONVICTION_WEIGHT_FUNDING
        if funding_rate is None:
            return w * 0.55  # no data — mild positive
        if side == "BUY":
            if funding_rate < config.FUNDING_NEG_STRONG:
                return w       # longs paid — full score
            if funding_rate < config.FUNDING_POS_MED:
                return w * 0.55
            return -config.CONVICTION_FUNDING_PENALTY  # crowded longs
        else:  # SELL
            if funding_rate > config.FUNDING_POS_STRONG:
                return w       # shorts paid — full score
            if funding_rate > config.FUNDING_NEG_MED:
                return w * 0.55
            return -config.CONVICTION_FUNDING_PENALTY

    @staticmethod
    def _score_sr_vwap(sr_position, vwap_position, side: str) -> float:
        """Factor 4: Support/Resistance + VWAP position (max 10 pts).
        sr_position: 0=at support, 1=at resistance. vwap_position: >0 above VWAP."""
        w = config.CONVICTION_WEIGHT_SR_VWAP
        if sr_position is None and vwap_position is None:
            return w * 0.45  # no data — mild positive
        sr_pts, vwap_pts = 0.0, 0.0
        if sr_position is not None:
            sr_pts = (1.0 - sr_position if side == "BUY" else sr_position) * (w * 0.6)
        if vwap_position is not None:
            if (side == "BUY" and vwap_position > 0) or (side == "SELL" and vwap_position < 0):
                vwap_pts = w * 0.4
        return sr_pts + vwap_pts

    @staticmethod
    def _score_oi(oi_change, side: str) -> float:
        """Factor 5: Open Interest change (max 8 pts).
        Growing OI confirms fresh positioning; falling OI signals unwinding."""
        w = config.CONVICTION_WEIGHT_OI
        if oi_change is None:
            return w * 0.50
        if side == "BUY":
            if oi_change > config.OI_CHANGE_HIGH:
                return w       # OI growing → strong positioning
            if oi_change > config.OI_CHANGE_MED:
                return w * 0.60
            if oi_change < config.OI_CHANGE_NEG_HIGH:
                return -config.CONVICTION_OI_PENALTY  # OI falling → short-covering risk
            return w * 0.30
        else:  # SELL
            if oi_change < config.OI_CHANGE_NEG_HIGH:
                return w       # OI falling → shorts winning
            if oi_change < config.OI_CHANGE_NEG_MED:
                return w * 0.60
            if oi_change > config.OI_CHANGE_HIGH:
                return -config.CONVICTION_OI_PENALTY
            return w * 0.30

    @staticmethod
    def _score_volatility(volatility) -> float:
        """Factor 6: Volatility quality filter (max 5 pts).
        Ideal vol is between VOL_MIN and 50% of VOL_MAX; extreme vol reduces score."""
        w = config.CONVICTION_WEIGHT_VOL
        if volatility is None:
            return w * 0.60
        if config.VOL_MIN_ATR_PCT <= volatility <= config.VOL_MAX_ATR_PCT * 0.5:
            return w           # ideal range
        if volatility <= config.VOL_MAX_ATR_PCT:
            return w * 0.60
        return w * 0.10        # too volatile

    @staticmethod
    def _score_sentiment(sentiment_score) -> float:
        """Factor 7: News/social sentiment (max 15 pts).
        Strongly negative news → penalty; strongly positive → full score."""
        w = config.CONVICTION_WEIGHT_SENTIMENT
        if sentiment_score is None:
            return w * 0.30    # no data — mild
        if sentiment_score < config.SENTIMENT_VETO_THRESHOLD:
            return -config.CONVICTION_SENTIMENT_STRONG_PENALTY
        if sentiment_score < config.CONVICTION_SENTIMENT_NEG_THRESHOLD:
            return -config.CONVICTION_SENTIMENT_MILD_PENALTY
        if sentiment_score < -config.CONVICTION_SENTIMENT_NEG_THRESHOLD:
            return w * 0.30    # neutral band
        if sentiment_score < config.SENTIMENT_STRONG_POS:
            return w * 0.75    # moderately positive
        return w               # strongly positive

    @staticmethod
    def _score_orderflow(orderflow_score, side: str) -> float:
        """Factor 8: Order-book flow alignment (max 10 pts).
        Aligned taker flow confirms direction; opposing flow penalises."""
        w = config.CONVICTION_WEIGHT_ORDERFLOW
        if orderflow_score is None:
            return 0.0
        # Map to trade-aligned direction: positive = aligned with our side
        aligned = orderflow_score if side == "BUY" else -orderflow_score
        if aligned > 0.5:
            return w           # strong flow confirmation
        if aligned > 0.2:
            return w * 0.70
        if aligned > -0.2:
            return w * 0.30    # neutral flow
        if aligned > -0.5:
            return -config.CONVICTION_FLOW_MILD_PENALTY
        return -config.CONVICTION_FLOW_STRONG_PENALTY

    @staticmethod
    def compute_conviction_score(
        confidence: float,
        regime: int,
        side: str,
        btc_regime=None,
        funding_rate=None,
        sr_position=None,
        vwap_position=None,
        oi_change=None,
        volatility=None,
        sentiment_score=None,
        orderflow_score=None,
    ) -> float:
        """
        Compute a 0–100 conviction score from 5 active factors.

        Active Factors
        ──────────────
        1. HMM Confidence       (61 pts) — core signal quality
        2. BTC Macro Regime      (7 pts) — macro alignment
        3. Funding Rate         (11 pts) — perpetual swap carry signal
        4. Open Interest Change (11 pts) — smart-money positioning
        5. Order Flow           (10 pts) — L2 depth + taker flow + cumDelta

        REMOVED: Sentiment (0 pts), S/R + VWAP (0 pts), Volatility (0 pts)

        Total max = 100 pts.
        Conviction → leverage via get_conviction_leverage().
        """
        score = (
            RiskManager._score_hmm(confidence)
            + RiskManager._score_btc_macro(btc_regime, regime, side)
            + RiskManager._score_funding(funding_rate, side)
            + RiskManager._score_oi(oi_change, side)
            + RiskManager._score_orderflow(orderflow_score, side)
        )
        return float(max(0.0, min(100.0, score)))


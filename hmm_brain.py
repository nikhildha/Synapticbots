"""
Project Regime-Master — HMM Brain
Gaussian Hidden Markov Model for market regime classification.
States: Bull (0), Bear (1), Chop (2)  — 3-state model (CRASH merged into BEAR)

Confidence: margin = best_prob - 2nd_best_prob (replaces raw max-posterior,
which was always 99%+ regardless of actual accuracy — completely uncalibrated).
"""
import numpy as np
import logging
from datetime import datetime
from hmmlearn.hmm import GaussianHMM, GMMHMM

import config

logger = logging.getLogger("HMMBrain")

# Suppress noisy hmmlearn warnings (e.g. "transmat_ zero sum" for rare states)
logging.getLogger("hmmlearn.base").setLevel(logging.ERROR)

from segment_features import ALL_HMM_FEATURES, get_features_for_coin, get_segment_for_coin

# (Legacy fallback)
HMM_FEATURES = ALL_HMM_FEATURES


class HMMBrain:
    """
    Wraps hmmlearn.GaussianHMM to classify market regimes.
    
    After training, states are re-ordered by mean log-return:
      - Highest mean  → BULL  (state 0)
      - Moderate neg  → BEAR  (state 1)
      - Near-zero     → CHOP  (state 2)
      - Lowest mean   → CRASH (state 3)
    """

    def __init__(self, n_states=None, symbol=None, features_list=None):
        self.n_states = n_states or config.HMM_N_STATES
        self.symbol = symbol or config.PRIMARY_SYMBOL
        self.features = features_list or get_features_for_coin(self.symbol)
        self.model = None
        self._state_map = None        # raw_state → canonical_state
        self._last_trained = None
        self._is_trained = False
        self._feat_mean = None
        self._feat_std = None

    # ─── Training ────────────────────────────────────────────────────────────

    def train(self, df):
        """
        Train HMM on a DataFrame with HMM feature columns.
        
        Parameters
        ----------
        df : pd.DataFrame
            Must contain HMM_FEATURES columns (from feature_engine.compute_hmm_features).
        
        Returns
        -------
        self
        """
        features = df[self.features].dropna().values

        if len(features) < 50:
            logger.warning("Insufficient data for HMM training (%d rows). Need ≥50.", len(features))
            return self

        # Scale features to prevent covariance issues
        self._feat_mean = features.mean(axis=0)
        self._feat_std = features.std(axis=0)
        self._feat_std[self._feat_std < 1e-10] = 1e-10  # avoid div-by-zero
        features_scaled = (features - self._feat_mean) / self._feat_std

        self.model = GMMHMM(
            n_components=self.n_states,
            n_mix=3,
            covariance_type=config.HMM_COVARIANCE,
            n_iter=config.HMM_ITERATIONS,
            random_state=42,
        )

        self.model.fit(features_scaled)
        self._build_state_map()
        self._last_trained = datetime.utcnow()
        self._is_trained = True

        logger.info(
            "HMM trained on %d samples. State means (log-ret): %s",
            len(features),
            {config.REGIME_NAMES[v]: f"{self.model.means_[k][0]:.6f}"
             for k, v in self._state_map.items()},
        )
        return self

    def _build_state_map(self):
        """
        Map raw HMM states → canonical regime labels by sorting on mean log-return.
        Highest return → BULL, then CHOP (near zero), then BEAR, then CRASH (most negative).
        """
        try:
            ret_idx = self.features.index("log_return")
        except ValueError:
            ret_idx = 0
            
        try:
            vol_idx = self.features.index("volatility")
        except ValueError:
            vol_idx = 1
            
        means = self.model.means_[:, ret_idx]   # log-return means per raw state
        vols  = self.model.means_[:, vol_idx]    # volatility means per raw state

        # Sort states: highest mean first → lowest
        sorted_indices = np.argsort(means)[::-1]

        # If we have 4 states:  [best, ..., worst]
        #   best          → BULL
        #   near-zero     → CHOP  (2nd or 3rd depending on vol)
        #   moderate neg  → BEAR
        #   worst + hi vol→ CRASH
        if self.n_states >= 4:
            # Rank by return: 0=best, 3=worst
            ranked = list(sorted_indices)
            # The two middle states: assign lower-vol one to CHOP, higher-vol to BEAR
            mid = ranked[1:3]
            if vols[mid[0]] <= vols[mid[1]]:
                chop_raw, bear_raw = mid[0], mid[1]
            else:
                chop_raw, bear_raw = mid[1], mid[0]

            self._state_map = {
                ranked[0]:  config.REGIME_BULL,
                bear_raw:   config.REGIME_BEAR,
                chop_raw:   config.REGIME_CHOP,
                ranked[-1]: config.REGIME_CRASH,
            }
        elif self.n_states == 3:
            self._state_map = {
                sorted_indices[0]: config.REGIME_BULL,
                sorted_indices[1]: config.REGIME_CHOP,
                sorted_indices[2]: config.REGIME_BEAR,
            }
        else:
            # 2-state fallback
            self._state_map = {
                sorted_indices[0]: config.REGIME_BULL,
                sorted_indices[1]: config.REGIME_BEAR,
            }

    # ─── Prediction ──────────────────────────────────────────────────────────

    def predict(self, df):
        """
        Predict the CURRENT regime from the latest data.
        
        Returns
        -------
        (canonical_state: int, confidence: float)
        """
        if not self._is_trained:
            logger.warning("HMM not trained yet. Returning CHOP with 0 confidence.")
            return config.REGIME_CHOP, 0.0

        features = df[self.features].dropna().values
        if len(features) == 0:
            return config.REGIME_CHOP, 0.0

        features_scaled = (features - self._feat_mean) / self._feat_std

        raw_state = self.model.predict(features_scaled)[-1]
        probs = self.model.predict_proba(features_scaled)[-1]

        canonical = self._state_map.get(raw_state, config.REGIME_CHOP)

        # Margin confidence: best_prob - 2nd_best_prob (range 0.0–1.0).
        # Raw max-posterior was always 99%+ regardless of accuracy (uncalibrated).
        # Margin measures decisiveness: 0=uncertain, 1=extremely confident.
        sorted_p = np.sort(probs)[::-1]
        confidence = float(sorted_p[0] - sorted_p[1]) if len(sorted_p) >= 2 else float(sorted_p[0])

        return canonical, confidence

    def predict_all(self, df):
        """
        Predict regime for entire DataFrame (used by backtester).
        
        Returns
        -------
        np.ndarray of canonical states
        """
        if not self._is_trained:
            return np.full(len(df), config.REGIME_CHOP)

        features = df[self.features].dropna().values
        features_scaled = (features - self._feat_mean) / self._feat_std
        raw_states = self.model.predict(features_scaled)

        # Map raw → canonical
        canonical = np.array([self._state_map.get(s, config.REGIME_CHOP) for s in raw_states])
        return canonical

    def predict_proba_all(self, df):
        """
        Get state probabilities for entire DataFrame.
        
        Returns
        -------
        np.ndarray of shape (n_samples, n_states) — max prob per row = confidence
        """
        if not self._is_trained:
            return np.zeros((len(df), self.n_states))

        features = df[self.features].dropna().values
        features_scaled = (features - self._feat_mean) / self._feat_std
        return self.model.predict_proba(features_scaled)

    # ─── Auto-Retrain ────────────────────────────────────────────────────────

    def needs_retrain(self):
        """Check if the model is stale and needs retraining."""
        if not self._is_trained or self._last_trained is None:
            return True
        hours_since = (datetime.utcnow() - self._last_trained).total_seconds() / 3600
        return hours_since >= config.HMM_RETRAIN_HOURS

    # ─── Helpers ─────────────────────────────────────────────────────────────

    def get_regime_name(self, state):
        """Convert canonical state int → human-readable regime name."""
        return config.REGIME_NAMES.get(state, "UNKNOWN")

    @property
    def is_trained(self):
        return self._is_trained


class MultiTFHMMBrain:
    """
    Multi-Timeframe HMM Brain — manages 3 separate HMMBrain instances per coin.

    Architecture:
      - Daily  (1D × 1000 bars = ~2.7 yrs) → 40 pts weight (macro trend)
      - Hourly (1H × 1000 bars = ~42 days)  → 35 pts weight (swing regime)
      - 15min  (15m × 1000 bars = ~10 days) → 25 pts weight (momentum)

    Combined via:
      1. Majority vote (≥2/3 TFs must agree on direction)
      2. Weighted conviction score (0-100)

    Backtest: +$2,421 PnL, PF 1.49 across 41 coins.
    Walk-forward: ✅ BALANCED (test WR ≥ train WR, no overfitting).
    """

    def __init__(self, symbol):
        self.symbol = symbol
        self.segment = get_segment_for_coin(symbol)
        self._brains = {}        # timeframe → HMMBrain
        self._predictions = {}   # timeframe → (regime, margin)

    def set_brain(self, timeframe, brain):
        """Register a trained HMMBrain for a specific timeframe."""
        if isinstance(brain, HMMBrain) and brain.is_trained:
            self._brains[timeframe] = brain

    def is_ready(self):
        """At least MIN_MODELS timeframes must have trained brains."""
        return len(self._brains) >= config.MULTI_TF_MIN_MODELS

    def predict(self, tf_data):
        """
        Run prediction for each timeframe and cache results.

        Parameters
        ----------
        tf_data : dict
            timeframe → DataFrame with HMM features (from compute_all_features)

        Returns
        -------
        self (for chaining)
        """
        self._predictions = {}
        for tf, brain in self._brains.items():
            if tf in tf_data and brain.is_trained:
                regime, margin = brain.predict(tf_data[tf])
                self._predictions[tf] = (regime, margin)
        return self

    def get_conviction(self):
        """
        Compute multi-TF conviction score and direction.

        Returns
        -------
        (conviction: float 0-100, direction: str 'BUY'/'SELL'/None, agreement: int)

        conviction = weighted sum of each TF's contribution (scaled by margin tier)
        direction  = majority vote direction (None if no consensus)
        agreement  = number of TFs agreeing with consensus
        """
        if not self._predictions:
            return 0.0, None, 0

        weights = config.MULTI_TF_WEIGHTS
        directions = []

        # Count votes
        for tf, (regime, margin) in self._predictions.items():
            if regime == config.REGIME_BULL:
                directions.append(("BUY", tf, margin))
            elif regime == config.REGIME_BEAR:
                directions.append(("SELL", tf, margin))
            # CHOP → no vote

        if not directions:
            return 0.0, None, 0

        buys = sum(1 for d, _, _ in directions if d == "BUY")
        sells = sum(1 for d, _, _ in directions if d == "SELL")

        # Need majority
        if buys > sells:
            consensus = "BUY"
        elif sells > buys:
            consensus = "SELL"
        else:
            return 0.0, None, 0  # Tied — skip

        agreement = buys if consensus == "BUY" else sells

        # Check minimum agreement
        if agreement < config.MULTI_TF_MIN_AGREEMENT:
            return 0.0, None, agreement

        # Weighted conviction score
        total = 0.0
        for tf, (regime, margin) in self._predictions.items():
            w = weights.get(tf, 0)
            agrees = (
                (regime == config.REGIME_BULL and consensus == "BUY")
                or (regime == config.REGIME_BEAR and consensus == "SELL")
            )

            if regime == config.REGIME_CHOP:
                total += 0  # Chop = no contribution
            elif agrees:
                # Margin-tiered scoring (matches config.HMM_CONF_TIER_*)
                if margin >= config.HMM_CONF_TIER_HIGH:
                    total += w * 1.0
                elif margin >= config.HMM_CONF_TIER_MED_HIGH:
                    total += w * 0.85
                elif margin >= config.HMM_CONF_TIER_MED:
                    total += w * 0.65
                elif margin >= config.HMM_CONF_TIER_LOW:
                    total += w * 0.40
                else:
                    total += w * 0.20
            else:
                # Disagreement adds nothing (penalty removed to allow higher conviction tiers)
                total += 0

        conviction = max(0.0, min(100.0, total))
        return round(conviction, 1), consensus, agreement

    def get_regime_summary(self):
        """Return human-readable regime summary for dashboard/logging."""
        parts = []
        for tf in config.MULTI_TF_TIMEFRAMES:
            if tf in self._predictions:
                regime, margin = self._predictions[tf]
                name = config.REGIME_NAMES.get(regime, "?")
                parts.append(f"{tf}={name}({margin:.2f})")
            else:
                parts.append(f"{tf}=N/A")
        return " | ".join(parts)

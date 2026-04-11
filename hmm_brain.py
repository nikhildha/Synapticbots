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
        self._active_col_mask = None  # bool mask: which features are non-constant

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
        features = df[self.features].replace([np.inf, -np.inf], np.nan).dropna().values

        if len(features) < 50:
            logger.warning("Insufficient data for HMM training (%d rows). Need ≥50.", len(features))
            return self

        # Scale features to prevent covariance issues
        self._feat_mean = features.mean(axis=0)
        self._feat_std = features.std(axis=0)
        self._feat_std[self._feat_std < 1e-10] = 1e-10  # avoid div-by-zero
        features_scaled = (features - self._feat_mean) / self._feat_std

        # ── Drop constant/near-constant columns (zero variance after scaling) ──
        # BTCUSDT has `exhaustion_tail` / `liquidity_vacuum` all-zero in 1h data
        # (BTC is maximally liquid). Zero-var cols → _try_fit pre-flight fails for
        # ALL 3 tiers. Drop them and train on remaining valid features instead.
        col_vars = np.var(features_scaled, axis=0)
        self._active_col_mask = col_vars >= 1e-8    # bool mask, shape (n_features,)
        if not self._active_col_mask.all():
            dropped = [self.features[i] for i, keep in enumerate(self._active_col_mask) if not keep]
            logger.warning(
                "Dropping %d zero-variance feature(s) for %s before HMM training: %s",
                len(dropped), self.symbol, dropped,
            )
        features_fit = features_scaled[:, self._active_col_mask]

        if features_fit.shape[1] < 2:
            logger.warning("Too few non-constant features for %s HMM training (%d columns). Skipping.",
                           self.symbol, features_fit.shape[1])
            return self

        import warnings

        def _try_fit(model, data):
            """Fit + validate. Returns True if model is clean, False if degenerate."""
            # ── Pre-flight: reject data with NaN/Inf ───────────────────────────
            # (Constant-variance check is now done before calling _try_fit)
            if np.isnan(data).any() or np.isinf(data).any():
                return False

            # ── Fit: suppress Python AND NumPy-layer warnings ─────────────────
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", category=RuntimeWarning)
                warnings.filterwarnings("ignore", module="hmmlearn")
                with np.errstate(divide="ignore", invalid="ignore"):
                    model.fit(data)

            # NaN in startprob or transmat → degenerate
            if np.isnan(model.startprob_).any() or np.isnan(model.transmat_).any():
                return False
            if np.isnan(model.means_).any():
                return False
            # GMMHMM-specific: NaN weights_ → "divide by zero in log"
            if hasattr(model, "weights_") and np.isnan(model.weights_).any():
                return False

            # ── Final gate: run predict_proba on a sample ─────────────────────
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    with np.errstate(divide="ignore", invalid="ignore"):
                        sample = data[-50:] if len(data) > 50 else data
                        proba = model.predict_proba(sample)
                if np.isnan(proba).any():
                    return False
            except Exception:
                return False
            return True


        fitted = False

        # Tier 1: GMMHMM n_mix=3 (most expressive — needs clean data)
        m1 = GMMHMM(
            n_components=self.n_states, n_mix=3,
            covariance_type="diag", n_iter=config.HMM_ITERATIONS,
            min_covar=1e-2,
            random_state=42,
        )
        try:
            if _try_fit(m1, features_fit):
                self.model = m1
                fitted = True
        except Exception:
            pass

        # Tier 2: GMMHMM n_mix=2 (fewer components — more stable for liquid coins)
        if not fitted:
            m2 = GMMHMM(
                n_components=self.n_states, n_mix=2,
                covariance_type="diag", n_iter=config.HMM_ITERATIONS,
                min_covar=1e-2,
                random_state=42,
            )
            try:
                if _try_fit(m2, features_fit):
                    self.model = m2
                    fitted = True
                    logger.debug("GMMHMM n_mix=2 fallback used for %s", self.symbol)
            except Exception:
                pass

        # Tier 3: Single-Gaussian HMM (most stable — always valid)
        if not fitted:
            m3 = GaussianHMM(
                n_components=self.n_states,
                covariance_type="diag", n_iter=config.HMM_ITERATIONS,
                min_covar=1e-2,
                random_state=42,
            )
            try:
                if _try_fit(m3, features_fit):
                    self.model = m3
                    fitted = True
                    logger.debug("GaussianHMM fallback used for %s", self.symbol)
            except Exception:
                pass

        if not fitted:
            logger.warning(
                "All HMM tiers degenerate for %s — skipping (coin gets CHOP/0 confidence).",
                self.symbol,
            )
            return self  # _is_trained stays False

        self._build_state_map()
        self._last_trained = datetime.utcnow()
        self._is_trained = True

        # Build per-state mean log-return for logging.
        # The model was trained on features_fit (active columns only), so we need
        # the index of log_return in the FILTERED feature list.
        active_features = [f for f, keep in zip(self.features, self._active_col_mask) if keep]
        try:
            ret_idx_log = active_features.index("log_return")
        except ValueError:
            ret_idx_log = 0
        raw_means = self.model.means_
        if raw_means.ndim == 3:
            w = self.model.weights_
            state_means_log = np.einsum("ij,ijk->ik", w, raw_means)[:, ret_idx_log]
        else:
            state_means_log = raw_means[:, ret_idx_log]
        logger.info(
            "HMM trained on %d samples (%d features). State means (log-ret): %s",
            len(features), features_fit.shape[1],
            {config.REGIME_NAMES[v]: f"{float(state_means_log[k]):.6f}"
             for k, v in self._state_map.items()},
        )
        return self

    def _build_state_map(self):
        """
        Map raw HMM states → canonical regime labels by sorting on mean log-return.
        Highest return → BULL, then CHOP (near zero), then BEAR, then CRASH (most negative).

        Handles both GaussianHMM (means_ 2D) and GMMHMM (means_ 3D — mixture-weighted average).
        """
        try:
            ret_idx = self.features.index("log_return")
        except ValueError:
            ret_idx = 0

        try:
            vol_idx = self.features.index("volatility")
        except ValueError:
            vol_idx = 1

        raw_means = self.model.means_
        if raw_means.ndim == 3:
            # GMMHMM: means_ shape (n_components, n_mix, n_features)
            # weights_ shape (n_components, n_mix) — mixture weights per state
            w = self.model.weights_          # (n_components, n_mix)
            # Guard: NaN weights mean degenerate GMMHMM — fall back to uniform
            if np.isnan(w).any():
                w = np.ones_like(w) / w.shape[1]
            # Weighted average across mixture components → (n_components, n_features)
            state_means = np.einsum("ij,ijk->ik", w, raw_means)
        else:
            # GaussianHMM: means_ shape (n_components, n_features)
            state_means = raw_means

        means = state_means[:, ret_idx]   # log-return means per raw state
        vols  = state_means[:, vol_idx]   # volatility means per raw state

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

        features = df[self.features].replace([np.inf, -np.inf], np.nan).dropna().values
        if len(features) == 0:
            return config.REGIME_CHOP, 0.0

        features_scaled = (features - self._feat_mean) / self._feat_std
        # Apply the same active-column mask used during training
        if self._active_col_mask is not None:
            features_scaled = features_scaled[:, self._active_col_mask]
        # ── NaN guard ────────────────────────────────────────────────────────
        # If any feature column is still NaN/inf after scaling (e.g. a zero-std
        # feature that slipped through training data), replace with 0 rather than
        # letting NaN poison predict_proba() and produce BEARISH(nan) in UI.
        if np.isnan(features_scaled).any() or np.isinf(features_scaled).any():
            nan_cols = np.where(np.isnan(features_scaled[-1]) | np.isinf(features_scaled[-1]))[0]
            if nan_cols.size > 0:
                bad_feats = [self.features[i] for i in nan_cols if i < len(self.features)]
                logger.warning("NaN/inf in scaled features for %s: %s — replacing with 0",
                               self.symbol, bad_feats)
            features_scaled = np.nan_to_num(features_scaled, nan=0.0, posinf=0.0, neginf=0.0)
        # ─────────────────────────────────────────────────────────────────────

        raw_state = self.model.predict(features_scaled)[-1]
        probs = self.model.predict_proba(features_scaled)[-1]

        canonical = self._state_map.get(raw_state, config.REGIME_CHOP)

        # Margin confidence: best_prob - 2nd_best_prob (range 0.0–1.0).
        # Raw max-posterior was always 99%+ regardless of accuracy (uncalibrated).
        # Margin measures decisiveness: 0=uncertain, 1=extremely confident.
        sorted_p = np.sort(probs)[::-1]
        # Guard: if predict_proba itself returned NaN (numerical instability in GMMHMM),
        # fall back to 0.0 instead of propagating NaN into the UI.
        if np.isnan(sorted_p).any():
            logger.warning("NaN in predict_proba for %s — returning 0.0 confidence", self.symbol)
            return canonical, 0.0
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

        features = df[self.features].replace([np.inf, -np.inf], np.nan).dropna().values
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

        features = df[self.features].replace([np.inf, -np.inf], np.nan).dropna().values
        features_scaled = (features - self._feat_mean) / self._feat_std
        return self.model.predict_proba(features_scaled)

    # ─── Auto-Retrain ────────────────────────────────────────────────────────

    # Minimum candle period in hours per TF — retraining before a new candle
    # forms is always wasted (same data). This prevents 4h TF from retraining
    # 4× per training cycle on identical data.
    _TF_MIN_RETRAIN_HOURS = {
        "1m": 0.017,   # 1 min
        "5m": 0.083,   # 5 min
        "15m": 0.25,
        "30m": 0.5,
        "1h": 1.0,
        "2h": 2.0,
        "4h": 4.0,
        "8h": 8.0,
        "12h": 12.0,
        "1d": 24.0,
    }

    def needs_retrain(self, timeframe: str = "1h") -> bool:
        """Check if the model is stale and needs retraining.

        Respects a minimum retrain floor equal to the TF candle period so that
        4h brains don't retrain 4× on identical data within one engine cycle.
        """
        if not self._is_trained or self._last_trained is None:
            return True
        hours_since = (datetime.utcnow() - self._last_trained).total_seconds() / 3600
        # Use the larger of: global retrain interval or TF candle period
        tf_floor = self._TF_MIN_RETRAIN_HOURS.get(timeframe, 1.0)
        effective_interval = max(config.HMM_RETRAIN_HOURS, tf_floor)
        return hours_since >= effective_interval


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
      - Macro Brain (4 hour, 1000 bars) - Holds 30% of the voting weight
      - Swing Brain (Hourly, 1000 bars) - Holds 45% of the voting weight
      - Momentum Brain (15m, 1000 bars) - Holds 25% of the voting weight

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

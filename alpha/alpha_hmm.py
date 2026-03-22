"""
╔══════════════════════════════════════════════════════════════════════════════╗
║                        ALPHA MODULE — SYNAPTIC                              ║
║  Module : alpha/alpha_hmm.py                                                 ║
║  Purpose: 2-state GaussianHMM regime classifier trained on 1h bars.         ║
║           States: BULL (highest mean log_return) / BEAR (lowest).           ║
║           Outputs regime + margin confidence for the entry filter.           ║
║                                                                              ║
║  Key difference from main engine's hmm_brain.py:                            ║
║    - 2 states only (no CHOP) — strategy only trades BULL or BEAR            ║
║    - 1h timeframe only — no multi-TF conviction scoring                     ║
║    - 7-feature subset tuned for QUAD coins                                  ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  ISOLATION CONTRACT                                                          ║
║  ✗ DO NOT import hmm_brain, config, segment_features, or any root module    ║
║  ✓ Only imports: hmmlearn, numpy, pandas, alpha_config, alpha_logger         ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

import warnings
import numpy as np
import pandas as pd
from datetime import datetime, timezone
from typing import Optional

warnings.filterwarnings("ignore", category=RuntimeWarning)
warnings.filterwarnings("ignore", category=UserWarning)

from alpha.alpha_config import (
    ALPHA_HMM_LOOKBACK, ALPHA_HMM_RETRAIN_H,
    ALPHA_HMM_N_STATES, ALPHA_HMM_FEATURES,
    ALPHA_REGIME_MARGIN,
)
from alpha.alpha_logger import get_logger

logger = get_logger("hmm")

# Regime labels — 2 states only
REGIME_BULL = "BULL"
REGIME_BEAR = "BEAR"


class AlphaHMM:
    """
    Single-timeframe 2-state HMM for one Alpha coin.
    Trained on 1h bars. Retrains every ALPHA_HMM_RETRAIN_H hours.

    Usage:
        hmm = AlphaHMM("AAVEUSDT")
        hmm.train(df_1h)          # True if success
        result = hmm.predict(df_1h)
        # {"regime": "BULL", "margin": 0.23, "passes_filter": True}
    """

    def __init__(self, symbol: str):
        self.symbol = symbol
        self._model = None
        self._state_map: dict[int, str] = {}   # raw HMM state → BULL/BEAR
        self._feat_mean: Optional[np.ndarray] = None
        self._feat_std:  Optional[np.ndarray] = None
        self._last_trained: Optional[datetime] = None
        self._is_trained: bool = False

    # ── Training ──────────────────────────────────────────────────────────────

    def train(self, df_1h: pd.DataFrame) -> bool:
        """
        Fit GaussianHMM on last ALPHA_HMM_LOOKBACK 1h bars.
        States are remapped by mean log_return: highest → BULL, lowest → BEAR.

        Returns True on success, False on failure (logs reason).
        Falls back from n_components=2 n_mix=3 → n_mix=2 → plain GaussianHMM.
        """
        try:
            from hmmlearn.hmm import GMMHMM, GaussianHMM
        except ImportError:
            logger.error("hmmlearn not installed — cannot train HMM")
            return False

        df = df_1h.copy().tail(ALPHA_HMM_LOOKBACK)
        missing = [f for f in ALPHA_HMM_FEATURES if f not in df.columns]
        if missing:
            logger.warning("%s: missing HMM features %s — skipping train", self.symbol, missing)
            return False
        if len(df) < 60:
            logger.warning("%s: only %d 1h bars — need ≥60", self.symbol, len(df))
            return False

        X = df[ALPHA_HMM_FEATURES].values.astype(float)

        # Drop rows with NaN/inf
        mask = np.isfinite(X).all(axis=1)
        X = X[mask]
        if len(X) < 60:
            logger.warning("%s: %d finite rows after NaN drop — need ≥60", self.symbol, len(X))
            return False

        # Z-score normalise
        self._feat_mean = X.mean(axis=0)
        self._feat_std  = np.where(X.std(axis=0) < 1e-8, 1.0, X.std(axis=0))
        X_norm = (X - self._feat_mean) / self._feat_std

        # Drop zero-variance columns (causes singular covariance)
        var_mask = X_norm.std(axis=0) > 1e-6
        X_norm = X_norm[:, var_mask]
        if X_norm.shape[1] < 2:
            logger.warning("%s: too many zero-variance features — skipping train", self.symbol)
            return False

        model = self._fit_with_fallback(X_norm, GMMHMM, GaussianHMM)
        if model is None:
            return False

        # Remap states by mean log_return: highest = BULL, lowest = BEAR
        log_ret_idx = ALPHA_HMM_FEATURES.index("log_return") if "log_return" in ALPHA_HMM_FEATURES else 0
        # Use the first feature column's means if log_return was dropped
        try:
            hidden = model.predict(X_norm)
            state_means = {s: X[hidden == s, log_ret_idx].mean() for s in range(ALPHA_HMM_N_STATES)
                           if (hidden == s).any()}
        except Exception:
            state_means = {s: s for s in range(ALPHA_HMM_N_STATES)}

        sorted_states = sorted(state_means, key=lambda s: state_means[s], reverse=True)
        self._state_map = {}
        for i, raw_state in enumerate(sorted_states):
            self._state_map[raw_state] = REGIME_BULL if i == 0 else REGIME_BEAR

        self._model = model
        self._is_trained = True
        self._last_trained = datetime.now(timezone.utc)
        logger.info("%s: HMM trained on %d bars. States: %s", self.symbol, len(X), self._state_map)
        return True

    def _fit_with_fallback(self, X_norm: np.ndarray, GMMHMM, GaussianHMM):
        """Try GMMHMM(n_mix=3) → GMMHMM(n_mix=2) → GaussianHMM. Return fitted model or None."""
        attempts = [
            ("GMMHMM n_mix=3", lambda: GMMHMM(
                n_components=ALPHA_HMM_N_STATES, n_mix=3,
                covariance_type="diag", n_iter=100, random_state=42, verbose=False,
            )),
            ("GMMHMM n_mix=2", lambda: GMMHMM(
                n_components=ALPHA_HMM_N_STATES, n_mix=2,
                covariance_type="diag", n_iter=100, random_state=42, verbose=False,
            )),
            ("GaussianHMM", lambda: GaussianHMM(
                n_components=ALPHA_HMM_N_STATES,
                covariance_type="diag", n_iter=100, random_state=42, verbose=False,
            )),
        ]
        for name, builder in attempts:
            try:
                model = builder()
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    model.fit(X_norm)
                logger.debug("%s: fitted %s", self.symbol, name)
                return model
            except Exception as e:
                logger.debug("%s: %s failed: %s", self.symbol, name, e)
        logger.error("%s: all HMM fitting attempts failed", self.symbol)
        return None

    # ── Prediction ────────────────────────────────────────────────────────────

    def predict(self, df_1h: pd.DataFrame) -> Optional[dict]:
        """
        Predict regime on the most recent 1h bar.

        Returns:
            {
                "regime":        "BULL" | "BEAR",
                "margin":        float,   # best_prob - 2nd_best_prob (0–1)
                "passes_filter": bool,    # margin >= ALPHA_REGIME_MARGIN (0.10)
            }
        Returns None if model not trained or prediction fails.
        """
        if not self._is_trained or self._model is None:
            return None

        missing = [f for f in ALPHA_HMM_FEATURES if f not in df_1h.columns]
        if missing:
            logger.warning("%s predict: missing features %s", self.symbol, missing)
            return None

        df = df_1h.tail(ALPHA_HMM_LOOKBACK).copy()
        X = df[ALPHA_HMM_FEATURES].values.astype(float)
        mask = np.isfinite(X).all(axis=1)
        X = X[mask]
        if len(X) < 2:
            return None

        X_norm = (X - self._feat_mean) / self._feat_std

        # Drop same zero-variance columns as during training
        var_mask = self._feat_std > 1e-6
        X_norm = X_norm[:, var_mask]

        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                posteriors = self._model.predict_proba(X_norm)
            last_post = posteriors[-1]  # probabilities for the most recent bar

            best_state = int(np.argmax(last_post))
            sorted_probs = np.sort(last_post)[::-1]
            margin = float(sorted_probs[0] - sorted_probs[1]) if len(sorted_probs) > 1 else 0.0

            regime = self._state_map.get(best_state, REGIME_BULL)
            passes = margin >= ALPHA_REGIME_MARGIN

            return {
                "regime":        regime,
                "margin":        round(margin, 4),
                "passes_filter": passes,
            }
        except Exception as e:
            logger.error("%s predict failed: %s", self.symbol, e)
            return None

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def needs_retrain(self) -> bool:
        """True if never trained or last trained > ALPHA_HMM_RETRAIN_H hours ago."""
        if not self._is_trained or self._last_trained is None:
            return True
        elapsed_h = (datetime.now(timezone.utc) - self._last_trained).total_seconds() / 3600
        return elapsed_h >= ALPHA_HMM_RETRAIN_H

    def to_dict(self) -> dict:
        """Serialise metadata to dict (for state.json persistence)."""
        return {
            "symbol":       self.symbol,
            "is_trained":   self._is_trained,
            "last_trained": self._last_trained.isoformat() if self._last_trained else None,
            "state_map":    {str(k): v for k, v in self._state_map.items()},
        }

    def __repr__(self) -> str:
        status = f"trained {self._last_trained}" if self._is_trained else "untrained"
        return f"AlphaHMM({self.symbol}, {status})"

import logging
import time
from datetime import datetime, timezone
import config

from data_pipeline import fetch_klines, _get_binance_client
from hmm_brain import HMMBrain, MultiTFHMMBrain
from feature_engine import compute_all_features, compute_trend, compute_ema
from segment_features import get_segment_for_coin

logger = logging.getLogger("CoinAnalyzer")

class CoinAnalyzer:
    def __init__(self, engine):
        self.engine = engine

    def _get_binance_client(self):
        return _get_binance_client()

    def analyze_coin(self, symbol, balance, btc_flash_crash=False):
        """
        Analyze a single coin. Returns a trade dict if eligible, else None.
        Extracted from main.py
        """
        # Fetch 1h data — with 1 retry + cache fallback for resilience
        df_1h = fetch_klines(symbol, config.TIMEFRAME_CONFIRMATION, limit=config.HMM_LOOKBACK)
        if (df_1h is None or len(df_1h) < 60) and symbol == "BTCUSDT":
            time.sleep(2)
            df_1h = fetch_klines(symbol, config.TIMEFRAME_CONFIRMATION, limit=config.HMM_LOOKBACK)
        if df_1h is None or len(df_1h) < 60:
            if symbol == "BTCUSDT":
                logger.error("🚨 BTC 1h data fetch failed or too short — regime STALE")
                self.engine._coin_states.setdefault("BTCUSDT", {})["last_fetch_error"] = datetime.utcnow().isoformat()
            return None

        # Get or create brain for this coin (1h)
        brain = self.engine._coin_brains.get(symbol)
        if brain is None:
            brain = HMMBrain(symbol=symbol)
            self.engine._coin_brains[symbol] = brain

        df_1h_feat = compute_all_features(df_1h)

        if brain.needs_retrain(timeframe=config.TIMEFRAME_CONFIRMATION):
            brain.train(df_1h_feat)

        if not brain.is_trained:
            if symbol == "BTCUSDT":
                logger.error("🚨 BTC brain not trained — regime STALE")
            return None

        regime, conf = brain.predict(df_1h_feat)
        regime_name = brain.get_regime_name(regime)

        # Multi-TF HMM Analysis
        if config.MULTI_TF_ENABLED:
            mtf_brain = self.engine._multi_tf_brains.get(symbol)
            if mtf_brain is None:
                mtf_brain = MultiTFHMMBrain(symbol)
                self.engine._multi_tf_brains[symbol] = mtf_brain

            tf_data = {} 
            for tf in config.MULTI_TF_TIMEFRAMES:
                tf_key = f"{symbol}_{tf}"
                tf_brain = self.engine._coin_brains.get(tf_key)
                if tf_brain is None:
                    tf_brain = HMMBrain(symbol=symbol)
                    self.engine._coin_brains[tf_key] = tf_brain

                try:
                    df_tf = fetch_klines(symbol, tf, limit=config.MULTI_TF_CANDLE_LIMIT)
                    if df_tf is not None and len(df_tf) >= 60:
                        df_tf_feat = compute_all_features(df_tf)
                        if tf_brain.needs_retrain(timeframe=tf):
                            logger.info("🧠 [%s] Training %s TF brain (%d bars)...", symbol, tf, len(df_tf))
                            tf_brain.train(df_tf_feat)
                        if tf_brain.is_trained:
                            mtf_brain.set_brain(tf, tf_brain)
                            tf_data[tf] = df_tf_feat
                        else:
                            logger.warning("⚠️  [%s] %s TF brain failed to train", symbol, tf)
                except Exception as e:
                    logger.warning("⚠️  [%s] %s TF failed: %s", symbol, tf, e, exc_info=True)

            tf_breakdown = {}
            if hasattr(mtf_brain, '_predictions') and mtf_brain._predictions:
                for _tf, (_r, _m) in mtf_brain._predictions.items():
                    tf_breakdown[_tf] = {
                        "regime": config.REGIME_NAMES.get(_r, "?"),
                        "margin": round(_m, 3),
                    }

            if not mtf_brain.is_ready():
                ready_tfs = list(mtf_brain._brains.keys())
                self.engine._coin_states[symbol] = {
                    "symbol": symbol, "regime": "N/A", "confidence": 0,
                    "price": 0, "action": "MTF_INSUFFICIENT_MODELS",
                    "segment": get_segment_for_coin(symbol),
                }
                return None

            mtf_brain.predict(tf_data)
            conviction, side, tf_agreement = mtf_brain.get_conviction()
            regime_summary = mtf_brain.get_regime_summary()
            
            tf_detail = " | ".join(
                f"{tf}={config.REGIME_NAMES.get(r,'?')}({m:.2f})"
                for tf, (r, m) in mtf_brain._predictions.items()
            )

            if side is None:
                self.engine._coin_states[symbol] = {
                    "symbol": symbol, "regime": regime_summary,
                    "confidence": 0, "price": 0, "action": "MTF_NO_CONSENSUS",
                    "segment": get_segment_for_coin(symbol),
                }
                return None

            if side == "BUY" and btc_flash_crash:
                self.engine._coin_states[symbol] = {
                    "symbol": symbol, "regime": regime_summary,
                    "confidence": 0, "price": 0, "action": "MACRO_VETO_BTC_CRASH",
                    "segment": get_segment_for_coin(symbol),
                }
                return None

            df_1h_feat = tf_data.get("1h")
            if df_1h_feat is None:
                return None

            current_price = float(df_1h_feat["close"].iloc[-1])
            current_atr = float(df_1h_feat["atr"].iloc[-1]) if "atr" in df_1h_feat.columns else 0.0
            
            df_5m = fetch_klines(symbol, "5m", limit=100)
            if df_5m is not None and len(df_5m) >= 60:
                current_trend = compute_trend(df_5m)
            else:
                df_fallback = tf_data.get("15m") if "15m" in tf_data else df_1h_feat
                current_trend = compute_trend(df_fallback)
                
            exhaustion_tail = float(df_1h_feat["exhaustion_tail"].iloc[-1]) if "exhaustion_tail" in df_1h_feat.columns else 0.0

            regime = config.REGIME_BULL if side == "BUY" else config.REGIME_BEAR
            regime_name = config.REGIME_NAMES.get(regime, "UNKNOWN")
            conf = conviction / 100.0

            brain_cfg = {}
            brain_id = "MultiTF-HMM"

            _tf_preds = mtf_brain._predictions
            _r4h  = _tf_preds.get("4h",  (config.REGIME_CHOP, 0))[0]
            _r1h  = _tf_preds.get("1h",  (config.REGIME_CHOP, 0))[0]
            _r15m = _tf_preds.get("15m", (config.REGIME_CHOP, 0))[0]
            _macro_opposing = (
                (side == "BUY"  and _r4h == config.REGIME_BEAR) or
                (side == "SELL" and _r4h == config.REGIME_BULL)
            )
            _short_tfs_agree = (
                _r1h  != config.REGIME_CHOP and
                _r15m != config.REGIME_CHOP
            )
            _exhaustion_sig = exhaustion_tail > 1.5
            _is_reversal = _macro_opposing and (_short_tfs_agree or _exhaustion_sig)

            try:
                _fr = float(df_1h_feat["funding_rate"].iloc[-1]) if "funding_rate" in df_1h_feat.columns else None
                _oi = float(df_1h_feat["oi_change"].iloc[-1])    if "oi_change"    in df_1h_feat.columns else None
                _fr_adj = -8 if (_fr is not None and side == "BUY"  and _fr >  0.0003) else \
                           4 if (_fr is not None and side == "SELL" and _fr >  0.0003) else \
                           4 if (_fr is not None and _fr < -0.0001) else 0
                _oi_adj =  5 if (_oi is not None and side == "BUY"  and _oi >  0.02) else \
                          -5 if (_oi is not None and side == "BUY"  and _oi < -0.02) else \
                           5 if (_oi is not None and side == "SELL" and _oi >  0.02) else \
                          -5 if (_oi is not None and side == "SELL" and _oi < -0.02) else 0
                conviction = float(max(0.0, min(100.0, conviction + _fr_adj + _oi_adj)))
            except Exception as _conv_err:
                pass

            if config.WEEKEND_SKIP_ENABLED:
                now_utc = datetime.now(timezone.utc)
                if now_utc.weekday() in config.WEEKEND_SKIP_DAYS:
                    self.engine._coin_states[symbol] = {
                        "symbol": symbol, "regime": regime_summary,
                        "confidence": round(conf, 4), "price": current_price,
                        "action": "WEEKEND_SKIP",
                        "segment": get_segment_for_coin(symbol),
                    }
                    return None

            if config.VOL_FILTER_ENABLED and current_atr > 0:
                vol_ratio = current_atr / current_price
                if vol_ratio < config.VOL_MIN_ATR_PCT:
                    self.engine._coin_states[symbol] = {
                        "symbol": symbol, "regime": regime_summary,
                        "confidence": round(conf, 4), "price": current_price,
                        "action": "VOL_TOO_LOW",
                        "segment": get_segment_for_coin(symbol),
                    }
                    return None
                if vol_ratio > config.VOL_MAX_ATR_PCT:
                    self.engine._coin_states[symbol] = {
                        "symbol": symbol, "regime": regime_summary,
                        "confidence": round(conf, 4), "price": current_price,
                        "action": "VOL_TOO_HIGH",
                        "segment": get_segment_for_coin(symbol),
                    }
                    return None

            conv_min = min(45, config.MIN_CONVICTION_FOR_DEPLOY - 15)
            if conviction < conv_min:
                self.engine._coin_states[symbol] = {
                    "symbol": symbol, "regime": regime_summary,
                    "confidence": round(conf, 4), "price": current_price,
                    "action": f"LOW_CONVICTION:{conviction:.1f}<{conv_min}",
                    "brain": brain_id,
                    "segment": get_segment_for_coin(symbol),
                }
                return None

            athena_action = None
            _rsi_1h = float(df_1h_feat["rsi"].iloc[-1]) if "rsi" in df_1h_feat.columns else 50.0

            self.engine._coin_states[symbol] = {
                "symbol": symbol,
                "regime": regime_name,
                "regime_int": regime,          
                "confidence": round(conf, 4),
                "price": current_price,
                "action": f"ELIGIBLE_{side}",
                "conviction": round(conviction, 1),
                "brain": brain_id,
                "tf_agreement": tf_agreement,
                "regime_summary": regime_summary,
                "athena": athena_action,
                "segment": get_segment_for_coin(symbol),
                "context": {"trend_alignment": current_trend},
                "rsi_1h": round(_rsi_1h, 1),   
                "signal_type": "REVERSAL_PULLBACK" if _is_reversal else "TREND_FOLLOW",
            }

            return {
                "symbol": symbol,
                "side": side,
                "atr": current_atr,
                "regime": regime,
                "regime_name": regime_name,
                "confidence": conf,
                "conviction": conviction,
                "brain_id": brain_id,
                "brain_cfg": brain_cfg,
                "tf_agreement": tf_agreement,
                "athena": athena_action,
                "trend_direction": current_trend,
                "exhaustion_tail": exhaustion_tail,
                "rsi_1h": _rsi_1h,
                "signal_type": "REVERSAL_PULLBACK" if _is_reversal else "TREND_FOLLOW",
                "reason": f"MultiTF-HMM | {regime_summary} | conv={conviction:.1f} TF={tf_agreement}/3",
            }

        macro_regime_name = None
        current_price = float(df_1h_feat["close"].iloc[-1])
        _features = {}
        try:
            last = df_1h_feat.iloc[-1]
            import coindcx_client as cdx
            cdx_pair = cdx.to_coindcx_pair(symbol)
            live_info = self.engine._live_prices.get(cdx_pair, {})
            live_fund = float(live_info.get("fr", 0.0))
            if live_fund == 0.0:
                 live_fund = float(live_info.get("efr", 0.0))

            _features = {
                "log_return":    round(float(last.get("log_return", 0)), 6),
                "volatility":    round(float(last.get("volatility", 0)), 6),
                "volume_change": round(float(last.get("volume_change", 0)), 6),
                "rsi_norm":      round(float(last.get("rsi_norm", 0)), 6),
                "oi_change":     0.0, 
                "funding":       round(live_fund, 8),
            }
        except Exception:
            pass

        _volume_24h = 0.0
        try:
            client = self._get_binance_client()
            ticker = client.get_ticker(symbol=symbol)
            _volume_24h = round(float(ticker.get("quoteVolume", 0)), 2)
        except Exception:
            try:
                vol_col = "volume" if "volume" in df_1h_feat.columns else None
                if vol_col:
                    close_col = df_1h_feat["close"].tail(24)
                    vol_vals = df_1h_feat[vol_col].tail(24)
                    _volume_24h = round(float((close_col * vol_vals).sum()), 2)
            except Exception:
                pass

        self.engine._coin_states[symbol] = {
            "symbol":       symbol,
            "regime":       regime_name,
            "confidence":   round(conf, 4),
            "price":        current_price,
            "action":       "ANALYZING",
            "macro_regime": macro_regime_name,
            "features":     _features,
            "volume_24h":   _volume_24h,
            "segment":      get_segment_for_coin(symbol),   
        }

        try:
            ta_multi = {"price": current_price}
            rsi_1h = float(df_1h_feat["rsi"].iloc[-1]) if "rsi" in df_1h_feat.columns else None
            atr_1h = float(df_1h_feat["atr"].iloc[-1]) if "atr" in df_1h_feat.columns else None
            ema20_1h = float(compute_ema(df_1h_feat["close"], 20).iloc[-1])
            ema50_1h = float(compute_ema(df_1h_feat["close"], 50).iloc[-1])
            ta_multi["1h"] = {
                "rsi": round(rsi_1h, 2) if rsi_1h else None,
                "atr": round(atr_1h, 4) if atr_1h else None,
                "trend": compute_trend(df_1h_feat),
            }
            ta_multi["ema_20_1h"] = round(ema20_1h, 4)
            ta_multi["ema_50_1h"] = round(ema50_1h, 4)

            try:
                df_5m_ta = fetch_klines(symbol, "5m", limit=100)
                if df_5m_ta is not None and len(df_5m_ta) >= 30:
                    df_5m_ta = compute_all_features(df_5m_ta)
                    ta_multi["5m"] = {
                        "rsi": round(float(df_5m_ta["rsi"].iloc[-1]), 2) if "rsi" in df_5m_ta.columns else None,
                        "atr": round(float(df_5m_ta["atr"].iloc[-1]), 4) if "atr" in df_5m_ta.columns else None,
                        "trend": compute_trend(df_5m_ta),
                    }
            except Exception as e:
                pass

            self.engine._coin_states[symbol]["ta_multi"] = ta_multi
        except Exception as e:
            pass

        _is_reversal_tier2 = False

        if regime == config.REGIME_BULL:
            side = "BUY"
        elif regime == config.REGIME_BEAR:
            side = "SELL"
        else:
            return None

        if side == "BUY" and btc_flash_crash:
            self.engine._coin_states[symbol]["action"] = "MACRO_VETO_BTC_CRASH"
            return None

        current_atr   = df_1h_feat["atr"].iloc[-1]   if "atr"   in df_1h_feat.columns else 0.0
        current_price = float(df_1h_feat["close"].iloc[-1])
        current_swing_l = float(df_1h_feat["swing_l"].iloc[-1]) if "swing_l" in df_1h_feat.columns else None
        current_swing_h = float(df_1h_feat["swing_h"].iloc[-1]) if "swing_h" in df_1h_feat.columns else None

        if config.VOL_FILTER_ENABLED and current_atr > 0:
            vol_ratio = current_atr / current_price
            if vol_ratio < config.VOL_MIN_ATR_PCT:
                self.engine._coin_states[symbol]["action"] = "VOL_TOO_LOW"
                return None
            if vol_ratio > config.VOL_MAX_ATR_PCT:
                self.engine._coin_states[symbol]["action"] = "VOL_TOO_HIGH"
                return None

        df_5m = None
        orderflow_score = None
        nearest_bullish_ob = None
        nearest_bearish_ob = None
        nearest_bid_wall   = None
        nearest_ask_wall   = None
        try:
            df_5m = fetch_klines(symbol, config.TIMEFRAME_EXECUTION, limit=50)
            if df_5m is not None and len(df_5m) >= 5:
                df_5m_feat = compute_all_features(df_5m)
                price_now   = float(df_5m_feat["close"].iloc[-1])
                price_5_ago = float(df_5m_feat["close"].iloc[-5])
        except Exception:
            pass

        if self.engine._orderflow:
            try:
                of_sig = self.engine._orderflow.get_signal(symbol, df_5m)
                if of_sig is not None:
                    orderflow_score = of_sig.score
                    nearest_bullish_ob = of_sig.nearest_bullish_ob
                    nearest_bearish_ob = of_sig.nearest_bearish_ob
                    nearest_bid_wall   = of_sig.nearest_bid_wall
                    nearest_ask_wall   = of_sig.nearest_ask_wall
            except Exception:
                pass

        if df_5m is not None and len(df_5m) >= 5:
            try:
                price_now   = float(df_5m_feat["close"].iloc[-1])
                price_5_ago = float(df_5m_feat["close"].iloc[-5])
                if side == "BUY"  and price_now <= price_5_ago:
                    self.engine._coin_states[symbol]["action"] = "5M_FILTER_SKIP"
                    return None
                if side == "SELL" and price_now >= price_5_ago:
                    self.engine._coin_states[symbol]["action"] = "5M_FILTER_SKIP"
                    return None
            except Exception:
                pass

        funding     = df_1h_feat["funding_rate"].iloc[-1] if "funding_rate" in df_1h_feat.columns else None
        oi_chg      = df_1h_feat["oi_change"].iloc[-1]    if "oi_change"    in df_1h_feat.columns else None

        conviction = self.engine.risk.compute_conviction_score(
            confidence=conf,
            regime=regime,
            side=side,
            funding_rate=funding,
            oi_change=oi_chg,
            orderflow_score=orderflow_score,
        )
        if conviction < 40:
            self.engine._coin_states[symbol]["action"] = f"LOW_CONVICTION:{conviction:.1f}"
            return None

        of_note = f" | OF={orderflow_score:+.2f}" if orderflow_score is not None else ""
        self.engine._coin_states[symbol]["action"] = f"ELIGIBLE_{side}"
        self.engine._coin_states[symbol].update({
            "conviction": round(conviction, 1),
            "orderflow":  round(orderflow_score, 3) if orderflow_score is not None else None,
        })
        return {
            "symbol": symbol,
            "side": side,
            "atr": current_atr,
            "swing_l": current_swing_l,
            "swing_h": current_swing_h,
            "regime": regime,
            "regime_name": regime_name,
            "confidence": conf,
            "conviction": conviction,
            "funding_rate": round(funding, 6) if funding is not None else None,
            "oi_change":    round(oi_chg, 4)  if oi_chg  is not None else None,
            "orderflow_score": round(orderflow_score, 3) if orderflow_score is not None else None,
            "nearest_bullish_ob": nearest_bullish_ob,  
            "nearest_bearish_ob": nearest_bearish_ob,  
            "nearest_bid_wall":   nearest_bid_wall,    
            "nearest_ask_wall":   nearest_ask_wall,    
            "tf_breakdown":    {},  
            "tf_agreement":    1,
            "reason": f"Trend {regime_name} | conf={conf:.0%} | conv={conviction:.1f}{of_note}",
        }

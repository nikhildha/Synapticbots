# Synaptic — Brain Intelligence: Deep Technical Reference

**Author:** Quant Lead  
**Version:** March 2026 — v3 Tiered MTF Signal Pipeline  
**File:** `hmm_brain.py`, `_analyze_coin()` in `main.py`

---

## Table of Contents

1. [Why HMM?](#1-why-hmm)
2. [HMM Architecture](#2-hmm-architecture)
3. [Feature Engineering](#3-feature-engineering)
   - 3a. [Per-Coin Feature Sets (Full Table)](#3a-per-coin-feature-sets-full-table)
4. [State Labeling & Regime Classification](#4-state-labeling--regime-classification)
5. [Confidence: Margin Score](#5-confidence-margin-score)
6. [Multi-Timeframe Brain (MultiTFHMMBrain)](#6-multi-timeframe-brain-multitfhmmbrain)
7. [Conviction Scoring (0–100)](#7-conviction-scoring-0100)
8. [Tiered MTF Signal Logic — Full Decision Table](#8-tiered-mtf-signal-logic--full-decision-table)
9. [ATR Pullback Logic — Tier 2A & 2B](#9-atr-pullback-logic--tier-2a--2b)
10. [Athena — AI Final Gatekeeper](#10-athena--ai-final-gatekeeper)
11. [Retraining Schedule & Intervals](#11-retraining-schedule--intervals)
12. [Key Design Decisions](#12-key-design-decisions)

---

## 1. Why HMM?

Markets do not trend in a straight line. They cycle through discrete "regimes":

- **BULL**: Trending upward — momentum, volume expansion, rising lows
- **BEAR**: Trending downward — distribution, volume on down-bars
- **CHOP**: No directional conviction — consolidation, efficient market noise

Traditional indicators (RSI, MACD) react to price _after_ the regime has started. They are **reactive**. An HMM is **predictive** — it learns the hidden state from patterns in observable data.

### Why HMM is Better Than a Signal Stack

| Approach | Problem |
|---|---|
| RSI crossover | Repaints, no memory of state sequence |
| MACD | Lagging by definition (difference of EMAs) |
| Pure ML (XGBoost, NN) | Requires labeled data — who labels regimes correctly? |
| **HMM** | Unsupervised — discovers regimes from raw data, temporal state memory |

The HMM answer is: **"Given the sequence of observed features over the last N candles, what is the most likely hidden state (regime) right now?"** It considers the full history, not just the last bar.

---

## 2. HMM Architecture

**Class:** `HMMBrain` in `hmm_brain.py`  
**Library:** `hmmlearn.GaussianHMM`

### Model Parameters

| Parameter | Value | Rationale |
|---|---|---|
| `n_states` | **3** | BULL / CHOP / BEAR. 4-state (Sharpe 0.72) was outperformed by 3-state (Sharpe 1.22). CRASH is extreme BEAR. |
| `covariance_type` | `full` | Captures cross-feature correlations (e.g., high vol & high selling = BEAR). Diagonal/spherical loses information. |
| `n_iter` | 100 | EM convergence iterations. Empirically sufficient for 6 features. |
| `lookback` | 250 candles per timeframe | ~2.6 days of 15m data; ~10 days of 1H; ~42 days of 4H. |
| `retrain_every` | 24 hours | Model adapts to new market structure without catastrophic forgetting. |

### 3-State vs 4-State: Why We Removed CRASH

| Metric | 3-State | 4-State |
|---|---|---|
| Sharpe Ratio | **1.22** | 0.72 |
| CRASH directional accuracy | — | **10.9%** (= random guess) |
| Min data points per state | ✅ Ample | ❌ CRASH rare → insufficient training |

**Decision:** 3-state model. CRASH events reclassified as extreme BEAR. The HMM naturally assigns very high BEAR margin confidence during crashes, which then triggers maximum negative conviction → no long trades.

---

## 3. Feature Engineering

**File:** `feature_engine.py` + `segment_features.py`

Each HMM instance uses a per-coin optimized feature set. The global feature list is defined in `segment_features.ALL_HMM_FEATURES`. Features were selected via greedy ablation during backtesting.

### Core HMM Features

| Feature | Formula | Why It Matters |
|---|---|---|
| `log_return` | `ln(close_t / close_{t-1})` | Primary price momentum signal. HMM's core differentiator between BULL and BEAR. |
| `volatility` | `(high - low) / close` | Intrabar volatility. Low in smooth trends (BULL), elevated in panics (BEAR), extreme in CHOP. Used to separate CHOP from BULL. |
| `volume_change` | `log(vol_t / vol_{t-1})` | Log-volume change. Breakout moves have volume expansion. Chop has flat volume. |
| `vol_zscore` | `(vol - SMA_24) / STD_24` | Volume relative to recent average. Identifies abnormal participation (institutional events). |
| `rel_strength_btc` | `asset_return - btc_return` | Performance relative to BTC. Strong positive = coin outperforming (BULL signal). Weak = distribution. |
| `liquidity_vacuum` | `\|log_return\| / ATR_pct` | Price moving through price levels without much resistance. High vacuum = momentum move, not choppy noise. |
| `exhaustion_tail` | `(lower_wick - upper_wick) / body × vol_zscore` | Wick analysis weighted by volume. Very long lower wick on high-volume bar = bullish rejection (potential bottom). |
| `amihud_illiquidity` | `\|return\| / dollar_volume × 1e8` | Market depth proxy. High illiquidity = price moves easily on small volume = volatile/thin coin. |
| `volume_trend_intensity` | `EMA_5(vol) / EMA_20(vol)` | Is buying interest accelerating? Rising short-term volume vs longer term = momentum building. |
| `swing_l` / `swing_h` | `rolling(10).min/max` | Recent structural lows/highs. Used by RMv3 for swing-based conviction scoring. |

### Feature Selection Result

Starting from basic 4 features:
```
4 features  → Sharpe 0.258
+ funding_proxy → 0.481
+ adx         → 0.667  ← tipping point
+ more        → diminishing returns (overfitting)
```

**Final: Per-coin feature sets** via `get_features_for_coin(symbol)` in `segment_features.py`. Each coin uses the subset that maximizes its individual Sharpe on forward-test data.

### Why Per-Coin, Not Per-Segment?

Initially we thought segment-level features (e.g., one feature set for all DeFi coins) would be sufficient. Backtesting showed otherwise:

- **AAVE** and **LINK** are both DeFi but have different microstructure — LINK has strong liquidity depth (oracle network, institutional demand); AAVE responds more to protocol TVL signals → different optimal features
- **DOGE** and **WIF** are both meme coins but DOGE has massive retail volume → `rel_strength_btc` matters more; WIF is thinner → `amihud_illiquidity` matters more
- **BTC and ETH** have no `rel_strength_btc` in their feature sets because they **are** the benchmark — comparing to themselves adds noise

**Method: Likelihood Permutation Importance (LPI)**
1. Train HMM on full feature set for each coin
2. Permute one feature at a time (shuffle its values, breaking correlation)
3. Measure drop in log-likelihood
4. Rank features by importance drop
5. Greedily add top features until Sharpe plateaus

### 3a. Per-Coin Feature Sets (Full Table)

> Source: `segment_features.py` · `COIN_FEATURES` dict (40 coins)  
> Features listed **left = highest importance → right = lowest importance** (rank order from LPI backtesting)

**Feature key:**
| Short | Full Name | Signal |
|---|---|---|
| `vol_z` | `vol_zscore` | Abnormal volume vs 24-bar average |
| `liq_vac` | `liquidity_vacuum` | Price moving through thin levels (momentum) |
| `log_r` | `log_return` | Raw price momentum |
| `amihud` | `amihud_illiquidity` | Market depth / thin book proxy |
| `vol_ti` | `volume_trend_intensity` | EMA5/EMA20 volume acceleration |
| `rel_btc` | `rel_strength_btc` | Outperformance vs BTC |
| `exh_tail` | `exhaustion_tail` | Reversal wicks × volume |
| `volatility` | `volatility` | (high-low)/close intrabar range |
| `vol_chg` | `volume_change` | Log ratio of successive volume bars |

| Coin | Rank 1 | Rank 2 | Rank 3 | Rank 4 | Rank 5 | Rank 6 | Rank 7 | Notes |
|---|---|---|---|---|---|---|---|---|
| **BTCUSDT** | vol_z | vol_ti | liq_vac | amihud | exh_tail | volatility | vol_chg | No rel_btc (IS benchmark). Depth + wick more important than momentum. |
| **ETHUSDT** | vol_z | liq_vac | vol_ti | amihud | exh_tail | log_r | volatility | Similar to BTC microstructure, no rel_btc. |
| **BNBUSDT** | vol_z | vol_ti | exh_tail | vol_chg | liq_vac | volatility | log_r | Exchange token — volume acceleration dominant. |
| **SOLUSDT** | vol_z | liq_vac | amihud | vol_ti | exh_tail | log_r | rel_btc | High-speed chain, liquidity vacuum critical on breakouts. |
| **AVAXUSDT** | vol_z | liq_vac | vol_ti | amihud | exh_tail | vol_chg | log_r | L1 — volume trend + vacuum dominant; no rel_btc. |
| **AAVEUSDT** | vol_z | liq_vac | log_r | amihud | vol_ti | rel_btc | exh_tail | DeFi — price momentum + depth. rel_btc matters (risk-on alt). |
| **LINKUSDT** | vol_z | amihud | liq_vac | vol_ti | exh_tail | vol_chg | log_r | Oracle token — thick book, depth proxy more important than momentum. |
| **UNIUSDT** | log_r | vol_z | rel_btc | liq_vac | amihud | vol_ti | exh_tail | DeFi — log_return leads (protocol fee volume driver); rel_btc high. |
| **CRVUSDT** | amihud | exh_tail | vol_z | log_r | rel_btc | vol_ti | liq_vac | Thin book DeFi — illiquidity + reversal wicks dominant. |
| **LDOUSDT** | vol_z | amihud | liq_vac | log_r | vol_ti | rel_btc | exh_tail | Liquid staking — depth proxy similar to LINK. |
| **PENDLEUSDT** | vol_z | liq_vac | amihud | vol_ti | log_r | rel_btc | exh_tail | Yield DeFi — momentum through vacuum; thinner market. |
| **INJUSDT** | vol_z | vol_ti | liq_vac | amihud | log_r | rel_btc | exh_tail | DeFi perps — volume acceleration strong signal. |
| **DOGEUSDT** | vol_z | vol_ti | liq_vac | log_r | exh_tail | rel_btc | amihud | Meme — volume vs retail BTC behaviour. Deep liquid book. |
| **WIFUSDT** | vol_z | log_r | rel_btc | liq_vac | vol_ti | amihud | exh_tail | Meme — thinner, relative BTC strength more critical. |
| **GALAUSDT** | vol_z | amihud | liq_vac | vol_ti | log_r | rel_btc | exh_tail | Gaming/Metaverse — thin market, illiquidity key. |
| **SANDUSDT** | vol_z | liq_vac | vol_ti | log_r | exh_tail | amihud | rel_btc | Gaming — vacuum + wick reversal. |
| **AXSUSDT** | vol_z | log_r | rel_btc | vol_ti | exh_tail | liq_vac | vol_chg | Gaming P2E — price momentum leads. |
| **RONINUSDT** | vol_z | log_r | rel_btc | liq_vac | vol_ti | exh_tail | amihud | Gaming — strong rel_btc correlation (retail driven). |
| **PIXELUSDT** | log_r | rel_btc | vol_z | vol_ti | exh_tail | volatility | liq_vac | Small-cap gaming — rel_btc and momentum primary. |
| **IMXUSDT** | vol_z | vol_ti | log_r | liq_vac | rel_btc | amihud | exh_tail | Gaming L2 — volume acceleration good predictor. |
| **ARBUSDT** | vol_z | log_r | liq_vac | rel_btc | vol_ti | amihud | exh_tail | L2 — momentum + relative BTC strength important. |
| **OPUSDT** | vol_z | liq_vac | vol_ti | log_r | amihud | rel_btc | exh_tail | L2 — vacuum dominant on thin orderbook. |
| **STRKUSDT** | vol_z | vol_ti | liq_vac | amihud | exh_tail | log_r | rel_btc | L2 (StarkWare) — volume trend critical, newer coin. |
| **SUIUSDT** | vol_z | liq_vac | vol_ti | log_r | amihud | rel_btc | exh_tail | L1 new gen — vacuum important on momentum moves. |
| **POLUSDT** | vol_z | liq_vac | vol_ti | amihud | log_r | rel_btc | exh_tail | Polygon (MATIC rename) — liquid, vacuum + depth. |
| **TAOUSDT** | vol_z | liq_vac | log_r | rel_btc | amihud | vol_ti | exh_tail | AI/DePIN — BTC correlation high (institutional narrative). |
| **AKTUSDT** | rel_btc | log_r | vol_z | vol_ti | exh_tail | liq_vac | amihud | AI/Cloud — **rel_btc is #1** (beta trade on AI narrative). |
| **API3USDT** | vol_z | log_r | rel_btc | vol_ti | liq_vac | exh_tail | vol_chg | Oracle/DePIN — price momentum leads. |
| **FETUSDT** | vol_z | liq_vac | amihud | vol_ti | log_r | exh_tail | rel_btc | AI agent — depth + vacuum key on thin book. |
| **IOTXUSDT** | vol_z | log_r | rel_btc | vol_ti | exh_tail | volatility | vol_chg | IoT/DePIN — retail driven, rel_btc important. |
| **WLDUSDT** | vol_z | liq_vac | vol_ti | amihud | exh_tail | log_r | vol_chg | Biometric/AI — depth dominant on newer coin. |
| **ONDOUSDT** | vol_z | log_r | vol_ti | amihud | liq_vac | rel_btc | exh_tail | RWA — volume + momentum lead narrative moves. |
| **POLYXUSDT** | vol_z | vol_ti | exh_tail | log_r | rel_btc | vol_chg | liq_vac | Compliance/RWA — tail reversals strong signal. |
| **TIAUSDT** | vol_z | amihud | liq_vac | vol_ti | log_r | rel_btc | exh_tail | Modular L1 — thin market, illiquidity key. |
| **ARUSDT** | log_r | vol_z | rel_btc | liq_vac | vol_ti | exh_tail | amihud | Storage — price momentum dominant, narrative-driven. |
| **FILUSDT** | vol_z | liq_vac | amihud | vol_ti | log_r | rel_btc | exh_tail | Storage — similar to AR, vacuum on breakouts. |
| **DYMUSDT** | vol_z | log_r | rel_btc | vol_ti | exh_tail | liq_vac | vol_chg | Modular — rel_btc strong (correlated L1 plays). |
| **JUPUSDT** | vol_z | vol_ti | liq_vac | amihud | log_r | rel_btc | exh_tail | Solana DEX — volume trend important (trading volume proxy). |
| **RUNEUSDT** | vol_z | vol_ti | liq_vac | exh_tail | amihud | log_r | vol_chg | Cross-chain DEX — tail reversals higher importance (liquidity provision). |
| **TRBUSDT** | vol_z | liq_vac | amihud | vol_ti | log_r | rel_btc | exh_tail | Oracle — thin book, depth key. |
| **TRUUSDT** | vol_z | rel_btc | vol_ti | log_r | exh_tail | vol_chg | liq_vac | RWA — BTC correlation strong (institutional narrative beta). |
| **PYTHUSDT** | vol_z | log_r | rel_btc | vol_ti | liq_vac | amihud | exh_tail | Oracle/Solana — price momentum + BTC beta. |

### Key Patterns Across Coins

| Pattern | Coins | Insight |
|---|---|---|
| **vol_zscore always #1 or #2** | 36/40 coins | Abnormal volume is the universal regime signal. Institutional events visible before price. |
| **No rel_btc for BTC/ETH/BNB** | 3 coins | They define the benchmark. Self-comparison adds noise not signal. |
| **rel_btc = #1 for AKTUSDT** | 1 coin | AI narrative plays have very high beta to BTC. Trade is essentially a sector rotation trade. |
| **amihud_illiquidity dominant for thin coins** | CRDB, TIA, FIL | Thin-book coins: small orders move price → illiquidity predicts regime more than volume absolute. |
| **exhaustion_tail lowest ranked universally** | all coins | Reversal wicks have the weakest standalone signal. Only useful as a confirming feature. |


## 4. State Labeling & Regime Classification

Raw HMM states are arbitrary numbers (0, 1, 2). They acquire meaning via `_build_state_map()`:

```python
def _build_state_map(self):
    means = self.model.means_[:, 0]   # mean log-return per raw state
    sorted_indices = np.argsort(means)[::-1]  # highest to lowest

    # 3-state mapping:
    self._state_map = {
        sorted_indices[0]: REGIME_BULL,   # highest mean return
        sorted_indices[1]: REGIME_CHOP,   # middle
        sorted_indices[2]: REGIME_BEAR,   # lowest mean return
    }
```

This is robust: regardless of which raw state the HMM assigns numbers 0/1/2 to, the regime label always follows economic meaning (high return = BULL).

### Regime Constants

```python
REGIME_BULL  = 0
REGIME_BEAR  = 1
REGIME_CHOP  = 2
REGIME_CRASH = 3  # unused in 3-state; kept for legacy code compatibility
```

---

## 5. Confidence: Margin Score

**Problem with raw posterior probability:** `model.predict_proba()` returns values like 99.8% for nearly every prediction — even when the model is genuinely uncertain. The softmax normalization in HMM posterior computation produces this artificially inflated result regardless of actual accuracy. Completely useless as a trading confidence signal.

**Solution: Margin Confidence**
```python
sorted_p = np.sort(probs)[::-1]           # sort probabilities descending
confidence = sorted_p[0] - sorted_p[1]   # best_state_prob - second_best_prob
```

| Margin | Physical Meaning | Conviction Tier |
|---|---|---|
| 0.00 – 0.10 | Model is nearly tied between two states | LOW (0 points) |
| 0.10 – 0.25 | Slight preference — model is uncertain | LOW (11 points) |
| 0.25 – 0.40 | Moderate conviction | MED (22 points) |
| 0.40 – 0.60 | Strong conviction | MED_HIGH (33 points) |
| 0.60 – 1.00 | Decisive — model is very sure | HIGH (44 points) |

These tiers are defined in `config.py` as `HMM_CONF_TIER_*` constants.

---

## 6. Multi-Timeframe Brain (MultiTFHMMBrain)

**Class:** `MultiTFHMMBrain` in `hmm_brain.py`

One `MultiTFHMMBrain` instance per coin. It manages 3 separate `HMMBrain` instances (one per timeframe):

### Timeframe Architecture

| Timeframe | Data | Weight | Purpose |
|---|---|---|---|
| **15m** | 1000 bars (~10 days) | 25 pts | Entry timing, momentum detection |
| **1H** | 1000 bars (~42 days) | 35 pts | Swing regime, intermediate trend |
| **4H** | 1000 bars (~170 days) | 40 pts | Macro regime, dominant direction |

```
Weight assignments reflect the "law of larger timeframes":
4H carries more weight because it takes longer to change direction
and therefore contains higher-quality directional information.
```

### `get_conviction()` — Weighted Voting Logic

```python
def get_conviction():
    directions = []
    for tf, (regime, margin) in predictions.items():
        if regime == BULL:  directions.append(("BUY", tf, margin))
        if regime == BEAR:  directions.append(("SELL", tf, margin))
        # CHOP = abstain (no directional vote)

    buys  = count BUY votes
    sells = count SELL votes

    if buys > sells:   consensus = "BUY"
    elif sells > buys: consensus = "SELL"
    else:              return 0.0, None, 0  # TIED — no trade

    # Only proceed if minimum agreement threshold met
    if agreement < MULTI_TF_MIN_AGREEMENT:
        return 0.0, None, agreement

    # Weighted conviction: each TF contributes weight × margin_tier_score
    total = Σ(weight × margin_tier_factor) for agreeing TFs
    conviction = max(0, min(100, total))
    return conviction, consensus, agreement
```

### Margin Tier Scoring in Conviction

```
margin ≥ 0.60 → factor = 1.00 (full weight)
margin ≥ 0.40 → factor = 0.85
margin ≥ 0.25 → factor = 0.65
margin ≥ 0.10 → factor = 0.40
margin < 0.10 → factor = 0.20 (model barely sure)
```

**Example:**
```
15m: BULL, margin=0.72 → factor=1.00, weight=25 → contributes 25 pts
1H:  BULL, margin=0.45 → factor=0.85, weight=35 → contributes 29.75 pts
4H:  BULL, margin=0.31 → factor=0.65, weight=40 → contributes 26 pts

Total conviction = 80.75 → rounded to 80.8
```

---

## 7. Conviction Scoring (0–100)

The conviction score gates every trade and determines leverage. Computed in `risk_manager.py`'s `validate_signal()`, then re-evaluated in the deploy loop.

### Score Formula

```
Score = HMM(max 44) + Sentiment(max 15) + Funding(max 11) + 
        OpenInterest(max 11) + OrderFlow(max 10) + BTC_Macro(max 7) + 
        SR_VWAP(max 2) + Volatility(filter only)
= 100 pts maximum
```

### Factor Details

| Factor | Max | Logic |
|---|---|---|
| **HMM** | 44 | Based on margin confidence tier (see §5). CHOP = 0 always. |
| **Sentiment** | 15 | VADER/FinBERT NLP score × article confidence. Hard veto if exploit/hack alert detected. |
| **Funding Rate** | 11 | Positive funding + BUY signal = smart money paying longs = bullish. Negative + SELL = bearish. |
| **Open Interest** | 11 | Rising OI in direction of trade = new money confirming the move. |
| **Order Flow** | 10 | L2 depth imbalance + taker buy/sell ratio from `orderflow_engine.py`. |
| **BTC Macro** | 7 | Is BTC in a bull regime? Coins have high correlation, especially alts. BTC bear = risk-off. |
| **S/R + VWAP** | 2 | Entry at support (long) or resistance (short) = favorable price level. Low weight (IC ~-0.01 on 4H). |
| **Volatility** | 0 | Filter only. Blocks trade if `ATR% < 0.3%` (too quiet) or `ATR% > 6%` (too chaotic). |

### Leverage Bands

```
Conviction → Leverage
< 40        → 0x    (NO TRADE)
40 – 54     → 10x
55 – 69     → 15x
70 – 84     → 25x
85 – 100    → 35x
```

---

## 8. Tiered MTF Signal Logic — Full Decision Table

All 27 possible combinations of [15m × 1H × 4H] regimes and what happens in `_analyze_coin()`:

> **B** = BULL, **Bear** = BEAR, **C** = CHOP

| # | 15m | 1H | 4H | Tier | Result |
|---|---|---|---|---|---|
| 1 | B | B | B | 1 — Trend Follow | ✅ LONG — full conviction |
| 2 | Bear | Bear | Bear | 1 — Trend Follow | ✅ SHORT — full conviction |
| 3 | B | B | C | 1 — Trend Follow | ✅ LONG — 1H/4H no conflict |
| 4 | B | C | B | 1 — Trend Follow | ✅ LONG — no conflict |
| 5 | Bear | Bear | C | 1 — Trend Follow | ✅ SHORT — no conflict |
| 6 | Bear | C | Bear | 1 — Trend Follow | ✅ SHORT — no conflict |
| 7–13 | C | any | any | — | ❌ SKIP — no 15m signal (CHOP = no side) |
| 14 | B | C | C | — | ❌ SKIP — only 15m signal, no higher TF support |
| 15 | Bear | C | C | — | ❌ SKIP — only 15m signal |
| 16 | B | Bear | Bear | **2A** — Reversal | 🔄 ATR+EMA20 pullback on **15m** → in zone: ✅ LONG at ≤55% conviction |
| 17 | Bear | B | B | **2A** — Reversal | 🔄 ATR+EMA20 pullback on **15m** → in zone: ✅ SHORT at ≤55% conviction |
| 18 | B | Bear | C | **2A** — Reversal | 🔄 ATR+EMA20 pullback on **15m** |
| 19 | B | C | Bear | **2A** — Reversal | 🔄 ATR+EMA20 pullback on **15m** |
| 20 | Bear | B | C | **2A** — Reversal | 🔄 ATR+EMA20 pullback on **15m** |
| 21 | Bear | C | B | **2A** — Reversal | 🔄 ATR+EMA20 pullback on **15m** |
| 24 | B | Bear | B | **2B** — Trend Resume | 📈 ATR+EMA20 pullback on **1H** → in zone: ✅ LONG at ≤60% conviction |
| 25 | Bear | B | Bear | **2B** — Trend Resume | 📈 ATR+EMA20 pullback on **1H** → in zone: ✅ SHORT at ≤60% conviction |
| 22 | B | B | Bear | 3 — Noise Block | ❌ MTF_CONFLICT — 1H/4H directly oppose |
| 23 | Bear | Bear | B | 3 — Noise Block | ❌ MTF_CONFLICT — 1H/4H directly oppose |
| 26 | C | B | Bear | 3 — Noise Block | ❌ MTF_CONFLICT — 1H/4H conflict (no 15m signal anyway) |
| 27 | C | Bear | B | 3 — Noise Block | ❌ MTF_CONFLICT — 1H/4H conflict |

### Master Rule

> **The 4H is the authority.** If trade direction agrees with 4H, entry is possible. If trade direction fights the 4H, it is blocked regardless of 15m/1H.

---

## 9. ATR Pullback Logic — Tier 2A & 2B

### Philosophy

Reversal entries should not chase price. The optimal entry is when price **returns to the mean** after the initial impulsive move. The 20-period EMA is the mean reversion reference; ATR defines the tolerance band.

```
Entry Zone = EMA20 ± (1× ATR)

Too far above EMA20 = overextended long → skip
Too far below EMA20 = free-falling → dangerous to catch
Within zone       = mean-reversion entry with tight SL logic
```

### Tier 2A — 15m Pullback (15m flip vs 1H+4H)

**When:** 15m HMM flipped direction but 1H and 4H have not yet confirmed.

```
LONG entry zone (15m):
  current_price ≤ ema20_15m + (1.0 × atr_15m)   [not overextended above]
  current_price ≥ ema20_15m - (1.0 × atr_15m)   [not crashing through mean]

SHORT entry zone (15m):
  current_price ≥ ema20_15m - (1.0 × atr_15m)
  current_price ≤ ema20_15m + (1.0 × atr_15m)
```

**If not in zone:** `action = REVERSAL_WAIT_PULLBACK` → `return None` (checked next cycle)  
**If in zone:** `conviction = min(conviction, 55.0)` → `signal_type = 'REVERSAL_PULLBACK'`  
**Athena context:** Informed that this is a reversal (not trend-follow), so it applies extra skepticism.

### Tier 2B — 1H Pullback (15m+4H agree, 1H lagging)

**When:** 15m and 4H agree on direction (e.g., both BULL) but 1H has not yet flipped (still BEAR).

**Why this is different from Tier 2A:** The 4H dominant trend is already in our direction. We're not fighting anything — we're buying a dip within a macro uptrend. The 1H is simply lagging.

```
LONG entry zone (1H):
  current_price ≤ ema20_1h + (1.0 × atr_1h)
  current_price ≥ ema20_1h - (1.0 × atr_1h)

SHORT entry zone (1H):
  current_price ≥ ema20_1h - (1.0 × atr_1h)
  current_price ≤ ema20_1h + (1.0 × atr_1h)
```

**If not in zone:** `action = TIER2B_WAIT_PULLBACK` → `return None`  
**If in zone:** `conviction = min(conviction, 60.0)` → `signal_type = 'TREND_RESUME_PULLBACK'`

> Note: Tier 2B has a higher conviction cap (60% vs 55%) because the macro (4H) aligns with the trade. This is a dip-buy in a bull trend, not a speculative reversal bet.

### SL Placement for Pullback Entries

For both Tier 2A and 2B, the stop-loss is placed **below the pullback zone** to keep risk defined:

```
LONG SL = current_entry - (0.75 × ATR)   [tighter than trend-follow 1×ATR]
SHORT SL = current_entry + (0.75 × ATR)
```

The tight SL is justified because the entry is at a structurally defined mean reversion point — if price breaks significantly below EMA20, the reversal thesis has failed.

---

## 10. Athena — AI Final Gatekeeper

**Class:** `AthenaEngine` in `llm_reasoning.py`  
**Model:** Google Gemini (via `GEMINI_API_KEY`)

Athena is the final intelligence layer before any trade is executed. Even if HMM + conviction scoring approve a trade, Athena must confirm with an `EXECUTE` decision.

### Input Context (`llm_ctx`)

```python
{
    "ticker":          "IMXUSDT",
    "side":            "BUY",
    "leverage":        10,
    "hmm_confidence":  0.68,
    "hmm_regime":      "BULLISH",
    "conviction":      65.0,
    "current_price":   1.831,
    "atr":             0.042,
    "atr_pct":         2.29,
    "trend":           "UP",
    "signal_type":     "TREND_FOLLOW",     # or "REVERSAL_PULLBACK" / "TREND_RESUME_PULLBACK"
    "ema_15m_20":      1.831,              # for reversal context
    # + BTC regime, funding rate, sentiment score, order flow data
}
```

### Output: `AthenaDecision`

```python
@dataclass
class AthenaDecision:
    action:               str    # "EXECUTE" or "VETO"
    adjusted_confidence:  float  # Athena's confidence estimate (0-1)
    reasoning:            str    # Plain English explanation
    risk_flags:           list   # ["OVERBOUGHT", "LOW_VOLUME", ...]
```

### Fail-Open Policy

If the Gemini API call fails (rate limit, network, key missing):
```python
except Exception:
    # Default to EXECUTE — do not miss trade opportunities due to API errors
    return AthenaDecision(action="EXECUTE", adjusted_confidence=0.5, ...)
```

### Athena's Role by Signal Type

| signal_type | Athena Behavior |
|---|---|
| `TREND_FOLLOW` | Standard review — checks trend, momentum, risk flags |
| `REVERSAL_PULLBACK` | Extra skepticism — checks if reversal has fundamental support |
| `TREND_RESUME_PULLBACK` | Moderate review — 4H confirms direction, so lower bar to EXECUTE |

---

## 11. Retraining Schedule & Intervals

### When Does Retraining Happen?

The HMM brain retrains **lazily** — only when a coin is actively being scanned AND its model is stale. No scheduled batch job exists.

```python
# In _analyze_coin(), called via ThreadPoolExecutor every 5 min:
brain = self._mtf_brains[symbol]
if brain.needs_retrain():          # checks: time.time() - last_trained > retrain_interval
    data = fetch_klines(symbol, tf, limit=1000)
    features = compute_all_features(data)
    brain.train(features)          # EM fitting, ~200-500ms per timeframe
    brain._last_trained = time.time()
```

### Retraining Interval Configuration

| Timeframe | Interval | Bars Fetched | Time Window |
|---|---|---|---|
| **15m** | **24 hours** | 1000 bars | ~10.4 days of 15m data |
| **1H** | **24 hours** | 1000 bars | ~41.7 days of 1H data |
| **4H** | **24 hours** | 1000 bars | ~166.7 days of 4H data |

All three timeframes retrain on the same 24-hour schedule.

### Why 24 Hours?

| Interval Considered | Verdict | Reason |
|---|---|---|
| Every 5 min (every cycle) | ❌ Rejected | Overfits intraday noise. Model churns states. High CPU cost. |
| Every 1 hour | ❌ Rejected | Still too reactive to short-term price swings. |
| **Every 24 hours** | ✅ Chosen | Adapts to regime changes (e.g., new bull/bear phase after a weekly close). Stable enough not to overfit. |
| Every 7 days | ❌ Rejected | Miss medium-term regime changes within a week. |

### Market Events That Trigger Awareness (Not Retrain)

The model does NOT retrain on market events. Instead, it is designed to detect them:

| Event | HMM Response |
|---|---|
| Sudden BTC crash | Margin confidence drops (model uncertain → conviction falls) |
| Volume spike (whale trade) | `vol_zscore` spikes → regime re-classified in next prediction |
| News-driven pump | `log_return` + `volume_change` change → model detects BULL in next 15m bar |

**Design principle:** The 5-minute predict cycle (not the 24-hour retrain) is how the model adapts to intraday events. You get fresh regime classification every 5 minutes, even with a 24-hour-old model.

### When Should You Force Retrain?

> Manually delete `data/brain_cache/` on Railway to force all brains to retrain on next startup.

Force retrain recommended when:
1. Market structure changes significantly (e.g., BTC halving, macro rate decision)
2. New features added to `segment_features.py`
3. Feature engineering formula changed in `feature_engine.py`
4. A coin's Sharpe has degraded significantly

Retraining is coin-specific and happens lazily. A coin not scanned for >24h will retrain on its next appearance in the scan list.


## 12. Key Design Decisions

| Decision | Rationale |
|---|---|
| **3-state HMM over 4-state** | CRASH state proved statistically useless (10.9% accuracy). 3-state Sharpe 1.22 >> 4-state Sharpe 0.72. |
| **Margin confidence over posterior** | Raw HMM posterior is always 99%+ regardless of actual confidence. Margin is calibrated and meaningful. |
| **Segment-based feature sets** | Different market segments (DeFi, L1, Meme) have different microstructure. A single global feature set is suboptimal. |
| **4H as dominant regime** | Higher timeframe signals carry more information. Reversed 4H trends require weeks to establish — reliable signal. |
| **ATR pullback gate for reversals** | Prevents chasing initial reversal spike. Waits for mean reversion confirmation before risking capital. |
| **Tier 2B: Unlock 1H laggard cases** | When 15m+4H agree, blocking on 1H lag means missing early entries in established macro trends. |
| **Fail-open Athena** | API failures should not cause missed opportunities. The HMM + conviction scoring is sufficient fallback. |
| **Per-cycle Athena (not pre-scan)** | Athena runs per bot, per coin, at deployment time — not during the scan phase. This prevents API cost explosion while scanning 25+ coins. |

# CoinDCX Trading Pairs — Full Market Report

**Date:** March 18, 2026
**Source:** CoinDCX Public API + CoinGecko Category Data

---

## 1. Exchange Overview

| Metric | Value |
|--------|-------|
| Total Active Spot Markets | **545** |
| Total Active Futures Instruments | **548** |
| **Total Tradable Instruments** | **1,093** |
| Futures Contract Type | Perpetuals Only (no expiry/quarterly) |
| Futures Quote Currency | USDT only |
| Spot Quote Currencies | USDT, INR, BTC, ETH, DAI, TRX, USDC |
| Inactive Markets | 0 |

---

## 2. Spot Markets (545 Active)

### 2.1 Segment Breakdown

| Segment Prefix | Description | Count | % |
|----------------|-------------|-------|---|
| `KC-*_USDT` | KuCoin-routed USDT Spot | ~486 | ~89.2% |
| `B-*_USDT` | B-Segment USDT (Advanced Orders) | 18 | 3.3% |
| `H-*_USDT` | H-Segment USDT Spot | 6 | 1.1% |
| `I-*_INR` | INR (Indian Rupee) Fiat Spot | 4 | 0.7% |
| `KC-*_BTC/ETH/DAI` | Misc Quote Currencies | ~31 | ~5.7% |
| **Total** | | **545** | **100%** |

### 2.2 Quote Currency Distribution (All Symbols)

| Quote Currency | Count | % |
|---------------|-------|---|
| USDT | 751 | 72.4% |
| INR | 260 | 25.1% |
| BTC | 14 | 1.4% |
| ETH | 5 | 0.5% |
| DAI | 3 | 0.3% |
| TRX | 2 | 0.2% |
| USDC | 1 | 0.1% |
| **Total** | **1,037** | **100%** |

> **Note:** The 1,037 figure includes all symbols (active + legacy/inactive). The 545 figure represents only fully configured, active markets per `/markets_details` endpoint.

### 2.3 Order Types by Segment

| Segment | Limit Order | Market Order | Stop-Limit | Take-Profit |
|---------|:-----------:|:------------:|:----------:|:-----------:|
| KC-Segment | ✅ | ✅ | ❌ | ❌ |
| B-Segment | ✅ | ✅ | ✅ | ✅ |
| H-Segment | ✅ | ✅ | ❌ | ❌ |
| I-Segment (INR) | ✅ | ❌ | ❌ | ❌ |

> B-Segment is the only segment supporting advanced order types (stop-limit, take-profit).

---

## 3. Futures Markets — Perpetuals (548 Active)

> All 548 instruments are **USDT-quoted perpetual contracts** with no fixed expiry.
> Leverage information is not exposed via the public API.

### 3.1 Segment Classification Summary

| # | Segment | Coins | % of Total |
|---|---------|-------|-----------|
| 1 | DeFi | 101 | 18.4% |
| 2 | Layer 1 (L1) | 75 | 13.7% |
| 3 | AI / Artificial Intelligence | 57 | 10.4% |
| 4 | Infrastructure | 55 | 10.0% |
| 5 | Meme | 45 | 8.2% |
| 6 | Layer 2 (L2) | 38 | 6.9% |
| 7 | Exchange Tokens (CEX) | 37 | 6.8% |
| 8 | Gaming / GameFi | 36 | 6.6% |
| 9 | Oracle | 13 | 2.4% |
| 10 | Storage | 6 | 1.1% |
| 11 | Privacy | 4 | 0.7% |
| 12 | Stablecoin | 3 | 0.5% |
| — | Uncategorized | 102 | 18.6% |
| | **Total Instruments** | **548** | |

> **Note:** ~111 coins appear in multiple segments (e.g. LINK = DeFi + Oracle + Infrastructure). Counts reflect primary CoinGecko taxonomy.

---

### 3.2 DeFi — 101 Coins

> Decentralized exchanges, lending protocols, yield aggregators, and liquidity infrastructure.

1INCH, AAVE, AERO, AEVO, API3, ASTER, AUCTION, AVNT, AWE, BABY, BAND, BARD, BERA, BNT, C98, CAKE, CETUS, COMP, COW, CRV, DEEP, DEXE, DIA, DOLO, DRIFT, DYDX, ENA, ETHFI, F, FF, FIDA, FLUID, FOGO, FRAX, GMX, HOME, HUMA, HYPE, INJ, INX, IOTA, JOE, JST, JTO, JUP, KERNEL, KMNO, KNC, LAYER, LDO, LINK, LISTA, LIT, LQTY, LRC, MAGMA, MET, MITO, MLN, MMT, MORPHO, NMR, OGN, ONDO, ORCA, PARTI, PENDLE, PUMP, PUNDIX, PYTH, RESOLV, REZ, RPL, RSR, RUNE, SEI, SKY, SNX, SPELL, SPK, SSV, STG, STO, SUN, SUSHI, SYRUP, T, THE, TRB, TRIA, UMA, UNI, USUAL, WET, WOO, XVS, YB, YFI, ZBT, ZRX, 1000LUNC

---

### 3.3 Layer 1 (L1) — 75 Coins

> Native base-layer blockchains with their own consensus and execution environment.

0G, A, ADA, ALGO, APT, AR, ARK, ASTR, AVAX, BCH, BERA, BNB, BTC, CC, CHZ, DUSK, DYDX, EGLD, ENJ, ETC, ETH, FIL, FLOW, FOGO, G, GALA, GUN, HBAR, HIVE, HYPE, ICP, INJ, IOTA, IP, IRYS, KAIA, KAS, KAVA, KITE, LTC, MINA, MON, MOVE, NEAR, NIGHT, NXPC, ONE, ONG, PLUME, POLYX, ROSE, RUNE, S, SCRT, SEI, SKL, SOL, SOMI, STABLE, SUI, TAO, THETA, TIA, TON, TRX, VANA, VET, VTHO, WAXP, XMR, XPL, XRP, XTZ, ZEC, ZETA

---

### 3.4 AI / Artificial Intelligence — 57 Coins

> AI agents, decentralized compute, machine learning infrastructure, and data networks.

0G, ACU, AIXBT, AKT, ALCH, ALLO, AR, ARC, ARKM, ATH, AWE, CARV, CGPT, CHR, CLANKER, COOKIE, CYBER, EIGEN, FET, FLOCK, FLUX, GLM, GRASS, GRT, HOLO, ICP, IO, IOTX, IP, KAITO, KITE, LA, LPT, MAGIC, MIRA, NEAR, NEWT, NIL, OPEN, PHA, PIPPIN, RECALL, RENDER, RLC, ROBO, SAGA, SAHARA, SAPIEN, SCRT, SENT, SQD, TAO, THETA, VANA, VANRY, VIRTUAL, VVV

---

### 3.5 Infrastructure — 55 Coins

> Cross-chain bridges, middleware, data availability, and blockchain tooling.

0G, 2Z, ARC, AT, ATH, AWE, AXL, BICO, BREV, CARV, CTSI, DEEP, DIA, EIGEN, ENSO, ESP, FIDA, FIL, GAS, GRT, H, HOLO, HYPER, ICNT, ICP, INIT, IOTA, LDO, LINK, LTC, MOVE, NIL, PHA, PIPPIN, POWER, PROVE, PYTH, QNT, RED, RPL, RUNE, SAFE, SAGA, SAPIEN, SCRT, SKR, SKY, STABLE, STRK, STX, TAC, TON, WAL, XAN, ZKP

---

### 3.6 Meme — 45 Coins

> Community-driven tokens, meme culture coins, and viral crypto assets.

ACT, AIXBT, ANIME, AVA, BAN, BANANAS31, BIRB, BOME, BRETT, CHILLGUY, DEGEN, DOGE, DOGS, FARTCOIN, GIGGLE, GOAT, GRIFFAIN, HIPPO, JOE, KOMA, MELANIA, MEME, MEW, MOODENG, MUBARAK, NOT, ORDI, PENGU, PEOPLE, PIPPIN, PNUT, POPCAT, PUMP, SPX, TRUMP, TUT, VINE, WIF, ZEREBRO, 1000BONK, 1000CAT, 1000FLOKI, 1000PEPE, 1000SHIB, 1MBABYDOGE

---

### 3.7 Layer 2 (L2) — 38 Coins

> Ethereum scaling solutions, rollups, and sidechain ecosystems.

AEVO, ALT, ARB, ASTR, BB, CELO, CKB, COTI, CTSI, CYBER, FHE, IMX, LINEA, LRC, LSK, LUMIA, MAGIC, MANTA, MERL, METIS, MTL, OP, OPEN, PHA, POL, PROM, PUFFER, SCR, SKR, SONIC, SOPH, STRK, STX, SYS, TAIKO, TON, TOWNS, ZK

---

### 3.8 Exchange Tokens (CEX) — 37 Coins

> Native tokens of centralized and decentralized exchanges.

1INCH, 1000CAT, AERO, ARKM, ASTER, BNB, BNT, CAKE, CETUS, COW, CRV, DOLO, DYDX, FF, FRAX, HFT, HYPE, INX, JOE, JUP, KNC, LA, LAYER, LRC, MET, MMT, ORCA, PENDLE, PUMP, RUNE, SAFE, SNX, SUSHI, THE, UNI, WOO, ZRX

---

### 3.9 Gaming / GameFi — 36 Coins

> Blockchain gaming, play-to-earn, NFT gaming ecosystems, and metaverse tokens.

A2Z, ACE, ALICE, APE, AXS, BIGTIME, CARV, CATI, ENJ, FORM, GALA, GMT, GUN, HMSTR, HOOK, IMX, MANA, MAVIA, MBOX, MOCA, MON, NOT, NXPC, PIXEL, PORTAL, POWER, SAND, SKL, SONIC, SUPER, TLM, WAXP, XAI, YGG, 1000FLOKI, 1MBABYDOGE

---

### 3.10 Oracle — 13 Coins

> Decentralized data feed providers connecting on-chain and off-chain information.

API3, AT, BAND, DIA, LINK, PHA, PHB, PYTH, RED, RLC, TRB, UMA, ZKP

---

### 3.11 Storage — 6 Coins

> Decentralized file storage and data persistence protocols.

AR, FIL, HOT, ICNT, STORJ, WAL

---

### 3.12 Privacy — 4 Coins

> Privacy-focused cryptocurrencies and zero-knowledge protocols.

EPIC, XMR, ZEC, ZKC

---

### 3.13 Stablecoin — 3 Coins

> Algorithmic and fiat-backed stablecoins.

FRAX, USDC, USTC

---

### 3.14 Uncategorized — 102 Coins

> These coins did not match CoinGecko's primary categories. Likely segments are noted below.

#### Likely Interoperability / L0 (Cosmos / Polkadot Ecosystem)
ATOM, DOT, KSM, XLM, DYM, NTRN, CFG, CFX, MOVR, RONIN, QTUM, ONT, ICX, ZETA

#### Likely RWA (Real World Assets)
PAXG, XAU, XAG, SOLV, ONDO *(also DeFi)*

#### Likely Social / Identity / DAO
WLD, ENS, MASK, BAT, GTC, ID, EDU, NFP, BLUR, OXT

#### Likely DePIN (Decentralized Physical Infrastructure)
POWR, IOTX, GPS, RIF, JASMY

#### Likely Fan Tokens / Sports
ALPINE, SANTOS, ASR, OG, CHZ *(also L1)*

#### Likely Ecosystem / Misc
ACH, AGLD, AI, ARPA, ATA, B3, BANANA, BANK, BEL, BIO, BMT, BROCCOLI714, BSV, C, DASH, DENT, DOT, DYM, EDEN, ERA, ETHW, EUL, FIGHT, FIO, HAEDAL, HEI, HEMI, HIGH, ILV, IOST, KSM, LUNA2, MAV, ME, MEGA, NEO, NOM, OPN, RARE, RAVE, RDNT, RIVER, RVN, SFP, SHELL, SIGN, STEEM, SWARMS, SXT, SYN, TA, TNSR, TREE, TRU, TURTLE, TWT, VELODROME, VIC, W, WCT, WLD, WLFI, XLM, ZEN, ZIL, ZRO, 1000000MOG, 1000RATS, 1000SATS

---

---

## 4. Binance vs CoinDCX Futures — Cross-Exchange Comparison

> **Source:** Binance USDT-M Perpetuals (`/fapi/v1/exchangeInfo`) vs CoinDCX futures instruments

| Metric | Count |
|--------|-------|
| Binance USDT-M Perpetuals | **543** |
| CoinDCX Futures (unique coins) | **438** |
| **On BOTH exchanges** | **436 (99.5%)** |
| Only on CoinDCX (not Binance) | **2** |
| Only on Binance (not on CoinDCX) | **107** |

### Exclusive to CoinDCX (2 coins)
| Symbol | Description |
|--------|-------------|
| XAU | Synthetic Gold perpetual |
| XAG | Synthetic Silver perpetual |

### Only on Binance — Not yet on CoinDCX (107 coins)
1000000BOB, 1000CHEEMS, 1000XEC, AERGO, AGT, AIA, AIN, AIO, AIOT, AKE, ALL, ANKR, APR, ARIA, AZTEC, B, B2, BAS, BEAMX, BEAT, BLESS, BLUAI, BOB, BR, BROCCOLIF3B, BTCDOM, BTR, BULLA, CELR, CLO, COAI, COLLECT, CROSS, CTK, CVC, CVX, CYS, D, DAM, DEGO, DODOX, DOOD, ELSA, ESPORTS, EVAA, FOLKS, FORTH, FUN, GUA, GWEI, HANA, IDOL, IN, IR, JCT, JELLYJELLY, KAT, KGEN, LAB, LIGHT, LYN, M, MANTRA, MYX, NAORIS, NEIRO, OL, ON, ORDER, PIEVERSE, PLAY, PROMPT, PTB, PUMPBTC, Q, RAYSOL, RLS, SIREN, SKYAI, SLP, SOON, SPACE, SPORTFUN, STBL, TAG, TAKE, TOSHI, TRADOOR, TRUST, TRUTH, TST, TURBO, UAI, UB, US, USELESS, VELVET, XNY, XPIN, XVG, ZAMA, ZKJ, ZORA

> **Conclusion:** CoinDCX mirrors Binance at 99.5% fidelity. The 107 missing coins are mostly newly listed or low-liquidity tokens on Binance not yet onboarded by CoinDCX.

---

## 5. Synaptic Engine — Training Status

> **Source:** `data/coin_tiers.csv` (HMM-trained coins) + `data/multi_bot_state.json` (live scan state)

### 5.1 Training Coverage Summary

| Status | Count | % of CoinDCX Futures |
|--------|-------|----------------------|
| **Trained & Evaluated** (coin_tiers.csv) | **86** | 19.6% |
| **Actively Scanned** (current cycle) | **8** | 1.8% |
| **Not Yet Trained** | **352** | 80.4% |
| **Total CoinDCX Futures (unique)** | **438** | 100% |

> Phase 1 training completed **March 18, 2026** — 45 new coins trained using GMMHMM (n_mix=3, diag covariance). 16 skipped due to insufficient history (new listings).

### 5.2 Trained Coins — 86 Total (Tier A/B/C)

| Tier | Original (41) | Phase 1 New (45) | Total | Criterion |
|------|:---:|:---:|:---:|-----------|
| **Tier A** (Strong) | 29 | 25 | **54** | fwd_sharpe ≥ 1.0 |
| **Tier B** (Moderate) | 1 | 15 | **16** | fwd_sharpe 0–1 |
| **Tier C** (Weak/Skip) | 11 | 5 | **16** | fwd_sharpe < 0 |

#### Original 41 Coins (pre-Phase 1)
**Tier A (29):** AAVEUSDT, API3USDT, AVAXUSDT, AXSUSDT, BNBUSDT, BTCUSDT, CRVUSDT, DOGEUSDT, FILUSDT, IMXUSDT, INJUSDT, JUPUSDT, LINKUSDT, ONDOUSDT, OPUSDT, PENDLEUSDT, PEPEUSDT, POLYXUSDT, PYTHUSDT, RONINUSDT, RUNEUSDT, SHIBUSDT, SOLUSDT, SUIUSDT, TAOUSDT, TRBUSDT, UNIUSDT, WIFUSDT

**Tier B (1):** TRUUSDT

**Tier C (11):** ARBUSDT, ARUSDT, BONKUSDT, DYMUSDT, ETHUSDT, IOTXUSDT, PIXELUSDT, POLUSDT, SANDUSDT, STRKUSDT, TIAUSDT, WLDUSDT

#### Phase 1 — New Coins Trained March 18, 2026 (GMMHMM n_mix=3)

**Tier A (25 coins):**

| Symbol | Segment | fwd_sharpe |
|--------|---------|-----------|
| APTUSDT | L1 | 2.16 |
| DOTUSDT | L1 | 2.81 |
| ETCUSDT | L1 | 1.89 |
| HBARUSDT | L1 | 2.24 |
| TRXUSDT | L1 | 1.50 |
| XRPUSDT | L1 | 2.39 |
| CELOUSDT | L2 | 2.20 |
| MANTAUSDT | L2 | 1.19 |
| ZKUSDT | L2 | 1.03 |
| CAKEUSDT | DeFi | 2.63 |
| DYDXUSDT | DeFi | 1.61 |
| ENAUSDT | DeFi | 1.18 |
| GMXUSDT | DeFi | 1.23 |
| LDOUSDT | DeFi | 2.92 |
| SUSHIUSDT | DeFi | 3.18 |
| FETUSDT | AI | 1.24 |
| GRTUSDT | AI | 2.41 |
| RENDERUSDT | AI | 2.17 |
| 1000BONKUSDT | Meme | 2.22 |
| 1000PEPEUSDT | Meme | 2.05 |
| 1000SHIBUSDT | Meme | 1.91 |
| MEWUSDT | Meme | 2.56 |
| GALAUSDT | Gaming | 1.79 |
| MANAUSDT | Gaming | 1.68 |
| STXUSDT | Infrastructure | 1.79 |

**Tier B (15 coins):** ADAUSDT, BCHUSDT, ICPUSDT, LTCUSDT, NEARUSDT, METISUSDT, COMPUSDT, JTOUSDT, SNXUSDT, GLMUSDT, IOUSDT, NOTUSDT, ENJUSDT, YGGUSDT, BANDUSDT

**Tier C (5 coins):** KASUSDT, TONUSDT, ARKMUSDT, AXLUSDT, QNTUSDT

#### Phase 1 — Skipped (16 coins — insufficient history, new listings)
LINEAUSDT, SCRUSDT, TAIKOUSDT, MORPHOUSDT, ORCAUSDT, CGPTUSDT, FLUXUSDT, GRASSUSDT, VIRTUALUSDT, BRETTUSDT, FARTCOINUSDT, PNUTUSDT, POPCATUSDT, TRUMPUSDT, EIGENUSDT, SAFEUSDT

### 5.3 Currently Active in Scan Cycle — 8 Coins
ARUSDT, AXSUSDT, BTCUSDT, IOTXUSDT, ONDOUSDT, PIXELUSDT, SANDUSDT, TRUUSDT

---

### 5.4 Untrained Coins — 397 Remaining

#### Phase 1 — High Priority (61 coins) ✅ COMPLETED March 18, 2026

**L1 — 13 coins**
ADAUSDT, APTUSDT, BCHUSDT, DOTUSDT, ETCUSDT, HBARUSDT, ICPUSDT, KASUSDT, LTCUSDT, NEARUSDT, TONUSDT, TRXUSDT, XRPUSDT

**L2 — 7 coins**
CELOUSDT, LINEAUSDT, MANTAUSDT, METISUSDT, SCRUSDT, TAIKOUSDT, ZKUSDT

**DeFi — 11 coins**
CAKEUSDT, COMPUSDT, DYDXUSDT, ENAUSDT, GMXUSDT, JTOUSDT, LDOUSDT, MORPHOUSDT, ORCAUSDT, SNXUSDT, SUSHIUSDT

**AI — 10 coins**
ARKMUSDT, CGPTUSDT, FETUSDT, FLUXUSDT, GLMUSDT, GRASSUSDT, GRTUSDT, IOUSDT, RENDERUSDT, VIRTUALUSDT

**Meme — 10 coins**
1000BONKUSDT, 1000PEPEUSDT, 1000SHIBUSDT, BRETTUSDT, FARTCOINUSDT, MEWUSDT, NOTUSDT, PNUTUSDT, POPCATUSDT, TRUMPUSDT

**Gaming — 4 coins**
ENJUSDT, GALAUSDT, MANAUSDT, YGGUSDT

**Infrastructure — 5 coins**
AXLUSDT, EIGENUSDT, QNTUSDT, SAFEUSDT, STXUSDT

**Oracle — 1 coin**
BANDUSDT

#### Phase 2 / Phase 3 — Long-tail (336 coins)

0GUSDT, 1000000MOGUSDT, 1000CATUSDT, 1000FLOKIUSDT, 1000LUNCUSDT, 1000RATSUSDT, 1000SATSUSDT, 1INCHUSDT, 1MBABYDOGEUSDT, 2ZUSDT, A2ZUSDT, ACEUSDT, ACHUSDT, ACTUSDT, ACUUSDT, ACXUSDT, AEROUSDT, AEVOUSDT, AGLDUSDT, AIUSDT, AIXBTUSDT, AKTUSDT, ALCHUSDT, ALGOUSDT, ALICEUSDT, ALLOUSDT, ALPINEUSDT, ALTUSDT, ANIMEUSDT, APEUSDT, ARCUSDT, ARKUSDT, ARPAUSDT, ASRUSDT, ASTERUSDT, ASTRUSDT, ATAUSDT, ATHUSDT, ATOMUSDT, ATUSDT, AUCTIONUSDT, AVAAIUSDT, AVAUSDT, AVNTUSDT, AWEUSDT, BABYUSDT, BANANAS31USDT, BANANAUSDT, BANKUSDT, BANUSDT, BARDUSDT, BATUSDT, BBUSDT, BELUSDT, BERAUSDT, BICOUSDT, BIGTIMEUSDT, BIOUSDT, BIRBUSDT, BLURUSDT, BMTUSDT, BNTUSDT, BOMEUSDT, BREVUSDT, BROCCOLI714USDT, BSVUSDT, C98USDT, CARVUSDT, CATIUSDT, CETUSUSDT, CFGUSDT, CFXUSDT, CHILLGUYUSDT, CHRUSDT, CHZUSDT, CKBUSDT, CLANKERUSDT, COOKIEUSDT, COSUSDT, COTIUSDT, COWUSDT, CTSIUSDT, CYBERUSDT, DASHUSDT, DEEPUSDT, DEGENUSDT, DENTUSDT, DEXEUSDT, DIAUSDT, DOGSUSDT, DOLOUSDT, DRIFTUSDT, DUSKUSDT, EDENUSDT, EDUUSDT, EGLDUSDT, ENSUSDT, EPICUSDT, ERAUSDT, ESPUSDT, ETHFIUSDT, ETHWUSDT, EULUSDT, FFUSDT, FHEUSDT, FIDAUSDT, FIGHTUSDT, FLOCKUSDT, FLOWUSDT, FLUIDUSDT, FOGOUSDT, FORMUSDT, FRAXUSDT, GASUSDT, GIGGLEUSDT, GMTUSDT, GOATUSDT, GPSUSDT, GRIFFAINUSDT, GTCUSDT, GUNUSDT, HAEDALUSDT, HFTUSDT, HIGHUSDT, HIPPOUSDT, HIVEUSDT, HMSTRUSDT, HOLOUSDT, HOMEUSDT, HOOKUSDT, HOTUSDT, HUMAUSDT, HYPERUSDT, HYPEUSDT, ICNTUSDT, ICXUSDT, IDUSDT, ILVUSDT, INITUSDT, INXUSDT, IOSTUSDT, IOTAUSDT, IPUSDT, IRYSUSDT, JASMYUSDT, JOEUSDT, JSTUSDT, KAIAUSDT, KAITOUSDT, KAVAUSDT, KERNELUSDT, KITEUSDT, KMNOUSDT, KNCUSDT, KOMAUSDT, KSMUSDT, LAUSDT, LAYERUSDT, LISTAUSDT, LITUSDT, LPTUSDT, LQTYUSDT, LRCUSDT, LSKUSDT, LUMIAUSDT, LUNA2USDT, MAGICUSDT, MAGMAUSDT, MASKUSDT, MAVIAUSDT, MAVUSDT, MBOXUSDT, MEGAUSDT, MELANIAUSDT, MEMEUSDT, MERLUSDT, METUSDT, MINAUSDT, MIRAUSDT, MLNUSDT, MMTUSDT, MOCAUSDT, MONUSDT, MOODENGUSDT, MOVEUSDT, MOVRUSDT, MTLUSDT, MUBARAKUSDT, NEOUSDT, NEWTUSDT, NFPUSDT, NIGHTUSDT, NILUSDT, NMRUSDT, NTRNUSDT, NXPCUSDT, OGNUSDT, ONEUSDT, ONGUSDT, ONTUSDT, OPENUSDT, OPNUSDT, ORDIUSDT, OXTUSDT, PARTIUSDT, PAXGUSDT, PENGUUSDT, PEOPLEUSDT, PHAUSDT, PHBUSDT, PIPPINUSDT, PLUMEUSDT, PORTALUSDT, POWERUSDT, POWRUSDT, PROMUSDT, PROVEUSDT, PUFFERUSDT, PUMPUSDT, PUNDIXUSDT, QTUMUSDT, RAREUSDT, RAVEUSDT, RDNTUSDT, RECALLUSDT, REDUSDT, RESOLVUSDT, REZUSDT, RIFUSDT, RLCUSDT, ROBOUSDT, ROSEUSDT, RPLUSDT, RSRUSDT, RVNUSDT, SAGAUSDT, SAHARAUSDT, SANTOSUSDT, SAPIENUSDT, SCRTUSDT, SEIUSDT, SENTUSDT, SFPUSDT, SHELLUSDT, SIGNUSDT, SKLUSDT, SKRUSDT, SKYUSDT, SOLVUSDT, SOMIUSDT, SONICUSDT, SOPHUSDT, SPELLUSDT, SPKUSDT, SPXUSDT, SQDUSDT, SSVUSDT, STEEMUSDT, STGUSDT, STORJUSDT, SUNUSDT, SUPERUSDT, SWARMSUSDT, SXTUSDT, SYNUSDT, SYRUPUSDT, SYSUSDT, TACUSDT, THETAUSDT, THEUSDT, TLMUSDT, TNSRUSDT, TOWNSUSDT, TREEUSDT, TUTUSDT, TWTUSDT, UMAUSDT, USDCUSDT, USTCUSDT, USUALUSDT, VANAUSDT, VANRYUSDT, VELODROMEUSDT, VETUSDT, VINEUSDT, VTHOUSDT, VVVUSDT, WALUSDT, WAXPUSDT, WETUSDT, WLFIUSDT, WOOUSDT, XAGUSDT, XAIUSDT, XAUUSDT, XLMUSDT, XMRUSDT, XTZUSDT, XVSUSDT, YFIUSDT, ZECUSDT, ZENUSDT, ZEREBROUSDT, ZETAUSDT, ZILUSDT, ZROUSDT, ZRXUSDT

---

## 5.5 Feature Pruning — Phase 1 Coins (March 18, 2026)

> Permutation importance run on 45 Phase 1 trained coins using 15m candles (1500 bars, Binance futures API).
> Each feature shuffled independently; log-likelihood drop measures importance.
> Top-7 features kept + mandatory `[vwap_dist, bb_width_norm, rel_strength_btc]`.

### Results Summary

| Metric | Value |
|--------|-------|
| Coins pruned | **39 / 45** |
| Coins failed (degenerate model) | **6** (LTCUSDT, CELOUSDT, DYDXUSDT, ENAUSDT, GALAUSDT, BANDUSDT) |
| Entries added to `segment_features.py` | **37** (2 already existed: LDOUSDT, FETUSDT) |

### Feature Retention Frequency (39 coins)

| Feature | Retained In | Score | Notes |
|---------|:-----------:|-------|-------|
| `exhaustion_tail` | 39/39 | ████████ | Universal — always kept |
| `vol_zscore` | 39/39 | ████████ | Universal — always kept |
| `vwap_dist` | 39/39 | ████████ | Mandatory |
| `bb_width_norm` | 39/39 | ████████ | Mandatory |
| `rel_strength_btc` | 39/39 | ████████ | Mandatory |
| `log_return` | 36/39 | ███████ | Strong — kept in most |
| `volatility` | 34/39 | ███████ | Strong |
| `liquidity_vacuum` | 34/39 | ███████ | Strong |
| `volume_trend_intensity` | 30/39 | ██████ | Moderate |
| `amihud_illiquidity` | 27/39 | █████ | Moderate |
| `volume_change` | 11/39 | ██ | **Weak** — pruned from 72% of coins |
| `rsi` | 5/39 | █ | **Weakest** — pruned from 87% of coins |

**Key finding:** `rsi` and `volume_change` are consistently the least informative features for HMM regime classification. The 5 universal core features (`exhaustion_tail`, `vol_zscore` + 3 mandatory) form the stable backbone across all market segments.

---

## 6. Training Expansion Plan — 397 Remaining Coins

> **Goal:** Systematically train all 397 untrained CoinDCX futures coins, prioritized by segment, liquidity, and strategic value.

### 6.1 Priority Framework

| Priority | Criteria | Action |
|----------|----------|--------|
| **P1 — Must Train** | Top-50 by market cap/volume, high-liquidity L1/DeFi/AI | Train immediately |
| **P2 — Should Train** | Mid-cap, all major segments, Binance-mirrored | Train in batch |
| **P3 — Optional** | Long-tail meme, fan tokens, micro-cap speculative | Train if P1+P2 complete |
| **Skip** | Stablecoins, wrapped tokens, synthetic metals | Exclude permanently |

### 6.2 Phase 1 — High Priority (P1): ~60 coins
*Top liquid, high market cap, cross-segment coverage*

| Segment | Coins to Train |
|---------|---------------|
| L1 | ETH (re-train), ADA, XRP, TRX, TON, NEAR, DOT, ATOM, AVAX (re-eval), LTC, BCH |
| DeFi | AAVE (✅), UNI (✅), CRV (✅), GMX, DYDX, JUP (✅), LDO, PENDLE (✅), SNX, COMP |
| AI | TAO (✅), FET, RENDER, VIRTUAL, GRT, GRASS, IO, ARKM |
| Meme | DOGE (✅), PEPE (✅), SHIB (✅), WIF (✅), BONK (re-eval), TRUMP, FARTCOIN |
| L2 | ARB (re-eval), OP (✅), STRK (re-eval), POL (re-eval), IMX (✅), ZK |
| Infrastructure | LINK (✅), QNT, AXL, EIGEN, STX |

### 6.3 Phase 2 — Medium Priority (P2): ~180 coins
*Mid-cap, segment diversification*

| Segment | Target Count | Examples |
|---------|-------------|---------|
| DeFi | 40 | RUNE (✅), ENA, ETHFI, GMX, COW, MORPHO, PENDLE ext... |
| AI | 25 | TAO ext, FET, GLM, FLUX, IOTX (re-eval), RENDER... |
| Gaming | 20 | AXS (✅), SAND (re-eval), PIXEL (re-eval), GALA, ENJ... |
| L1 | 20 | SOL (✅), SUI (✅), AVAX (✅), HBAR, KAS, ALGO, APT... |
| L2 | 15 | METIS, MANTA, CELO, TAIKO, SCR... |
| Infrastructure | 15 | PYTH (✅), SAFE, RPL, STRK ext... |
| Meme | 20 | BRETT, PNUT, POPCAT, MEW, BONK ext... |
| RWA/Interop | 10 | ONDO (✅), PAXG, ATOM, DOT, XLM... |
| Oracle | 8 | PYTH (✅), API3 (✅), BAND, TRB (✅), UMA... |

### 6.4 Phase 3 — Low Priority (P3): ~157 coins
*Long-tail, speculative, niche*

| Category | Estimated Count | Notes |
|----------|----------------|-------|
| Small meme/viral | ~50 | BROCCOLI714, WLFI, TRUMP ext, etc. |
| Fan tokens | ~15 | ALPINE, SANTOS, ASR, OG |
| Micro-cap DeFi | ~30 | ASTER, BARD, AVNT, FOGO, etc. |
| Misc / Uncategorized | ~62 | SIGN, SWARMS, TURTLE, etc. |

### 6.5 Permanent Exclusions (Do Not Train)
| Symbol | Reason |
|--------|--------|
| USDC, FRAX, USTC | Stablecoins — no regime signal |
| XAU, XAG | Synthetic metals — no crypto correlation |
| 1000LUNC, LUNA2 | Dead/zombie chains |
| BTCDOM | Index instrument, not a coin |

### 6.6 Recommended Training Schedule

```
Week 1:  Phase 1 — P1 batch (60 coins)
         Focus: L1, DeFi, AI, top Meme, L2
         Expected Tier A output: ~25-35 coins

Week 2:  Phase 2A — DeFi + AI batch (65 coins)
         Re-evaluate all Tier C coins from original 41

Week 3:  Phase 2B — Gaming + Infrastructure + L2 (55 coins)

Week 4:  Phase 2C — Interop + RWA + Oracle (60 coins)

Week 5+: Phase 3 — Long-tail sweep (157 coins)
         Only train if engine capacity allows
```

### 6.7 Training Configuration Recommendations

| Setting | Recommendation |
|---------|---------------|
| Timeframes | 1d + 1h + 15m (current multi-TF setup) |
| Min candles | 300 per TF |
| Min volume filter | $15M/24h USD (current) |
| Auto-exclude threshold | < $5M/24h (insufficient data) |
| Batch size | 20–25 coins per run (avoid rate limits) |
| Re-train frequency | Weekly for Tier A, monthly for Tier B/C |

---

## 7. Key Insights

1. **Futures > Spot** — CoinDCX lists more futures instruments (548) than active spot markets (545).
2. **DeFi leads futures** — DeFi is the largest segment with 101 coins (18.4% of all futures).
3. **L1 is second** — 75 L1 blockchain tokens are tradable as perpetuals.
4. **AI is rising** — 57 AI-related tokens are available for futures trading, reflecting the sector's growth.
5. **Meme coins are significant** — 45 meme tokens including TRUMP, FARTCOIN, and MELANIA are live on futures.
6. **No Futures on INR** — All 548 futures are USDT-quoted; INR futures are not available.
7. **No expiry contracts** — CoinDCX only offers perpetual futures, not quarterly/monthly expiry contracts.
8. **Advanced orders limited** — Stop-limit and take-profit orders are only available on 18 B-segment spot pairs.
9. **77% categorized** — 336 of 438 unique futures coins are classified under known CoinGecko segments.
10. **Multi-segment coins** — ~111 coins span multiple segments (e.g. LINK = DeFi + Oracle + Infrastructure).
11. **CoinDCX mirrors Binance** — 99.5% of CoinDCX futures are direct mirrors of Binance USDT-M perpetuals.
12. **Synaptic coverage is 9.4%** — Only 41 of 438 futures coins have been HMM-trained. 397 remain untrained.
13. **29 Tier A coins ready** — The engine has 29 high-confidence tradable coins from the trained set.
14. **~5 weeks to full coverage** — A phased training plan (P1→P2→P3) can cover all 397 remaining coins.

---

## 8. Data Sources

| Source | Endpoint | Purpose |
|--------|----------|---------|
| CoinDCX | `/exchange/v1/markets` | All spot symbols |
| CoinDCX | `/exchange/v1/markets_details` | Active spot market configs |
| CoinDCX | `/exchange/v1/derivatives/futures/data/active_instruments` | All futures instruments |
| Binance | `/fapi/v1/exchangeInfo` | USDT-M perpetuals cross-reference |
| CoinGecko | `/api/v3/coins/markets?category=<id>` | Sector/segment classification |
| Synaptic Engine | `data/coin_tiers.csv` | Trained coin performance tiers |
| Synaptic Engine | `data/multi_bot_state.json` | Active scan state |

---

*Report generated by Claude Code on March 18, 2026*
*Last updated: March 18, 2026 — Feature pruning complete: 39/45 Phase 1 coins pruned via permutation importance. `rsi` and `volume_change` identified as weakest features (pruned from 87% and 72% of coins respectively). `segment_features.py` updated with 37 per-coin feature lists.*

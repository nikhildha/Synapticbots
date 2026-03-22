"""
tools/data_cache.py
═══════════════════════════════════════════════════════════════════════════════
Multi-exchange disk-backed OHLCV data cache for experiment scripts.

Supported exchanges:
  binance  — fapi.binance.com  (may be IP-banned; intervals: 4h/1h/15m)
  bybit    — api.bybit.com     (v5 linear; intervals: 240/60/15)
  okx      — okx.com           (not accessible from all regions)

Cache location:
  data_cache/binance_{SYMBOL}_{TF}.parquet
  data_cache/bybit_{SYMBOL}_{TF}.parquet

Usage:
  python tools/data_cache.py --fill --exchange bybit    # fill from Bybit
  python tools/data_cache.py --status                   # show all caches
  python tools/data_cache.py --compare                  # compare exchanges

From experiment scripts:
  from tools.data_cache import load_all_tf
  dfs = load_all_tf("AAVEUSDT", exchange="bybit")
"""

import sys, os, time, warnings
from datetime import datetime, timezone
from pathlib import Path

warnings.filterwarnings("ignore")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import numpy as np
import pandas as pd
import requests

# Root modules — only available in the full local environment, not in Alpha Docker container
try:
    from data_pipeline import _parse_klines_df
    from feature_engine import compute_all_features as _root_compute_features
    _HAS_ROOT_MODULES = True
except ImportError:
    _HAS_ROOT_MODULES = False
    _root_compute_features = None
    _parse_klines_df = None

CACHE_DIR       = Path(ROOT) / "data_cache"
CACHE_MAX_AGE_H = 23
TOTAL_MONTHS    = 15          # 3 warmup + 12 test
TFS             = ["4h", "1h", "15m"]

DEFAULT_SYMBOLS  = ["AAVEUSDT", "BNBUSDT", "COMPUSDT", "SNXUSDT"]
DEFAULT_EXCHANGE = "bybit"   # bybit while Binance is banned

# Bybit interval mapping
BYBIT_INTERVALS = {"4h": "240", "1h": "60", "15m": "15"}

# OKX symbol mapping (perpetual swaps)
OKX_SYMBOLS = {
    "AAVEUSDT": "AAVE-USDT-SWAP",
    "BNBUSDT":  "BNB-USDT-SWAP",
    "COMPUSDT": "COMP-USDT-SWAP",
    "SNXUSDT":  "SNX-USDT-SWAP",
}
OKX_INTERVALS = {"4h": "4H", "1h": "1H", "15m": "15m"}


# ─── Standardized DataFrame builder ──────────────────────────────────────────

def _build_df(rows: list, ts_col=0, o_col=1, h_col=2, l_col=3,
              c_col=4, v_col=5, ascending=True) -> pd.DataFrame | None:
    """Convert raw OHLCV rows to standard feature DataFrame."""
    if not rows:
        return None
    df = pd.DataFrame(rows)
    df = df.rename(columns={ts_col: "timestamp", o_col: "open", h_col: "high",
                             l_col: "low", c_col: "close", v_col: "volume"})
    df["timestamp"] = pd.to_datetime(df["timestamp"].astype(float), unit="ms")
    for col in ["open", "high", "low", "close", "volume"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df[["timestamp","open","high","low","close","volume"]].dropna()
    if not ascending:
        df = df.iloc[::-1].reset_index(drop=True)
    df = df.sort_values("timestamp").drop_duplicates("timestamp").reset_index(drop=True)
    if _HAS_ROOT_MODULES:
        try:
            df = _root_compute_features(df).dropna().reset_index(drop=True)
        except Exception as e:
            print(f"    feature error: {e}"); return None
    return df


# ─── Binance fetcher ──────────────────────────────────────────────────────────

def _fetch_binance(symbol: str, tf: str) -> pd.DataFrame | None:
    mins_map     = {"4h": 240, "1h": 60, "15m": 15}
    mins_per_bar = mins_map[tf]
    n_bars       = int((TOTAL_MONTHS * 30 * 24 * 60 / mins_per_bar) * 1.1)
    now_ms       = int(datetime.now(timezone.utc).timestamp() * 1000)
    start_ms     = now_ms - n_bars * mins_per_bar * 60 * 1000
    klines, cur  = [], start_ms
    while True:
        try:
            r = requests.get(
                "https://fapi.binance.com/fapi/v1/klines",
                params={"symbol": symbol, "interval": tf,
                        "startTime": cur, "limit": 1500}, timeout=20)
            if r.status_code != 200: break
            batch = r.json()
            if not batch or isinstance(batch, dict): break
            klines.extend(batch)
            if len(batch) < 1500: break
            cur = int(batch[-1][0]) + 1
            time.sleep(0.06)
        except Exception as e:
            print(f"    binance {symbol}/{tf}: {e}"); break
    if not klines: return None
    if not _HAS_ROOT_MODULES or _parse_klines_df is None: return None
    df_raw = _parse_klines_df(klines)
    if df_raw is None or df_raw.empty: return None
    try:
        df = _root_compute_features(df_raw).dropna().reset_index(drop=True)
    except Exception as e:
        print(f"    feature error {symbol}/{tf}: {e}"); return None
    if "timestamp" not in df.columns:
        df = df.reset_index()
        if "index" in df.columns: df.rename(columns={"index": "timestamp"}, inplace=True)
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    return df.reset_index(drop=True)


# ─── Bybit fetcher ────────────────────────────────────────────────────────────

def _fetch_bybit(symbol: str, tf: str) -> pd.DataFrame | None:
    """
    Bybit V5 linear perpetuals.
    Returns: [timestamp_ms, open, high, low, close, volume, turnover] — newest first.
    Pagination via 'start' parameter.
    """
    interval     = BYBIT_INTERVALS[tf]
    mins_map     = {"4h": 240, "1h": 60, "15m": 15}
    mins_per_bar = mins_map[tf]
    n_bars       = int((TOTAL_MONTHS * 30 * 24 * 60 / mins_per_bar) * 1.1)
    now_ms       = int(datetime.now(timezone.utc).timestamp() * 1000)
    start_ms     = now_ms - n_bars * mins_per_bar * 60 * 1000

    all_rows = []
    cur_start = start_ms

    while True:
        try:
            r = requests.get(
                "https://api.bybit.com/v5/market/kline",
                params={"category": "linear", "symbol": symbol,
                        "interval": interval, "start": cur_start, "limit": 1000},
                timeout=20)
            d = r.json()
            if r.status_code != 200 or d.get("retCode") != 0:
                print(f"    bybit {symbol}/{tf}: {d.get('retMsg','HTTP '+str(r.status_code))}")
                break
            batch = d["result"]["list"]
            if not batch: break
            all_rows.extend(batch)
            # batch is newest-first; advance past the newest bar
            newest_ts = int(batch[0][0])
            next_start = newest_ts + mins_per_bar * 60 * 1000
            if next_start >= now_ms or len(batch) < 1000: break
            cur_start = next_start
            time.sleep(0.05)
        except Exception as e:
            print(f"    bybit {symbol}/{tf}: {e}"); break

    if not all_rows: return None
    # Sort ascending (batch was newest-first)
    all_rows.sort(key=lambda x: int(x[0]))
    # cols: [ts_ms, open, high, low, close, volume, turnover]
    return _build_df(all_rows, ts_col=0, o_col=1, h_col=2, l_col=3,
                     c_col=4, v_col=5, ascending=True)


# ─── OKX fetcher ─────────────────────────────────────────────────────────────

def _fetch_okx(symbol: str, tf: str) -> pd.DataFrame | None:
    """
    OKX history-candles endpoint.
    Returns: [ts, open, high, low, close, vol, volCcy, volCcyQuote, confirm] — newest first.
    Pagination via 'after' (return candles older than this ts).
    Max 100 per request.
    """
    inst_id  = OKX_SYMBOLS.get(symbol)
    if not inst_id:
        print(f"    okx: no mapping for {symbol}"); return None
    bar_str  = OKX_INTERVALS[tf]
    mins_map = {"4h": 240, "1h": 60, "15m": 15}
    mins_per = mins_map[tf]
    n_bars   = int((TOTAL_MONTHS * 30 * 24 * 60 / mins_per) * 1.1)
    now_ms   = int(datetime.now(timezone.utc).timestamp() * 1000)

    all_rows = []
    after_ts = None   # None = start from now

    while True:
        params = {"instId": inst_id, "bar": bar_str, "limit": 100}
        if after_ts is not None:
            params["after"] = str(after_ts)
        try:
            r = requests.get(
                "https://www.okx.com/api/v5/market/history-candles",
                params=params, timeout=20)
            d = r.json()
            if r.status_code != 200 or d.get("code") != "0":
                print(f"    okx {symbol}/{tf}: {d.get('msg','HTTP '+str(r.status_code))}")
                break
            batch = d["data"]
            if not batch: break
            all_rows.extend(batch)
            # OKX returns newest first — oldest bar is last
            oldest_ts = int(batch[-1][0])
            if oldest_ts <= (now_ms - n_bars * mins_per * 60 * 1000): break
            if len(batch) < 100: break
            after_ts = oldest_ts   # next page: before this ts
            time.sleep(0.1)
        except Exception as e:
            print(f"    okx {symbol}/{tf}: {e}"); break

    if not all_rows: return None
    all_rows.sort(key=lambda x: int(x[0]))
    # cols: [ts, open, high, low, close, vol, volCcy, volCcyQuote, confirm]
    return _build_df(all_rows, ts_col=0, o_col=1, h_col=2, l_col=3,
                     c_col=4, v_col=5, ascending=True)


# ─── Exchange dispatch ────────────────────────────────────────────────────────

_FETCHERS = {
    "binance": _fetch_binance,
    "bybit":   _fetch_bybit,
    "okx":     _fetch_okx,
}


def _cache_path(symbol: str, tf: str, exchange: str) -> Path:
    return CACHE_DIR / f"{exchange}_{symbol}_{tf}.parquet"


def _cache_age_h(symbol: str, tf: str, exchange: str) -> float:
    p = _cache_path(symbol, tf, exchange)
    if not p.exists(): return float("inf")
    return (time.time() - p.stat().st_mtime) / 3600


# ─── Public API ───────────────────────────────────────────────────────────────

def load_all_tf(symbol: str, exchange: str = DEFAULT_EXCHANGE,
                force_refresh: bool = False) -> dict | None:
    """
    Return dict {tf: DataFrame} for symbol from given exchange.
    Uses disk cache if fresh (< CACHE_MAX_AGE_H old); fetches otherwise.
    """
    needs_fetch = force_refresh or any(
        _cache_age_h(symbol, tf, exchange) > CACHE_MAX_AGE_H for tf in TFS
    )

    if not needs_fetch:
        dfs = {}
        try:
            for tf in TFS:
                df = pd.read_parquet(_cache_path(symbol, tf, exchange))
                df["timestamp"] = pd.to_datetime(df["timestamp"])
                dfs[tf] = df.reset_index(drop=True)
            return dfs
        except Exception as e:
            print(f"    cache read error ({exchange} {symbol}): {e}")

    # Fetch live
    fetcher = _FETCHERS.get(exchange)
    if not fetcher:
        print(f"    unknown exchange: {exchange}"); return None

    dfs = {}
    for tf in TFS:
        df = fetcher(symbol, tf)
        if df is None or df.empty:
            print(f"    {exchange} {symbol}/{tf}: FAILED"); return None
        dfs[tf] = df
        CACHE_DIR.mkdir(exist_ok=True)
        df.to_parquet(_cache_path(symbol, tf, exchange), index=False)
        time.sleep(0.1)
    return dfs


def cache_is_fresh(symbols: list, exchange: str = DEFAULT_EXCHANGE,
                   max_age_h: float = CACHE_MAX_AGE_H) -> bool:
    return all(_cache_age_h(s, tf, exchange) <= max_age_h
               for s in symbols for tf in TFS)


def fill_cache(symbols: list = DEFAULT_SYMBOLS,
               exchange: str = DEFAULT_EXCHANGE, force: bool = False) -> None:
    CACHE_DIR.mkdir(exist_ok=True)
    print(f"\n  Filling cache  exchange={exchange}  symbols={symbols}")
    print(f"  Target: {TOTAL_MONTHS} months | Cache dir: {CACHE_DIR}\n")
    ok, fail = 0, 0
    for i, sym in enumerate(symbols, 1):
        print(f"  [{i}/{len(symbols)}] {sym:<14} ... ", end="", flush=True)
        if not force and cache_is_fresh([sym], exchange):
            ages = [f"{_cache_age_h(sym, tf, exchange):.1f}h" for tf in TFS]
            print(f"FRESH ({', '.join(ages)})")
            ok += 1; continue
        dfs = load_all_tf(sym, exchange=exchange, force_refresh=True)
        if dfs:
            sizes = " / ".join(f"{tf}={len(dfs[tf])}" for tf in TFS)
            print(f"OK  [{sizes}]")
            ok += 1
        else:
            print("FAILED")
            fail += 1
    print(f"\n  Done: {ok}/{len(symbols)} cached, {fail} failed")


def cache_status(symbols: list = DEFAULT_SYMBOLS,
                 exchanges: list = ("binance", "bybit")) -> None:
    print(f"\n  {'Exchange':<8}  {'Symbol':<14}  {'4h':>10}  {'1h':>10}  {'15m':>10}  Status")
    print("  " + "─" * 70)
    for ex in exchanges:
        for sym in sorted(symbols):
            ages = {tf: _cache_age_h(sym, tf, ex) for tf in TFS}
            rows = {}
            for tf in TFS:
                p = _cache_path(sym, tf, ex)
                rows[tf] = len(pd.read_parquet(p, columns=["timestamp"])) if p.exists() else 0
            status = "FRESH" if all(a <= CACHE_MAX_AGE_H for a in ages.values()) \
                     else ("STALE" if all(a < float("inf") for a in ages.values()) else "MISSING")
            def fmt(tf):
                if ages[tf] == float("inf"): return "—"
                return f"{rows[tf]}r/{ages[tf]:.0f}h"
            print(f"  {ex:<8}  {sym:<14}  {fmt('4h'):>10}  {fmt('1h'):>10}  {fmt('15m'):>10}  {status}")
    print()


def compare_exchanges(symbol: str = "AAVEUSDT", tf: str = "1h",
                      exchanges: list = ("binance", "bybit")) -> None:
    """Show overlap stats between exchange caches for the same symbol/tf."""
    print(f"\n  Comparing {symbol}/{tf} across exchanges:")
    dfs = {}
    for ex in exchanges:
        p = _cache_path(symbol, tf, ex)
        if p.exists():
            df = pd.read_parquet(p)
            df["timestamp"] = pd.to_datetime(df["timestamp"])
            dfs[ex] = df
            print(f"    {ex:<8}: {len(df)} rows  "
                  f"{df['timestamp'].iloc[0].strftime('%Y-%m-%d')} → "
                  f"{df['timestamp'].iloc[-1].strftime('%Y-%m-%d')}")
        else:
            print(f"    {ex:<8}: MISSING")
    if len(dfs) == 2:
        ex1, ex2 = list(dfs.keys())
        shared = pd.merge(
            dfs[ex1][["timestamp","close"]].rename(columns={"close": ex1}),
            dfs[ex2][["timestamp","close"]].rename(columns={"close": ex2}),
            on="timestamp")
        if len(shared):
            corr = shared[ex1].corr(shared[ex2])
            pct_diff = ((shared[ex1] - shared[ex2]) / shared[ex1]).abs().mean() * 100
            print(f"\n    Shared rows: {len(shared)}")
            print(f"    Close price correlation:  {corr:.6f}")
            print(f"    Mean abs price diff:      {pct_diff:.4f}%")
    print()


# ─── CLI ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Synaptic multi-exchange data cache")
    parser.add_argument("--fill",     action="store_true", help="Fetch and cache data")
    parser.add_argument("--status",   action="store_true", help="Show cache status")
    parser.add_argument("--compare",  action="store_true", help="Compare exchange prices")
    parser.add_argument("--force",    action="store_true", help="Force re-fetch")
    parser.add_argument("--exchange", default=DEFAULT_EXCHANGE,
                        choices=["binance","bybit","okx"],
                        help="Exchange to use (default: bybit)")
    parser.add_argument("--symbols",  nargs="+", default=DEFAULT_SYMBOLS)
    args = parser.parse_args()

    if args.status:
        cache_status(args.symbols)

    if args.fill:
        fill_cache(args.symbols, exchange=args.exchange, force=args.force)
        cache_status(args.symbols)

    if args.compare:
        for sym in args.symbols[:2]:
            compare_exchanges(sym)

    if not (args.fill or args.status or args.compare):
        # Default: status then fill bybit
        cache_status(args.symbols)
        fill_cache(args.symbols, exchange=args.exchange, force=args.force)
        cache_status(args.symbols)

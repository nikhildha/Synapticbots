"""
╔══════════════════════════════════════════════════════════════════════════════╗
║                        ALPHA MODULE — SYNAPTIC                              ║
║  Module : alpha/alpha_telegram.py                                            ║
║  Purpose: Telegram notifications for Alpha trades and engine status.         ║
║           Uses a dedicated Alpha bot — separate from the main engine bot.    ║
║                                                                              ║
║  Messages sent:                                                              ║
║    - Trade OPENED                                                            ║
║    - Trade CLOSED (TP / SL / BE_SL / DIR_FLIP / MANUAL)                     ║
║    - Breakeven activated                                                     ║
║    - Cycle summary (every 4h)                                                ║
║    - Engine start / engine error alert                                       ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  ISOLATION CONTRACT                                                          ║
║  ✗ DO NOT import any root module                                             ║
║  ✓ Fire-and-forget — all functions return silently on failure                ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

import requests
from datetime import datetime, timezone
from alpha.alpha_config import (
    ALPHA_TELEGRAM_TOKEN, ALPHA_TELEGRAM_CHAT_ID, ALPHA_TELEGRAM_ENABLED,
    ALPHA_PAPER_MODE,
)
from alpha.alpha_logger import get_logger

logger = get_logger("telegram")

_BASE_URL = f"https://api.telegram.org/bot{ALPHA_TELEGRAM_TOKEN}/sendMessage"
_MODE_TAG = "📄 PAPER" if ALPHA_PAPER_MODE else "🔴 LIVE"


# ── Core sender ───────────────────────────────────────────────────────────────

def _send(text: str) -> None:
    """Send a Telegram message. Never raises — logs errors silently."""
    if not ALPHA_TELEGRAM_ENABLED:
        logger.debug("Telegram disabled — skipping message")
        return
    try:
        resp = requests.post(
            _BASE_URL,
            json={"chat_id": ALPHA_TELEGRAM_CHAT_ID, "text": text, "parse_mode": "HTML"},
            timeout=8,
        )
        if not resp.ok:
            logger.warning("Telegram send failed: %s %s", resp.status_code, resp.text[:120])
    except Exception as e:
        logger.warning("Telegram send error: %s", e)


# ── Trade messages ────────────────────────────────────────────────────────────

def notify_trade_opened(trade: dict) -> None:
    """
    🟢 ALPHA OPENED
    AAVEUSDT LONG @ $95.40
    SL: $85.95 (−11.4%) | TP: $119.70 (+25.5%)
    vol_z: 2.10 | Regime: BULL (margin 0.23)
    Capital: $500 @ 25x | #A-14A1 | 📄 PAPER
    """
    side    = trade.get("side", "?")
    symbol  = trade.get("symbol", "?")
    entry   = float(trade.get("entry_price", 0))
    sl      = float(trade.get("stop_loss", 0))
    tp      = float(trade.get("take_profit", 0))
    tid     = trade.get("trade_id", "?")
    regime  = trade.get("regime", "?")
    margin  = trade.get("regime_margin", 0)
    vz      = trade.get("vol_zscore", 0)
    capital = trade.get("margin_usdt", 0)

    sl_pct = ((sl - entry) / entry * 100) if entry else 0
    tp_pct = ((tp - entry) / entry * 100) if entry else 0

    arrow = "🟢" if side == "LONG" else "🔴"
    text = (
        f"{arrow} <b>ALPHA OPENED</b>\n"
        f"{symbol} <b>{side}</b> @ ${entry:,.4f}\n"
        f"SL: ${sl:,.4f} ({sl_pct:+.1f}%) | TP: ${tp:,.4f} ({tp_pct:+.1f}%)\n"
        f"vol_z: {vz:.2f} | Regime: {regime} (margin {margin:.2f})\n"
        f"Capital: ${capital:,.0f} @ 25x | #{tid} | {_MODE_TAG}"
    )
    _send(text)


def notify_trade_closed(trade: dict) -> None:
    """
    ✅ ALPHA CLOSED — TP HIT
    AAVEUSDT LONG | Entry $95.40 → Exit $119.70
    P&L: +$287.50 (+57.5%) | Fee: $12.24
    Duration: 14h 35m | #A-14A1 | 📄 PAPER
    Portfolio: +$287.50 total
    """
    tid     = trade.get("trade_id", "?")
    symbol  = trade.get("symbol", "?")
    side    = trade.get("side", "?")
    entry   = float(trade.get("entry_price", 0))
    exit_p  = float(trade.get("exit_price", 0))
    reason  = trade.get("exit_reason", "?")
    net_pnl = float(trade.get("net_pnl", 0))
    pct     = float(trade.get("pnl_pct", 0))
    fee_o   = float(trade.get("fee_open_usdt", 0) or 0)
    fee_c   = float(trade.get("fee_close_usdt", 0) or 0)
    opened  = trade.get("opened_at", "")
    closed  = trade.get("closed_at", "")

    # Duration
    duration_str = "?"
    try:
        dt_open  = datetime.fromisoformat(opened.replace("Z", "+00:00"))
        dt_close = datetime.fromisoformat(closed.replace("Z", "+00:00"))
        secs     = int((dt_close - dt_open).total_seconds())
        h, m     = divmod(secs // 60, 60)
        duration_str = f"{h}h {m}m"
    except Exception:
        pass

    # Reason label
    reason_labels = {
        "TP":       "✅ TP HIT",
        "SL":       "❌ SL HIT",
        "BE_SL":    "🛡️ BREAKEVEN SL",
        "DIR_FLIP": "🔄 REGIME FLIP",
        "MANUAL":   "🖐️ MANUAL CLOSE",
    }
    label = reason_labels.get(reason, f"EXIT ({reason})")
    emoji = "✅" if net_pnl > 0 else "❌"

    text = (
        f"{emoji} <b>ALPHA CLOSED — {label}</b>\n"
        f"{symbol} {side} | Entry ${entry:,.4f} → Exit ${exit_p:,.4f}\n"
        f"P&L: <b>{net_pnl:+,.2f}</b> ({pct:+.1f}%) | Fee: ${fee_o+fee_c:.2f}\n"
        f"Duration: {duration_str} | #{tid} | {_MODE_TAG}"
    )
    _send(text)


def notify_breakeven(trade: dict, current_price: float) -> None:
    """
    🛡️ ALPHA BREAKEVEN
    AAVEUSDT — SL moved to entry $95.40
    Price now $103.50 (+8.5%) | #A-14A1
    """
    text = (
        f"🛡️ <b>ALPHA BREAKEVEN</b>\n"
        f"{trade.get('symbol')} — SL moved to entry ${trade.get('entry_price'):,.4f}\n"
        f"Price now ${current_price:,.4f} | #{trade.get('trade_id')} | {_MODE_TAG}"
    )
    _send(text)


# ── Engine messages ───────────────────────────────────────────────────────────

def notify_engine_start(cycle: int) -> None:
    text = (
        f"⚡ <b>ALPHA ENGINE STARTED</b>\n"
        f"Cycle #{cycle} | {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}\n"
        f"Coins: AAVE · SNX · COMP · BNB | {_MODE_TAG}"
    )
    _send(text)


def notify_cycle_summary(
    cycle: int,
    regime_map: dict,
    open_trades: list,
    portfolio: dict,
) -> None:
    """
    ⚡ ALPHA CYCLE #143 | 14:00 UTC
    AAVE: BULL(0.23) | SNX: CHOP | COMP: BULL(0.31) | BNB: BEAR(0.18)
    Open: 2 trades | Closed: 12 | Win rate: 66.7% | PnL: +$1,842
    📄 PAPER
    """
    coin_lines = []
    for sym, info in regime_map.items():
        if info:
            r   = info.get("regime", "?")
            m   = info.get("margin", 0)
            ok  = "✓" if info.get("passes_filter") else "·"
            coin_lines.append(f"{sym.replace('USDT','')}: {r}({m:.2f}){ok}")
        else:
            coin_lines.append(f"{sym.replace('USDT','')}: —")

    open_syms = [t.get("symbol","").replace("USDT","") for t in open_trades]
    open_str  = ", ".join(open_syms) if open_syms else "none"

    text = (
        f"⚡ <b>ALPHA CYCLE #{cycle}</b> | {datetime.now(timezone.utc).strftime('%H:%M UTC')}\n"
        f"{' | '.join(coin_lines)}\n"
        f"Open: {portfolio['open_count']} ({open_str}) | "
        f"Closed: {portfolio['closed_count']} | "
        f"WR: {portfolio['win_rate']:.0f}%\n"
        f"Total P&L: <b>${portfolio['total_net_pnl']:+,.2f}</b> | {_MODE_TAG}"
    )
    _send(text)


def notify_error(context: str, error: str) -> None:
    text = (
        f"⚠️ <b>ALPHA ENGINE ERROR</b>\n"
        f"Context: {context}\n"
        f"Error: {error[:300]}\n"
        f"{_MODE_TAG}"
    )
    _send(text)

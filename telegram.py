"""
Project Regime-Master — Telegram Notifications
Sends trade alerts, kill switch warnings, and daily summaries via Telegram Bot API.
Uses the HTTP API directly (no external telegram library needed).
"""
import json
import logging
import os
import queue
import re
import threading
import time
from datetime import datetime
from urllib.request import Request, urlopen
from urllib.error import URLError

import config

logger = logging.getLogger("Telegram")

# ─── Telegram Bot API ────────────────────────────────────────────────────────────

BASE_URL = "https://api.telegram.org/bot{token}/{method}"

# Path to .env for dynamic re-reads (so dashboard changes take effect immediately)
_ENV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")


def _read_env_val(key, fallback=""):
    """Read a value from .env file first, then fall back to os.environ."""
    try:
        with open(_ENV_PATH, "r") as f:
            for line in f:
                line = line.strip()
                if line.startswith(f"{key}="):
                    return line[len(key) + 1:].strip()
    except Exception:
        pass
    # Fall back to os.environ (Railway sets env vars directly, no .env file)
    return os.environ.get(key, fallback)


def _get_live_config():
    """Get current telegram config, re-reading .env each time."""
    return {
        "token": _read_env_val("TELEGRAM_BOT_TOKEN", ""),
        "chat_id": _read_env_val("TELEGRAM_CHAT_ID", ""),
        "enabled": _read_env_val("TELEGRAM_ENABLED", "false").lower() == "true",
    }


def _send_request(method, params=None):
    """Send a request to the Telegram Bot API."""
    cfg = _get_live_config()
    if not cfg["enabled"]:
        logger.warning("[Telegram] TELEGRAM_ENABLED is not 'true' — message dropped (method=%s). "
                       "Set TELEGRAM_ENABLED=true in Railway env vars.", method)
        return None
    if not cfg["token"]:
        logger.warning("[Telegram] TELEGRAM_BOT_TOKEN is empty — message dropped (method=%s).", method)
        return None

    url = BASE_URL.format(token=cfg["token"], method=method)

    data = json.dumps(params or {}).encode("utf-8")
    req = Request(url, data=data, headers={"Content-Type": "application/json"})

    try:
        with urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except URLError as e:
        logger.error("Telegram API error (%s): %s", method, e)
        return None
    except Exception as e:
        logger.error("Telegram unexpected error: %s", e)
        return None


def send_message(text, parse_mode="HTML", silent=False):
    """
    Send a text message to the configured chat.

    Parameters
    ----------
    text : str — message content (HTML supported)
    parse_mode : str — 'HTML' or 'Markdown'
    silent : bool — send without notification sound
    """
    cfg = _get_live_config()
    if not cfg["chat_id"]:
        logger.warning("[Telegram] TELEGRAM_CHAT_ID is empty — message dropped. "
                       "Set TELEGRAM_CHAT_ID in Railway env vars.")
        return None

    return _send_request("sendMessage", {
        "chat_id": cfg["chat_id"],
        "text": text,
        "parse_mode": parse_mode,
        "disable_notification": silent,
    })


def log_startup_config():
    """Log Telegram config at startup so prod issues are visible immediately."""
    cfg = _get_live_config()
    token_preview = (cfg["token"][:8] + "...") if cfg["token"] else "(not set)"
    logger.info(
        "[Telegram] Config loaded — enabled=%s | token=%s | chat_id=%s",
        cfg["enabled"], token_preview, cfg["chat_id"] or "(not set)"
    )
    if not cfg["enabled"]:
        logger.warning("[Telegram] TELEGRAM_ENABLED is not true — all notifications are OFF. "
                       "Set TELEGRAM_ENABLED=true in Railway environment variables.")
    elif not cfg["token"] or not cfg["chat_id"]:
        logger.warning("[Telegram] token or chat_id missing — messages will be dropped.")


# ─── Rate-Limited Send Queue ─────────────────────────────────────────────────
# Telegram allows ~30 msg/s globally but recommends ≤1/s per chat to avoid 429s.
# All async sends go through this queue; background worker drains at 1 msg/sec.

_send_queue: queue.Queue = queue.Queue(maxsize=200)


def _queue_worker():
    """Background thread: drain _send_queue at max 1 message per second."""
    while True:
        try:
            text, kwargs = _send_queue.get(timeout=5)
            try:
                send_message(text, **kwargs)
            except Exception as e:
                logger.error("[Telegram] Queue worker send error: %s", e)
            finally:
                _send_queue.task_done()
            time.sleep(1)  # rate-limit: 1 msg/sec
        except queue.Empty:
            continue
        except Exception as e:
            logger.error("[Telegram] Queue worker fatal error: %s", e)


_worker_thread = threading.Thread(target=_queue_worker, daemon=True, name="TelegramQueue")
_worker_thread.start()


def send_message_async(text, **kwargs):
    """Queue a message for rate-limited delivery. Never drops silently."""
    try:
        _send_queue.put_nowait((text, kwargs))
    except queue.Full:
        logger.error("[Telegram] Send queue full (%d items) — message dropped: %.60s…",
                     _send_queue.qsize(), text)


# ─── Notification Formatters ─────────────────────────────────────────────────────

def notify_trade_open(trade):
    """Send notification when a single trade is opened (legacy, still works)."""
    notify_batch_entries([trade])


def notify_batch_entries(trades):
    """
    Send ONE consolidated notification for all trades opened in a cycle.
    Groups them into a single message instead of spamming individual alerts.
    """
    if not _read_env_val("TELEGRAM_NOTIFY_TRADES", "true").lower() == "true":
        return
    if not trades:
        return

    count = len(trades)
    header = f"📦 <b>{count} NEW TRADE{'S' if count > 1 else ''} DEPLOYED</b>"

    lines = [header, "━━━━━━━━━━━━━━━━━━"]

    for i, trade in enumerate(trades, 1):
        emoji = "🟢" if trade.get("position") == "LONG" else "🔴"
        sym = trade.get("symbol", "?")
        pos = trade.get("position", "?")
        regime = trade.get("regime", "?")
        conf = trade.get("confidence", 0)
        lev = trade.get("leverage", 1)
        entry = trade.get("entry_price", 0)
        sl = trade.get("stop_loss", 0)
        tp = trade.get("take_profit", 0)

        lines.append(
            f"{emoji} <b>{sym}</b> {pos} {lev}× | {regime} {conf:.0%}\n"
            f"   📈 <code>{entry:.6f}</code>  🛑 <code>{sl:.6f}</code>  🎯 <code>{tp:.6f}</code>"
        )

    lines.append(f"\n💵 Capital: $100 each  |  🕐 {datetime.utcnow().strftime('%H:%M:%S UTC')}")

    msg = "\n".join(lines)
    send_message_async(msg)


def notify_athena_signal(sym, side, conviction_pct, entry_price, sl, tp, segment, reasoning, bot_name="", leverage=0):
    """
    Fire when Athena approves a coin — before the trade actually deploys.
    This is the 'signal' alert; notify_batch_entries fires on confirmed deploy.
    """
    if not _read_env_val("TELEGRAM_NOTIFY_TRADES", "true").lower() == "true":
        return

    emoji = "🟢" if side in ("BUY", "LONG") else "🔴"
    dir_label = "LONG ↑" if side in ("BUY", "LONG") else "SHORT ↓"

    # Split on true sentence boundaries (". " not ".") to avoid cutting at decimal points.
    # e.g. "confidence of 0.82" would wrongly split → "confidence of 0" with the old method.
    sentences = re.split(r'(?<=[.!?])\s+', (reasoning or "").strip())
    short_reason = " ".join(sentences[:2]).strip()  # up to 2 full sentences
    if len(short_reason) > 400:
        short_reason = short_reason[:397] + "…"

    # Format prices — use 6dp for small prices, 2dp for large
    def fmt(p):
        if p and p > 0:
            return f"{p:.6f}" if p < 10 else f"{p:.2f}"
        return "N/A"

    sl_pct = abs((sl - entry_price) / entry_price * 100) if entry_price and sl else 0
    tp_pct = abs((tp - entry_price) / entry_price * 100) if entry_price and tp else 0
    lev_str = f" · {leverage}×" if leverage else ""
    coin_name = sym.replace('USDT', '')

    msg = (
        f"🏛️ <b>ATHENA SIGNAL</b>\n"
        f"━━━━━━━━━━━━━━━━━━\n"
        f"{emoji} <b>{coin_name}</b>{lev_str} · {dir_label} · <b>{conviction_pct:.0f}%</b>\n"
        f"📂 Segment: {segment}\n"
        f"\n"
        f"📍 Entry:  <code>{fmt(entry_price)}</code>\n"
        f"🛑 SL:     <code>{fmt(sl)}</code>  <i>(-{sl_pct:.1f}%)</i>\n"
        f"🎯 TP:     <code>{fmt(tp)}</code>  <i>(+{tp_pct:.1f}%)</i>\n"
        f"\n"
        f"💡 <i>{short_reason}</i>\n"
        f"\n"
        f"🛡 <b>Risk Manager</b>: Step Trailing SL\n"
        f"   +7% → lock +3% · +10% → +5%\n"
        f"   +15% → +10% · +20% → +15%\n"
        f"   …up to +50% → lock +45%\n"
        f"\n"
        f"{'🤖 ' + bot_name + '  ' if bot_name else ''}"
        f"🕐 {datetime.utcnow().strftime('%H:%M:%S UTC')}"
    )
    send_message_async(msg)


def notify_athena_veto(sym, side, conviction_pct, reasoning, segment):
    """Fire when Athena vetoes a coin — trade blocked."""
    if not _read_env_val("TELEGRAM_NOTIFY_TRADES", "true").lower() == "true":
        return

    emoji = "🟢" if side in ("BUY", "LONG") else "🔴"
    dir_label = "LONG ↑" if side in ("BUY", "LONG") else "SHORT ↓"
    # Use proper sentence boundary split — not '.' which hits decimal points
    sentences = re.split(r'(?<=[\.!?])\s+', (reasoning or "").strip())
    short_reason = " ".join(sentences[:2]).strip()
    if len(short_reason) > 300:
        short_reason = short_reason[:297] + "…"
    coin_name = sym.replace('USDT', '')

    msg = (
        f"🚫 <b>ATHENA VETO</b>\n"
        f"━━━━━━━━━━━━━━━━━━\n"
        f"{emoji} <b>{coin_name}</b> · {dir_label} · <b>{conviction_pct:.0f}% conf</b>\n"
        f"📂 Segment: {segment}\n"
        f"\n"
        f"❌ <i>{short_reason}</i>\n"
        f"🕐 {datetime.utcnow().strftime('%H:%M:%S UTC')}"
    )
    send_message_async(msg)


def notify_trade_close(trade):
    """Send notification when a trade is closed."""
    if not config.TELEGRAM_NOTIFY_TRADES:
        return

    pnl = trade.get("realized_pnl", 0)
    pnl_pct = trade.get("realized_pnl_pct", 0)
    emoji = "✅" if pnl >= 0 else "❌"
    pnl_color = "+" if pnl >= 0 else ""

    reason_map = {
        "STOP_LOSS": "🛑 Stop Loss",
        "TRAILING_SL": "🛑 Trailing SL",
        "TAKE_PROFIT": "🎯 Take Profit",
        "TRAILING_TP": "🎯 Trailing TP",
        "MAX_LOSS": "🚨 MAX LOSS GUARD",
        "REGIME_CHANGE": "🔄 Regime Change",
        "KILL_SWITCH": "🚨 Kill Switch",
        "MANUAL": "✋ Manual Close",
    }
    reason = trade.get("exit_reason", "UNKNOWN")
    reason_display = reason_map.get(reason, reason)

    msg = (
        f"{emoji} <b>TRADE CLOSED</b>\n"
        f"━━━━━━━━━━━━━━━━━━\n"
        f"📊 <b>{trade['symbol']}</b> | {trade.get('position', 'N/A')}\n"
        f"📍 {reason_display}\n"
        f"📈 Entry: <code>{trade.get('entry_price', 0):.6f}</code>\n"
        f"📉 Exit: <code>{trade.get('exit_price', 0):.6f}</code>\n"
        f"💰 P&L: <b>{pnl_color}${pnl:.2f}</b> ({pnl_color}{pnl_pct:.2f}%)\n"
        f"⏱ Duration: <b>{trade.get('duration_minutes', 0):.0f}m</b>\n"
        f"🕐 {datetime.utcnow().strftime('%H:%M:%S UTC')}"
    )
    send_message_async(msg)


def notify_kill_switch(drawdown_pct, peak, current):
    """Send URGENT notification when kill switch triggers."""
    if not config.TELEGRAM_NOTIFY_ALERTS:
        return

    msg = (
        f"🚨🚨🚨 <b>KILL SWITCH TRIGGERED</b> 🚨🚨🚨\n"
        f"━━━━━━━━━━━━━━━━━━\n"
        f"📉 Drawdown: <b>{drawdown_pct:.2f}%</b>\n"
        f"📊 Peak: ${peak:,.2f} → Now: ${current:,.2f}\n"
        f"⚠️ ALL positions being closed!\n"
        f"🕐 {datetime.utcnow().strftime('%H:%M:%S UTC')}"
    )
    send_message_async(msg)


def notify_max_loss(symbol, pnl_pct, trade_id):
    """Send notification when a trade hits MAX_LOSS limit."""
    if not config.TELEGRAM_NOTIFY_ALERTS:
        return

    msg = (
        f"🛑 <b>MAX LOSS AUTO-EXIT</b>\n"
        f"━━━━━━━━━━━━━━━━━━\n"
        f"📊 <b>{symbol}</b> (Trade {trade_id})\n"
        f"📉 P&L: <b>{pnl_pct:.2f}%</b> (limit: {config.MAX_LOSS_PER_TRADE_PCT}%)\n"
        f"⚠️ Trade auto-closed to prevent further loss\n"
        f"🕐 {datetime.utcnow().strftime('%H:%M:%S UTC')}"
    )
    send_message_async(msg)


def notify_daily_summary(summary):
    """Send daily portfolio summary."""
    if not config.TELEGRAM_NOTIFY_SUMMARY:
        return

    total_pnl = summary.get("total_realized_pnl", 0)
    emoji = "📈" if total_pnl >= 0 else "📉"
    pnl_sign = "+" if total_pnl >= 0 else ""

    msg = (
        f"📊 <b>DAILY SUMMARY</b>\n"
        f"━━━━━━━━━━━━━━━━━━\n"
        f"{emoji} Total P&L: <b>{pnl_sign}${total_pnl:.2f}</b>\n"
        f"📋 Total Trades: <b>{summary.get('total_trades', 0)}</b>\n"
        f"✅ Winners: <b>{summary.get('winners', 0)}</b>\n"
        f"❌ Losers: <b>{summary.get('losers', 0)}</b>\n"
        f"🎯 Win Rate: <b>{summary.get('win_rate', 0):.1f}%</b>\n"
        f"🔄 Active: <b>{summary.get('active_trades', 0)}</b>\n"
        f"🕐 {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}"
    )
    send_message_async(msg)


def notify_regime_change(symbol, old_regime, new_regime):
    """Send notification on regime change for active position."""
    if not config.TELEGRAM_NOTIFY_ALERTS:
        return

    msg = (
        f"🔄 <b>REGIME CHANGE</b>\n"
        f"📊 <b>{symbol}</b>\n"
        f"📍 {old_regime} → <b>{new_regime}</b>\n"
        f"⚠️ Position will be closed"
    )
    send_message_async(msg, silent=True)


def get_updates(offset=None):
    """Get recent messages (used to auto-detect chat_id)."""
    params = {}
    if offset:
        params["offset"] = offset
    return _send_request("getUpdates", params)


def test_connection():
    """Test the bot token by calling getMe."""
    result = _send_request("getMe")
    if result and result.get("ok"):
        bot = result["result"]
        return {
            "ok": True,
            "bot_name": bot.get("first_name", ""),
            "bot_username": bot.get("username", ""),
        }
    return {"ok": False, "error": "Failed to connect"}

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

    grouped = {}
    for trade in trades:
        sym = trade.get("symbol", "?")
        pos = trade.get("position", "?")
        if pos == "?":
            side = trade.get("side", "").upper()
            pos = "LONG" if side in ("BUY", "LONG") else "SHORT" if side in ("SELL", "SHORT") else "?"
            
        lev = trade.get("leverage", 1)
        regime = trade.get("regime", "?")
        
        key = (sym, pos, lev, regime)
        if key not in grouped:
            grouped[key] = []
        grouped[key].append(trade)

    unique_coins = len(grouped)
    header = f"📦 <b>{unique_coins} COIN{'S' if unique_coins > 1 else ''} DEPLOYED</b>"

    lines = [header, "━━━━━━━━━━━━━━━━━━"]

    for (sym, pos, lev, regime), group in grouped.items():
        rep_trade = group[0]
        count_in_group = len(group)
        
        emoji = "🟢" if pos == "LONG" else "🔴"
        conf = rep_trade.get("confidence", 0)
        entry = rep_trade.get("entry_price", 0)
        sl = rep_trade.get("stop_loss", 0)
        tp = rep_trade.get("take_profit", 0)
        
        if count_in_group > 1:
            users = set(t.get("user_id") for t in group if t.get("user_id"))
            bots = set(t.get("bot_id") for t in group if t.get("bot_id"))
            u_str = f"{len(users)} user{'s' if len(users) != 1 else ''}" if users else f"{count_in_group} users"
            b_str = f"{len(bots)} bot{'s' if len(bots) != 1 else ''}" if bots else f"{count_in_group} bots"
            deployed_msg = f"\n   👥 <i>Deployed across {u_str} · {b_str}</i>"
        else:
            bot_name = rep_trade.get("bot_name")
            deployed_msg = f"\n   🤖 <i>{bot_name}</i>" if bot_name else ""

        reasoning = rep_trade.get("athena_reasoning", "")
        short_reason = ""
        if reasoning and not reasoning.startswith("Auto-approve"):
            sentences = re.split(r'(?<=[.!?])\s+', reasoning.strip())
            short_reason = " ".join(sentences[:2]).strip()
            if len(short_reason) > 400:
                short_reason = short_reason[:397] + "…"
        
        athena_block = f"\n\n💡 <i>{short_reason}</i>\n" if short_reason else "\n"

        lines.append(
            f"{emoji} <b>{sym}</b> {pos} {lev}× | {regime} {conf:.0%}{deployed_msg}\n"
            f"   📈 <code>{entry:.6f}</code>  🛑 <code>{sl:.6f}</code>  🎯 <code>{tp:.6f}</code>{athena_block}"
        )

    lines.append(f"💵 Capital: $100 per user  |  🕐 {datetime.utcnow().strftime('%H:%M:%S UTC')}")

    msg = "\n".join(lines)
    send_message_async(msg)





# ─── Veto batch (mirrors close-batch pattern) ────────────────────────────
_veto_batch: list = []
_veto_batch_lock = threading.Lock()


def notify_athena_veto(sym, side, conviction_pct, reasoning, segment):
    """
    Queue a single veto so it is batched with others in the same cycle.
    Drop-in replacement for the old fire-and-forget version.
    Call flush_veto_batch() at the end of each engine cycle to send one
    consolidated message instead of N per-user duplicates.
    """
    if not _read_env_val("TELEGRAM_NOTIFY_TRADES", "true").lower() == "true":
        return
    with _veto_batch_lock:
        _veto_batch.append({
            "symbol":         sym,
            "side":           side,
            "conviction_pct": conviction_pct,
            "reasoning":      reasoning or "",
            "segment":        segment or "",
        })


def flush_veto_batch():
    """
    Drain the veto batch and send ONE message per engine cycle.
    Deduplicates by symbol so multiple-user engines don’t spam the same coin.
    Call once at the end of each HMM cycle (e.g. after the coin loop).
    """
    with _veto_batch_lock:
        entries = list(_veto_batch)
        _veto_batch.clear()

    if not entries:
        return

    # Deduplicate by symbol — keep highest-conviction entry per coin
    seen: dict[str, dict] = {}
    for e in entries:
        sym = e["symbol"]
        if sym not in seen or e["conviction_pct"] > seen[sym]["conviction_pct"]:
            seen[sym] = e

    unique = list(seen.values())
    header = f"🚫 <b>{len(unique)} COIN{'S' if len(unique) > 1 else ''} VETOED BY ATHENA</b>"
    lines = [header, "━" * 18]

    for e in unique:
        sym, side, conv, reasoning, segment = (
            e["symbol"], e["side"], e["conviction_pct"], e["reasoning"], e["segment"]
        )
        emoji   = "🟢" if side in ("BUY", "LONG") else "🔴"
        dir_lbl = "LONG ↑" if side in ("BUY", "LONG") else "SHORT ↓"
        coin    = sym.replace("USDT", "")

        sentences = re.split(r'(?<=[.!?])\s+', reasoning.strip())
        short_rsn = " ".join(sentences[:2]).strip()
        if len(short_rsn) > 300:
            short_rsn = short_rsn[:297] + "…"

        lines.append(
            f"{emoji} <b>{coin}</b> · {dir_lbl} · <b>{conv:.0f}% conf</b>"
            + (f" · {segment}" if segment else "")
            + (f"\n   ❌ <i>{short_rsn}</i>" if short_rsn else "")
        )

    original_count = len(entries)
    if original_count > len(unique):
        lines.append(f"\n<i>👥 {original_count} veto signals → {len(unique)} unique coins (duplicates merged)</i>")

    lines.append(f"🕐 {datetime.utcnow().strftime('%H:%M:%S UTC')}")
    send_message_async("\n".join(lines))


_close_batch = []
_close_batch_lock = threading.Lock()

def notify_trade_close(trade):
    """Queue a trade close context for batched notification."""
    if not _read_env_val("TELEGRAM_NOTIFY_TRADES", "true").lower() == "true":
        return
    with _close_batch_lock:
        _close_batch.append(trade)

def flush_trade_closes():
    """Drains the close batch and sends them as one concatenated message per N closes."""
    with _close_batch_lock:
        trades = list(_close_batch)
        _close_batch.clear()

    if not trades:
        return

    grouped = {}
    for trade in trades:
        sym = trade.get("symbol", "?")
        pos = trade.get("position", "?")
        reason = trade.get("exit_reason", "UNKNOWN")
        key = (sym, pos, reason)
        if key not in grouped:
            grouped[key] = []
        grouped[key].append(trade)

    unique_closes = len(grouped)
    header = f"🏁 <b>{unique_closes} COIN{'S' if unique_closes > 1 else ''} CLOSED</b>"
    lines = [header, "━━━━━━━━━━━━━━━━━━"]

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

    for (sym, pos, reason), group in grouped.items():
        rep_trade = group[0]
        count_in_group = len(group)
        
        # Calculate averages for the display
        avg_entry = sum(t.get("entry_price", 0) for t in group) / count_in_group
        avg_exit = sum(t.get("exit_price", 0) for t in group) / count_in_group
        avg_pnl = sum(t.get("realized_pnl", 0) for t in group) / count_in_group
        avg_pnl_pct = sum(t.get("realized_pnl_pct", 0) for t in group) / count_in_group
        avg_dur = sum(t.get("duration_minutes", 0) for t in group) / count_in_group

        emoji = "✅" if avg_pnl >= 0 else "❌"
        pnl_color = "+" if avg_pnl >= 0 else ""
        reason_display = reason_map.get(reason, reason)

        deployed_msg = ""
        if count_in_group > 1:
            users = set(t.get("user_id") for t in group if t.get("user_id"))
            bots = set(t.get("bot_id") for t in group if t.get("bot_id"))
            u_str = f"{len(users)} user{'s' if len(users) != 1 else ''}" if users else f"{count_in_group} users"
            b_str = f"{len(bots)} bot{'s' if len(bots) != 1 else ''}" if bots else f"{count_in_group} bots"
            deployed_msg = f"\n   👥 <i>Closed across {u_str} · {b_str}</i>"

        lines.append(
            f"{emoji} <b>{sym}</b> {pos} | {reason_display}{deployed_msg}\n"
            f"   📈 Entry: <code>{avg_entry:.6f}</code>  📉 Exit: <code>{avg_exit:.6f}</code>\n"
            f"   💰 P&L: <b>{pnl_color}${avg_pnl:.2f}</b> ({pnl_color}{avg_pnl_pct:.2f}%) | ⏱ {avg_dur:.0f}m"
        )
        lines.append("")

    lines.append(f"🕐 {datetime.utcnow().strftime('%H:%M:%S UTC')}")
    send_message_async("\n".join(lines))


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

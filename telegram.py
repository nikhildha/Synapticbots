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


# Kill switch: module-level cooldown so repeated cycles don't re-spam
_kill_switch_last_sent: float = 0.0
_KILL_SWITCH_COOLDOWN_SECS: int = 3600  # 1 hour


def notify_kill_switch(drawdown_pct, peak, current):
    """Send URGENT notification when kill switch triggers.

    Silenced for _KILL_SWITCH_COOLDOWN_SECS after the first fire so a
    sustained kill-switch state doesn't spam every engine cycle.
    """
    global _kill_switch_last_sent
    if not config.TELEGRAM_NOTIFY_ALERTS:
        return
    now = time.time()
    if now - _kill_switch_last_sent < _KILL_SWITCH_COOLDOWN_SECS:
        logger.debug("[Telegram] kill-switch cooldown active — suppressing duplicate alert")
        return
    _kill_switch_last_sent = now

    msg = (
        f"🚨🚨🚨 <b>KILL SWITCH TRIGGERED</b> 🚨🚨🚨\n"
        f"━━━━━━━━━━━━━━━━━━\n"
        f"📉 Drawdown: <b>{drawdown_pct:.2f}%</b>\n"
        f"📊 Peak: ${peak:,.2f} → Now: ${current:,.2f}\n"
        f"⚠️ ALL positions being closed!\n"
        f"🕐 {datetime.utcnow().strftime('%H:%M:%S UTC')}"
    )
    send_message_async(msg)


# ─── MAX_LOSS batch (same pattern as veto/close batches) ─────────────────────
_max_loss_batch: list = []
_max_loss_batch_lock = threading.Lock()

# Per-symbol cooldown: avoid re-alerting same coin within 10 minutes
_max_loss_last_sent: dict[str, float] = {}
_MAX_LOSS_COOLDOWN_SECS: int = 600  # 10 minutes


def notify_max_loss(symbol, pnl_pct, trade_id):
    """Queue a MAX_LOSS alert for batched delivery at cycle end.

    Multiple users closing the same coin at MAX_LOSS in one cycle are
    collapsed into a single row by flush_max_loss_batch().
    """
    if not config.TELEGRAM_NOTIFY_ALERTS:
        return
    now = time.time()
    if now - _max_loss_last_sent.get(symbol, 0) < _MAX_LOSS_COOLDOWN_SECS:
        logger.debug("[Telegram] MAX_LOSS cooldown for %s — suppressing duplicate", symbol)
        return
    _max_loss_last_sent[symbol] = now
    with _max_loss_batch_lock:
        _max_loss_batch.append({
            "symbol":   symbol,
            "pnl_pct":  pnl_pct,
            "trade_id": trade_id,
        })


def flush_max_loss_batch():
    """Drain the MAX_LOSS batch and send one grouped alert per cycle."""
    with _max_loss_batch_lock:
        entries = list(_max_loss_batch)
        _max_loss_batch.clear()

    if not entries:
        return

    # Deduplicate by symbol — worst PnL wins (most alarming for the reader)
    seen: dict[str, dict] = {}
    for e in entries:
        sym = e["symbol"]
        if sym not in seen or e["pnl_pct"] < seen[sym]["pnl_pct"]:
            seen[sym] = e

    unique = list(seen.values())
    header = f"🛑 <b>{len(unique)} MAX LOSS AUTO-EXIT{'S' if len(unique) > 1 else ''}</b>"
    lines = [header, "━" * 18]

    for e in unique:
        lines.append(
            f"📊 <b>{e['symbol'].replace('USDT','')}</b> · "
            f"P&L: <b>{e['pnl_pct']:.2f}%</b> "
            f"(limit: {config.MAX_LOSS_PER_TRADE_PCT}%)"
        )

    if len(entries) > len(unique):
        lines.append(f"\n<i>👥 {len(entries)} alerts → {len(unique)} unique coins merged</i>")

    lines.append(f"🕐 {datetime.utcnow().strftime('%H:%M:%S UTC')}")
    send_message_async("\n".join(lines))


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


# ═══════════════════════════════════════════════════════════════════════════════
#  TELEGRAM COMMAND HANDLER — polling-based bot menu
#  Starts a background daemon thread that long-polls getUpdates and dispatches
#  /commands.  No external libraries needed.
# ═══════════════════════════════════════════════════════════════════════════════

# Shared engine reference — set by register_engine_ref() at engine startup
_engine_ref: dict = {
    "engine":       None,   # Engine instance (cycle_count, _veto_log, etc.)
    "paused":       False,  # deployment pause flag polled by main loop
    "close_all_fn": None,   # callable(mode) injected by main.py
}

# Pending two-step confirmations: {chat_id: {"action": str, "expires": float}}
_pending_confirms: dict = {}


def register_engine_ref(engine, close_all_fn=None):
    """Call once at engine startup so the command handler can read state."""
    _engine_ref["engine"]       = engine
    _engine_ref["close_all_fn"] = close_all_fn
    logger.info("[TelegramMenu] Engine reference registered")


def is_deployment_paused() -> bool:
    """Main loop calls this each cycle to honour /pause."""
    return bool(_engine_ref.get("paused"))


# ─── Command Builders ────────────────────────────────────────────────────────

def _cmd_status() -> str:
    import config as _cfg
    eng   = _engine_ref.get("engine")
    mode  = "LIVE 🔴" if not getattr(_cfg, "PAPER_TRADE", True) else "PAPER 🔵"
    cycle = eng._cycle_count if eng else "?"
    dur   = f"{eng._last_cycle_duration:.1f}s" if eng and hasattr(eng, "_last_cycle_duration") else "?"
    state = "⏸ PAUSED" if _engine_ref.get("paused") else "▶ RUNNING"
    return (
        f"🖥 <b>ENGINE STATUS</b>\n"
        f"━━━━━━━━━━━━━━━━━━\n"
        f"State:  <b>{state}</b>\n"
        f"Mode:   <b>{mode}</b>\n"
        f"Cycle:  <b>#{cycle}</b>\n"
        f"Last:   <code>{dur}</code>\n"
        f"🕐 {datetime.utcnow().strftime('%H:%M:%S UTC')}"
    )


def _cmd_trades() -> str:
    import tradebook as _tb
    trades = _tb.get_all_active_trades()
    if not trades:
        return "📭 <b>No active trades</b>\n🕐 " + datetime.utcnow().strftime('%H:%M:%S UTC')
    by_bot: dict = {}
    for t in trades:
        bn = t.get("bot_name") or "Unknown"
        by_bot.setdefault(bn, []).append(t)
    total_pnl = sum(t.get("unrealized_pnl", 0) for t in trades)
    sign = "+" if total_pnl >= 0 else ""
    lines = [f"📊 <b>ACTIVE TRADES ({len(trades)})</b>", "━━━━━━━━━━━━━━━━━━"]
    for bn, bts in sorted(by_bot.items()):
        syms = ", ".join(t.get("symbol","?").replace("USDT","") for t in bts[:6])
        if len(bts) > 6: syms += f" +{len(bts)-6}"
        bp = sum(t.get("unrealized_pnl", 0) for t in bts)
        bs = "+" if bp >= 0 else ""
        lines.append(f"🤖 <b>{bn}</b> ({len(bts)}) · <code>{bs}${bp:.2f}</code>\n   {syms}")
    lines.append(f"\n💰 Unrealized total: <b>{sign}${total_pnl:.2f}</b>")
    lines.append("🕐 " + datetime.utcnow().strftime('%H:%M:%S UTC'))
    return "\n".join(lines)


def _cmd_pnl() -> str:
    import tradebook as _tb
    book  = _tb._load_book()
    all_t = book.get("trades", [])
    active  = [t for t in all_t if t.get("status") in ("ACTIVE","OPEN")]
    closed  = [t for t in all_t if t.get("status") == "CLOSED"]
    wins    = [t for t in closed if t.get("realized_pnl", 0) > 0]
    realized   = sum(t.get("realized_pnl", 0) for t in closed)
    unrealized = sum(t.get("unrealized_pnl", 0) for t in active)
    fees       = sum(t.get("commission", 0) for t in closed)
    wr = (len(wins) / len(closed) * 100) if closed else 0
    combined = realized + unrealized
    s = "+" if combined >= 0 else ""
    return (
        f"💹 <b>PORTFOLIO P&L</b>\n"
        f"━━━━━━━━━━━━━━━━━━\n"
        f"Total:      <b>{s}${combined:.2f}</b>\n"
        f"Realized:   <code>{'+'if realized>=0 else ''}${realized:.2f}</code>\n"
        f"Unrealized: <code>{'+'if unrealized>=0 else ''}${unrealized:.2f}</code>\n"
        f"Fees paid:  <code>-${fees:.2f}</code>\n"
        f"Win rate:   <b>{wr:.1f}%</b>  ({len(wins)}W / {len(closed)-len(wins)}L)\n"
        f"Active: {len(active)}  Closed: {len(closed)}\n"
        f"🕐 {datetime.utcnow().strftime('%H:%M:%S UTC')}"
    )


def _cmd_bots() -> str:
    import tradebook as _tb
    import config as _cfg
    MAX    = getattr(_cfg, "MAX_USER_TRADES_PER_MODE", 10)
    trades = _tb.get_all_active_trades()
    by_bot: dict = {}
    for t in trades:
        key = t.get("bot_id") or t.get("bot_name") or "unknown"
        by_bot.setdefault(key, []).append(t)
    lines = ["🤖 <b>BOT STATUS</b>", "━━━━━━━━━━━━━━━━━━"]
    if not by_bot:
        lines.append("No active bot trades.")
    for bid, bts in sorted(by_bot.items()):
        bname = bts[0].get("bot_name") or bid
        pnl   = sum(t.get("unrealized_pnl", 0) for t in bts)
        sign  = "+" if pnl >= 0 else ""
        bar   = "█" * len(bts) + "░" * max(0, MAX - len(bts))
        lines.append(f"▶ <b>{bname}</b>  [{bar}] {len(bts)}/{MAX}  <code>{sign}${pnl:.2f}</code>")
    lines.append("🕐 " + datetime.utcnow().strftime('%H:%M:%S UTC'))
    return "\n".join(lines)


def _cmd_veto() -> str:
    eng   = _engine_ref.get("engine")
    vetos = list(reversed(eng._veto_log))[:10] if eng and hasattr(eng, "_veto_log") else []
    if not vetos:
        return "✅ <b>No recent Athena vetoes</b>"
    lines = [f"🚫 <b>RECENT VETOES ({len(vetos)})</b>", "━━━━━━━━━━━━━━━━━━"]
    for v in vetos:
        coin   = v.get("symbol","?").replace("USDT","")
        side   = v.get("side","?")
        conv   = int((v.get("conviction") or 0) * 100)
        reason = (v.get("reason") or "")[:80]
        emoji  = "🟢" if side in ("BUY","LONG") else "🔴"
        lines.append(f"{emoji} <b>{coin}</b> · {v.get('action','VETO')} · {conv}%\n   <i>{reason}</i>")
    lines.append("🕐 " + datetime.utcnow().strftime('%H:%M:%S UTC'))
    return "\n".join(lines)


def _cmd_users() -> str:
    """Rank all users by realized + unrealized PnL."""
    import tradebook as _tb
    book  = _tb._load_book()
    all_t = book.get("trades", [])
    stats: dict = {}
    for t in all_t:
        uid = t.get("user_id") or "anonymous"
        if uid not in stats:
            stats[uid] = {"realized": 0.0, "unrealized": 0.0, "active": 0, "closed": 0, "wins": 0}
        s = stats[uid]
        st = (t.get("status") or "").upper()
        if st in ("ACTIVE","OPEN"):
            s["unrealized"] += t.get("unrealized_pnl", 0)
            s["active"]     += 1
        elif st == "CLOSED":
            pnl = t.get("realized_pnl", 0)
            s["realized"] += pnl
            s["closed"]   += 1
            if pnl > 0: s["wins"] += 1
    if not stats:
        return "📭 <b>No user data yet</b>"
    ranked = sorted(stats.items(), key=lambda x: x[1]["realized"]+x[1]["unrealized"], reverse=True)
    medals = ["🥇","🥈","🥉"]
    lines  = [f"👥 <b>USER PnL RANKING ({len(ranked)} users)</b>", "━━━━━━━━━━━━━━━━━━"]
    for i, (uid, s) in enumerate(ranked):
        total = s["realized"] + s["unrealized"]
        sign  = "+" if total >= 0 else ""
        wr    = (s["wins"]/s["closed"]*100) if s["closed"] else 0
        medal = medals[i] if i < 3 else f"{i+1}."
        short = uid[-8:] if len(uid) > 8 else uid
        lines.append(
            f"{medal} <code>…{short}</code>  <b>{sign}${total:.2f}</b>\n"
            f"   📈 realized {sign}${s['realized']:.2f} · {s['active']} open · {wr:.0f}% WR"
        )
    lines.append("🕐 " + datetime.utcnow().strftime('%H:%M:%S UTC'))
    return "\n".join(lines)


def _cmd_summary() -> str:
    import tradebook as _tb
    book  = _tb._load_book()
    all_t = book.get("trades", [])
    closed = [t for t in all_t if t.get("status") == "CLOSED"]
    active = [t for t in all_t if t.get("status") in ("ACTIVE","OPEN")]
    wins   = [t for t in closed if t.get("realized_pnl", 0) > 0]
    realized   = sum(t.get("realized_pnl", 0) for t in closed)
    unrealized = sum(t.get("unrealized_pnl", 0) for t in active)
    wr   = (len(wins)/len(closed)*100) if closed else 0
    e    = "📈" if realized >= 0 else "📉"
    sign = "+" if realized >= 0 else ""
    return (
        f"📊 <b>PORTFOLIO SUMMARY</b>\n"
        f"━━━━━━━━━━━━━━━━━━\n"
        f"{e} Realized:   <b>{sign}${realized:.2f}</b>\n"
        f"📊 Unrealized: <code>{'+'if unrealized>=0 else ''}${unrealized:.2f}</code>\n"
        f"📋 Trades: <b>{len(all_t)}</b>  ({len(active)} active · {len(closed)} closed)\n"
        f"✅ {len(wins)}W  ❌ {len(closed)-len(wins)}L  🎯 {wr:.1f}% WR\n"
        f"🕐 {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}"
    )


# ─── Command table + help ───────────────────────────────────────────────────

_COMMANDS_META = [
    ("/status",   "Engine health, mode, cycle count"),
    ("/trades",   "Active trades grouped by bot"),
    ("/pnl",      "Full portfolio P&L breakdown"),
    ("/bots",     "Bot-level status and capital usage"),
    ("/veto",     "Last 10 Athena veto decisions"),
    ("/users",    "All users ranked by P&L"),
    ("/summary",  "Portfolio summary on demand"),
    ("/pause",    "Pause new trade deployments"),
    ("/resume",   "Resume deployments"),
    ("/closeall", "Close ALL active trades (confirm required)"),
    ("/help",     "Show this command menu"),
]

_HELP_TEXT = (
    "🏛 <b>SYNAPTIC COMMANDS</b>\n"
    "━━━━━━━━━━━━━━━━━━\n"
    + "\n".join(f"<code>{cmd}</code> — {desc}" for cmd, desc in _COMMANDS_META)
)


def _dispatch(chat_id: str, text: str):
    cmd = text.strip().lower().split()[0] if text.strip() else ""

    # Two-step confirm check
    pending = _pending_confirms.get(chat_id)
    if pending and time.time() < pending["expires"]:
        if text.strip().lower() == "confirm":
            action = pending.get("action", "")
            _pending_confirms.pop(chat_id, None)
            if action == "closeall":
                fn = _engine_ref.get("close_all_fn")
                if fn:
                    try:
                        fn()
                        return "✅ <b>All active trades closed.</b>"
                    except Exception as e:
                        return f"❌ Close all failed: {e}"
                return "❌ close_all handler not registered."
        else:
            _pending_confirms.pop(chat_id, None)
            return "↩️ Confirmation cancelled."

    if cmd in ("/help", "/start"): return _HELP_TEXT
    if cmd == "/status":   return _cmd_status()
    if cmd == "/trades":   return _cmd_trades()
    if cmd == "/pnl":      return _cmd_pnl()
    if cmd == "/bots":     return _cmd_bots()
    if cmd == "/veto":     return _cmd_veto()
    if cmd == "/users":    return _cmd_users()
    if cmd == "/summary":  return _cmd_summary()
    if cmd == "/pause":
        try:
            import json as _j, os as _os
            _state_path = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "data", "engine_state.json")
            _os.makedirs(_os.path.dirname(_state_path), exist_ok=True)
            with open(_state_path, "w") as _f:
                _j.dump({"status": "paused", "paused_by": "telegram",
                          "paused_at": datetime.utcnow().isoformat() + "Z"}, _f, indent=2)
        except Exception as _pe:
            logger.warning("[TelegramMenu] /pause write failed: %s", _pe)
        _engine_ref["paused"] = True
        return "⏸ <b>Deployments PAUSED</b> — engine will skip new trades.\nSend /resume to restart."
    if cmd == "/resume":
        try:
            import json as _j, os as _os
            _state_path = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "data", "engine_state.json")
            with open(_state_path, "w") as _f:
                _j.dump({"status": "running", "resumed_by": "telegram",
                          "resumed_at": datetime.utcnow().isoformat() + "Z"}, _f, indent=2)
        except Exception as _re:
            logger.warning("[TelegramMenu] /resume write failed: %s", _re)
        _engine_ref["paused"] = False
        return "▶ <b>Deployments RESUMED</b>"
    if cmd == "/closeall":
        _pending_confirms[chat_id] = {"action": "closeall", "expires": time.time() + 30}
        return (
            "⚠️ <b>Close ALL active trades?</b>\n"
            "Reply <code>confirm</code> within 30s.\n"
            "Any other message cancels."
        )
    return None  # unknown — ignore


# ─── BotFather registration ──────────────────────────────────────────────────

def _register_bot_commands():
    commands = [{"command": c.lstrip("/"), "description": d} for c, d in _COMMANDS_META]
    result   = _send_request("setMyCommands", {"commands": commands})
    if result and result.get("ok"):
        logger.info("[TelegramMenu] Commands registered with BotFather ✅")
    else:
        logger.warning("[TelegramMenu] setMyCommands failed: %s", result)


# ─── Polling loop ────────────────────────────────────────────────────────────

def _poll_loop():
    offset = None
    try:
        _register_bot_commands()
    except Exception as e:
        logger.warning("[TelegramMenu] register failed: %s", e)
    logger.info("[TelegramMenu] Polling started")
    while True:
        try:
            cfg = _get_live_config()
            if not cfg["enabled"] or not cfg["token"]:
                time.sleep(10)
                continue
            params: dict = {"timeout": 20, "allowed_updates": ["message"]}
            if offset is not None:
                params["offset"] = offset
            url  = BASE_URL.format(token=cfg["token"], method="getUpdates")
            data = json.dumps(params).encode()
            req  = Request(url, data=data, headers={"Content-Type": "application/json"})
            with urlopen(req, timeout=30) as resp:
                body = json.loads(resp.read().decode())
            if not body.get("ok"):
                time.sleep(5)
                continue
            for update in body.get("result", []):
                offset  = update["update_id"] + 1
                msg     = update.get("message", {})
                chat_id = str(msg.get("chat", {}).get("id", ""))
                text    = msg.get("text", "")
                if not chat_id or not text:
                    continue
                # Accept commands AND confirm reply (no slash needed for confirm)
                if not text.startswith("/") and text.strip().lower() != "confirm":
                    continue
                try:
                    reply = _dispatch(chat_id, text)
                    if reply:
                        _send_request("sendMessage", {
                            "chat_id":    chat_id,
                            "text":       reply,
                            "parse_mode": "HTML",
                        })
                except Exception as e:
                    logger.error("[TelegramMenu] dispatch error: %s", e)
        except Exception as e:
            logger.warning("[TelegramMenu] Poll error: %s", e)
            time.sleep(5)


_menu_thread_started = False
_menu_thread_lock    = threading.Lock()


def start_command_handler():
    """
    Launch the polling daemon thread. Idempotent — safe to call multiple times.
    Call from main.py after engine init and register_engine_ref().
    """
    global _menu_thread_started
    with _menu_thread_lock:
        if _menu_thread_started:
            return
        _menu_thread_started = True
    t = threading.Thread(target=_poll_loop, daemon=True, name="TelegramMenu")
    t.start()
    logger.info("[TelegramMenu] Command handler thread launched")

"""
ai4trade_client.py — Synaptic × AI-Trader Integration
======================================================
Connects Synaptic to the ai4trade.ai platform (HKUDS/AI-Trader):

  1. Registers / logs in Synaptic as an AI agent on ai4trade.ai
  2. Publishes every live trade as a real-time signal (buy/sell/short/cover)
  3. Polls the heartbeat API to receive replies from other agents
  4. Logs all agent conversations to a JSONL file for analysis
  5. Exposes community_context() for Athena to consume before EXECUTE/VETO

Environment variables (add to Railway):
  AI4TRADE_EMAIL          — bot account email
  AI4TRADE_PASSWORD       — bot account password
  AI4TRADE_TOKEN          — (auto-filled after first registration)
  AI4TRADE_AGENT_NAME     — display name (default: "Synaptic-HMM-Engine")

Controlled by config.py:
  AI4TRADE_ENABLED        — master on/off switch
  AI4TRADE_MIN_CONVICTION — only publish trades >= this conviction %
  AI4TRADE_POST_STRATEGY  — post HMM cycle summary as strategy discussion
"""

import os
import json
import logging
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import requests

logger = logging.getLogger(__name__)

BASE_URL = "https://ai4trade.ai/api"
TIMEOUT  = 12  # seconds per API call


class AI4TradeClient:
    """Synaptic ↔ AI-Trader bridge.

    Thread-safe: heartbeat runs in a daemon thread.
    All public methods are safe to call from the main engine loop.
    """

    def __init__(self):
        self._token: str    = os.getenv("AI4TRADE_TOKEN", "").strip()
        self._agent_id: Optional[int] = None
        self._agent_name: str = os.getenv("AI4TRADE_AGENT_NAME", "Synaptic-HMM-Engine")
        self._headers: dict = {}

        # Rolling buffer of community insights (thread-safe via lock)
        self._community_context: list[str] = []
        self._lock = threading.Lock()

        # Conversation log path (persisted to disk)
        log_dir = Path(os.getenv("DATA_DIR", "data"))
        log_dir.mkdir(parents=True, exist_ok=True)
        self._convo_log = log_dir / "agent_conversations.jsonl"

        # ── Register or re-use saved token ──────────────────────────────
        if not self._token:
            self._register_or_login()
        else:
            self._headers = {"Authorization": f"Bearer {self._token}"}
            logger.info("🤝 AI4Trade: using existing token for '%s'", self._agent_name)

        # ── Start background heartbeat thread ───────────────────────────
        if self._token:
            self._start_heartbeat_thread()

    # ─────────────────────────────────────────────────────────────────────
    # Auth
    # ─────────────────────────────────────────────────────────────────────

    def _register_or_login(self) -> None:
        email    = os.getenv("AI4TRADE_EMAIL", "").strip()
        password = os.getenv("AI4TRADE_PASSWORD", "").strip()

        if not email:
            logger.warning(
                "AI4Trade: AI4TRADE_EMAIL not set — integration disabled. "
                "Set email + password in Railway env vars to enable."
            )
            return

        try:
            # 1. Try login first (agent may already be registered)
            resp = requests.post(
                f"{BASE_URL}/claw/agents/login",
                json={"email": email, "password": password},
                timeout=TIMEOUT,
            )
            if resp.status_code == 200 and resp.json().get("token"):
                data = resp.json()
                logger.info("🤝 AI4Trade: logged in as '%s'", self._agent_name)
            else:
                # 2. Register fresh agent
                resp = requests.post(
                    f"{BASE_URL}/claw/agents/selfRegister",
                    json={
                        "name":     self._agent_name,
                        "email":    email,
                        "password": password,
                    },
                    timeout=TIMEOUT,
                )
                resp.raise_for_status()
                data = resp.json()
                logger.info("✅ AI4Trade: registered new agent '%s'", self._agent_name)

            self._token      = data.get("token", "")
            self._agent_id   = data.get("agent_id")
            self._headers    = {"Authorization": f"Bearer {self._token}"}

            # Persist token so future restarts skip registration
            if self._token:
                os.environ["AI4TRADE_TOKEN"] = self._token
                logger.info(
                    "   agent_id=%s  |  Add AI4TRADE_TOKEN=%s... to Railway env to persist",
                    self._agent_id, self._token[:20]
                )

        except Exception as exc:
            logger.warning("AI4Trade registration/login failed: %s", exc)

    # ─────────────────────────────────────────────────────────────────────
    # Public API — called from main.py
    # ─────────────────────────────────────────────────────────────────────

    def publish_trade_open(
        self,
        symbol: str,
        side: str,         # "LONG" | "SHORT"
        entry_price: float,
        quantity: float,
        conviction: float, # 0-100
        regime: str,
        reasoning: str,
        entry_timestamp: Optional[str] = None,
    ) -> None:
        """Publish a new trade to ai4trade.ai signal feed.

        Called from main.py immediately after tradebook.open_trade().
        """
        if not self._token:
            return

        # Map Synaptic direction → AI4Trade action
        action_map = {
            "LONG": "buy", "BUY": "buy",
            "SHORT": "short", "SELL": "short",
        }
        action = action_map.get(side.upper(), "buy")

        # Strip USDT suffix:  SOLUSDT → SOL
        ticker = symbol.replace("USDT", "").replace("USDC", "").replace("BUSD", "")

        content = (
            f"[Synaptic HMM] Regime: {regime} | "
            f"Conviction: {conviction:.0f}% | "
            f"Athena: {reasoning[:120]}"
        )

        payload = {
            "market":      "crypto",
            "action":      action,
            "symbol":      ticker,
            "price":       round(float(entry_price), 6),
            "quantity":    round(float(quantity), 6),
            "content":     content,
            "executed_at": entry_timestamp or datetime.now(timezone.utc).isoformat(),
        }

        self._post_signal("realtime", payload,
                          label=f"{action.upper()} {ticker} @ {entry_price:.4f}")

    def publish_trade_close(
        self,
        symbol: str,
        side_was: str,     # "LONG" or "SHORT" — the side being CLOSED
        close_price: float,
        quantity: float,
        pnl_pct: float,
        close_reason: str,
    ) -> None:
        """Publish a trade exit (sell or cover) to the signal feed."""
        if not self._token:
            return

        close_action = "sell" if side_was.upper() in ("LONG", "BUY") else "cover"
        ticker = symbol.replace("USDT", "").replace("USDC", "").replace("BUSD", "")

        emoji = "🟢" if pnl_pct >= 0 else "🔴"
        content = f"{emoji} Closed {ticker} {close_reason} | PnL: {pnl_pct:+.1f}%"

        payload = {
            "market":      "crypto",
            "action":      close_action,
            "symbol":      ticker,
            "price":       round(float(close_price), 6),
            "quantity":    round(float(quantity), 6),
            "content":     content,
            "executed_at": datetime.now(timezone.utc).isoformat(),
        }

        self._post_signal("realtime", payload,
                          label=f"CLOSE {ticker} {pnl_pct:+.1f}%")

    def publish_cycle_strategy(
        self,
        cycle: int,
        btc_regime: str,
        top_coin: str,
        top_side: str,
        top_conviction: float,
        n_deployed: int,
    ) -> None:
        """Post a strategy discussion summarising the current HMM scan cycle.

        Other agents reply → replies arrive via heartbeat → fed into Athena.
        Does NOT reveal internal thresholds or weights.
        """
        if not self._token:
            return

        ticker = top_coin.replace("USDT", "").replace("USDC", "")
        title = f"HMM Scan #{cycle} — BTC: {btc_regime}"
        content = (
            f"📊 Synaptic Engine cycle #{cycle} complete.\n"
            f"• BTC macro regime: **{btc_regime}**\n"
            f"• Strongest signal: **{ticker} {top_side}** "
            f"({top_conviction:.0f}% conviction)\n"
            f"• Positions deployed this cycle: {n_deployed}\n\n"
            f"Community: what's your read on {ticker} structure right now?"
        )

        payload = {
            "market":  "crypto",
            "title":   title,
            "content": content,
            "symbols": [ticker],
            "tags":    ["hmm", "crypto", "algorithmic", "synaptic"],
        }

        try:
            resp = requests.post(
                f"{BASE_URL}/signals/strategy",
                headers=self._headers,
                json=payload,
                timeout=TIMEOUT,
            )
            if resp.status_code == 200:
                logger.info("📝 AI4Trade strategy posted: %s", title)
        except Exception as exc:
            logger.debug("AI4Trade strategy post error: %s", exc)

    def reply_to_discussion(self, signal_id: int, content: str) -> None:
        """Reply to a discussion thread on ai4trade.ai."""
        if not self._token:
            return
        try:
            requests.post(
                f"{BASE_URL}/signals/reply",
                headers=self._headers,
                json={
                    "signal_id": signal_id,
                    "user_name": self._agent_name,
                    "content":   content,
                },
                timeout=TIMEOUT,
            )
        except Exception as exc:
            logger.debug("AI4Trade reply error: %s", exc)

    def get_community_context(self, symbol: str = "") -> str:
        """Return recent agent insights for Athena context injection.

        Returns last 8 messages, filtered to the symbol if provided.
        """
        with self._lock:
            if not self._community_context:
                return ""
            ctx = list(self._community_context)  # copy under lock

        if symbol:
            ticker = symbol.replace("USDT", "").replace("USDC", "").upper()
            filtered = [m for m in ctx if ticker in m.upper()]
            ctx = filtered[-6:] if filtered else ctx[-4:]
        else:
            ctx = ctx[-8:]

        return "\n".join(ctx)

    def is_ready(self) -> bool:
        """True if the client is authenticated and ready to publish."""
        return bool(self._token)

    # ─────────────────────────────────────────────────────────────────────
    # Internal — signal POST helper
    # ─────────────────────────────────────────────────────────────────────

    def _post_signal(self, endpoint: str, payload: dict, label: str) -> None:
        try:
            resp = requests.post(
                f"{BASE_URL}/signals/{endpoint}",
                headers=self._headers,
                json=payload,
                timeout=TIMEOUT,
            )
            if resp.status_code == 200:
                logger.info("📡 AI4Trade signal published: %s", label)
            else:
                logger.debug(
                    "AI4Trade publish (%s) %s: %s",
                    endpoint, resp.status_code, resp.text[:200]
                )
        except Exception as exc:
            logger.debug("AI4Trade publish error (%s): %s", endpoint, exc)

    # ─────────────────────────────────────────────────────────────────────
    # Heartbeat — background thread
    # ─────────────────────────────────────────────────────────────────────

    def _start_heartbeat_thread(self) -> None:
        t = threading.Thread(
            target=self._heartbeat_loop,
            name="ai4trade-heartbeat",
            daemon=True,
        )
        t.start()
        logger.info("💓 AI4Trade: heartbeat thread started")

    def _heartbeat_loop(self) -> None:
        """Poll /api/claw/agents/heartbeat every ~30s.
        Extracts intelligence from other agents' replies.
        """
        while True:
            interval = 30  # default fallback
            try:
                resp = requests.post(
                    f"{BASE_URL}/claw/agents/heartbeat",
                    headers=self._headers,
                    timeout=TIMEOUT,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    interval = data.get("recommended_poll_interval_seconds", 30)

                    for msg in data.get("messages", []):
                        self._process_message(msg)

                    # If more messages queued, poll again immediately
                    if data.get("has_more_messages"):
                        interval = 1
                else:
                    logger.debug("Heartbeat HTTP %s", resp.status_code)

            except Exception as exc:
                logger.debug("Heartbeat error: %s", exc)
                interval = 60  # back off on error

            time.sleep(interval)

    def _process_message(self, msg: dict) -> None:
        """Parse a heartbeat message, extract insight, log to disk."""
        msg_type = msg.get("type", "")
        content  = msg.get("content", "")
        data     = msg.get("data", {})
        ts       = msg.get("created_at", datetime.now(timezone.utc).isoformat())

        logger.info("📬 AI4Trade [%s]: %s", msg_type, content[:100])

        # ── Write to conversation log ──────────────────────────────────
        log_entry = {
            "ts":       ts,
            "type":     msg_type,
            "content":  content,
            "data":     data,
            "msg_id":   msg.get("id"),
            "agent_id": msg.get("agent_id"),
        }
        try:
            with open(self._convo_log, "a", encoding="utf-8") as f:
                f.write(json.dumps(log_entry) + "\n")
        except Exception:
            pass  # non-fatal

        # ── Extract intelligence snippet for Athena context ────────────
        snippet = self._extract_intel(msg_type, content, data)
        if snippet:
            with self._lock:
                self._community_context.append(snippet)
                # Keep rolling window of 60 most recent insights
                self._community_context = self._community_context[-60:]

    def _extract_intel(self, msg_type: str, content: str, data: dict) -> str:
        """Convert a raw heartbeat message into a concise Athena-readable insight."""

        author = data.get("reply_author_name", data.get("agent_name", "Agent"))

        if msg_type in ("discussion_reply", "strategy_reply"):
            # Someone replied to our strategy post → direct alpha signal
            signal_title = data.get("title", "")
            return f"[Reply from {author} on '{signal_title}']: {content}"

        if msg_type == "new_follower":
            # A new agent is following us — note it but don't add to Athena ctx
            logger.info("🎉 AI4Trade: new follower — %s", content)
            return ""

        if msg_type in ("strategy_published", "discussion_started"):
            # An agent we follow posted something — this IS market insight
            return f"[{author} posted]: {content}"

        if msg_type in ("discussion_mention", "strategy_mention"):
            # Someone mentioned Synaptic in their analysis
            return f"[{author} mentioned Synaptic]: {content}"

        return ""

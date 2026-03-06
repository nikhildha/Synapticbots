# Sentinel Production Validation Test Checklist

Base URL: `https://hhmbot-production.up.railway.app`

---

## 1. Auth — Login / Session

| # | Test | Expected | Status |
|---|------|----------|--------|
| 1.1 | GET `/api/auth/session` (no cookie) | `{}` or `{user: null}` | |
| 1.2 | POST `/api/auth/callback/credentials` admin login | 200 + session cookie | |
| 1.3 | GET `/api/auth/session` (with cookie) | `{user: {email, id, role: "admin"}}` | |
| 1.4 | POST `/api/auth/callback/credentials` user login | 200 + session cookie | |
| 1.5 | GET `/api/auth/session` (user cookie) | `{user: {email, role: "user"}}` | |
| 1.6 | POST `/api/auth/signout` | 200, session cleared | |

---

## 2. Bot Toggle — Start / Stop

| # | Test | Expected | Status |
|---|------|----------|--------|
| 2.1 | GET `/api/bots` (admin) | List of bots with config | |
| 2.2 | POST `/api/bots/toggle` `{botId, isActive: true}` | Bot active, BotSession created | |
| 2.3 | GET `/api/sessions?botId=<id>` after start | Session with `status: "active"` | |
| 2.4 | POST `/api/bots/toggle` `{botId, isActive: false}` | Bot inactive, session closed | |
| 2.5 | GET `/api/sessions?botId=<id>` after stop | Session with `status: "closed"`, metrics populated | |
| 2.6 | Toggle ON again → new session created (sessionIndex increments) | | |

---

## 3. Kill Bot

| # | Test | Expected | Status |
|---|------|----------|--------|
| 3.1 | POST `/api/bots/kill` `{botId}` (with active session) | 200, paper trades closed, session metrics computed | |
| 3.2 | Trades after kill | `status: "closed"`, `exitReason: "BOT_STOPPED"` | |
| 3.3 | BotSession after kill | `status: "closed"`, `endedAt` set | |

---

## 4. Trade Sync

| # | Test | Expected | Status |
|---|------|----------|--------|
| 4.1 | GET `/api/trades` (admin) | All trades visible | |
| 4.2 | GET `/api/trades` (regular user) | Only user's own trades | |
| 4.3 | Trades after bot start have `sessionId` set | Not null | |
| 4.4 | Trades from before first session have `sessionId: null` | (legacy) | |

---

## 5. Sessions API

| # | Test | Expected | Status |
|---|------|----------|--------|
| 5.1 | GET `/api/sessions` (no auth) | 401 | |
| 5.2 | GET `/api/sessions` (authenticated) | Array of BotSession objects | |
| 5.3 | GET `/api/sessions?botId=<id>` | Filtered sessions for that bot | |
| 5.4 | Active session has `status: "active"` | | |
| 5.5 | Closed session has `totalPnl`, `roi`, `winRate`, `totalTrades` | | |

---

## 6. Legacy Backfill

| # | Test | Expected | Status |
|---|------|----------|--------|
| 6.1 | POST `/api/sessions/backfill` (non-admin) | 403 Forbidden | |
| 6.2 | POST `/api/sessions/backfill` (admin) | 200 `{sessionsCreated: N}` | |
| 6.3 | Legacy trades after backfill | `sessionId` set to Session #0 | |
| 6.4 | GET `/api/sessions` after backfill | Session #0 (Legacy) appears | |

---

## 7. Performance Page

| # | Test | Expected | Status |
|---|------|----------|--------|
| 7.1 | GET `/performance` (no auth) | Redirect to login | |
| 7.2 | GET `/performance` (authenticated) | 200 HTML, shows sessions table | |
| 7.3 | Table shows all-time summary row | | |
| 7.4 | Each session row shows: Run #, Mode, Started, Duration, Trades, Win%, PnL, ROI | | |
| 7.5 | Session #0 shows "Legacy" badge | | |
| 7.6 | Active session shows green "Live" badge | | |
| 7.7 | ROI positive = green, negative = red | | |

---

## 8. Dashboard "This Session / All Time" Toggle

| # | Test | Expected | Status |
|---|------|----------|--------|
| 8.1 | GET `/dashboard` shows "PnL Scope" pill toggle | | |
| 8.2 | Click "This Session" — PnL cards filter to active session trades only | | |
| 8.3 | Click "All Time" — PnL cards show all historical trades | | |
| 8.4 | No active session: "This Session" shows warning badge | | |

---

## 9. Tradebook Session Filter

| # | Test | Expected | Status |
|---|------|----------|--------|
| 9.1 | GET `/trades` shows session dropdown | "All Sessions" default | |
| 9.2 | Select "Run #N (Active)" — filters to active session trades | | |
| 9.3 | Select a past session — filters to that session's trades | | |
| 9.4 | Each trade row shows "Run #N" badge | | |

---

## 10. Subscription / Payments

| # | Test | Expected | Status |
|---|------|----------|--------|
| 10.1 | GET `/api/subscription` (authenticated) | Returns current tier and limits | |
| 10.2 | POST `/api/subscription/update` with valid Razorpay IDs | Subscription updated | |
| 10.3 | POST `/api/webhooks/razorpay` with payment.captured | Subscription tier set, 30-day period | |
| 10.4 | POST `/api/webhooks/razorpay` with wrong signature | 401 | |
| 10.5 | Free trial user has `coinScans: 5`, Pro has 15, Ultra has 50 | | |

---

## 11. Signup

| # | Test | Expected | Status |
|---|------|----------|--------|
| 11.1 | POST `/api/signup` valid new user | 201, user + free trial subscription | |
| 11.2 | POST `/api/signup` duplicate email | 400 "Email already exists" | |
| 11.3 | POST `/api/signup` missing fields | 400 "Missing required fields" | |
| 11.4 | POST `/api/signup` with god referral code | Ultra tier, no expiry | |

---

## 12. Edge Cases / Regression

| # | Test | Expected | Status |
|---|------|----------|--------|
| 12.1 | Toggle bot OFF with no active session | Graceful, no 500 | |
| 12.2 | Kill bot with no open trades | Session closes with zeroed metrics | |
| 12.3 | Start bot, stop immediately (0 trades) | Session created + closed, 0 metrics | |
| 12.4 | Admin can see all users' sessions | | |
| 12.5 | User cannot see other users' sessions | | |
| 12.6 | `/api/bot-state` still works (regression) | | |
| 12.7 | `/api/health` returns 200 | | |

---

## Smoke Test curl Commands

```bash
BASE=https://hhmbot-production.up.railway.app

# Health
curl -s $BASE/api/health | jq .

# Get CSRF token
curl -sc /tmp/admin.jar "$BASE/api/auth/csrf" | python3 -m json.tool

# Login as admin
CSRF=$(curl -sb /tmp/admin.jar "$BASE/api/auth/csrf" | python3 -c "import sys,json; print(json.load(sys.stdin)['csrfToken'])")
curl -sb /tmp/admin.jar -sc /tmp/admin.jar \
  -X POST "$BASE/api/auth/callback/credentials" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "email=admin@sentinel.app&password=Admin%402026&csrfToken=$CSRF&json=true"

# Get sessions
curl -sb /tmp/admin.jar "$BASE/api/sessions" | jq .

# Backfill legacy
curl -sb /tmp/admin.jar -X POST "$BASE/api/sessions/backfill" | jq .

# Get trades
curl -sb /tmp/admin.jar "$BASE/api/trades?limit=5" | jq .
```

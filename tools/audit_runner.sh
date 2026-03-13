#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
#  HMMBOT Master Daily Audit Runner
#  tools/audit_runner.sh
#
#  Runs at 04:00 UTC via Railway Cron (or manually for debugging).
#  Orchestrates both audit sides, merges results, sends Telegram on FAIL.
#
#  Usage:
#    bash tools/audit_runner.sh                  # run everything
#    bash tools/audit_runner.sh --no-telegram     # suppress Telegram alert
#    bash tools/audit_runner.sh --saas-only       # skip engine checks
#    bash tools/audit_runner.sh --engine-only     # skip SaaS checks
#
#  Required env vars (set in Railway):
#    SAAS_URL               — Next.js SaaS base URL (e.g. https://app.example.com)
#    SAAS_AUDIT_TOKEN       — Bearer token for /api/admin/audit  (admin session or API token)
#    TELEGRAM_BOT_TOKEN     — Telegram bot token (optional)
#    TELEGRAM_CHAT_ID       — Telegram chat/channel ID (optional)
#
#  Exit codes: 0=all pass, 1=warnings, 2=fail
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
DATA_DIR="$ROOT_DIR/data"
REPORT_DIR="$DATA_DIR/audit_reports"
RUN_TS="$(date -u '+%Y-%m-%d_%H%M%S')"
REPORT_FILE="$REPORT_DIR/audit_${RUN_TS}.json"
MERGED_FILE="$DATA_DIR/audit_report_merged.json"

# Flags
RUN_ENGINE=true
RUN_SAAS=true
SEND_TELEGRAM=true

for arg in "$@"; do
  case "$arg" in
    --no-telegram)  SEND_TELEGRAM=false ;;
    --saas-only)    RUN_ENGINE=false ;;
    --engine-only)  RUN_SAAS=false ;;
  esac
done

mkdir -p "$REPORT_DIR"

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  HMMBOT MASTER AUDIT — $(date -u '+%Y-%m-%d %H:%M UTC')"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# ─── Step 1: Python Engine Checks ────────────────────────────────────
ENGINE_REPORT="$DATA_DIR/audit_report_engine.json"
ENGINE_EXIT=0

if $RUN_ENGINE; then
  echo "  [1/3] Running Python engine checks..."
  cd "$ROOT_DIR"
  python3 tools/daily_audit.py || ENGINE_EXIT=$?
  echo ""

  if [[ ! -f "$ENGINE_REPORT" ]]; then
    echo "  ⚠️  Engine report file not written — check Python errors above"
    ENGINE_EXIT=2
  fi
else
  echo "  [1/3] Engine checks skipped (--saas-only)"
  ENGINE_EXIT=0
fi

# ─── Step 2: SaaS Checks via API ─────────────────────────────────────
SAAS_REPORT="$DATA_DIR/audit_report_saas.json"
SAAS_EXIT=0
SAAS_URL="${SAAS_URL:-}"
SAAS_AUDIT_TOKEN="${SAAS_AUDIT_TOKEN:-}"

if $RUN_SAAS; then
  echo "  [2/3] Running SaaS checks..."
  if [[ -z "$SAAS_URL" ]]; then
    echo "  ⚠️  SAAS_URL not set — skipping SaaS checks"
    SAAS_EXIT=1
    echo '{"section":"saas","error":"SAAS_URL not configured","results":[],"summary":{"pass":0,"warn":1,"fail":0,"skip":0,"total":1}}' > "$SAAS_REPORT"
  else
    CURL_ARGS=(-s -X GET -o "$SAAS_REPORT" -w "%{http_code}" --max-time 30)
    if [[ -n "$SAAS_AUDIT_TOKEN" ]]; then
      CURL_ARGS+=(-H "Authorization: Bearer $SAAS_AUDIT_TOKEN")
    fi
    HTTP_CODE=$(curl "${CURL_ARGS[@]}" "$SAAS_URL/api/admin/audit" || echo "000")

    if [[ "$HTTP_CODE" == "200" ]]; then
      echo "  ✅ SaaS audit endpoint OK (HTTP 200)"
      # Check for FAILs in saas report
      SAAS_FAILS=$(python3 -c "
import json, sys
try:
    d = json.load(open('$SAAS_REPORT'))
    fails = [r for r in d.get('results', []) if r.get('status') == 'FAIL']
    warns = [r for r in d.get('results', []) if r.get('status') == 'WARN']
    if fails: sys.exit(2)
    elif warns: sys.exit(1)
    else: sys.exit(0)
except: sys.exit(1)
" 2>/dev/null || echo $?)
      SAAS_EXIT="${SAAS_FAILS:-0}"
    elif [[ "$HTTP_CODE" == "403" ]]; then
      echo "  ❌ SaaS audit: 403 Forbidden — SAAS_AUDIT_TOKEN invalid or missing"
      SAAS_EXIT=2
      echo '{"section":"saas","error":"403 Forbidden","results":[],"summary":{"fail":1}}' > "$SAAS_REPORT"
    else
      echo "  ❌ SaaS audit: HTTP $HTTP_CODE — endpoint unreachable"
      SAAS_EXIT=2
      echo "{\"section\":\"saas\",\"error\":\"HTTP $HTTP_CODE\",\"results\":[],\"summary\":{\"fail\":1}}" > "$SAAS_REPORT"
    fi
  fi
  echo ""
else
  echo "  [2/3] SaaS checks skipped (--engine-only)"
  SAAS_EXIT=0
fi

# ─── Step 3: Merge + final report ─────────────────────────────────────
echo "  [3/3] Merging results..."

python3 - <<'PYEOF'
import json, os, sys
from datetime import datetime, timezone

data_dir = os.environ.get("DATA_DIR", "data")
engine_f = os.path.join(data_dir, "audit_report_engine.json")
saas_f   = os.path.join(data_dir, "audit_report_saas.json")

engine = {}
saas   = {}
try:
    if os.path.exists(engine_f):
        with open(engine_f) as f:
            engine = json.load(f)
except Exception:
    pass

try:
    if os.path.exists(saas_f):
        with open(saas_f) as f:
            saas = json.load(f)
except Exception:
    pass

all_results = engine.get("results", []) + saas.get("results", [])
summary = {
    "pass":  sum(1 for r in all_results if r.get("status") == "PASS"),
    "warn":  sum(1 for r in all_results if r.get("status") == "WARN"),
    "fail":  sum(1 for r in all_results if r.get("status") == "FAIL"),
    "skip":  sum(1 for r in all_results if r.get("status") == "SKIP"),
    "total": len(all_results),
}

merged = {
    "run_ts":  datetime.now(timezone.utc).isoformat(),
    "sections": {"engine": engine, "saas": saas},
    "results":  all_results,
    "summary":  summary,
}

out = os.path.join(data_dir, "audit_report_merged.json")
with open(out, "w") as f:
    json.dump(merged, f, indent=2)

# Print summary
print()
print("  ─────────────────────────────────────────────────────────────")
print(f"  COMBINED SUMMARY: ✅ {summary['pass']} PASS  "
      f"⚠️  {summary['warn']} WARN  ❌ {summary['fail']} FAIL  "
      f"⏭️  {summary['skip']} SKIP")

fails = [r for r in all_results if r.get("status") == "FAIL"]
if fails:
    print()
    print("  CRITICAL FAILURES:")
    for r in fails:
        print(f"    {r['check']}: {r['message']}")
print("  ─────────────────────────────────────────────────────────────")
print()

# Print exit info
if summary["fail"] > 0:
    sys.exit(2)
elif summary["warn"] > 0:
    sys.exit(1)
PYEOF

MERGE_EXIT=${PIPESTATUS[0]:-$?}

# ─── Step 4: Telegram alert on FAIL ──────────────────────────────────
OVERALL_EXIT=$(( ENGINE_EXIT > SAAS_EXIT ? ENGINE_EXIT : SAAS_EXIT ))
OVERALL_EXIT=$(( OVERALL_EXIT > MERGE_EXIT ? OVERALL_EXIT : MERGE_EXIT ))

TELE_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELE_CHAT="${TELEGRAM_CHAT_ID:-}"

if $SEND_TELEGRAM && [[ -n "$TELE_TOKEN" && -n "$TELE_CHAT" && $OVERALL_EXIT -ge 2 ]]; then
  echo "  📢 Sending Telegram alert..."

  FAIL_MSGS=$(python3 -c "
import json, os
try:
    with open(os.path.join('$DATA_DIR', 'audit_report_merged.json')) as f:
        d = json.load(f)
    fails = [r for r in d.get('results', []) if r.get('status') == 'FAIL']
    for r in fails[:5]:
        print(f\"  ❌ {r['check']}: {r['message']}\")
except: pass
" 2>/dev/null)

  RUN_DATE="$(date -u '+%Y-%m-%d %H:%M UTC')"
  MSG="🚨 *HMMBOT AUDIT FAIL* — ${RUN_DATE}
${FAIL_MSGS}

Run: \`bash tools/audit_runner.sh\` to re-check"

  curl -s -X POST "https://api.telegram.org/bot${TELE_TOKEN}/sendMessage" \
    -d chat_id="$TELE_CHAT" \
    -d parse_mode="Markdown" \
    -d text="$MSG" \
    > /dev/null 2>&1 && echo "  ✅ Telegram alert sent" || echo "  ⚠️  Telegram send failed"
  echo ""
fi

echo "═══════════════════════════════════════════════════════════════"
echo "  AUDIT COMPLETE — exit code $OVERALL_EXIT"
echo "  Report: $DATA_DIR/audit_report_merged.json"
echo "═══════════════════════════════════════════════════════════════"
echo ""

exit $OVERALL_EXIT

#!/usr/bin/env bash
# xBloom bridge health audit.
# Runs daily at 08:00 Asia/Kuwait via LaunchAgent
# com.xbloom.bean-to-bloom-daily-audit.
# Creates timestamped JSON + human-readable reports under
#   ~/.codex/xbloom-bridge/audit/reports/
# Auto-repairs only known local bridge faults (kickstart only) when no active
# Appium session exists.  Never modifies database, cloud state, D1, jobs,
# recipes, queue claim endpoints, or unrelated host processes.
# Never wipes emulator data or alters xBloom login state.
# Never includes raw log samples, recipe, user, or job data in reports.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RUNTIME_DIR="${XBLOOM_RUNTIME_DIR:-$HOME/.codex/xbloom-bridge}"
REPORT_DIR="$RUNTIME_DIR/audit/reports"
LOCK_FILE="$RUNTIME_DIR/audit/audit.lock"
LOCK_DIR="${LOCK_FILE}.d"
GATE_FILE="$RUNTIME_DIR/audit/last-run-kwt-date"
LATEST_REPORT="$RUNTIME_DIR/audit/latest.json"
HISTORY_FILE="$RUNTIME_DIR/audit/history.jsonl"
GLOBAL_TIMEOUT_SEC="${XBLOOM_AUDIT_TIMEOUT_SEC:-1200}"   # 20 min; never blocks on emulator boot
REPORT_RETENTION_DAYS="${XBLOOM_AUDIT_RETENTION_DAYS:-30}"
BRIDGE_PORT="${XBLOOM_BRIDGE_PORT:-3999}"
APPIUM_PORT="${XBLOOM_APPIUM_PORT:-4723}"
CLOUD_WORKER_URL="${CLOUD_WORKER_URL:-https://xbloom-recipe-worker.bean-to-bloom.workers.dev}"
ADB_PROBE_TIMEOUT="${XBLOOM_ADB_PROBE_TIMEOUT:-10}"
BRIDGE_AGENT_LABEL="com.xbloom.bean-to-bloom-bridge"
XBLOOM_PACKAGE="${XBLOOM_PACKAGE:-com.xbloom.tbdx}"
DISK_WARN_PCT="${XBLOOM_DISK_WARN_PCT:-80}"
DISK_CRIT_PCT="${XBLOOM_DISK_CRIT_PCT:-90}"
LOAD_WARN_RATIO="${XBLOOM_LOAD_WARN_RATIO:-2}"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
ADB_BIN="${ANDROID_HOME}/platform-tools/adb"

# Source shared helpers (portable _run_timed, Appium-session detection).
[[ -f "$SCRIPT_DIR/bridge-supervisor.sh" ]] && source "$SCRIPT_DIR/bridge-supervisor.sh"
[[ -f "$SCRIPT_DIR/bridge-watchdog.sh" ]]  && source "$SCRIPT_DIR/bridge-watchdog.sh"

# ------------------------------------------------------------------
# Once-per-Kuwait-day gate (protects against RunAtLoad double-runs)
# ------------------------------------------------------------------
_kwt_today() { TZ=Asia/Kuwait date +%Y-%m-%d 2>/dev/null || date +%Y-%m-%d; }

mkdir -p "$RUNTIME_DIR/audit"
chmod 700 "$RUNTIME_DIR" "$RUNTIME_DIR/audit"

check_already_ran_today() {
  mkdir -p "$(dirname "$GATE_FILE")"
  if [[ "${XBLOOM_AUDIT_FORCE:-0}" != "1" ]]; then
    local hour; hour=$(TZ=Asia/Kuwait date +%H 2>/dev/null || date +%H)
    if [[ "$hour" -lt 8 ]]; then
      echo "[audit] Before 08:00 KWT; waiting for the scheduled run" >&2
      exit 0
    fi
  fi
  if [[ "${XBLOOM_AUDIT_FORCE:-0}" != "1" && -f "$GATE_FILE" ]]; then
    local last; last=$(cat "$GATE_FILE" 2>/dev/null || echo "")
    if [[ "$last" == "$(_kwt_today)" ]]; then
      echo "[audit] Already ran today ($last KWT); skipping" >&2
      exit 0
    fi
  fi
}
check_already_ran_today

# ------------------------------------------------------------------
# Atomic lock via mkdir (POSIX guarantee; stale-PID recovery)
# ------------------------------------------------------------------
LOCK_OWNED=false
TIMEOUT_PID=""

cleanup() {
  if [[ -n "$TIMEOUT_PID" ]]; then kill "$TIMEOUT_PID" 2>/dev/null || true; fi
  if [[ "$LOCK_OWNED" == true ]] && [[ "$(cat "$LOCK_FILE" 2>/dev/null || true)" == "$$" ]]; then
    rm -f "$LOCK_FILE"
    rmdir "$LOCK_DIR" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT
trap 'cleanup; exit 124' TERM

acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "$$" > "$LOCK_FILE"; chmod 600 "$LOCK_FILE"; LOCK_OWNED=true; return 0
  fi
  local old_pid; old_pid=$(cat "$LOCK_FILE" 2>/dev/null || echo "")
  if [[ -n "$old_pid" ]] && kill -0 "$old_pid" 2>/dev/null; then
    echo "[audit] Already running (pid $old_pid); skipping" >&2; exit 0
  fi
  # Stale lock — clean and retry once
  rm -f "$LOCK_FILE"; rmdir "$LOCK_DIR" 2>/dev/null || true
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "$$" > "$LOCK_FILE"; chmod 600 "$LOCK_FILE"; LOCK_OWNED=true; return 0
  fi
  echo "[audit] Cannot acquire lock; skipping" >&2; exit 0
}
acquire_lock

# ------------------------------------------------------------------
# Setup: report paths and global timeout, only after owning the lock.
# ------------------------------------------------------------------
mkdir -p "$REPORT_DIR"
chmod 700 "$REPORT_DIR"

START_TS=$(date -u +%Y%m%dT%H%M%SZ)
START_EPOCH=$(date +%s)
JSON_REPORT="$REPORT_DIR/audit-$START_TS.json"
TEXT_REPORT="$REPORT_DIR/audit-$START_TS.txt"
touch "$JSON_REPORT" "$TEXT_REPORT"
chmod 600 "$JSON_REPORT" "$TEXT_REPORT"

(
  sleep "$GLOBAL_TIMEOUT_SEC"
  kill -TERM "$$" 2>/dev/null || true
) </dev/null >/dev/null 2>&1 &
TIMEOUT_PID=$!

# ------------------------------------------------------------------
# Check result accumulators
# bash 3.2 (macOS default) does not support declare -A; use flat
# variables via printf -v / ${!varname} indirect expansion instead.
# ------------------------------------------------------------------
OVERALL="healthy"
ISSUES=""   # space-separated
BRIDGE_PID=""

# Ordered list of check keys (used for export loop and text report)
CHECK_KEYS="bridge_launchagent bridge_health adb_transport android_boot \
            emulator_network host_network appium xbloom_app prerequisites \
            keychain disk_space host_load recent_errors cloud_health"

set_check() {
  local name="$1" status="$2" detail="${3:-}"
  # printf -v for safe indirect assignment (bash 3.1+)
  printf -v "CHECK_STATUS_${name}" '%s' "$status"
  printf -v "CHECK_DETAIL_${name}" '%s' "$detail"
  if [[ "$status" == "failed" ]]; then
    OVERALL="failed"
    ISSUES="${ISSUES:+$ISSUES }$name"
  elif [[ "$status" == "warning" && "$OVERALL" != "failed" ]]; then
    OVERALL="degraded"
    ISSUES="${ISSUES:+$ISSUES }$name"
  fi
}

_check_status() { local v="CHECK_STATUS_${1}"; printf '%s' "${!v:-unknown}"; }
_check_detail() { local v="CHECK_DETAIL_${1}"; printf '%s' "${!v:-}"; }

# Emit a JSON-safe double-quoted string.
json_str() {
  python3 -c "import json,sys; print(json.dumps(sys.stdin.read().rstrip('\n')))" <<< "$1"
}

# ------------------------------------------------------------------
# 1. Bridge LaunchAgent
# ------------------------------------------------------------------
check_bridge_launchagent() {
  local info pid state
  info=$(launchctl list "$BRIDGE_AGENT_LABEL" 2>/dev/null || echo "")
  if [[ -z "$info" ]]; then
    set_check bridge_launchagent warning '"loaded":false,"running":false'; return
  fi
  pid=$(awk '/"PID"/ {gsub(/[^0-9]/,"",$3); print $3}' <<< "$info")
  state=$(awk '/"LastExitStatus"/ {gsub(/[^0-9-]/,"",$3); print $3}' <<< "$info")
  if [[ -n "$pid" && "$pid" -gt 0 ]]; then
    BRIDGE_PID="$pid"
    set_check bridge_launchagent ok "\"loaded\":true,\"running\":true,\"pid\":$pid"
  else
    set_check bridge_launchagent warning "\"loaded\":true,\"running\":false,\"last_exit\":${state:-null}"
  fi
}

# ------------------------------------------------------------------
# 2. Local /health endpoint
# ------------------------------------------------------------------
check_bridge_health() {
  local body
  body=$(curl --silent --fail --max-time 5 "http://127.0.0.1:${BRIDGE_PORT}/health" 2>/dev/null || echo "")
  if [[ -z "$body" ]]; then
    set_check bridge_health failed '"reachable":false'; return
  fi
  local ok; ok=$(python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(str(d.get('ok',False)).lower())" \
                <<< "$body" 2>/dev/null || echo "false")
  if [[ "$ok" == "true" ]]; then
    set_check bridge_health ok '"reachable":true,"ok":true'
  else
    set_check bridge_health warning '"reachable":true,"ok":false'
  fi
}

# ------------------------------------------------------------------
# 3+4. ADB transport and Android boot (explicit emulator-5554 serial)
# ------------------------------------------------------------------
check_adb_and_boot() {
  if [[ ! -x "$ADB_BIN" ]]; then
    set_check adb_transport failed '"status":"adb_missing"'
    set_check android_boot  failed '"status":"adb_missing"'
    return
  fi
  local state
  state=$(_run_timed "$ADB_PROBE_TIMEOUT" "$ADB_BIN" -s emulator-5554 get-state 2>/dev/null || echo "")
  if [[ "$state" != "device" ]]; then
    set_check adb_transport warning "\"status\":$(json_str "${state:-offline}")"
    set_check android_boot  warning '"status":"transport_unavailable"'
    return
  fi
  set_check adb_transport ok '"status":"device"'
  local booted
  booted=$(_run_timed "$ADB_PROBE_TIMEOUT" "$ADB_BIN" -s emulator-5554 \
           shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || echo "")
  if [[ "$booted" == "1" ]]; then
    set_check android_boot ok '"status":"complete"'
  else
    set_check android_boot warning '"status":"incomplete"'
  fi
}

# ------------------------------------------------------------------
# 5. xBloom-host DNS/TCP reachability from Android
# ------------------------------------------------------------------
check_emulator_network() {
  if [[ ! -x "$ADB_BIN" ]]; then
    set_check emulator_network warning '"status":"adb_missing"'; return
  fi
  local hosts="${XBLOOM_API_HOSTS:-client-api.xbloom.com,backend-api.xbloom.com}"
  local failed_host=""
  for host in ${hosts//,/ }; do
    if ! _run_timed 12 "$ADB_BIN" -s emulator-5554 shell toybox nc -z -w 4 "$host" 443 \
         >/dev/null 2>&1; then
      failed_host="$host"; break
    fi
  done
  if [[ -z "$failed_host" ]]; then
    set_check emulator_network ok '"status":"ok"'
  else
    set_check emulator_network failed "\"status\":\"unreachable\",\"failed_host\":$(json_str "$failed_host")"
  fi
}

# ------------------------------------------------------------------
# 5b. Host-side xBloom reachability. This distinguishes an emulator-only DNS
# fault from a wider upstream or Mac network outage.
# ------------------------------------------------------------------
check_host_network() {
  local hosts="${XBLOOM_API_HOSTS:-client-api.xbloom.com,backend-api.xbloom.com}"
  local failed_host=""
  for host in ${hosts//,/ }; do
    if ! _run_timed 8 nc -z -w 4 "$host" 443 >/dev/null 2>&1; then
      failed_host="$host"; break
    fi
  done
  if [[ -z "$failed_host" ]]; then
    set_check host_network ok '"status":"ok"'
  else
    set_check host_network warning "\"status\":\"unreachable\",\"failed_host\":$(json_str "$failed_host")"
  fi
}

# ------------------------------------------------------------------
# 6. Appium
# ------------------------------------------------------------------
check_appium() {
  local body
  body=$(curl --silent --fail --max-time 5 "http://127.0.0.1:${APPIUM_PORT}/status" 2>/dev/null || echo "")
  if [[ -z "$body" ]]; then
    set_check appium warning '"reachable":false'
  else
    set_check appium ok '"reachable":true'
  fi
}

# ------------------------------------------------------------------
# 7. xBloom app presence and version (explicit emulator-5554 serial)
# ------------------------------------------------------------------
check_xbloom_app() {
  if [[ ! -x "$ADB_BIN" ]]; then
    set_check xbloom_app warning '"status":"adb_missing"'; return
  fi
  local installed
  installed=$(_run_timed "$ADB_PROBE_TIMEOUT" "$ADB_BIN" -s emulator-5554 \
              shell pm list packages 2>/dev/null | grep -c "$XBLOOM_PACKAGE" || true)
  if [[ "${installed:-0}" -ge 1 ]]; then
    local ver
    ver=$(_run_timed "$ADB_PROBE_TIMEOUT" "$ADB_BIN" -s emulator-5554 \
          shell dumpsys package "$XBLOOM_PACKAGE" 2>/dev/null \
          | awk -F= '/versionName/{print $2; exit}' | tr -d '\r' || echo "")
    set_check xbloom_app ok "\"status\":\"installed\",\"version\":$(json_str "${ver:-unknown}")"
  else
    set_check xbloom_app warning '"status":"absent"'
  fi
}

# ------------------------------------------------------------------
# 7b. Local runtime prerequisites (presence only; no installation or changes).
# ------------------------------------------------------------------
check_prerequisites() {
  local node_ok=false appium_ok=false avd_ok=false driver_ok=false
  command -v node >/dev/null 2>&1 && node_ok=true
  command -v appium >/dev/null 2>&1 && appium_ok=true
  [[ -d "$HOME/.android/avd/${XBLOOM_AVD_NAME:-xBloom_Pixel8_API35}.avd" ]] && avd_ok=true
  if [[ "$appium_ok" == true ]] && \
     _run_timed 15 appium driver list --installed 2>/dev/null | grep -q 'uiautomator2@'; then
    driver_ok=true
  fi
  if [[ "$node_ok" == true && "$appium_ok" == true && "$avd_ok" == true && "$driver_ok" == true ]]; then
    set_check prerequisites ok '"node":true,"appium":true,"uiautomator2":true,"avd":true'
  else
    set_check prerequisites warning "\"node\":$node_ok,\"appium\":$appium_ok,\"uiautomator2\":$driver_ok,\"avd\":$avd_ok"
  fi
}

# ------------------------------------------------------------------
# 7c. Bridge credential presence only. Never read or print its value.
# ------------------------------------------------------------------
check_keychain() {
  if security find-generic-password -a bridge -s "xBloom Bean to Bloom Bridge Token" >/dev/null 2>&1; then
    set_check keychain ok '"present":true'
  else
    set_check keychain warning '"present":false'
  fi
}

# ------------------------------------------------------------------
# 8. Disk space
# ------------------------------------------------------------------
check_disk_space() {
  local used_pct
  used_pct=$(df / | awk 'NR==2{gsub(/%/,"",$5); print $5}')
  local status="ok"
  if   [[ "$used_pct" -ge "$DISK_CRIT_PCT" ]]; then status="failed"
  elif [[ "$used_pct" -ge "$DISK_WARN_PCT"  ]]; then status="warning"
  fi
  set_check disk_space "$status" "\"used_pct\":$used_pct"
}

# ------------------------------------------------------------------
# 9. Host load (no memory or log data in the report)
# ------------------------------------------------------------------
check_host_load() {
  local ncpu load1 load_ratio status
  # LaunchAgents use a deliberately small PATH. Use the macOS absolute path so
  # this diagnostic cannot terminate the entire audit with command-not-found.
  ncpu=$(/usr/sbin/sysctl -n hw.logicalcpu 2>/dev/null || echo 1)
  load1=$(/usr/sbin/sysctl -n vm.loadavg 2>/dev/null | awk '{print $2}' || true)
  ncpu="${ncpu:-1}"
  load1="${load1:-0}"
  load_ratio=$(python3 -c "print(round(float('$load1')/int('$ncpu'),2))" 2>/dev/null || echo 0)
  status="ok"
  python3 -c "exit(0 if float('$load1')/int('$ncpu') < $LOAD_WARN_RATIO else 1)" 2>/dev/null \
    || status="warning"
  set_check host_load "$status" "\"load1\":$load1,\"ncpu\":$ncpu,\"load_ratio\":$load_ratio"
}

# ------------------------------------------------------------------
# 10. Recent bridge error count (never includes raw log content)
# ------------------------------------------------------------------
check_recent_errors() {
  local error_count=0 file count
  for file in "$RUNTIME_DIR/stderr.log" "$RUNTIME_DIR/appium.log" "$RUNTIME_DIR/emulator.log"; do
    [[ -f "$file" ]] || continue
    count=$(tail -n 2000 "$file" 2>/dev/null | grep -cEi \
      'did not finish booting|network check failed|SHARE_LINK_FAILED|ECONNREFUSED|error|fatal|exception|crash' || true)
    error_count=$(( error_count + ${count:-0} ))
  done
  if [[ "$error_count" -gt 0 ]]; then
    set_check recent_errors warning "\"count\":$error_count"
  else
    set_check recent_errors ok '"count":0'
  fi
}

# ------------------------------------------------------------------
# 11. Public Cloudflare /health (read-only; no cloud mutation)
# ------------------------------------------------------------------
check_cloud_health() {
  if [[ -z "$CLOUD_WORKER_URL" ]]; then
    set_check cloud_health ok '"status":"unconfigured"'; return
  fi
  local body
  body=$(curl --silent --fail --max-time 10 "${CLOUD_WORKER_URL}/health" 2>/dev/null || echo "")
  if [[ -z "$body" ]]; then
    set_check cloud_health warning '"status":"unreachable"'
  else
    set_check cloud_health ok '"status":"ok"'
  fi
}

# ------------------------------------------------------------------
# Run all checks
# ------------------------------------------------------------------
check_bridge_launchagent
check_bridge_health
check_adb_and_boot
check_emulator_network
check_host_network
check_appium
check_xbloom_app
check_prerequisites
check_keychain
check_disk_space
check_host_load
check_recent_errors
check_cloud_health

# ------------------------------------------------------------------
# Auto-repair: kickstart bridge only when confirmed down and no active
# Appium session exists.  Two probes required; never waits for boot.
# Never touches cloud endpoints, D1, jobs, recipes, or queue claims.
# ------------------------------------------------------------------
REPAIR_ATTEMPTED=false
REPAIR_RESULT=""

attempt_repair() {
  local la_status; la_status=$(_check_status bridge_launchagent)
  local health_status; health_status=$(_check_status bridge_health)
  if [[ "$la_status" == "ok" && "$health_status" == "ok" ]]; then return; fi
  if [[ "${XBLOOM_AUDIT_REPAIR:-1}" != "1" ]]; then
    REPAIR_RESULT="disabled"; return
  fi

  # Second probe after a brief pause (avoids acting on a transient hiccup)
  sleep 3
  local body2
  body2=$(curl --silent --fail --max-time 5 "http://127.0.0.1:${BRIDGE_PORT}/health" 2>/dev/null || echo "")
  if [[ -n "$body2" ]]; then REPAIR_RESULT="false_alarm"; return; fi

  if [[ "$(_check_status host_network)" != "ok" ]]; then
    REPAIR_RESULT="skipped_host_network"; return
  fi

  # A newly launched supervisor may legitimately spend up to 15 minutes
  # booting Android. Do not reset that progress; only intervene after 20 min.
  if [[ "$la_status" == "ok" && -n "$BRIDGE_PID" ]]; then
    local elapsed elapsed_seconds
    elapsed=$(ps -p "$BRIDGE_PID" -o etime= 2>/dev/null | tr -d ' ' || true)
    elapsed_seconds=$(python3 - "$elapsed" <<'PYELAPSED'
import sys
s=sys.argv[1].strip()
days=0
if '-' in s:
    d,s=s.split('-',1); days=int(d)
parts=[int(x) for x in s.split(':') if x]
seconds=days*86400
if len(parts)==3:
    seconds+=parts[0]*3600+parts[1]*60+parts[2]
elif len(parts)==2:
    seconds+=parts[0]*60+parts[1]
elif len(parts)==1:
    seconds+=parts[0]
print(seconds)
PYELAPSED
)
    if [[ "${elapsed_seconds:-0}" -lt 1200 ]]; then
      REPAIR_RESULT="skipped_boot_in_progress"; return
    fi
  fi

  # Guard: never interrupt an active Appium automation session
  local session_rc=0
  has_active_uiautomator2_session 2>/dev/null || session_rc=$?
  if [[ "$session_rc" -eq 0 ]]; then
    REPAIR_RESULT="skipped_active_session"; return
  elif [[ "$session_rc" -eq 2 ]]; then
    REPAIR_RESULT="skipped_session_state_unknown"; return
  fi

  REPAIR_ATTEMPTED=true
  echo "[audit] Auto-repair: kickstarting ${BRIDGE_AGENT_LABEL}" >&2
  # kickstart -k atomically stops any running instance then starts fresh.
  # Emulator boot takes up to 15 min; we report repair_pending rather than
  # blocking the audit waiting for the bridge to become healthy.
  if launchctl kickstart -k "gui/$UID/$BRIDGE_AGENT_LABEL" 2>/dev/null; then
    REPAIR_RESULT="repair_pending"
  else
    REPAIR_RESULT="kickstart_failed"
  fi
}
attempt_repair

# ------------------------------------------------------------------
# Assemble and write reports
# ------------------------------------------------------------------
END_EPOCH=$(date +%s)
DURATION=$(( END_EPOCH - START_EPOCH ))

build_json_report() {
  python3 - <<PYEOF
import json, os

def ev(name, default=''):
    return os.environ.get(name, default)

check_names = [
    'bridge_launchagent','bridge_health','adb_transport','android_boot',
    'emulator_network','host_network','appium','xbloom_app','prerequisites','keychain','disk_space',
    'host_load','recent_errors','cloud_health',
]
checks = {}
for k in check_names:
    status = ev(f'AUDIT_CHECK_{k}_STATUS', 'unknown')
    detail_raw = ev(f'AUDIT_CHECK_{k}_DETAIL', '')
    try:
        detail = json.loads('{' + detail_raw + '}') if detail_raw else {}
    except Exception:
        detail = {}
    # A detail payload may describe the observed state using a legacy
    # "status" field. The normalized audit status must remain authoritative.
    checks[k] = {**detail, 'status': status}

repair_result = ev('AUDIT_REPAIR_RESULT') or None
report = {
    'timestamp':        ev('AUDIT_TS'),
    'version':          '1',
    'duration_sec':     int(ev('AUDIT_DURATION', '0')),
    'overall':          ev('AUDIT_OVERALL', 'unknown'),
    'checks':           checks,
    'repair_attempted': ev('AUDIT_REPAIR_ATTEMPTED', 'false').lower() == 'true',
    'repair_result':    repair_result,
}
print(json.dumps(report, indent=2))
PYEOF
}

export AUDIT_TS="$START_TS" AUDIT_DURATION="$DURATION"
export AUDIT_OVERALL="$OVERALL"
export AUDIT_REPAIR_ATTEMPTED="$REPAIR_ATTEMPTED"
export AUDIT_REPAIR_RESULT="$REPAIR_RESULT"
for key in $CHECK_KEYS; do
  export "AUDIT_CHECK_${key}_STATUS=$(_check_status "$key")"
  export "AUDIT_CHECK_${key}_DETAIL=$(_check_detail "$key")"
done

build_json_report > "$JSON_REPORT"

{
  echo "xBloom Bridge Audit — $START_TS"
  echo "Overall: $OVERALL  (duration: ${DURATION}s)"
  echo "---"
  for key in $CHECK_KEYS; do
    printf "  %-24s %s\n" "$key" "$(_check_status "$key")"
    _dt=$(_check_detail "$key")
    [[ -n "$_dt" ]] && printf "    %s\n" "$_dt"
  done
  echo "---"
  echo "Repair attempted: $REPAIR_ATTEMPTED  result: ${REPAIR_RESULT:-none}"
  [[ -n "$ISSUES" ]] && echo "Issues: $ISSUES"
} > "$TEXT_REPORT"

# Keep an atomic latest snapshot and a compact, non-sensitive history.
cp "$JSON_REPORT" "${LATEST_REPORT}.tmp"
chmod 600 "${LATEST_REPORT}.tmp"
mv "${LATEST_REPORT}.tmp" "$LATEST_REPORT"
python3 - "$JSON_REPORT" >> "$HISTORY_FILE" <<'PYHISTORY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as fh:
    report = json.load(fh)
print(json.dumps({
    "timestamp": report.get("timestamp"),
    "overall": report.get("overall"),
    "repair_attempted": report.get("repair_attempted", False),
    "repair_result": report.get("repair_result"),
}, separators=(",", ":")))
PYHISTORY
chmod 600 "$HISTORY_FILE"

# Mark today so RunAtLoad double-runs are skipped
echo "$(_kwt_today)" > "$GATE_FILE"
chmod 600 "$GATE_FILE"

# Prune reports older than retention period
find "$REPORT_DIR" -type f -mtime "+${REPORT_RETENTION_DAYS}" -delete 2>/dev/null || true

echo "[audit] Complete: $OVERALL — reports in $REPORT_DIR" >&2

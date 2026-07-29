#!/usr/bin/env bash
# Supervisor helper functions for the xBloom bridge stack.
# Sourced by run-stack.sh. All functions are pure and independently testable.
# Never modifies AVD data, wipes storage, or alters xBloom login state.

# ─── Portable bounded execution ───────────────────────────────────────────────
# macOS ships without GNU coreutils; fall back to a Python 3 shim so every
# adb probe has a hard upper bound on wall time.

if command -v timeout >/dev/null 2>&1; then
  _run_timed() { timeout "$@"; }
elif command -v gtimeout >/dev/null 2>&1; then
  _run_timed() { gtimeout "$@"; }
else
  # Python 3 is guaranteed on modern macOS.  We use Popen + start_new_session
  # so the child runs as its own process-group leader; on timeout we kill the
  # entire group (catching any bash children like `sleep`) and exit 124 to
  # match GNU timeout behaviour.  subprocess.run(timeout=) alone leaves those
  # grandchildren alive and holding the stdout pipe, stalling the caller.
  _run_timed() {
    local _secs="$1"; shift
    python3 - "$_secs" "$@" <<'PYTIMED'
import subprocess, sys, os, signal
secs = float(sys.argv[1])
cmd  = sys.argv[2:]
try:
    proc = subprocess.Popen(cmd, start_new_session=True)
    proc.wait(timeout=secs)
    sys.exit(proc.returncode)
except subprocess.TimeoutExpired:
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except OSError:
        pass
    proc.wait()
    sys.exit(124)
except Exception as exc:
    print(exc, file=sys.stderr)
    sys.exit(1)
PYTIMED
  }
fi

# Hard timeout (seconds) for a single adb probe to prevent indefinite blocking.
ADB_PROBE_TIMEOUT_SEC="${ADB_PROBE_TIMEOUT_SEC:-10}"
ADB_SERIAL="${XBLOOM_ADB_SERIAL:-emulator-5554}"

# Return 0 if sys.boot_completed == 1 within ADB_PROBE_TIMEOUT_SEC.
adb_boot_completed() {
  local result
  result=$(_run_timed "$ADB_PROBE_TIMEOUT_SEC" adb -s "$ADB_SERIAL" shell getprop sys.boot_completed \
           2>/dev/null | tr -d '\r') || true
  [[ "$result" == "1" ]]
}

# Print device, present, absent, or unknown from a successful adb device list.
# Offline/unauthorized still means the emulator exists. A failed or timed-out
# listing is unknown and must fail closed.
adb_serial_state() {
  local output rc=0 transport
  output=$(_run_timed "$ADB_PROBE_TIMEOUT_SEC" adb devices -l 2>/dev/null) || rc=$?
  if [[ "$rc" -ne 0 ]]; then echo unknown; return; fi
  transport=$(awk -v serial="$ADB_SERIAL" '$1 == serial {print $2; exit}' <<<"$output")
  if [[ "$transport" == "device" ]]; then
    echo device
  elif [[ -n "$transport" ]]; then
    echo present
  else
    echo absent
  fi
}

# Return 0 only when adb positively reports a ready device.
adb_get_state_ok() {
  [[ "$(adb_serial_state)" == "device" ]]
}

# Send emu kill, optionally signal a known emulator PID, then block until the
# device vanishes from adb or max_wait_sec elapses.  Never wipes AVD data.
# Usage: stop_emulator_and_wait [max_wait_sec [serial [emulator_pid]]]
stop_emulator_and_wait() {
  local max_wait="${1:-60}"
  local serial="${2:-emulator-5554}"
  local epid="${3:-}"

  echo "Stopping emulator ${serial} (max wait ${max_wait}s)…" >&2
  _run_timed 5 adb -s "$serial" emu kill >/dev/null 2>&1 || true
  if [[ -n "$epid" ]] && kill -0 "$epid" 2>/dev/null; then
    kill "$epid" 2>/dev/null || true
  fi

  local deadline=$(( $(date +%s) + max_wait ))
  while [[ $(date +%s) -lt $deadline ]]; do
    local adb_state pid_alive=0
    ADB_SERIAL="$serial" adb_state=$(adb_serial_state)
    [[ -n "$epid" ]] && kill -0 "$epid" 2>/dev/null && pid_alive=1
    if [[ "$adb_state" == "absent" && "$pid_alive" -eq 0 ]]; then
      echo "Emulator gone from ADB." >&2
      return 0
    fi
    sleep 2
  done
  if [[ -n "$epid" ]] && kill -0 "$epid" 2>/dev/null; then
    kill -KILL "$epid" 2>/dev/null || true
  fi
  echo "Emulator did not fully stop within ${max_wait}s; waiting for positive shutdown confirmation." >&2

  # Production defaults to waiting indefinitely rather than allowing launchd
  # to start a second QEMU against the same AVD. Tests may set a finite limit.
  local confirm_timeout="${XBLOOM_STOP_CONFIRM_TIMEOUT_SEC:-0}"
  local confirm_deadline=0
  if [[ "$confirm_timeout" -gt 0 ]]; then
    confirm_deadline=$(( $(date +%s) + confirm_timeout ))
  fi
  while true; do
    local confirm_state confirm_pid_alive=0
    ADB_SERIAL="$serial" confirm_state=$(adb_serial_state)
    [[ -n "$epid" ]] && kill -0 "$epid" 2>/dev/null && confirm_pid_alive=1
    if [[ "$confirm_state" == "absent" && "$confirm_pid_alive" -eq 0 ]]; then
      echo "Emulator shutdown confirmed." >&2
      return 0
    fi
    if [[ "$confirm_deadline" -gt 0 && $(date +%s) -ge "$confirm_deadline" ]]; then
      echo "Emulator shutdown remains unconfirmed." >&2
      return 1
    fi
    sleep 2
  done
}

# ─── Persistent boot-failure backoff ──────────────────────────────────────────
# Counts are stored in a file that survives launchd restarts.
# Reset to 0 after a healthy boot so a single hiccup does not compound.

_boot_failures_file() {
  printf '%s/boot-failures' "${XBLOOM_RUNTIME_DIR:-$HOME/.codex/xbloom-bridge}"
}

read_boot_failures() {
  local file; file=$(_boot_failures_file)
  if [[ ! -f "$file" ]]; then echo 0; return; fi
  local n; n=$(cat "$file" 2>/dev/null || echo "")
  if [[ "$n" =~ ^[0-9]+$ ]]; then echo "$n"; else echo 0; fi
}

write_boot_failures() {
  local file; file=$(_boot_failures_file)
  printf '%d\n' "${1:-0}" > "$file"
  chmod 600 "$file"
}

reset_boot_failures() {
  rm -f "$(_boot_failures_file)"
}

# Cooldown in seconds for N consecutive boot failures.
# 0→0s  1→30s  2→60s  3→120s  4→240s  5+→300s (hard cap)
compute_boot_backoff_sec() {
  local failures="${1:-0}"
  if [[ "$failures" -le 0 ]]; then echo 0; return; fi
  if [[ "$failures" -ge 5 ]]; then echo 300; return; fi
  local delay=$(( 30 * (1 << (failures - 1)) ))
  echo "$delay"
}

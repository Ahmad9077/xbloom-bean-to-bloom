#!/usr/bin/env bash

# True only for an active UiAutomator2 forward belonging to this emulator.
# Appium may choose any free system port in 8200..8299; the device-side
# UiAutomator2 server always listens on 6790.

# _run_timed is defined by bridge-supervisor.sh when sourced from run-stack.sh.
# Provide a self-contained fallback so this file can be sourced independently.
if ! declare -f _run_timed >/dev/null 2>&1; then
  if command -v timeout >/dev/null 2>&1; then
    _run_timed() { timeout "$@"; }
  elif command -v gtimeout >/dev/null 2>&1; then
    _run_timed() { gtimeout "$@"; }
  else
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
fi

has_active_uiautomator2_session() {
  local forwards="${1:-}"
  if [[ -z "$forwards" ]]; then
    if ! forwards="$(_run_timed "${ADB_PROBE_TIMEOUT_SEC:-10}" adb forward --list 2>/dev/null)"; then
      # Unknown is intentionally distinct from "no active session". Callers
      # must fail closed and defer recovery when ADB cannot be inspected.
      return 2
    fi
  fi

  awk '
    $1 == "emulator-5554" && $2 ~ /^tcp:82[0-9][0-9]$/ && $3 == "tcp:6790" {
      found = 1
    }
    END { exit(found ? 0 : 1) }
  ' <<<"$forwards"
}

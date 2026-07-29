#!/usr/bin/env bash
# Durable xBloom bridge stack: emulator + Appium + cloud queue poller.
set -euo pipefail

cd "$(dirname "$0")"

source ./lib/bridge-supervisor.sh
source ./lib/bridge-watchdog.sh

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator"

if [[ -z "${BRIDGE_TOKEN:-}" ]]; then
  BRIDGE_TOKEN="$(security find-generic-password -a bridge -s "xBloom Bean to Bloom Bridge Token" -w)"
  export BRIDGE_TOKEN
fi

AVD_NAME="${XBLOOM_AVD_NAME:-xBloom_Pixel8_API35}"
XBLOOM_DNS_SERVERS="${XBLOOM_DNS_SERVERS:-1.1.1.1,8.8.8.8}"
XBLOOM_API_HOSTS="${XBLOOM_API_HOSTS:-client-api.xbloom.com,backend-api.xbloom.com}"
export XBLOOM_API_HOSTS

# Maximum seconds to wait for the emulator to finish booting (default: 15 min).
XBLOOM_BOOT_TIMEOUT_SEC="${XBLOOM_BOOT_TIMEOUT_SEC:-900}"

RUNTIME_DIR="${XBLOOM_RUNTIME_DIR:-$HOME/.codex/xbloom-bridge}"
export XBLOOM_RUNTIME_DIR="$RUNTIME_DIR"
mkdir -p "$RUNTIME_DIR"
chmod 700 "$RUNTIME_DIR"

rotate_log() {
  local file="$1"
  local max_bytes=$((10 * 1024 * 1024))
  if [[ -f "$file" ]] && [[ "$(stat -f %z "$file" 2>/dev/null || echo 0)" -gt "$max_bytes" ]]; then
    rm -f "${file}.1"
    mv "$file" "${file}.1"
  fi
}

rotate_log "$RUNTIME_DIR/appium.log"
rotate_log "$RUNTIME_DIR/emulator.log"

ensure_appium_uiautomator2_driver() {
  if ! command -v appium >/dev/null 2>&1; then
    echo "Appium CLI is not installed or not in PATH" >&2
    exit 1
  fi

  if appium driver list --installed 2>&1 | grep -q "uiautomator2@"; then
    return
  fi

  echo "Appium UiAutomator2 driver missing; installing official driver..." >&2
  if ! appium driver install uiautomator2 >>"$RUNTIME_DIR/appium.log" 2>&1; then
    echo "Failed to install Appium UiAutomator2 driver" >&2
    exit 1
  fi

  if ! appium driver list --installed 2>&1 | grep -q "uiautomator2@"; then
    echo "Appium UiAutomator2 driver still unavailable after install" >&2
    exit 1
  fi
}

ensure_appium_uiautomator2_driver

emulator_pid=""
appium_pid=""
service_pid=""
watchdog_pid=""
cleanup_done=false

cleanup() {
  [[ "$cleanup_done" == true ]] && return
  cleanup_done=true
  if [[ -n "$service_pid" ]]; then kill "$service_pid" 2>/dev/null || true; fi
  if [[ -n "$watchdog_pid" ]]; then kill "$watchdog_pid" 2>/dev/null || true; fi
  if [[ -n "$appium_pid" ]]; then kill "$appium_pid" 2>/dev/null || true; fi
  if [[ -n "$emulator_pid" ]] && kill -0 "$emulator_pid" 2>/dev/null; then
    stop_emulator_and_wait 45 "emulator-5554" "$emulator_pid" || true
  fi
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

start_emulator() {
  emulator -avd "$AVD_NAME" -no-window -no-audio -no-boot-anim \
    -no-snapshot-load -no-snapshot-save -gpu auto -dns-server "$XBLOOM_DNS_SERVERS" \
    >>"$RUNTIME_DIR/emulator.log" 2>&1 &
  emulator_pid="$!"
}

find_existing_emulator_pid() {
  pgrep -f "qemu-system.* -avd ${AVD_NAME}( |$)" 2>/dev/null | head -1 || true
}

# Adopt an already-running QEMU even if ADB is still offline or has not yet
# registered the serial. This prevents a second process from opening the AVD.
emulator_pid="$(find_existing_emulator_pid)"

# Apply persistent backoff before touching the emulator so launchd restart
# storms from consecutive boot failures decelerate automatically.
_failures=$(read_boot_failures)
_backoff=$(compute_boot_backoff_sec "$_failures")
if [[ "$_backoff" -gt 0 ]]; then
  echo "Boot-failure backoff: waiting ${_backoff}s after ${_failures} consecutive failure(s)" >&2
  sleep "$_backoff"
fi

_adb_state=$(adb_serial_state)
if [[ -z "$emulator_pid" && "$_adb_state" == "absent" ]]; then
  start_emulator
fi

# Wait for Android to finish booting.  Each adb probe is bounded by
# ADB_PROBE_TIMEOUT_SEC so a hung adb cannot stall the whole boot window.
boot_deadline=$(( $(date +%s) + XBLOOM_BOOT_TIMEOUT_SEC ))
while [[ $(date +%s) -lt $boot_deadline ]]; do
  if adb_boot_completed; then
    break
  fi
  # A fast launchd restart can briefly observe the previous supervisor's
  # emulator before it finishes shutting down. Take ownership of a replacement
  # rather than waiting until timeout with no emulator process.
  if { [[ -z "$emulator_pid" ]] || ! kill -0 "$emulator_pid" 2>/dev/null; }; then
    emulator_pid="$(find_existing_emulator_pid)"
    if [[ -z "$emulator_pid" && "$(adb_serial_state)" == "absent" ]]; then
      start_emulator
    fi
  fi
  sleep 2
done

if ! adb_boot_completed; then
  echo "Android emulator did not finish booting within ${XBLOOM_BOOT_TIMEOUT_SEC}s" >&2
  _new_failures=$(( _failures + 1 ))
  write_boot_failures "$_new_failures"
  echo "Recording boot failure #${_new_failures}; next backoff: $(compute_boot_backoff_sec "$_new_failures")s" >&2
  stop_emulator_and_wait 60 "emulator-5554" "${emulator_pid:-}"
  exit 1
fi

# Healthy boot: reset the persistent failure counter so transient failures
# do not compound into an ever-growing cooldown.
reset_boot_failures

xbloom_network_ready() {
  local host
  local hosts="${XBLOOM_API_HOSTS//,/ }"
  for host in $hosts; do
    # _run_timed 12 bounds the adb shell command; nc -w 4 bounds the TCP probe itself.
    if ! _run_timed 12 adb -s emulator-5554 shell toybox nc -z -w 4 "$host" 443 >/dev/null 2>&1; then
      return 1
    fi
  done
  return 0
}

# Do not start the queue poller until DNS and TCP work from inside Android.
# This catches a stale emulator DNS forwarder before a cloud job can be claimed.
for _ in {1..12}; do
  if xbloom_network_ready; then break; fi
  sleep 5
done

if ! xbloom_network_ready; then
  echo "Android emulator cannot reach the xBloom API; restarting the stack" >&2
  stop_emulator_and_wait 60 "emulator-5554" "${emulator_pid:-}"
  exit 1
fi

if ! curl --silent --fail --max-time 5 http://127.0.0.1:4723/status >/dev/null 2>&1; then
  appium --address 127.0.0.1 --port 4723 >>"$RUNTIME_DIR/appium.log" 2>&1 &
  appium_pid="$!"
fi

for _ in {1..30}; do
  if curl --silent --fail --max-time 5 http://127.0.0.1:4723/status >/dev/null 2>&1; then break; fi
  sleep 1
done

if ! curl --silent --fail --max-time 5 http://127.0.0.1:4723/status >/dev/null 2>&1; then
  echo "Appium did not become ready" >&2
  exit 1
fi

NODE_BIN="${XBLOOM_NODE_BIN:-}"
if [[ -z "$NODE_BIN" ]] && [[ -x /opt/homebrew/opt/node@22/bin/node ]] && \
   /opt/homebrew/opt/node@22/bin/node --version >/dev/null 2>&1; then
  NODE_BIN=/opt/homebrew/opt/node@22/bin/node
fi
NODE_BIN="${NODE_BIN:-$(command -v node)}"

"$NODE_BIN" --import tsx/esm --env-file .env src/server.ts &
service_pid="$!"

# The virtual DNS proxy can become stale after host network changes.  Two
# consecutive failures trigger a supervised cold restart, but never while an
# Appium session is active.  launchd then starts the stack with fresh DNS.
# Each adb probe inside the watchdog is bounded by ADB_PROBE_TIMEOUT_SEC.
(
  failures=0
  while kill -0 "$service_pid" 2>/dev/null; do
    sleep 60
    if xbloom_network_ready; then
      failures=0
      continue
    fi
    failures=$((failures + 1))
    echo "xBloom emulator network check failed ($failures/2)" >&2
    if [[ "$failures" -ge 2 ]]; then
      session_rc=0
      has_active_uiautomator2_session || session_rc=$?
      if [[ "$session_rc" -eq 2 ]]; then
        echo "Could not verify Appium session state; deferring DNS recovery" >&2
        continue
      fi
      if [[ "$session_rc" -eq 1 ]]; then
        echo "Restarting bridge stack to recover emulator DNS" >&2
        # Wait for the emulator to fully vanish so launchd cannot overlap
        # this instance with the replacement started on the next launch.
        stop_emulator_and_wait 60 "emulator-5554" "$emulator_pid"
        kill "$service_pid" 2>/dev/null || true
        break
      fi
    fi
  done
) &
watchdog_pid="$!"
wait "$service_pid"

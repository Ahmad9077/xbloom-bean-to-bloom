#!/usr/bin/env bash
# Durable xBloom bridge stack: emulator + Appium + cloud queue poller.
set -euo pipefail

cd "$(dirname "$0")"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator"

if [[ -z "${BRIDGE_TOKEN:-}" ]]; then
  BRIDGE_TOKEN="$(security find-generic-password -a bridge -s "xBloom Bean to Bloom Bridge Token" -w)"
  export BRIDGE_TOKEN
fi

AVD_NAME="${XBLOOM_AVD_NAME:-xBloom_Pixel8_API35}"
RUNTIME_DIR="${XBLOOM_RUNTIME_DIR:-$HOME/.codex/xbloom-bridge}"
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

cleanup() {
  if [[ -n "$service_pid" ]]; then kill "$service_pid" 2>/dev/null || true; fi
  if [[ -n "$appium_pid" ]]; then kill "$appium_pid" 2>/dev/null || true; fi
  if [[ -n "$emulator_pid" ]]; then kill "$emulator_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT INT TERM

start_emulator() {
  emulator -avd "$AVD_NAME" -no-window -no-audio -no-boot-anim -no-snapshot-save \
    -gpu swiftshader_indirect \
    >>"$RUNTIME_DIR/emulator.log" 2>&1 &
  emulator_pid="$!"
}

if ! adb get-state >/dev/null 2>&1; then
  start_emulator
fi

for _ in {1..90}; do
  if [[ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]; then
    break
  fi
  # A fast launchd restart can briefly observe the previous supervisor's
  # emulator before that supervisor finishes shutting it down. If it vanishes
  # during this boot window, take ownership of a replacement instead of waiting
  # until timeout with no emulator process.
  if ! adb get-state >/dev/null 2>&1 && \
     { [[ -z "$emulator_pid" ]] || ! kill -0 "$emulator_pid" 2>/dev/null; }; then
    start_emulator
  fi
  sleep 2
done

if [[ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" != "1" ]]; then
  echo "Android emulator did not finish booting" >&2
  exit 1
fi

if ! curl --silent --fail http://127.0.0.1:4723/status >/dev/null 2>&1; then
  appium --address 127.0.0.1 --port 4723 >>"$RUNTIME_DIR/appium.log" 2>&1 &
  appium_pid="$!"
fi

for _ in {1..30}; do
  if curl --silent --fail http://127.0.0.1:4723/status >/dev/null 2>&1; then break; fi
  sleep 1
done

if ! curl --silent --fail http://127.0.0.1:4723/status >/dev/null 2>&1; then
  echo "Appium did not become ready" >&2
  exit 1
fi

node --import tsx/esm --env-file .env src/server.ts &
service_pid="$!"
wait "$service_pid"

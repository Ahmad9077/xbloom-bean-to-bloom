#!/usr/bin/env bash

# True only for an active UiAutomator2 forward belonging to this emulator.
# Appium may choose any free system port in 8200..8299; the device-side
# UiAutomator2 server always listens on 6790.
has_active_uiautomator2_session() {
  local forwards="${1:-}"
  if [[ -z "$forwards" ]]; then
    forwards="$(adb forward --list 2>/dev/null || true)"
  fi

  awk '
    $1 == "emulator-5554" && $2 ~ /^tcp:82[0-9][0-9]$/ && $3 == "tcp:6790" {
      found = 1
    }
    END { exit(found ? 0 : 1) }
  ' <<<"$forwards"
}

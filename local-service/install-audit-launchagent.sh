#!/usr/bin/env bash
# Install the xBloom bridge audit LaunchAgent.
# Copies bridge-audit.sh to the runtime app directory, writes a resolved plist
# into ~/Library/LaunchAgents/, and sets safe permissions.
# Does NOT load the agent — run `launchctl load` yourself after reviewing.
# Does NOT wipe data, modify cloud state, or alter xBloom login.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="$SCRIPT_DIR/lib/com.xbloom.bean-to-bloom-audit.plist"
AUDIT_SRC="$SCRIPT_DIR/lib/bridge-audit.sh"
WATCHDOG_SRC="$SCRIPT_DIR/lib/bridge-watchdog.sh"
SUPERVISOR_SRC="$SCRIPT_DIR/lib/bridge-supervisor.sh"

RUNTIME_DIR="${XBLOOM_RUNTIME_DIR:-$HOME/.codex/xbloom-bridge}"
APP_DIR="$RUNTIME_DIR/app"
LIB_DIR="$APP_DIR/lib"
AUDIT_DEST="$LIB_DIR/bridge-audit.sh"
PLIST_LABEL="com.xbloom.bean-to-bloom-daily-audit"
PLIST_DEST="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
ANDROID_HOME_DEFAULT="$HOME/Library/Android/sdk"
ANDROID_HOME_RESOLVED="${ANDROID_HOME:-$ANDROID_HOME_DEFAULT}"

# --- Pre-flight checks --------------------------------------------------------
if [[ ! -f "$TEMPLATE" ]]; then
  echo "ERROR: plist template not found: $TEMPLATE" >&2; exit 1
fi
if [[ ! -f "$AUDIT_SRC" ]]; then
  echo "ERROR: audit script not found: $AUDIT_SRC" >&2; exit 1
fi
if [[ "$EUID" -eq 0 ]]; then
  echo "ERROR: do not run this installer as root; run as the Mac user account" >&2; exit 1
fi

echo "Installing xBloom bridge audit LaunchAgent…"
echo "  Audit script → $AUDIT_DEST"
echo "  LaunchAgent  → $PLIST_DEST"
echo "  Runtime dir  → $RUNTIME_DIR"
echo ""

# --- Create directories -------------------------------------------------------
mkdir -p "$LIB_DIR" "$RUNTIME_DIR/audit" "$RUNTIME_DIR/audit/reports"
chmod 700 "$RUNTIME_DIR" "$RUNTIME_DIR/audit" "$RUNTIME_DIR/audit/reports"

# --- Copy scripts -------------------------------------------------------------
install -m 700 "$AUDIT_SRC"     "$AUDIT_DEST"
install -m 600 "$WATCHDOG_SRC"  "$LIB_DIR/bridge-watchdog.sh"
install -m 600 "$SUPERVISOR_SRC" "$LIB_DIR/bridge-supervisor.sh"

# --- Write resolved plist -----------------------------------------------------
sed \
  -e "s|AUDIT_SCRIPT_PATH|${AUDIT_DEST}|g" \
  -e "s|USER_HOME|${HOME}|g" \
  -e "s|ANDROID_HOME_PATH|${ANDROID_HOME_RESOLVED}|g" \
  -e "s|XBLOOM_RUNTIME_PATH|${RUNTIME_DIR}|g" \
  "$TEMPLATE" > "$PLIST_DEST"
chmod 644 "$PLIST_DEST"

echo "Done.  To activate the daily 08:00 audit run:"
echo ""
echo "  launchctl load -w \"$PLIST_DEST\""
echo ""
echo "To run the audit immediately:"
echo ""
echo "  launchctl start $PLIST_LABEL"
echo ""
echo "To uninstall:"
echo ""
echo "  launchctl unload -w \"$PLIST_DEST\""
echo "  rm \"$PLIST_DEST\""

#!/usr/bin/env bash
# Start the xBloom local Appium service.
# Prerequisites: Node 20+, Appium 3 running on 127.0.0.1:4723, emulator-5554 online.
# Appium is NOT started by this script; start it separately before running.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "[run.sh] Installing dependencies..."
  npm install
fi

if [ ! -f .env ]; then
  echo "[run.sh] No .env found — copying .env.example"
  cp .env.example .env
fi

# Read PORT from .env for the startup message only (no shell evaluation of values)
_port=$(grep -m1 '^PORT=' .env 2>/dev/null | cut -d'=' -f2- || true)
echo "[run.sh] Starting service on http://127.0.0.1:${_port:-3999}"

# --env-file loads key=value pairs from .env without shell evaluation
exec node --import tsx/esm --env-file .env src/server.ts

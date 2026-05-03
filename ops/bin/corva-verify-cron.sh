#!/bin/bash
# Wrapper for scheduled Corva verify+repair pass. Invoked by launchd
# (~/Library/LaunchAgents/com.edmund.corva.verify.plist) weekly.
# Runs with --repair so disk drift gets fixed automatically.
# Logs go to ops/logs/corva-verify.{out,err}.log.

set -e
NODE_BIN="/Users/edmundmitchell/.local/share/fnm/node-versions/v24.15.0/installation/bin"
export PATH="$NODE_BIN:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

echo "===== $(date) — corva-verify --repair ====="
exec "$NODE_BIN/node" /Users/edmundmitchell/factory/dashboard/scripts/corva-verify.mjs --repair

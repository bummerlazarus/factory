#!/bin/bash
# Wrapper for scheduled Corva proposal pass. Invoked by launchd
# (~/Library/LaunchAgents/com.edmund.corva.propose.plist) nightly.
# Logs go to ops/logs/corva-propose.{out,err}.log.

set -e
NODE_BIN="/Users/edmundmitchell/.local/share/fnm/node-versions/v24.15.0/installation/bin"
export PATH="$NODE_BIN:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

echo "===== $(date) — corva-propose ====="
exec "$NODE_BIN/node" /Users/edmundmitchell/factory/dashboard/scripts/corva-propose.mjs

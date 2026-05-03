#!/bin/bash
# Always-running dashboard wrapper. Invoked by launchd
# (~/Library/LaunchAgents/com.edmund.dashboard.plist). Keeps `npm run dev`
# alive on localhost:3000 so the dashboard is always there when Edmund opens
# his browser. Logs to ops/logs/dashboard.{out,err}.log.

set -e

# fnm-managed node (v24.15.0). Hardcoded so launchd doesn't need fnm env.
NODE_BIN="/Users/edmundmitchell/.local/share/fnm/node-versions/v24.15.0/installation/bin"
export PATH="$NODE_BIN:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

cd /Users/edmundmitchell/factory/dashboard
exec "$NODE_BIN/npm" run dev

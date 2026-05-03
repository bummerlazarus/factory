# Dashboard launchd autostart

**Date:** 2026-05-03 (existed before this session; documented here)
**Status:** Active. Maps to `ops/focus.md` priority #1 (dashboard as primary surface).

## What's running

A launchd agent keeps `npm run dev` alive on `localhost:3000`. Starts on login, restarts on crash, throttles at 10s between restarts so it can't loop hot.

| Piece | Where |
|---|---|
| Plist | `~/Library/LaunchAgents/com.edmund.dashboard.plist` |
| Wrapper script | `ops/bin/dashboard-dev.sh` (hardcodes fnm node v24.15.0 PATH) |
| Stdout log | `ops/logs/dashboard.out.log` |
| Stderr log | `ops/logs/dashboard.err.log` |
| Service label | `com.edmund.dashboard` |

## Daily commands

```bash
# Is it alive?
curl -sI http://localhost:3000 | head -1
launchctl list | grep com.edmund.dashboard
# Tail logs
tail -f /Users/edmundmitchell/factory/ops/logs/dashboard.out.log
```

## Maintenance

```bash
# Restart (e.g. after pulling new code)
launchctl unload ~/Library/LaunchAgents/com.edmund.dashboard.plist
launchctl load ~/Library/LaunchAgents/com.edmund.dashboard.plist

# Stop (until next reboot or load)
launchctl unload ~/Library/LaunchAgents/com.edmund.dashboard.plist

# Permanent off
launchctl unload ~/Library/LaunchAgents/com.edmund.dashboard.plist
rm ~/Library/LaunchAgents/com.edmund.dashboard.plist
```

## Gotchas

- **Node version is hardcoded** in `dashboard-dev.sh` (`/Users/edmundmitchell/.local/share/fnm/node-versions/v24.15.0/...`). When you upgrade node via fnm, also edit that file or the service breaks silently.
- **`.env.local` must exist in `dashboard/`** at launch time — launchd doesn't see your shell env. Missing keys show up as 500s in `dashboard.err.log`.
- **Logs grow unbounded.** `ops/logs/dashboard.out.log` was 17KB after one day; rotate manually or add `newsyslog` if it gets noisy.
- **Hot reload still works** — launchd just keeps the process alive. Editing files in `dashboard/` triggers Next.js HMR as normal.

## How to verify after a reboot

1. Reboot.
2. Log in.
3. Wait ~30s.
4. `curl -I http://localhost:3000` → expect `HTTP/1.1 200 OK`.

If it doesn't come up: check `ops/logs/dashboard.err.log` for the failure reason (usually a missing env var or a node-path break).

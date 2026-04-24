#!/usr/bin/env bash
# ingest-youtube.sh — fetch a YouTube transcript via yt-dlp and POST directly
# to the youtube-ingest Edge Function. Bypasses the MCP tool to avoid pushing
# ~100KB of transcript text through Claude's context.
#
# Usage:
#   ingest-youtube.sh <youtube-url> [--force] [--tags tag1,tag2]

set -euo pipefail

URL="${1:?usage: ingest-youtube.sh <youtube-url> [--force] [--tags t1,t2]}"
shift || true

FORCE="false"
TAGS='["youtube"]'
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force) FORCE="true"; shift ;;
    --tags)  TAGS="$(echo "$2" | jq -R 'split(",")')"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# Load env
ENV_FILE="${FACTORY_ENV:-/Users/edmundmitchell/factory/ops/.env}"
[[ -f "$ENV_FILE" ]] || { echo "env file not found: $ENV_FILE" >&2; exit 1; }
# shellcheck disable=SC1090
source "$ENV_FILE"
: "${SUPABASE_URL:?missing in env}"
: "${CAPTURE_SECRET:?missing in env}"

# Extract video id
VIDEO_ID="$(python3 -c "
import sys, urllib.parse as up
u = up.urlparse('$URL')
q = up.parse_qs(u.query)
if 'v' in q: print(q['v'][0])
else: print(u.path.strip('/').split('/')[-1])
")"
echo "video_id: $VIDEO_ID"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Title + channel
META="$(yt-dlp --print "%(title)s|||%(channel)s" "$URL" 2>/dev/null)"
TITLE="${META%%|||*}"
CHANNEL="${META##*|||}"
echo "title:    $TITLE"
echo "channel:  $CHANNEL"

# Transcript
cd "$WORK"
yt-dlp --write-auto-sub --skip-download --sub-langs en \
  --output "t" "$URL" >/dev/null 2>&1 || {
  yt-dlp --write-sub --skip-download --sub-langs en --output "t" "$URL" >/dev/null 2>&1
}
VTT="$(ls t.*.vtt 2>/dev/null | head -n1 || true)"
[[ -n "$VTT" ]] || { echo "no subtitles available" >&2; exit 1; }

# Dedupe VTT → plain text (preserves speaking order)
python3 - "$VTT" > transcript.txt <<'PY'
import sys, re
seen = set()
with open(sys.argv[1]) as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith(("WEBVTT","Kind:","Language:")) or "-->" in line:
            continue
        clean = re.sub("<[^>]*>", "", line)
        clean = clean.replace("&amp;","&").replace("&gt;",">").replace("&lt;","<")
        if clean and clean not in seen:
            seen.add(clean)
            print(clean)
PY

CHARS="$(wc -c < transcript.txt | tr -d ' ')"
echo "transcript: ${CHARS} chars"

# POST
jq -n \
  --arg url "$URL" \
  --arg title "$TITLE" \
  --arg channel "$CHANNEL" \
  --rawfile transcript transcript.txt \
  --argjson tags "$TAGS" \
  --argjson force "$FORCE" \
  '{video_url:$url, title:$title, channel_name:$channel, transcript:$transcript, transcript_format:"text", force:$force, tags:$tags}' \
  | curl -sS -X POST \
      -H "x-capture-secret: $CAPTURE_SECRET" \
      -H "Content-Type: application/json" \
      --data-binary @- \
      "$SUPABASE_URL/functions/v1/youtube-ingest" \
  | jq '{video_id, title, channel_name, chunks_written, warnings}'

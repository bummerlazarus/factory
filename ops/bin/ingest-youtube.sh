#!/usr/bin/env bash
# ingest-youtube.sh — fetch a YouTube transcript via yt-dlp and POST directly
# to the youtube-ingest Edge Function. Bypasses the MCP tool to avoid pushing
# ~100KB of transcript text through Claude's context.
#
# Every invocation writes a row to public.ingest_runs (migration 017) so
# failures are visible in seconds:
#   SELECT started_at, status, source_title, items_processed, error_message
#   FROM public.ingest_runs ORDER BY started_at DESC LIMIT 20;
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
: "${SUPABASE_SERVICE_ROLE_KEY:?missing in env (needed for ingest_runs logging)}"

# === ingest_runs visibility ===========================================
RUN_ID="$(uuidgen | tr 'A-Z' 'a-z')"
SB_HEADERS=(
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY"
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
  -H "Content-Type: application/json"
  -H "Prefer: return=minimal"
)

run_insert() {
  jq -n --arg id "$RUN_ID" --arg url "$URL" --argjson tags "$TAGS" \
    '{id:$id, source_type:"youtube", source_url:$url, status:"running", tags:$tags}' \
  | curl -sS -X POST "${SB_HEADERS[@]}" --data-binary @- \
      "$SUPABASE_URL/rest/v1/ingest_runs" >/dev/null || true
}

run_update() {
  # $1 = status, $2 = items_processed (number or empty), $3 = error_message (or empty)
  jq -n --arg s "$1" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        --arg ip "${2:-}" --arg err "${3:-}" \
    '{status:$s, finished_at:$ts}
       + (if $ip == "" then {} else {items_processed:($ip|tonumber)} end)
       + (if $err == "" then {} else {error_message:$err} end)' \
  | curl -sS -X PATCH "${SB_HEADERS[@]}" --data-binary @- \
      "$SUPABASE_URL/rest/v1/ingest_runs?id=eq.$RUN_ID" >/dev/null || true
}

run_patch_meta() {
  jq -n --arg t "$TITLE" --arg v "$VIDEO_ID" --arg c "$CHANNEL" \
    '{source_title:$t, metadata:{video_id:$v, channel:$c}}' \
  | curl -sS -X PATCH "${SB_HEADERS[@]}" --data-binary @- \
      "$SUPABASE_URL/rest/v1/ingest_runs?id=eq.$RUN_ID" >/dev/null || true
}

on_error() {
  local rc=$?
  run_update failed "" "script exited (rc=$rc) at line $LINENO"
  echo "run_id: $RUN_ID  status: failed (see public.ingest_runs)" >&2
}
trap on_error ERR

run_insert
echo "run_id:   $RUN_ID"

# === Extract video id =================================================
VIDEO_ID="$(python3 -c "
import sys, urllib.parse as up
u = up.urlparse('$URL')
q = up.parse_qs(u.query)
if 'v' in q: print(q['v'][0])
else: print(u.path.strip('/').split('/')[-1])
")"
echo "video_id: $VIDEO_ID"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT  # cleanup runs after on_error/ERR

# === Title + channel ==================================================
META="$(yt-dlp --print "%(title)s|||%(channel)s" "$URL" 2>/dev/null)"
TITLE="${META%%|||*}"
CHANNEL="${META##*|||}"
echo "title:    $TITLE"
echo "channel:  $CHANNEL"
run_patch_meta

# === Transcript =======================================================
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

# === POST to Edge Function ============================================
RESP="$(jq -n \
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
      "$SUPABASE_URL/functions/v1/youtube-ingest")"

CHUNKS="$(echo "$RESP" | jq -r '.chunks_written // 0')"
ERROR_FIELD="$(echo "$RESP" | jq -r '.error // empty')"

if [[ -n "$ERROR_FIELD" ]]; then
  run_update failed "$CHUNKS" "$ERROR_FIELD"
  echo "$RESP" | jq
  echo "run_id: $RUN_ID  status: failed" >&2
  exit 1
fi

run_update succeeded "$CHUNKS" ""
echo "$RESP" | jq '{video_id, title, channel_name, chunks_written, warnings}'
echo "run_id: $RUN_ID  status: succeeded  chunks: $CHUNKS"

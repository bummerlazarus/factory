#!/usr/bin/env bash
# ingest-youtube-scribe.sh — transcribe a YouTube video via ElevenLabs Scribe v2
# (diarization + audio events) and POST the speaker-labeled transcript to the
# youtube-ingest Edge Function for chunking + embedding into public.memory.
#
# Better than ingest-youtube.sh when:
#   - YouTube auto-captions are missing, broken, or low quality
#   - You want speaker labels (interviews, multi-speaker podcasts)
#   - yt-dlp is broken by recent YouTube bot-detection / signature changes
#
# Cost: ~$0.22/hour of audio. Sync API call; long videos take a few minutes.
#
# Every invocation writes a row to public.ingest_runs (source_type='youtube-scribe').
#   SELECT started_at, status, source_title, items_processed, error_message
#   FROM public.ingest_runs ORDER BY started_at DESC LIMIT 20;
#
# Saved artifacts:
#   /tmp/scribe-<run_id>/response.json   — full Scribe response (words + timestamps)
#   /tmp/scribe-<run_id>/transcript.md   — speaker-turn-collapsed readable transcript
#   These are NOT auto-promoted to Content Workspace — promote manually after review.
#
# Usage:
#   ingest-youtube-scribe.sh <youtube-url> [--force] [--tags t1,t2] [--no-diarize]

set -euo pipefail

URL="${1:?usage: ingest-youtube-scribe.sh <youtube-url> [--force] [--tags t1,t2] [--no-diarize]}"
shift || true

FORCE="false"
TAGS='["youtube","scribe"]'
DIARIZE="true"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)       FORCE="true"; shift ;;
    --tags)        TAGS="$(echo "$2" | jq -R 'split(",")')"; shift 2 ;;
    --no-diarize)  DIARIZE="false"; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# === env =============================================================
ENV_FILE="${FACTORY_ENV:-/Users/edmundmitchell/factory/ops/.env}"
[[ -f "$ENV_FILE" ]] || { echo "env file not found: $ENV_FILE" >&2; exit 1; }
# shellcheck disable=SC1090
source "$ENV_FILE"
: "${SUPABASE_URL:?missing in env}"
: "${SUPABASE_SERVICE_ROLE_KEY:?missing in env (needed for ingest_runs logging)}"
: "${CAPTURE_SECRET:?missing in env}"
: "${ELEVENLABS_API_KEY:?missing in env}"

# === ingest_runs tracking ============================================
RUN_ID="$(uuidgen | tr 'A-Z' 'a-z')"
WORK="/tmp/scribe-$RUN_ID"
mkdir -p "$WORK"

SB_HEADERS=(
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY"
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
  -H "Content-Type: application/json"
  -H "Prefer: return=minimal"
)

# sb_call <method> <path> <payload-json> — POST/PATCH to Supabase REST.
# Echoes body, exits non-zero with a loud error if HTTP != 2xx.
sb_call() {
  local method="$1" path="$2" payload="$3" out http
  out="$(mktemp)"
  http="$(printf '%s' "$payload" | curl -sS -w "%{http_code}" -o "$out" \
    -X "$method" "${SB_HEADERS[@]}" --data-binary @- \
    "$SUPABASE_URL$path")"
  if [[ ! "$http" =~ ^2 ]]; then
    echo "ingest_runs ${method} ${path} failed: HTTP=$http body=$(cat "$out" | head -c 600)" >&2
    rm -f "$out"
    return 1
  fi
  rm -f "$out"
  return 0
}

run_insert() {
  local payload
  payload="$(jq -n --arg id "$RUN_ID" --arg url "$URL" --argjson tags "$TAGS" \
    '{id:$id, source_type:"youtube-scribe", source_url:$url, status:"running", tags:$tags}')"
  sb_call POST "/rest/v1/ingest_runs" "$payload"
}

run_update() {
  # $1 = status, $2 = items_processed (number or empty), $3 = error_message (or empty)
  local payload
  payload="$(jq -n --arg s "$1" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        --arg ip "${2:-}" --arg err "${3:-}" \
    '{status:$s, finished_at:$ts}
       + (if $ip == "" then {} else {items_processed:($ip|tonumber)} end)
       + (if $err == "" then {} else {error_message:$err} end)')"
  sb_call PATCH "/rest/v1/ingest_runs?id=eq.$RUN_ID" "$payload" || true
}

run_patch_meta() {
  local payload
  payload="$(jq -n --arg t "$TITLE" --arg v "$VIDEO_ID" --arg c "$CHANNEL" \
        --arg dur "$DURATION_SECS" --arg cost "$COST_USD" \
    '{source_title:$t,
      metadata:{
        video_id:$v, channel:$c,
        duration_secs:($dur|tonumber? // null),
        scribe_cost_usd:($cost|tonumber? // null),
        scribe_model:"scribe_v2"
      }}')"
  sb_call PATCH "/rest/v1/ingest_runs?id=eq.$RUN_ID" "$payload" || true
}

on_error() {
  local rc=$?
  run_update failed "" "script exited (rc=$rc) at line $LINENO"
  echo "run_id: $RUN_ID  status: failed (see public.ingest_runs)" >&2
}
trap on_error ERR

run_insert
echo "run_id:    $RUN_ID"
echo "work_dir:  $WORK"

# === Extract video id ================================================
VIDEO_ID="$(python3 -c '
import sys, urllib.parse as up
u = up.urlparse(sys.argv[1])
q = up.parse_qs(u.query)
print(q["v"][0] if "v" in q else u.path.strip("/").split("/")[-1])
' "$URL")"
echo "video_id:  $VIDEO_ID"

# === Title + channel (best-effort via yt-dlp metadata only) ==========
# We don't need captions here, just metadata. yt-dlp metadata calls are usually
# unaffected by the signature/n-challenge breakage that kills caption fetches.
TITLE="Unknown"
CHANNEL="Unknown"
if META="$(yt-dlp --print "%(title)s|||%(channel)s" "$URL" 2>/dev/null)"; then
  TITLE="${META%%|||*}"
  CHANNEL="${META##*|||}"
fi
echo "title:     $TITLE"
echo "channel:   $CHANNEL"

# === Scribe ===========================================================
echo "scribe:    POST /v1/speech-to-text (this can take several minutes for long audio)..."
SCRIBE_HTTP="$(curl -sS -w "%{http_code}" -o "$WORK/response.json" --max-time 1800 \
  -X POST "https://api.elevenlabs.io/v1/speech-to-text" \
  -H "xi-api-key: $ELEVENLABS_API_KEY" \
  -F "model_id=scribe_v2" \
  -F "source_url=$URL" \
  -F "diarize=$DIARIZE" \
  -F "tag_audio_events=true" \
  -F "timestamps_granularity=word")"

if [[ "$SCRIBE_HTTP" != "200" ]]; then
  ERR_BODY="$(cat "$WORK/response.json" 2>/dev/null | head -c 600)"
  run_update failed "" "scribe http=$SCRIBE_HTTP body=$ERR_BODY"
  echo "scribe error: http=$SCRIBE_HTTP" >&2
  echo "$ERR_BODY" >&2
  exit 1
fi

DURATION_SECS="$(jq -r '.audio_duration_secs // 0' "$WORK/response.json")"
COST_USD="$(awk -v d="$DURATION_SECS" 'BEGIN{ printf "%.4f", d/3600*0.22 }')"
NUM_WORDS="$(jq -r '.words | length' "$WORK/response.json")"
NUM_SPEAKERS="$(jq -r '[.words[]?.speaker_id] | unique | length' "$WORK/response.json")"
echo "scribe:    duration=${DURATION_SECS}s  words=${NUM_WORDS}  speakers=${NUM_SPEAKERS}  cost=\$${COST_USD}"

run_patch_meta

# === Build readable speaker-turn transcript ==========================
# Walks .words, collapses consecutive same-speaker into turns,
# emits "**[MM:SS · speaker_X]**\n\n<text>\n\n" blocks. Audio events stay
# inline but their parens-wrapped text marks them visually.
jq -r '
  def fmt_ts:
    . as $s
    | ($s | floor) as $i
    | "\($i / 60 | floor):\($i % 60 | tostring | if length==1 then "0"+. else . end)";
  .words
  | reduce .[] as $w (
      [];
      if (length == 0 or .[-1].speaker != $w.speaker_id)
      then . + [{speaker: $w.speaker_id, start: $w.start, text: $w.text}]
      else .[0:-1] + [(.[-1] + {text: (.[-1].text + $w.text)})]
      end)
  | .[]
  | "**[\(.start | fmt_ts) · \(.speaker)]**\n\n\(.text | gsub("^[ ]+|[ ]+$"; ""))\n"
' "$WORK/response.json" > "$WORK/transcript.md"

CHARS="$(wc -c < "$WORK/transcript.md" | tr -d ' ')"
echo "transcript: ${CHARS} chars saved to $WORK/transcript.md"

# === POST to youtube-ingest Edge Function ===========================
RESP="$(jq -n \
  --arg url "$URL" \
  --arg title "$TITLE" \
  --arg channel "$CHANNEL" \
  --rawfile transcript "$WORK/transcript.md" \
  --argjson tags "$TAGS" \
  --argjson force "$FORCE" \
  '{video_url:$url, title:$title, channel_name:$channel,
    transcript:$transcript, transcript_format:"text",
    force:$force, tags:$tags}' \
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
echo "run_id:    $RUN_ID  status: succeeded  chunks: $CHUNKS  cost: \$${COST_USD}"
echo "artifacts: $WORK/{response.json,transcript.md}"

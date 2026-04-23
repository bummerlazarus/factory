#!/usr/bin/env bash
# deploy-and-test-youtube.sh — One-shot deploy + MCP setup + test script.
#
# Runs end-to-end:
#  1. Install Supabase CLI (if missing)
#  2. Login to Supabase with PAT from ops/.env
#  3. Deploy youtube-ingest + youtube-ingest-mcp Edge Functions
#  4. Set function secrets (CAPTURE_SECRET, OPENAI_API_KEY, YOUTUBE_API_KEY)
#  5. Register youtube-ingest-mcp in Claude Code
#  6. Install yt-dlp + whisper (if missing)
#  7. Test ingestion on the 3 Edmund-provided videos
#
# Run from factory root:
#   bash ops/scripts/deploy-and-test-youtube.sh

set -euo pipefail

FACTORY_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$FACTORY_ROOT"

echo "═══════════════════════════════════════════════════════════════"
echo "  YouTube Ingest Tool — End-to-End Setup"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# ─────────────────────────────────────────────────────────────────
# Step 0: Load credentials
# ─────────────────────────────────────────────────────────────────
if [ ! -f "ops/.env" ]; then
  echo "❌ ops/.env not found. Create it from ops/.env.example first."
  exit 1
fi

echo "▶ Loading credentials from ops/.env"
set -a
# shellcheck disable=SC1091
source ops/.env
set +a

PROJECT_REF="${SUPABASE_PROJECT_REF:-obizmgugsqirmnjpirnh}"
SUPABASE_FN_URL="https://${PROJECT_REF}.supabase.co/functions/v1"

for var in SUPABASE_ACCESS_TOKEN CAPTURE_SECRET OPENAI_API_KEY; do
  if [ -z "${!var:-}" ]; then
    echo "❌ Missing $var in ops/.env"
    exit 1
  fi
done
echo "  ✓ All credentials loaded"
echo ""

# ─────────────────────────────────────────────────────────────────
# Step 1: Install Supabase CLI (if missing)
# ─────────────────────────────────────────────────────────────────
echo "▶ Checking Supabase CLI"
if ! command -v supabase >/dev/null 2>&1; then
  echo "  Installing Supabase CLI..."
  if command -v brew >/dev/null 2>&1; then
    brew install supabase/tap/supabase
  elif [[ "$(uname)" == "Linux" ]]; then
    curl -sSfL "https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.tar.gz" \
      -o /tmp/supabase.tar.gz
    tar -xzf /tmp/supabase.tar.gz -C /tmp supabase
    sudo mv /tmp/supabase /usr/local/bin/supabase
    sudo chmod +x /usr/local/bin/supabase
  else
    echo "❌ Please install Supabase CLI manually: https://supabase.com/docs/guides/cli"
    exit 1
  fi
fi
echo "  ✓ Supabase CLI: $(supabase --version)"
echo ""

# ─────────────────────────────────────────────────────────────────
# Step 2: Deploy Edge Functions
# ─────────────────────────────────────────────────────────────────
echo "▶ Deploying youtube-ingest Edge Function"
supabase functions deploy youtube-ingest \
  --project-ref "$PROJECT_REF" \
  --no-verify-jwt \
  --use-api
echo "  ✓ youtube-ingest deployed"
echo ""

echo "▶ Deploying youtube-ingest-mcp Edge Function"
supabase functions deploy youtube-ingest-mcp \
  --project-ref "$PROJECT_REF" \
  --no-verify-jwt \
  --use-api
echo "  ✓ youtube-ingest-mcp deployed"
echo ""

# ─────────────────────────────────────────────────────────────────
# Step 3: Set function secrets
# ─────────────────────────────────────────────────────────────────
echo "▶ Setting function secrets"
supabase secrets set \
  CAPTURE_SECRET="$CAPTURE_SECRET" \
  OPENAI_API_KEY="$OPENAI_API_KEY" \
  ${YOUTUBE_API_KEY:+YOUTUBE_API_KEY="$YOUTUBE_API_KEY"} \
  ${YOUTUBE_CHANNEL_ID:+YOUTUBE_CHANNEL_ID="$YOUTUBE_CHANNEL_ID"} \
  --project-ref "$PROJECT_REF"
echo "  ✓ Secrets configured"
echo ""

# ─────────────────────────────────────────────────────────────────
# Step 4: Sanity-check deployment
# ─────────────────────────────────────────────────────────────────
echo "▶ Sanity check: GET $SUPABASE_FN_URL/youtube-ingest-mcp"
response=$(curl -sS "$SUPABASE_FN_URL/youtube-ingest-mcp")
if echo "$response" | grep -q "youtube_ingest"; then
  echo "  ✓ MCP discovery endpoint live"
else
  echo "  ⚠ Unexpected discovery response: $response"
fi
echo ""

# ─────────────────────────────────────────────────────────────────
# Step 5: Register MCP in Claude Code
# ─────────────────────────────────────────────────────────────────
echo "▶ Registering youtube-ingest-mcp in Claude Code"
if command -v claude >/dev/null 2>&1; then
  # Remove any existing registration, ignore error if absent
  claude mcp remove youtube-ingest-mcp 2>/dev/null || true
  claude mcp add --transport http youtube-ingest-mcp \
    "$SUPABASE_FN_URL/youtube-ingest-mcp" \
    --header "Authorization: Bearer $CAPTURE_SECRET"
  echo "  ✓ MCP registered. Restart Claude Code to pick it up."
else
  echo "  ⚠ claude CLI not found. Register manually:"
  echo "    claude mcp add --transport http youtube-ingest-mcp \\"
  echo "      $SUPABASE_FN_URL/youtube-ingest-mcp \\"
  echo "      --header \"Authorization: Bearer \$CAPTURE_SECRET\""
fi
echo ""

# ─────────────────────────────────────────────────────────────────
# Step 6: Install script prerequisites
# ─────────────────────────────────────────────────────────────────
echo "▶ Checking companion-script prerequisites"

need_install=()
command -v yt-dlp  >/dev/null || need_install+=("yt-dlp")
command -v ffmpeg  >/dev/null || need_install+=("ffmpeg")
command -v whisper >/dev/null || need_install+=("openai-whisper")
command -v deno    >/dev/null || need_install+=("deno")

if [ ${#need_install[@]} -gt 0 ]; then
  echo "  Missing: ${need_install[*]}"
  echo "  Install manually, then re-run. E.g.:"
  echo "    brew install yt-dlp ffmpeg deno && pip install openai-whisper"
  echo ""
  echo "  (Skipping video tests — deploy succeeded.)"
  exit 0
fi
echo "  ✓ All prerequisites present"
echo ""

# ─────────────────────────────────────────────────────────────────
# Step 7: Test on Edmund's 3 videos
# ─────────────────────────────────────────────────────────────────
VIDEOS=(
  "https://youtu.be/s2eka_dWAxs"
  "https://www.youtube.com/live/dpZfNNYUZEc"
  "https://www.youtube.com/watch?v=5Iq0WLxLMfM"
)

echo "▶ Running 3 video ingest tests"
echo ""

for url in "${VIDEOS[@]}"; do
  echo "─── Ingesting: $url ───"
  deno run --allow-env --allow-run --allow-read --allow-write --allow-net \
    ops/scripts/ingest-youtube.ts "$url" || echo "  ⚠ Test failed for $url (continuing)"
  echo ""
done

echo "═══════════════════════════════════════════════════════════════"
echo "  Done. Verify in Supabase:"
echo ""
echo "  SELECT count(*) FROM memory"
echo "    WHERE source='youtube'"
echo "    AND metadata->>'video_id' IN ('s2eka_dWAxs','dpZfNNYUZEc','5Iq0WLxLMfM');"
echo "═══════════════════════════════════════════════════════════════"

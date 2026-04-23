#!/usr/bin/env -S deno run --allow-env --allow-run --allow-read --allow-write --allow-net

/**
 * ingest-youtube.ts — Companion script for YouTube ingest
 *
 * Two-phase YouTube ingestion:
 * 1. Fetch transcript (yt-dlp for captions, Whisper fallback for audio)
 * 2. POST to youtube-ingest Edge Function
 *
 * Usage:
 *   deno run --allow-env --allow-run --allow-read --allow-write --allow-net \
 *     ops/scripts/ingest-youtube.ts <youtube-url> [--force]
 *
 * Environment:
 *   SUPABASE_URL         — Supabase project URL
 *   CAPTURE_SECRET       — Auth token for youtube-ingest function
 *   OPENAI_API_KEY       — Optional, for embedding (passed to Edge Function)
 *   YOUTUBE_API_KEY      — Optional, for auto-metadata (passed to Edge Function)
 *   YOUTUBE_CHANNEL_ID   — Optional, for owned-video detection (passed to Edge Function)
 *
 * Requires:
 *   - yt-dlp (install via: pip install yt-dlp)
 *   - ffmpeg (for audio extraction)
 *   - Optional: whisper CLI (install via: pip install openai-whisper) for local transcription
 *
 * If Whisper CLI is unavailable, falls back to OpenAI API (requires OPENAI_API_KEY).
 */

interface TranscriptResult {
  source: "captions" | "whisper_local" | "whisper_api";
  text: string;
  language?: string;
  duration_seconds?: number;
}

interface YoutubeMetadata {
  video_id: string;
  title: string;
  channel_name: string;
  duration_seconds: number;
  url: string;
}

async function extractVideoId(youtubeUrl: string): Promise<string> {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/,
    /\/([a-zA-Z0-9_-]{11})(?:\?|$)/,
  ];

  for (const pattern of patterns) {
    const match = youtubeUrl.match(pattern);
    if (match) return match[1];
  }

  throw new Error(`Could not extract video ID from: ${youtubeUrl}`);
}

async function getYoutubeMetadata(videoId: string): Promise<YoutubeMetadata> {
  console.log(`[yt-dlp] Fetching metadata for ${videoId}...`);

  const proc = Deno.run({
    cmd: [
      "yt-dlp",
      "--no-warnings",
      "--quiet",
      "-j",
      `https://www.youtube.com/watch?v=${videoId}`,
    ],
    stdout: "piped",
    stderr: "piped",
  });

  const output = await proc.output();
  const result = await proc.status();

  if (!result.success) {
    const error = new TextDecoder().decode(await proc.stderrOutput());
    throw new Error(`yt-dlp failed: ${error}`);
  }

  const jsonData = JSON.parse(new TextDecoder().decode(output));

  return {
    video_id: videoId,
    title: jsonData.title || "Unknown",
    channel_name: jsonData.uploader || "Unknown",
    duration_seconds: jsonData.duration || 0,
    url: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

async function tryFetchCaptions(videoId: string): Promise<string | null> {
  console.log(`[yt-dlp] Trying to fetch captions for ${videoId}...`);

  const outputTemplate = `/tmp/yt_${videoId}`;

  const proc = Deno.run({
    cmd: [
      "yt-dlp",
      "--no-warnings",
      "--quiet",
      "--skip-download",
      "--write-auto-subs",
      "--write-subs",
      "--sub-langs",
      "en.*,en",
      "--sub-format",
      "vtt",
      "-o",
      outputTemplate,
      `https://www.youtube.com/watch?v=${videoId}`,
    ],
    stdout: "piped",
    stderr: "piped",
  });

  const result = await proc.status();

  if (!result.success) {
    console.log(`[yt-dlp] No captions found (will use Whisper fallback)`);
    return null;
  }

  // yt-dlp writes files like /tmp/yt_<id>.en.vtt or /tmp/yt_<id>.en-US.vtt
  let captionFile: string | null = null;
  for await (const entry of Deno.readDir("/tmp")) {
    if (entry.isFile && entry.name.startsWith(`yt_${videoId}.`) && entry.name.endsWith(".vtt")) {
      captionFile = `/tmp/${entry.name}`;
      break;
    }
  }

  if (!captionFile) {
    console.log(`[yt-dlp] Caption file not found, falling back to Whisper`);
    return null;
  }

  try {
    const captions = await Deno.readTextFile(captionFile);
    console.log(`[yt-dlp] ✓ Captions fetched from ${captionFile} (${captions.length} bytes)`);
    await Deno.remove(captionFile).catch(() => {});
    return captions;
  } catch {
    console.log(`[yt-dlp] Caption file unreadable, falling back to Whisper`);
    return null;
  }
}

async function downloadAudio(
  videoId: string
): Promise<{ path: string; duration: number }> {
  console.log(`[yt-dlp] Downloading audio for ${videoId}...`);

  const audioPath = `/tmp/yt_audio_${videoId}.m4a`;

  const proc = Deno.run({
    cmd: [
      "yt-dlp",
      "--no-warnings",
      "--quiet",
      "-f",
      "bestaudio[ext=m4a]/bestaudio",
      "-o",
      audioPath,
      `https://www.youtube.com/watch?v=${videoId}`,
    ],
    stdout: "piped",
    stderr: "piped",
  });

  const result = await proc.status();

  if (!result.success) {
    const error = new TextDecoder().decode(await proc.stderrOutput());
    throw new Error(`yt-dlp audio download failed: ${error}`);
  }

  // Get duration via ffprobe (part of ffmpeg)
  const ffprobe = Deno.run({
    cmd: [
      "ffprobe",
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1:nokey=1",
      audioPath,
    ],
    stdout: "piped",
  });

  const durationOutput = await ffprobe.output();
  const duration = parseFloat(new TextDecoder().decode(durationOutput)) || 0;

  console.log(
    `[yt-dlp] ✓ Audio downloaded (${duration.toFixed(1)}s, ~${audioPath})`
  );

  return { path: audioPath, duration };
}

async function transcribeWithWhisperLocal(audioPath: string): Promise<string> {
  console.log(`[Whisper] Transcribing locally (this may take a while)...`);

  const proc = Deno.run({
    cmd: [
      "whisper",
      audioPath,
      "--model",
      "base",
      "--output_format",
      "vtt",
      "--output_dir",
      "/tmp",
      "--quiet",
    ],
    stdout: "piped",
    stderr: "piped",
  });

  const result = await proc.status();

  if (!result.success) {
    const error = new TextDecoder().decode(await proc.stderrOutput());
    throw new Error(`Whisper transcription failed: ${error}`);
  }

  // Read the generated VTT file
  const baseName = audioPath.split("/").pop()?.split(".")[0];
  const vttPath = `/tmp/${baseName}.vtt`;

  const transcript = await Deno.readTextFile(vttPath).catch(() => {
    throw new Error(`Whisper VTT output not found at ${vttPath}`);
  });

  console.log(
    `[Whisper] ✓ Transcribed (${transcript.length} bytes, local model)`
  );

  // Cleanup
  await Deno.remove(vttPath).catch(() => {});
  await Deno.remove(audioPath).catch(() => {});

  return transcript;
}

async function transcribeWithWhisperAPI(
  audioPath: string,
  openaiKey: string
): Promise<string> {
  console.log(
    `[Whisper API] Transcribing via OpenAI (this may take a while)...`
  );

  const audioBuffer = await Deno.readFile(audioPath);
  const formData = new FormData();
  formData.append("file", new Blob([audioBuffer], { type: "audio/mp4" }), `audio_${Date.now()}.m4a`);
  formData.append("model", "whisper-1");
  formData.append("response_format", "vtt");

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Whisper API failed: ${response.status} ${error}`);
  }

  const transcript = await response.text();

  console.log(
    `[Whisper API] ✓ Transcribed (${transcript.length} bytes, OpenAI API)`
  );

  // Cleanup
  await Deno.remove(audioPath).catch(() => {});

  return transcript;
}

async function transcribeAudio(
  audioPath: string,
  openaiKey?: string
): Promise<TranscriptResult> {
  // Try local Whisper first
  try {
    const text = await transcribeWithWhisperLocal(audioPath);
    return { source: "whisper_local", text };
  } catch (error) {
    console.log(
      `[Whisper] Local transcription failed: ${error.message || error}`
    );
  }

  // Fall back to Whisper API
  if (!openaiKey) {
    throw new Error(
      "Local Whisper failed and OPENAI_API_KEY not set. Install Whisper CLI (pip install openai-whisper) or set OPENAI_API_KEY."
    );
  }

  const text = await transcribeWithWhisperAPI(audioPath, openaiKey);
  return { source: "whisper_api", text };
}

async function fetchTranscript(
  videoId: string,
  openaiKey?: string
): Promise<TranscriptResult> {
  // Try captions first
  const captions = await tryFetchCaptions(videoId);
  if (captions) {
    return { source: "captions", text: captions };
  }

  // Fall back to audio + Whisper
  console.log(`[Audio] Captions unavailable, using Whisper fallback...`);
  const { path: audioPath, duration } = await downloadAudio(videoId);
  const result = await transcribeAudio(audioPath, openaiKey);
  result.duration_seconds = duration;
  return result;
}

async function postToYoutubeIngest(
  videoId: string,
  metadata: YoutubeMetadata,
  transcript: string,
  supabaseUrl: string,
  captureSecret: string,
  force: boolean = false
): Promise<Record<string, unknown>> {
  console.log(`[POST] Sending to youtube-ingest Edge Function...`);

  const response = await fetch(
    `${supabaseUrl}/functions/v1/youtube-ingest`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-capture-secret": captureSecret,
      },
      body: JSON.stringify({
        video_id: videoId,
        title: metadata.title,
        channel_name: metadata.channel_name,
        transcript,
        transcript_format: "vtt",
        force,
        tags: ["from-script", "whisper-fallback"],
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`youtube-ingest failed: ${response.status} ${error}`);
  }

  const result = await response.json();
  console.log(
    `[POST] ✓ Ingested (${result.chunks_written} chunks, ${result.memory_ids?.length || 0} memory rows)`
  );

  return result;
}

async function main() {
  const args = Deno.args;

  if (args.length === 0) {
    console.error(`Usage: deno run ... ingest-youtube.ts <youtube-url> [--force]`);
    console.error(`Example: deno run ... ingest-youtube.ts "https://www.youtube.com/watch?v=dQw4w9WgXcQ"`);
    Deno.exit(1);
  }

  const youtubeUrl = args[0];
  const force = args.includes("--force");

  // Check environment
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const captureSecret = Deno.env.get("CAPTURE_SECRET");
  const openaiKey = Deno.env.get("OPENAI_API_KEY");

  if (!supabaseUrl || !captureSecret) {
    console.error(
      "Missing required env vars: SUPABASE_URL, CAPTURE_SECRET"
    );
    Deno.exit(1);
  }

  try {
    // Extract video ID
    const videoId = await extractVideoId(youtubeUrl);
    console.log(`[Start] Ingesting video: ${videoId}\n`);

    // Fetch metadata
    const metadata = await getYoutubeMetadata(videoId);
    console.log(
      `       Title: ${metadata.title}`
    );
    console.log(
      `       Channel: ${metadata.channel_name}`
    );
    console.log(
      `       Duration: ${(metadata.duration_seconds / 60).toFixed(1)}m\n`
    );

    // Fetch transcript (with Whisper fallback)
    const transcriptResult = await fetchTranscript(videoId, openaiKey);
    console.log(`       Transcript source: ${transcriptResult.source}\n`);

    // Post to Edge Function
    const ingestResult = await postToYoutubeIngest(
      videoId,
      metadata,
      transcriptResult.text,
      supabaseUrl,
      captureSecret,
      force
    );

    // Summary
    console.log(`\n[Success] YouTube ingest complete`);
    console.log(`  Video ID: ${ingestResult.video_id}`);
    console.log(`  Chunks written: ${ingestResult.chunks_written}`);
    console.log(`  Memory rows: ${ingestResult.memory_ids?.length || 0}`);
    if (ingestResult.warnings && ingestResult.warnings.length > 0) {
      console.log(`  Warnings: ${ingestResult.warnings.join(", ")}`);
    }

    console.log("\n[Done] Video ready for semantic search in memory table.");
  } catch (error) {
    console.error(
      `\n[Error] ${error.message || error}`
    );
    Deno.exit(1);
  }
}

main();

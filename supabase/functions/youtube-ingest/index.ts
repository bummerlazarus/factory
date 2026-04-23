import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

interface YoutubeIngestRequest {
  video_url?: string;
  video_id?: string;
  title?: string;
  channel_name?: string;
  transcript?: string;
  transcript_format?: "vtt" | "plain";
  tags?: string[];
  force?: boolean;
}

interface ChunkMetadata {
  source: "youtube";
  video_id: string;
  title?: string;
  channel_name?: string;
  url?: string;
  timestamp_url?: string;
  start_time?: string;
  end_time?: string;
  chunk_index: number;
  total_chunks: number;
  is_owned?: boolean;
  tags?: string[];
}

interface TranscriptChunk {
  text: string;
  start_time?: string;
  end_time?: string;
  chunk_index: number;
}

const CHUNK_TARGET_WORDS = 300;
const CHUNK_OVERLAP_WORDS = 50;

function extractVideoId(videoUrl?: string, videoId?: string): string {
  if (videoId) return videoId;

  if (!videoUrl) throw new Error("Either video_url or video_id required");

  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)/,
    /\/([a-zA-Z0-9_-]{11})(?:\?|$)/,
  ];

  for (const pattern of patterns) {
    const match = videoUrl.match(pattern);
    if (match) return match[1];
  }

  throw new Error(`Could not extract video ID from: ${videoUrl}`);
}

function parseVtt(vttText: string): Array<{ text: string; start_time: string; end_time: string }> {
  const lines = vttText.split("\n");
  const cues: Array<{ text: string; start_time: string; end_time: string }> = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();

    // Look for timestamp line (HH:MM:SS.mmm --> HH:MM:SS.mmm)
    if (line.includes("-->")) {
      const [startTime, endTime] = line.split("-->").map((t) => t.trim());
      const textLines = [];
      i++;

      // Collect text lines until we hit a blank line or end
      while (i < lines.length && lines[i].trim()) {
        textLines.push(lines[i]);
        i++;
      }

      if (textLines.length > 0) {
        const cleaned = textLines
          .join(" ")
          .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, "")
          .replace(/<\/?c[^>]*>/g, "")
          .replace(/\s+/g, " ")
          .trim();
        if (cleaned) {
          cues.push({ text: cleaned, start_time: startTime, end_time: endTime });
        }
      }
    }
    i++;
  }

  return cues;
}

function parsePlainText(text: string): Array<{ text: string }> {
  const lines = text.split("\n").filter((l) => l.trim());
  return lines.map((line) => ({ text: line }));
}

function chunkTranscript(cues: Array<{ text: string; start_time?: string; end_time?: string }>): TranscriptChunk[] {
  const chunks: TranscriptChunk[] = [];
  const words = cues.flatMap((c) => c.text.split(/\s+/));

  let chunkIndex = 0;
  let i = 0;

  while (i < words.length) {
    const chunkWords = words.slice(i, i + CHUNK_TARGET_WORDS);
    if (chunkWords.length === 0) break;

    // Find start and end cue metadata
    const chunkText = chunkWords.join(" ");
    const startWordIdx = i;
    const endWordIdx = i + chunkWords.length - 1;

    let startTime: string | undefined;
    let endTime: string | undefined;
    let wordCount = 0;

    for (const cue of cues) {
      const cueWords = cue.text.split(/\s+/);
      if (wordCount + cueWords.length > startWordIdx && !startTime) {
        startTime = cue.start_time;
      }
      if (wordCount + cueWords.length > endWordIdx) {
        endTime = cue.end_time;
        break;
      }
      wordCount += cueWords.length;
    }

    chunks.push({
      text: chunkText,
      start_time: startTime,
      end_time: endTime,
      chunk_index: chunkIndex,
    });

    // Move forward with overlap
    i += CHUNK_TARGET_WORDS - CHUNK_OVERLAP_WORDS;
    chunkIndex++;
  }

  return chunks.length > 0
    ? chunks
    : [
        {
          text: words.join(" ") || "",
          chunk_index: 0,
        },
      ];
}

async function embedText(text: string, openaiKey: string): Promise<number[]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: text,
      model: "text-embedding-3-small",
      dimensions: 1536,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

Deno.serve(async (req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const captureSecret = Deno.env.get("CAPTURE_SECRET");
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  const youtubeApiKey = Deno.env.get("YOUTUBE_API_KEY");
  const youtubeChannelId = Deno.env.get("YOUTUBE_CHANNEL_ID");

  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(
      JSON.stringify({ error: "Missing Supabase configuration" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // Check auth
  const authHeader = req.headers.get("x-capture-secret");
  if (authHeader !== captureSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body = (await req.json()) as YoutubeIngestRequest;
    const warnings: string[] = [];

    // Extract video ID
    const videoId = extractVideoId(body.video_url, body.video_id);

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if already ingested
    if (!body.force) {
      const { data: existing } = await supabase
        .from("memory")
        .select("id")
        .eq("source", "youtube")
        .filter("metadata->>'video_id'", "eq", videoId)
        .limit(1);

      if (existing && existing.length > 0) {
        return new Response(
          JSON.stringify({
            video_id: videoId,
            skipped: true,
            reason: "already_ingested",
            message: "Call again with { force: true } to re-ingest.",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    let title = body.title;
    let channelName = body.channel_name;
    let description = "";
    let publishedAt: string | null = null;
    let isOwned = false;

    // Fetch metadata if API key available
    if (youtubeApiKey && !title) {
      try {
        const metadataResponse = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoId}&key=${youtubeApiKey}`
        );
        if (metadataResponse.ok) {
          const metadataData = await metadataResponse.json();
          if (metadataData.items && metadataData.items[0]) {
            const snippet = metadataData.items[0].snippet;
            title = snippet.title;
            channelName = snippet.channelTitle;
            description = snippet.description;
            publishedAt = snippet.publishedAt;

            if (youtubeChannelId && snippet.channelId === youtubeChannelId) {
              isOwned = true;
            }
          }
        }
      } catch (_error) {
        warnings.push("youtube_metadata_fetch_failed");
      }
    } else if (!youtubeApiKey) {
      warnings.push("youtube_api_key_not_set");
    }

    // Parse and chunk transcript
    if (!body.transcript) {
      return new Response(
        JSON.stringify({
          error: "transcript required (two-phase model)",
          video_id: videoId,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const format = body.transcript_format || "plain";
    const cues = format === "vtt" ? parseVtt(body.transcript) : parsePlainText(body.transcript);
    const chunks = chunkTranscript(cues);

    // If force re-ingest, delete old chunks
    if (body.force) {
      await supabase
        .from("memory")
        .delete()
        .eq("source", "youtube")
        .filter("metadata->>'video_id'", "eq", videoId);
    }

    // Embed and insert chunks
    const memoryIds: string[] = [];
    const metadataBase: ChunkMetadata = {
      source: "youtube",
      video_id: videoId,
      title,
      channel_name: channelName,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      chunk_index: 0,
      total_chunks: chunks.length,
      is_owned: isOwned,
      tags: body.tags || [],
    };

    for (const chunk of chunks) {
      try {
        let embedding: number[] | null = null;

        // Try to embed if OpenAI key is available
        if (openaiKey) {
          embedding = await embedText(chunk.text, openaiKey);
        } else {
          warnings.push("memory_skipped_no_openai");
        }

        const metadata: ChunkMetadata = {
          ...metadataBase,
          chunk_index: chunk.chunk_index,
          start_time: chunk.start_time,
          end_time: chunk.end_time,
        };

        if (embedding) {
          const { data: memoryRow, error: insertError } = await supabase.from("memory").upsert(
            [
              {
                content: chunk.text,
                namespace: "knowledge",
                source: "youtube",
                source_id: `${videoId}#${chunk.chunk_index}`,
                embedding,
                metadata,
              },
            ],
            { onConflict: "source,source_id" }
          ).select("id");

          if (insertError) {
            warnings.push("memory_insert_failed");
          } else if (memoryRow && memoryRow.length > 0) {
            memoryIds.push(memoryRow[0].id);
          }
        }
      } catch (_error) {
        warnings.push("memory_partial_failure");
      }
    }

    // Upsert video record
    const { error: videoError } = await supabase.from("agent_youtube_videos").upsert(
      {
        video_id: videoId,
        title,
        channel_name: channelName,
        description,
        transcript: body.transcript,
        is_owned: isOwned,
        published_at: publishedAt,
        channel_id: null,
      },
      { onConflict: "video_id" }
    );

    if (videoError) {
      warnings.push("table_upsert_failed");
    }

    return new Response(
      JSON.stringify({
        video_id: videoId,
        title,
        channel_name: channelName,
        is_owned: isOwned,
        chunks_written: memoryIds.length,
        memory_ids: memoryIds,
        table_upserted: !videoError,
        warnings,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
});

#!/usr/bin/env -S deno run --allow-env --allow-read --allow-net

/**
 * Ingest a YouTube "Show transcript" copy-paste (timestamped text) into the
 * youtube-ingest Edge Function. Use when captions aren't auto-fetchable.
 *
 * Usage:
 *   deno run --allow-env --allow-read --allow-net \
 *     ops/scripts/ingest-pasted-transcript.ts \
 *     --file <path> --video-id <id> --title <t> --channel <c> [--tag <tag> ...] [--force]
 */

interface Cue { start: string; text: string }

function toVttTime(mmss: string): string {
  const parts = mmss.split(":").map(Number);
  let h = 0, m = 0, s = 0;
  if (parts.length === 3) [h, m, s] = parts;
  else if (parts.length === 2) [m, s] = parts;
  else s = parts[0];
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.000`;
}

function parsePasted(raw: string): Cue[] {
  const lines = raw.split(/\r?\n/);
  const tsRe = /^\d{1,2}:\d{2}(?::\d{2})?$/;
  const durRe = /^\d+\s+(hours?|minutes?|seconds?)(\s*,\s*\d+\s+(hours?|minutes?|seconds?))*$/i;
  const cues: Cue[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (tsRe.test(line)) {
      const start = line;
      i++;
      const textParts: string[] = [];
      while (i < lines.length) {
        const next = lines[i].trim();
        if (tsRe.test(next)) break;
        if (next && !durRe.test(next)) textParts.push(next);
        i++;
      }
      if (textParts.length) cues.push({ start, text: textParts.join(" ") });
    } else {
      i++;
    }
  }
  return cues;
}

function toVtt(cues: Cue[]): string {
  const lines = ["WEBVTT", ""];
  for (let k = 0; k < cues.length; k++) {
    const start = toVttTime(cues[k].start);
    const end = k + 1 < cues.length ? toVttTime(cues[k + 1].start) : toVttTime(cues[k].start);
    lines.push(`${start} --> ${end}`);
    lines.push(cues[k].text);
    lines.push("");
  }
  return lines.join("\n");
}

function arg(name: string): string | undefined {
  const a = Deno.args;
  const i = a.indexOf(`--${name}`);
  return i >= 0 ? a[i + 1] : undefined;
}

function argAll(name: string): string[] {
  const out: string[] = [];
  const a = Deno.args;
  for (let i = 0; i < a.length; i++) if (a[i] === `--${name}`) out.push(a[i + 1]);
  return out;
}

async function main() {
  const file = arg("file");
  const videoId = arg("video-id");
  const title = arg("title");
  const channel = arg("channel");
  const tags = argAll("tag");
  const force = Deno.args.includes("--force");

  if (!file || !videoId || !title || !channel) {
    console.error("Missing required: --file --video-id --title --channel");
    Deno.exit(1);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const captureSecret = Deno.env.get("CAPTURE_SECRET");
  if (!supabaseUrl || !captureSecret) {
    console.error("Missing SUPABASE_URL or CAPTURE_SECRET");
    Deno.exit(1);
  }

  const raw = await Deno.readTextFile(file);
  const cues = parsePasted(raw);
  console.log(`[parse] ${cues.length} cues, ${raw.length} bytes in`);
  const vtt = toVtt(cues);
  console.log(`[parse] ${vtt.length} bytes VTT out`);

  const res = await fetch(`${supabaseUrl}/functions/v1/youtube-ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-capture-secret": captureSecret,
    },
    body: JSON.stringify({
      video_id: videoId,
      title,
      channel_name: channel,
      transcript: vtt,
      transcript_format: "vtt",
      force,
      tags,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`[POST] ${res.status}: ${text}`);
    Deno.exit(1);
  }
  console.log(`[POST] ok`);
  console.log(text);
}

main();

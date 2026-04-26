#!/usr/bin/env -S deno run --allow-env --allow-net --allow-read --allow-write
/**
 * migrate-pinecone-to-pgvector.ts
 *
 * One-shot migration script — Pinecone `gravity-claw` index → Supabase `public.memory`.
 *
 * Phase: 2 (pgvector consolidation) — see
 *   architecture-rebuild-2026-04-17/03-decisions/decisions-log.md
 *   architecture-rebuild-2026-04-17/04-audit/2026-04-17-q2-vector-strategy-memo.md
 *   architecture-rebuild-2026-04-17/05-design/phase-2-migrations/README.md
 *
 * What it does:
 *   1. Lists namespaces in Pinecone `gravity-claw` via the REST API.
 *   2. Pages through vectors per namespace (via `describe_index_stats` + `list` + `fetch`).
 *   3. Extracts text + metadata from vector.metadata.
 *   4. Deduplicates by content hash (drops ~400 duplicate Priestley chunks).
 *   5. Normalizes metadata across ingest types into a consistent shape.
 *   6. Re-embeds content via OpenAI `text-embedding-3-small` (1536-dim).
 *   7. Bulk-upserts to public.memory via Supabase REST in batches of 100 on
 *      conflict (source, source_id).
 *   8. Drops the 5 persona-memory namespaces (ceo-memory, developer-memory,
 *      content-memory, marketing-memory, cordis-memory) — logs counts only.
 *   9. Writes a migration-report.md alongside this script.
 *
 * Flags:
 *   --dry-run          Count only; NO OpenAI calls, NO Supabase writes. Default when
 *                      invoked with no args — forces Edmund to opt in to writes.
 *   --namespace=<n>    Migrate only one namespace (repeat flag not supported; one call one ns).
 *   --execute          Required to actually perform writes. --dry-run overrides.
 *
 * Env (read from ops/.env via `--env-file` or pre-export):
 *   PINECONE_API_KEY
 *   PINECONE_INDEX_NAME         (default: gravity-claw)
 *   OPENAI_API_KEY              (NOT set in ops/.env today — add before --execute)
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   # Dry run (what would migrate, no writes)
 *   deno run --env-file=../.env \
 *     --allow-env --allow-net --allow-read --allow-write \
 *     migrate-pinecone-to-pgvector.ts --dry-run
 *
 *   # Single-namespace dry run
 *   ... migrate-pinecone-to-pgvector.ts --dry-run --namespace=knowledge
 *
 *   # Real run (requires OPENAI_API_KEY set and --execute)
 *   ... migrate-pinecone-to-pgvector.ts --execute
 *
 * Exits non-zero on any error. Idempotent: re-running --execute upserts on
 * (source, source_id); rows already embedded with the same content hash are skipped.
 */

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const PINECONE_INDEX = Deno.env.get("PINECONE_INDEX_NAME") ?? "gravity-claw";
const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
const OPENAI_EMBEDDING_DIM = 1536;
const SUPABASE_UPSERT_BATCH = 100;
// OpenAI max is 2048 inputs per request; the real constraint is TPM, not input count.
// Attempt #3 ran batches of 100 and hit tier-1 TPM (1M) repeatedly with "used 95%+" burst 429s.
// 50 halves per-batch token load and keeps us safely below bursts while embedBatch retry handles
// transient headroom-exceeded responses.
const OPENAI_EMBED_BATCH = 50;
// Max retries per embed batch when OpenAI returns 429. Exponential backoff starts at 1s,
// doubles each attempt, caps at 60s. Respects Retry-After header when present.
const OPENAI_EMBED_MAX_RETRIES = 5;
// Pinecone fetch-by-id is a GET with repeated ?ids=; 100 ids pushed header past 8KB and
// triggered HTTP 431. 25 keeps us well under URL-length limits across clients.
const PINECONE_FETCH_BATCH = 25;

// Persona-memory namespaces to DROP (per Q2 memo sub-question #5).
const DROPPED_NAMESPACES = new Set([
  "ceo-memory",
  "developer-memory",
  "content-memory",
  "marketing-memory",
  "cordis-memory",
]);

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

interface PineconeIndexStats {
  namespaces: Record<string, { vectorCount: number }>;
  dimension: number;
  indexFullness: number;
  totalVectorCount: number;
}

interface PineconeVector {
  id: string;
  values?: number[];
  metadata?: Record<string, unknown>;
}

interface MemoryRow {
  content: string;
  namespace: string;
  source: string | null;
  source_id: string | null;
  metadata: Record<string, unknown>;
  embedding?: number[] | null;
}

interface NamespaceReport {
  namespace: string;
  action: "migrate" | "drop" | "skip";
  pineconeCount: number;
  fetched: number;
  deduped: number;
  toUpsert: number;
  upserted: number;
  errors: string[];
}

// -----------------------------------------------------------------------------
// Arg parsing
// -----------------------------------------------------------------------------

function parseArgs(argv: string[]) {
  const flags = {
    dryRun: false,
    execute: false,
    namespace: null as string | null,
  };
  for (const a of argv) {
    if (a === "--dry-run") flags.dryRun = true;
    else if (a === "--execute") flags.execute = true;
    else if (a.startsWith("--namespace=")) flags.namespace = a.split("=")[1];
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: migrate-pinecone-to-pgvector.ts [--dry-run] [--execute] [--namespace=<n>]\n" +
          "Default is --dry-run if neither --dry-run nor --execute is passed.",
      );
      Deno.exit(0);
    } else {
      console.error(`Unknown arg: ${a}`);
      Deno.exit(2);
    }
  }
  // Safety default: if neither flag is set, force dry run.
  if (!flags.dryRun && !flags.execute) flags.dryRun = true;
  // --dry-run wins if both are passed.
  if (flags.dryRun) flags.execute = false;
  return flags;
}

// -----------------------------------------------------------------------------
// Env validation
// -----------------------------------------------------------------------------

function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) {
    console.error(`FATAL: env var ${name} is not set.`);
    Deno.exit(1);
  }
  return v;
}

// -----------------------------------------------------------------------------
// Pinecone client (REST, no SDK — keeps Deno deps to zero)
// -----------------------------------------------------------------------------

interface PineconeClient {
  describeIndex(): Promise<{ host: string; dimension: number; metric: string }>;
  describeIndexStats(host: string): Promise<PineconeIndexStats>;
  // Paged list of ids in a namespace.
  listIds(
    host: string,
    namespace: string,
    paginationToken?: string,
  ): Promise<{ vectors: Array<{ id: string }>; pagination?: { next?: string } }>;
  // Fetch vectors by id (up to 100 per call).
  fetchVectors(
    host: string,
    namespace: string,
    ids: string[],
  ): Promise<Record<string, PineconeVector>>;
}

function makePineconeClient(apiKey: string, indexName: string): PineconeClient {
  const controlBase = "https://api.pinecone.io";
  const headers = () => ({
    "Api-Key": apiKey,
    "Content-Type": "application/json",
    "X-Pinecone-API-Version": "2024-07",
  });

  return {
    async describeIndex() {
      const res = await fetch(`${controlBase}/indexes/${indexName}`, {
        headers: headers(),
      });
      if (!res.ok) {
        throw new Error(
          `Pinecone describeIndex ${res.status}: ${await res.text()}`,
        );
      }
      const j = await res.json();
      return { host: j.host, dimension: j.dimension, metric: j.metric };
    },

    async describeIndexStats(host: string) {
      const res = await fetch(`https://${host}/describe_index_stats`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        throw new Error(
          `Pinecone stats ${res.status}: ${await res.text()}`,
        );
      }
      return await res.json();
    },

    async listIds(host, namespace, paginationToken) {
      // Pinecone list endpoint is a GET with query params.
      const url = new URL(`https://${host}/vectors/list`);
      url.searchParams.set("namespace", namespace);
      url.searchParams.set("limit", "100");
      if (paginationToken) {
        url.searchParams.set("paginationToken", paginationToken);
      }
      const res = await fetch(url, { headers: headers() });
      if (!res.ok) {
        throw new Error(
          `Pinecone list ${res.status}: ${await res.text()}`,
        );
      }
      const j = await res.json();
      return {
        vectors: j.vectors ?? [],
        pagination: j.pagination,
      };
    },

    async fetchVectors(host, namespace, ids) {
      const url = new URL(`https://${host}/vectors/fetch`);
      url.searchParams.set("namespace", namespace);
      for (const id of ids) url.searchParams.append("ids", id);
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch(url, { headers: headers() });
        if (res.ok) {
          const j = await res.json();
          return j.vectors ?? {};
        }
        lastErr = new Error(
          `Pinecone fetch ${res.status}: ${await res.text()}`,
        );
        // Back off on 429 / 5xx. 431 (header too large) is deterministic — fail fast.
        if (res.status === 431 || (res.status >= 400 && res.status < 500 && res.status !== 429)) {
          throw lastErr;
        }
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
      throw lastErr;
    },
  };
}

// -----------------------------------------------------------------------------
// Metadata normalization
// -----------------------------------------------------------------------------

/**
 * Map a Pinecone vector id + metadata into a consistent MemoryRow.
 *
 * Pinecone metadata schemas today (from 04-audit/2026-04-17-pinecone-audit.md):
 *
 *   knowledge / yt_*      : text, type, source=youtube, video_id, url, title, chunk_index, total_chunks
 *   knowledge / book_*    : text, type, source=pdf, author, filename, folder, ingest_type=book, chunk_index, total_chunks
 *   knowledge / notion_*  : text, type, source=notion, database_id, url, tags
 *   knowledge / thought_* : text, type, source?, tags
 *   knowledge / guide_*   : text, type, source=architecture_guide, filename, folder
 *   knowledge / on_*      : text, type, ... (ninety.io guides)
 *   knowledge / *_brief_* : text, type, ... (framework briefs)
 *   conversations / msg_* : text, timestamp, type=conversation
 *   content / <uuid>      : text, source=website, competitor, competitor_id, content_type, published_at, topic_tags
 *
 * Target (public.memory):
 *   content   = metadata.text
 *   namespace = pinecone namespace
 *   source    = normalized channel (youtube|pdf|notion|thought|architecture_guide|brief|conversation|website|unknown)
 *   source_id = Pinecone vector id (natural key, fits the existing ID schemes)
 *   metadata  = rest of the Pinecone metadata minus `text`, plus { pinecone_id, ingest_date_missing: true }
 */
// Strip NUL bytes (`\u0000`). PostgreSQL text + JSONB both reject embedded NULs
// with `22P05: unsupported Unicode escape sequence`. Applied to content and
// (recursively) to metadata strings. See phase-2-attempt-5 failure: 2 batches
// of 100 (at offsets 6500 and 6600) rejected for this reason — 200-row gap.
function stripNulls(s: string): string {
  return s.includes("\u0000") ? s.replace(/\u0000/g, "") : s;
}

function stripNullsDeep<T>(v: T): T {
  if (typeof v === "string") return stripNulls(v) as T;
  if (Array.isArray(v)) return v.map((x) => stripNullsDeep(x)) as unknown as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = stripNullsDeep(val);
    }
    return out as unknown as T;
  }
  return v;
}

function normalize(v: PineconeVector, namespace: string): MemoryRow | null {
  const md = (v.metadata ?? {}) as Record<string, unknown>;
  const rawContent = typeof md.text === "string" ? md.text : null;
  if (!rawContent || !rawContent.trim()) return null; // no text = skip
  const content = stripNulls(rawContent);

  // Strip text from metadata; keep everything else (with NUL scrub).
  const { text: _drop, ...rest } = md;

  // Normalize source.
  let source: string | null = null;
  const rawSource = typeof md.source === "string" ? md.source : null;
  const id = v.id;

  if (namespace === "conversations") source = "conversation";
  else if (namespace === "content") source = "website";
  else if (rawSource) source = String(rawSource);
  else if (id.startsWith("yt_")) source = "youtube";
  else if (id.startsWith("book_")) source = "pdf";
  else if (id.startsWith("notion_")) source = "notion";
  else if (id.startsWith("thought_")) source = "thought";
  else if (id.startsWith("guide_")) source = "architecture_guide";
  else if (id.startsWith("on_") || id.includes("_brief")) source = "brief";
  else source = "unknown";

  const normalizedMeta: Record<string, unknown> = stripNullsDeep({
    ...rest,
    pinecone_id: v.id,
    pinecone_namespace: namespace,
    // Audit flagged: no ingest_date anywhere. Mark so future queries can see the gap.
    ingest_date_known: false,
  }) as Record<string, unknown>;

  return {
    content,
    namespace,
    source,
    source_id: v.id,
    metadata: normalizedMeta,
  };
}

// -----------------------------------------------------------------------------
// Content hashing for dedup (~400 Priestley duplicate chunks)
// -----------------------------------------------------------------------------

async function sha256Hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// -----------------------------------------------------------------------------
// OpenAI embeddings client (REST, no SDK)
// -----------------------------------------------------------------------------

async function embedBatch(
  apiKey: string,
  inputs: string[],
): Promise<number[][]> {
  // Tier-1 OpenAI accounts start at 40k TPM and auto-upgrade to 1M TPM;
  // within 1M TPM we still see bursty "used 95%+" 429s. Respect Retry-After
  // when the server sends it, else do exponential backoff: 1s → 2s → 4s → … cap 60s.
  let attempt = 0;
  let lastErr: unknown = null;
  while (attempt <= OPENAI_EMBED_MAX_RETRIES) {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_EMBEDDING_MODEL,
        input: inputs,
        dimensions: OPENAI_EMBEDDING_DIM,
      }),
    });
    if (res.ok) {
      const j = await res.json();
      const data = j.data as Array<{ embedding: number[]; index: number }>;
      const ordered = new Array<number[]>(inputs.length);
      for (const d of data) ordered[d.index] = d.embedding;
      return ordered;
    }
    const bodyText = await res.text();
    lastErr = new Error(`OpenAI embeddings ${res.status}: ${bodyText}`);
    // Retry only on 429 and 5xx. Everything else is deterministic — fail fast.
    const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
    if (!retryable || attempt === OPENAI_EMBED_MAX_RETRIES) {
      throw lastErr;
    }
    // Prefer server-supplied Retry-After (seconds or HTTP-date). Fallback: exponential backoff.
    let waitMs = Math.min(60_000, 1000 * 2 ** attempt);
    const retryAfter = res.headers.get("retry-after");
    if (retryAfter) {
      const asSec = Number(retryAfter);
      if (!Number.isNaN(asSec) && asSec > 0) {
        waitMs = Math.min(60_000, Math.ceil(asSec * 1000));
      } else {
        const asDate = Date.parse(retryAfter);
        if (!Number.isNaN(asDate)) {
          waitMs = Math.min(60_000, Math.max(0, asDate - Date.now()));
        }
      }
    }
    console.log(
      `    [embed-retry] attempt=${attempt + 1}/${OPENAI_EMBED_MAX_RETRIES} status=${res.status} wait=${waitMs}ms inputs=${inputs.length}`,
    );
    await new Promise((r) => setTimeout(r, waitMs));
    attempt++;
  }
  throw lastErr;
}

/**
 * Verify OpenAI auth + dimension without burning a full corpus.
 * Used during dry-run and as the first step of --execute.
 */
async function verifyOpenAI(apiKey: string): Promise<{
  ok: boolean;
  dim?: number;
  error?: string;
}> {
  try {
    const [vec] = await embedBatch(apiKey, ["ping"]);
    return { ok: vec?.length === OPENAI_EMBEDDING_DIM, dim: vec?.length };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// -----------------------------------------------------------------------------
// Supabase upsert
// -----------------------------------------------------------------------------

async function upsertBatch(
  supabaseUrl: string,
  serviceRoleKey: string,
  rows: MemoryRow[],
): Promise<void> {
  // PostgREST format for vector column: pg-vector accepts a JSON number[] via
  // the supabase-js SDK normally. Over REST we send the array directly; pgvector
  // has an input converter that reads JSON arrays when the column type is vector.
  // However, PostgREST currently expects a string literal like "[0.1,0.2,...]"
  // for vector. Convert here.
  const payload = rows.map((r) => ({
    namespace: r.namespace,
    content: r.content,
    embedding: r.embedding
      ? `[${r.embedding.map((x) => x.toFixed(7)).join(",")}]`
      : null,
    metadata: r.metadata,
    source: r.source,
    source_id: r.source_id,
  }));

  const res = await fetch(
    `${supabaseUrl}/rest/v1/memory?on_conflict=source,source_id`,
    {
      method: "POST",
      headers: {
        "apikey": serviceRoleKey,
        "Authorization": `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    throw new Error(`Supabase upsert ${res.status}: ${await res.text()}`);
  }
}

// -----------------------------------------------------------------------------
// Main migration logic per namespace
// -----------------------------------------------------------------------------

interface RunContext {
  dryRun: boolean;
  pinecone: PineconeClient;
  pineconeHost: string;
  openaiKey: string;
  supabaseUrl: string;
  supabaseServiceKey: string;
}

async function processNamespace(
  ctx: RunContext,
  namespace: string,
  expectedCount: number,
): Promise<NamespaceReport> {
  const report: NamespaceReport = {
    namespace,
    action: DROPPED_NAMESPACES.has(namespace) ? "drop" : "migrate",
    pineconeCount: expectedCount,
    fetched: 0,
    deduped: 0,
    toUpsert: 0,
    upserted: 0,
    errors: [],
  };

  if (report.action === "drop") {
    console.log(
      `  [drop] ${namespace}: ${expectedCount} persona-memory vectors — will NOT migrate (per Q2 memo).`,
    );
    return report;
  }

  // 1. Page through ids.
  const ids: string[] = [];
  let token: string | undefined;
  do {
    const page = await ctx.pinecone.listIds(
      ctx.pineconeHost,
      namespace,
      token,
    );
    for (const v of page.vectors) ids.push(v.id);
    token = page.pagination?.next;
  } while (token);

  report.fetched = ids.length;
  console.log(
    `  [fetch] ${namespace}: listed ${ids.length} ids (stats reported ${expectedCount})`,
  );

  // 2. Fetch vectors in PINECONE_FETCH_BATCH chunks, extract text + metadata.
  const seenHashes = new Set<string>();
  const bySourceId = new Map<string, MemoryRow>(); // last-write-wins per source_id
  const fetchStart = Date.now();
  for (let i = 0; i < ids.length; i += PINECONE_FETCH_BATCH) {
    const chunk = ids.slice(i, i + PINECONE_FETCH_BATCH);
    const fetched = await ctx.pinecone.fetchVectors(
      ctx.pineconeHost,
      namespace,
      chunk,
    );
    for (const id of chunk) {
      const v = fetched[id];
      if (!v) continue;
      const row = normalize(v, namespace);
      if (!row) continue;
      const hash = await sha256Hex(row.content);
      if (seenHashes.has(hash)) {
        report.deduped++;
        continue;
      }
      seenHashes.add(hash);
      // Key by (source, source_id) to match the target unique constraint.
      const k = `${row.source}::${row.source_id}`;
      bySourceId.set(k, row);
    }
    // Progress: every 20 batches (~500 vectors) or at end.
    const nextI = i + PINECONE_FETCH_BATCH;
    if ((nextI / PINECONE_FETCH_BATCH) % 20 === 0 || nextI >= ids.length) {
      const done = Math.min(nextI, ids.length);
      const elapsed = ((Date.now() - fetchStart) / 1000).toFixed(1);
      console.log(
        `    [fetch-progress] ${namespace}: ${done}/${ids.length} (${elapsed}s elapsed, ${bySourceId.size} kept, ${report.deduped} dup)`,
      );
    }
  }

  const rows = [...bySourceId.values()];
  report.toUpsert = rows.length;
  console.log(
    `  [norm] ${namespace}: ${rows.length} unique rows after content-hash dedup (${report.deduped} dupes dropped)`,
  );

  if (ctx.dryRun) {
    return report;
  }

  // 3. Embed in OPENAI_EMBED_BATCH chunks.
  const embedStart = Date.now();
  for (let i = 0; i < rows.length; i += OPENAI_EMBED_BATCH) {
    const chunk = rows.slice(i, i + OPENAI_EMBED_BATCH);
    try {
      const embs = await embedBatch(ctx.openaiKey, chunk.map((r) => r.content));
      for (let j = 0; j < chunk.length; j++) chunk[j].embedding = embs[j];
    } catch (err) {
      report.errors.push(`embed batch at ${i}: ${err}`);
      continue;
    }
    const done = Math.min(i + OPENAI_EMBED_BATCH, rows.length);
    if (((i + OPENAI_EMBED_BATCH) / OPENAI_EMBED_BATCH) % 5 === 0 || done >= rows.length) {
      const elapsed = ((Date.now() - embedStart) / 1000).toFixed(1);
      console.log(`    [embed-progress] ${namespace}: ${done}/${rows.length} (${elapsed}s elapsed)`);
    }
  }

  // 4. Upsert in SUPABASE_UPSERT_BATCH chunks.
  const upsertStart = Date.now();
  for (let i = 0; i < rows.length; i += SUPABASE_UPSERT_BATCH) {
    const batch = rows
      .slice(i, i + SUPABASE_UPSERT_BATCH)
      .filter((r) => r.embedding && r.embedding.length === OPENAI_EMBEDDING_DIM);
    if (batch.length === 0) continue;
    try {
      await upsertBatch(ctx.supabaseUrl, ctx.supabaseServiceKey, batch);
      report.upserted += batch.length;
    } catch (err) {
      report.errors.push(`upsert batch at ${i}: ${err}`);
    }
    const done = Math.min(i + SUPABASE_UPSERT_BATCH, rows.length);
    if (((i + SUPABASE_UPSERT_BATCH) / SUPABASE_UPSERT_BATCH) % 10 === 0 || done >= rows.length) {
      const elapsed = ((Date.now() - upsertStart) / 1000).toFixed(1);
      console.log(`    [upsert-progress] ${namespace}: ${report.upserted}/${rows.length} upserted (${elapsed}s elapsed)`);
    }
  }

  return report;
}

// -----------------------------------------------------------------------------
// Report writer
// -----------------------------------------------------------------------------

function writeReport(
  path: string,
  args: ReturnType<typeof parseArgs>,
  stats: PineconeIndexStats,
  reports: NamespaceReport[],
  openaiCheck: { ok: boolean; dim?: number; error?: string } | null,
) {
  const now = new Date().toISOString();
  const totalPc = reports.reduce((a, r) => a + r.pineconeCount, 0);
  const totalMigrate = reports
    .filter((r) => r.action === "migrate")
    .reduce((a, r) => a + r.toUpsert, 0);
  const totalDrop = reports
    .filter((r) => r.action === "drop")
    .reduce((a, r) => a + r.pineconeCount, 0);
  const totalDedup = reports.reduce((a, r) => a + r.deduped, 0);
  const totalUpserted = reports.reduce((a, r) => a + r.upserted, 0);

  const lines: string[] = [];
  lines.push(`# Pinecone → pgvector migration report`);
  lines.push(``);
  lines.push(`**Generated:** ${now}`);
  lines.push(`**Mode:** ${args.dryRun ? "DRY RUN (no writes)" : "EXECUTE"}`);
  lines.push(
    `**Scope:** ${args.namespace ? `namespace=${args.namespace}` : "all namespaces"}`,
  );
  lines.push(`**Pinecone index:** ${PINECONE_INDEX}`);
  lines.push(`**Pinecone dimension:** ${stats.dimension}`);
  lines.push(
    `**Target embedding model:** ${OPENAI_EMBEDDING_MODEL} (${OPENAI_EMBEDDING_DIM}-dim)`,
  );
  if (openaiCheck) {
    lines.push(
      `**OpenAI auth check:** ${
        openaiCheck.ok
          ? `ok (dim=${openaiCheck.dim})`
          : `FAILED (${openaiCheck.error ?? "unknown"})`
      }`,
    );
  }
  lines.push(``);
  lines.push(`## Per-namespace counts`);
  lines.push(``);
  lines.push(
    `| Namespace | Action | Pinecone | Fetched | Dedup | To upsert | Upserted | Errors |`,
  );
  lines.push(
    `|---|---|---:|---:|---:|---:|---:|---:|`,
  );
  for (const r of reports) {
    lines.push(
      `| \`${r.namespace}\` | ${r.action} | ${r.pineconeCount} | ${r.fetched} | ${r.deduped} | ${r.toUpsert} | ${r.upserted} | ${r.errors.length} |`,
    );
  }
  lines.push(``);
  lines.push(`## Totals`);
  lines.push(``);
  lines.push(`- Pinecone total: **${totalPc}**`);
  lines.push(`- Would drop (persona-memory): **${totalDrop}**`);
  lines.push(`- Deduped (content hash): **${totalDedup}**`);
  lines.push(`- To upsert to public.memory: **${totalMigrate}**`);
  lines.push(`- Actually upserted: **${totalUpserted}**`);
  lines.push(``);

  const anyErrors = reports.some((r) => r.errors.length);
  if (anyErrors) {
    lines.push(`## Errors`);
    lines.push(``);
    for (const r of reports) {
      if (r.errors.length === 0) continue;
      lines.push(`### ${r.namespace}`);
      for (const e of r.errors) lines.push(`- ${e}`);
      lines.push(``);
    }
  }

  lines.push(`---`);
  lines.push(
    `Generated by \`/ops/scripts/migrate-pinecone-to-pgvector.ts\`. One-shot; kept for reference.`,
  );
  Deno.writeTextFileSync(path, lines.join("\n"));
}

// -----------------------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------------------

async function main() {
  const args = parseArgs(Deno.args);

  console.log(`== migrate-pinecone-to-pgvector.ts ==`);
  console.log(`  mode: ${args.dryRun ? "DRY RUN" : "EXECUTE"}`);
  console.log(
    `  namespace filter: ${args.namespace ?? "<all>"}`,
  );
  console.log(``);

  const pineconeKey = requireEnv("PINECONE_API_KEY");
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const supabaseServiceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  // OPENAI_API_KEY is only required when --execute. Dry-run still pings it if present.
  const openaiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  if (!args.dryRun && !openaiKey) {
    console.error(
      `FATAL: OPENAI_API_KEY must be set for --execute. It is not in ops/.env today; add it before the real run.`,
    );
    Deno.exit(1);
  }

  const pinecone = makePineconeClient(pineconeKey, PINECONE_INDEX);
  const idx = await pinecone.describeIndex();
  console.log(
    `  pinecone index: ${PINECONE_INDEX} host=${idx.host} dim=${idx.dimension} metric=${idx.metric}`,
  );
  if (idx.dimension !== 3072) {
    console.warn(
      `  WARNING: expected source dimension 3072 (text-embedding-3-large); got ${idx.dimension}. Proceeding.`,
    );
  }

  const stats = await pinecone.describeIndexStats(idx.host);
  console.log(
    `  pinecone total vectors: ${stats.totalVectorCount} across ${
      Object.keys(stats.namespaces).length
    } namespaces`,
  );
  console.log(``);

  let openaiCheck: { ok: boolean; dim?: number; error?: string } | null = null;
  if (openaiKey) {
    console.log(`  verifying OpenAI auth + dimension...`);
    openaiCheck = await verifyOpenAI(openaiKey);
    if (openaiCheck.ok) {
      console.log(`  openai ok (dim=${openaiCheck.dim})`);
    } else {
      console.warn(
        `  openai check FAILED: ${openaiCheck.error ?? `dim=${openaiCheck.dim}`}`,
      );
      if (!args.dryRun) Deno.exit(1);
    }
  } else {
    console.log(
      `  (skipping OpenAI check — OPENAI_API_KEY not set; dry-run only)`,
    );
  }
  console.log(``);

  const ctx: RunContext = {
    dryRun: args.dryRun,
    pinecone,
    pineconeHost: idx.host,
    openaiKey,
    supabaseUrl,
    supabaseServiceKey,
  };

  const reports: NamespaceReport[] = [];
  const nsEntries = Object.entries(stats.namespaces).sort(
    (a, b) => b[1].vectorCount - a[1].vectorCount,
  );
  for (const [namespace, info] of nsEntries) {
    if (args.namespace && namespace !== args.namespace) continue;
    console.log(`[ns] ${namespace} (${info.vectorCount} vectors)`);
    try {
      const report = await processNamespace(ctx, namespace, info.vectorCount);
      reports.push(report);
    } catch (err) {
      console.error(`  FAIL ${namespace}: ${err}`);
      reports.push({
        namespace,
        action: "skip",
        pineconeCount: info.vectorCount,
        fetched: 0,
        deduped: 0,
        toUpsert: 0,
        upserted: 0,
        errors: [String(err)],
      });
    }
  }

  // Summary to stdout.
  console.log(``);
  console.log(`== summary ==`);
  const totalPc = reports.reduce((a, r) => a + r.pineconeCount, 0);
  const totalMigrate = reports
    .filter((r) => r.action === "migrate")
    .reduce((a, r) => a + r.toUpsert, 0);
  const totalDrop = reports
    .filter((r) => r.action === "drop")
    .reduce((a, r) => a + r.pineconeCount, 0);
  const totalDedup = reports.reduce((a, r) => a + r.deduped, 0);
  console.log(`  pinecone total:          ${totalPc}`);
  console.log(`  would drop (persona):    ${totalDrop}`);
  console.log(`  deduped:                 ${totalDedup}`);
  console.log(`  would upsert:            ${totalMigrate}`);
  if (!args.dryRun) {
    const totalUpserted = reports.reduce((a, r) => a + r.upserted, 0);
    console.log(`  upserted:                ${totalUpserted}`);
  }

  // Write report markdown alongside this script.
  const reportPath = new URL("./migration-report.md", import.meta.url).pathname;
  writeReport(reportPath, args, stats, reports, openaiCheck);
  console.log(`  report written: ${reportPath}`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(`FATAL: ${err}`);
    Deno.exit(1);
  });
}

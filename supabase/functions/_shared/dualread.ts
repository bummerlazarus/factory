/**
 * dualread.ts — Pinecone → pgvector parity logger.
 *
 * Used during the cutover window (W1.2 → W1.4) so every semantic-search caller
 * can double-read cheaply and build up a body of parity evidence in
 * `public.memory_dualread_log`. Primary result returned to the caller is
 * pgvector; Pinecone is a shadow read with its errors swallowed and logged.
 *
 * The helper is deliberately dependency-light and platform-agnostic — it takes
 * clients as injected deps so it works from:
 *   - Supabase Edge Functions (Deno)
 *   - Deno scripts in /ops/scripts/
 *   - Node-based callers (the dashboard's API routes, once they call memory)
 *
 * Caller supplies the query text + a precomputed 1536-dim embedding (so we
 * don't need to know or care which embedding provider you're using, and you can
 * use a single embedding for both lookups — which is what we want for a fair
 * comparison).
 *
 * --- Usage ---
 *
 *   import { dualReadSearch } from "../_shared/dualread.ts";
 *
 *   const rows = await dualReadSearch({
 *     query: "How do I think about voice and tone?",
 *     embedding: myEmbedding1536,
 *     namespace: "knowledge",
 *     topK: 10,
 *     caller: "capture-edge-fn",
 *     supabaseUrl: env.SUPABASE_URL,
 *     supabaseServiceKey: env.SUPABASE_SERVICE_ROLE_KEY,
 *     pineconeApiKey: env.PINECONE_API_KEY,
 *     pineconeHost: env.PINECONE_HOST,   // host URL for the gravity-claw index
 *     pineconeNamespace: "knowledge",     // identical to namespace by convention
 *   });
 *
 *   // rows is the pgvector result ([{id, content, metadata, similarity}]).
 *   // Logging happens fire-and-forget; never throws on Pinecone failure.
 *
 * --- Shape of the log row ---
 *
 *   pgvector_results: [{id, pinecone_id, similarity, content_preview}]
 *   pinecone_results: [{id, score, content_preview}]
 *   overlap_count   : # of pinecone_ids present on both sides
 *   jaccard         : overlap / union (NULL when Pinecone failed)
 *   metadata        : { error? , pinecone_host, ... }
 *
 * --- How overlap is computed ---
 *
 *   During the migration, every pgvector row for the `knowledge` / `content` /
 *   `conversations` namespaces stamped `metadata.pinecone_id` with the original
 *   Pinecone vector id. So overlap = |{ pgvector row.metadata.pinecone_id }
 *   ∩ { pinecone result id }|.
 *
 *   Rows ingested after the cutover won't have a `pinecone_id` on the pgvector
 *   side. Those contribute 0 to overlap by design — dual-read parity is only
 *   meaningful for the historical corpus.
 */

export interface PgMatch {
  id: string;            // memory.id (uuid)
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
}

export interface PineconeHit {
  _id: string;           // Pinecone vector id
  _score?: number;
  fields?: Record<string, unknown>;
}

export interface DualReadOptions {
  query: string;
  embedding: number[];    // must be 1536-dim
  namespace: string;
  topK?: number;          // default 10
  caller?: string;        // free-text identifier for the log row
  supabaseUrl: string;
  supabaseServiceKey: string;
  pineconeApiKey: string;
  pineconeHost: string;   // e.g. "gravity-claw-xxxxxxx.svc.xxx.pinecone.io"
  pineconeNamespace?: string;  // defaults to `namespace`
  metadataFilter?: Record<string, unknown>;  // empty by default
}

export async function dualReadSearch(opts: DualReadOptions): Promise<PgMatch[]> {
  const topK = opts.topK ?? 10;

  // --- pgvector (primary) ---
  const pgStart = Date.now();
  let pgResults: PgMatch[] = [];
  let pgError: string | null = null;
  try {
    pgResults = await callMatchMemory(
      opts.supabaseUrl,
      opts.supabaseServiceKey,
      opts.embedding,
      opts.namespace,
      topK,
      opts.metadataFilter ?? {},
    );
  } catch (err) {
    pgError = String(err);
    // pgvector is primary — re-throw after we log.
  }
  const pgMs = Date.now() - pgStart;

  // --- Pinecone (shadow) ---
  const pcStart = Date.now();
  let pineconeResults: PineconeHit[] = [];
  let pineconeError: string | null = null;
  try {
    pineconeResults = await callPineconeSearch(
      opts.pineconeHost,
      opts.pineconeApiKey,
      opts.pineconeNamespace ?? opts.namespace,
      opts.embedding,
      topK,
    );
  } catch (err) {
    pineconeError = String(err);
  }
  const pcMs = Date.now() - pcStart;

  // --- Compute overlap ---
  const pgPineconeIds = new Set(
    pgResults
      .map((r) => (r.metadata as { pinecone_id?: string })?.pinecone_id)
      .filter((x): x is string => !!x),
  );
  const pineconeIds = new Set(pineconeResults.map((h) => h._id));
  let overlap = 0;
  for (const id of pineconeIds) if (pgPineconeIds.has(id)) overlap += 1;
  const union = new Set([...pgPineconeIds, ...pineconeIds]);
  const jaccard = (!pgError && !pineconeError && union.size > 0)
    ? Number((overlap / union.size).toFixed(3))
    : null;

  // --- Log (fire-and-forget; swallow logging errors too) ---
  const logRow = {
    query: opts.query,
    namespace: opts.namespace,
    top_k: topK,
    pgvector_results: pgResults.map((r) => ({
      id: r.id,
      pinecone_id: (r.metadata as { pinecone_id?: string })?.pinecone_id ?? null,
      similarity: r.similarity,
      content_preview: r.content.slice(0, 160),
    })),
    pinecone_results: pineconeResults.map((h) => ({
      id: h._id,
      score: h._score ?? null,
      content_preview: contentPreviewFromFields(h.fields),
    })),
    overlap_count: overlap,
    jaccard,
    pgvector_ms: pgMs,
    pinecone_ms: pineconeError ? null : pcMs,
    caller: opts.caller ?? null,
    metadata: {
      pinecone_host: opts.pineconeHost,
      pinecone_namespace: opts.pineconeNamespace ?? opts.namespace,
      ...(pgError ? { pg_error: pgError } : {}),
      ...(pineconeError ? { pinecone_error: pineconeError } : {}),
    },
  };
  // Fire-and-forget — awaited but wrapped so logging never surfaces as a caller error.
  try {
    await insertLogRow(opts.supabaseUrl, opts.supabaseServiceKey, logRow);
  } catch (_logErr) {
    // Swallow — the log is an observability convenience, not a correctness requirement.
  }

  if (pgError) throw new Error(pgError);
  return pgResults;
}

// --- Internals ---

async function callMatchMemory(
  supabaseUrl: string,
  serviceKey: string,
  embedding: number[],
  namespace: string,
  matchCount: number,
  metadataFilter: Record<string, unknown>,
): Promise<PgMatch[]> {
  const url = `${supabaseUrl}/rest/v1/rpc/match_memory`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "apikey": serviceKey,
      "authorization": `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({
      query_embedding: embedding,
      match_namespace: namespace,
      match_count: matchCount,
      metadata_filter: metadataFilter,
    }),
  });
  if (!res.ok) throw new Error(`match_memory ${res.status}: ${await res.text()}`);
  return (await res.json()) as PgMatch[];
}

async function callPineconeSearch(
  host: string,
  apiKey: string,
  namespace: string,
  embedding: number[],
  topK: number,
): Promise<PineconeHit[]> {
  // Pinecone BYO-vector /query endpoint — works on the current gravity-claw index.
  // (Not the /search endpoint, which requires an integrated index.)
  const url = `https://${host}/query`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Api-Key": apiKey,
      "X-Pinecone-API-Version": "2025-01",
    },
    body: JSON.stringify({
      namespace,
      vector: embedding,
      topK,
      includeMetadata: true,
      includeValues: false,
    }),
  });
  if (!res.ok) throw new Error(`pinecone /query ${res.status}: ${await res.text()}`);
  const body = await res.json() as { matches?: Array<{ id: string; score?: number; metadata?: Record<string, unknown> }> };
  return (body.matches ?? []).map((m) => ({
    _id: m.id,
    _score: m.score,
    fields: m.metadata,
  }));
}

async function insertLogRow(
  supabaseUrl: string,
  serviceKey: string,
  row: Record<string, unknown>,
): Promise<void> {
  const url = `${supabaseUrl}/rest/v1/memory_dualread_log`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "apikey": serviceKey,
      "authorization": `Bearer ${serviceKey}`,
      "prefer": "return=minimal",
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(`dualread log ${res.status}: ${await res.text()}`);
}

function contentPreviewFromFields(fields: Record<string, unknown> | undefined): string {
  if (!fields) return "";
  // Pinecone metadata commonly stores text under `text` or `content`; be permissive.
  const candidate = (fields["text"] ?? fields["content"] ?? fields["body"]) as string | undefined;
  return typeof candidate === "string" ? candidate.slice(0, 160) : "";
}

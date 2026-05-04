# LLM Cost Tracking — Implementation Plan

> **For agentic workers:** Execute task-by-task. Steps use checkbox (`- [ ]`) syntax. After every Task, commit before moving on.

**Date:** 2026-05-03
**Author:** Claude (rev 2 — incorporates Codex review findings)
**Goal:** Capture token usage on every LLM call across the dashboard + Edge Functions, compute estimated USD cost, and surface a 7-day rolling spend total on the home page so Edmund can see how expensive the system is to run.

**Revision history:**
- rev 1 → rev 2 (2026-05-03): Codex caught (a) wrong paths — there are TWO Edge Function trees: `dashboard/supabase/functions/` AND repo-root `supabase/functions/`. Fixed throughout. (b) `_shared/llm.ts` is **not** the only chokepoint — `curator_pass`, `mixture`, `delegate` (repo-root) call LLMs directly; added Task 7b. (c) `ConsensusOpts` doesn't currently accept `source`/`tool` and its internal `callLLM` call must forward them; fixed in Task 7. (d) `dashboard/lib/anthropic.ts` already calls `await stream.finalMessage()` at line 291 and returns it; rewrote Task 5 to splice into the existing call rather than append a duplicate. (e) Multiple `callLLM(...)` invocations per Edge Function — that's fine because all calls in a function share the same `source` label, but step says "grep first" explicitly.
- rev 2 → rev 3 (2026-05-03): Codex round 2 caught (a) `dashboard/supabase/functions/signals-ingest/index.ts` calls Gemini directly via `fetch` and was not instrumented; added Task 7c with Gemini-specific usage parsing (`usageMetadata.promptTokenCount` / `candidatesTokenCount`). (b) `curator_pass` and `delegate` parse responses into `j`, not `body`/`payload`; hardcoded `j` in Task 7b snippets. (c) Edge isolates may shut down before unawaited promises resolve; changed all Edge logger calls from `void logModelCall(...)` to `await logModelCall(...)` (the logger swallows errors internally, so awaiting is safe and cost rows don't get dropped). (d) Removed stale `dashboard/supabase/functions/_shared/llm-pricing.ts` reference from the file map — Task 6 explicitly inlines pricing instead.
- rev 3 → rev 4 (2026-05-03): Codex round 3 flagged `dashboard/supabase/functions/capture/index.ts::transcribeAudio` (Whisper/`gpt-4o-transcribe`) as a missed cost-bearing call. Whisper is priced per audio second, not per token, so the token-shaped schema doesn't fit cleanly. Explicitly added it to "out of scope" with a note to track audio cost in a follow-up if voice volume grows. Also updated the Risks table to reflect the Node-`void` / Edge-`await` split rather than the rev 1 "always void" wording.

**Architecture:**
- New table `public.model_calls` records one row per LLM response (tokens + computed cost + source/model).
- Single shared pricing table (`lib/llm-pricing.ts` + `supabase/functions/_shared/llm-pricing.ts`) drives cost estimation. List-price only; no volume discounts.
- Two thin loggers (Next.js / Deno) insert into the table via service-role. Failures never break the host call.
- Home page server component sums last 7 days and renders a card with a per-day sparkline + breakdown by source.

**Tech stack:** Postgres (Supabase), Next.js App Router, Anthropic SDK (streaming + non-streaming), Deno Edge Functions, OpenRouter via fetch.

**Out of scope:**
- Embeddings cost (`embed()` in `_shared/llm.ts`) — flat-rate, not on the hot path; skip unless trivial.
- Non-LLM costs (Supabase, Vercel, Firecrawl).
- Per-user attribution / RLS for non-admin viewers.
- Charts beyond a simple sparkline.
- One-off scripts (`dashboard/scripts/corva-propose.mjs`, `dashboard/scripts/corva-verify.mjs`) — run manually by Edmund a few times a month; not material to the weekly $ number. Can be added later if their share grows.
- **Audio transcription** (`dashboard/supabase/functions/capture/index.ts::transcribeAudio` → OpenAI `/v1/audio/transcriptions`) — Whisper/`gpt-4o-transcribe` is priced per audio second, not per token. The `model_calls` schema is token-shaped. Track transcription separately in a follow-up if voice capture spend grows; for now Edmund's voice-capture volume is small enough that excluding it doesn't materially distort the weekly $.

---

## Pre-flight grep results (locked, rev 2)

Verified 2026-05-03 before drafting:
- No existing table `model_calls`, `cost_usd`, `llm_calls`, or `usage_log` in `supabase/migrations/`. Latest migration: `036_artifact_links.sql`. → Use `037_model_calls.sql`.
- **TWO Edge Function trees, both deploy to project `obizmgugsqirmnjpirnh`:**
  - `dashboard/supabase/functions/` — has `processor-run`, `contradiction-scan`, `permanent-gate`, `researcher-run`, `research-director-synthesis`, plus `_shared/llm.ts` (the `callLLM` helper).
  - Repo-root `supabase/functions/` — has `curator_pass`, `delegate`, `mixture`, `route_query`, `youtube-ingest-mcp`. Three of those call LLMs directly via `fetch` (no shared helper).
- LLM call sites in dashboard (Node): `dashboard/lib/anthropic.ts` (streaming, main agent chat — `stream.finalMessage()` already returned at line 291), `dashboard/lib/agent-runner.ts` line ~215 (non-streaming, wake loop).
- LLM call sites in dashboard Edge tree: every `callLLM(...)` invocation inside the 5 functions above. Some functions invoke it 2–4×; that's fine — all calls in one function share the same `source` label, so a single import + edit per function covers them.
- LLM call sites in repo-root Edge tree: `curator_pass/index.ts::callLLM` (line ~77, local helper, not the shared one), `mixture/index.ts::callOpenRouter` (line ~32), `delegate/index.ts::llmSummarize` (line ~48). Each does its own `fetch` and parses `payload.usage = { prompt_tokens, completion_tokens }`.
- Anthropic SDK usage shape: `response.usage = { input_tokens, output_tokens, cache_creation_input_tokens?, cache_read_input_tokens? }`. Streaming exposes the same via `stream.finalMessage()`.
- OpenRouter response shape: `payload.usage = { prompt_tokens, completion_tokens }`. No cache fields.
- Home page (`dashboard/app/page.tsx`) is a server component that already imports `createClient` from `@supabase/supabase-js` and a `WeeklyReviewTile`. Stats card grid pattern lives at lines ~145–162.
- `ConsensusOpts` (in `dashboard/supabase/functions/_shared/llm.ts` line ~228) has no `source`/`tool` field and its internal `callLLM` call (line ~279) does not forward attribution. Both must be extended in Task 7.

---

## File map (rev 2)

**Create:**
- `supabase/migrations/037_model_calls.sql` — table + indexes + RLS + aggregate view
- `dashboard/lib/llm-pricing.ts` — pricing constants + `estimateCostUsd()` (Node)
- `dashboard/lib/model-cost.ts` — `logModelCall()` (Node, fire-and-forget insert)
- `dashboard/supabase/functions/_shared/cost-log.ts` — `logModelCall()` + inlined pricing for the dashboard Edge tree (Deno)
- `supabase/functions/_shared/cost-log.ts` — identical content for the repo-root Edge tree (Deno). Both `cost-log.ts` files inline pricing and are kept in sync manually.
- `dashboard/components/admin/weekly-cost-tile.tsx` — server component widget

**Modify:**
- `dashboard/lib/anthropic.ts` — splice logging into the existing `stream.finalMessage()` site (~line 291)
- `dashboard/lib/agent-runner.ts` — log usage from wake `messages.create` response (~line 215)
- `dashboard/supabase/functions/_shared/llm.ts` — call `logModelCall()` after every `callLLM` response, extend `LLMCallOpts` and `ConsensusOpts` with `source`/`tool`
- `dashboard/supabase/functions/{processor-run,contradiction-scan,permanent-gate,researcher-run,research-director-synthesis}/index.ts` — pass `source: "edge:<fn-name>"` to every `callLLM` / `callLLMConsensus` call
- `supabase/functions/curator_pass/index.ts` — log after the local `callLLM` helper returns
- `supabase/functions/mixture/index.ts` — log after `callOpenRouter` returns
- `supabase/functions/delegate/index.ts` — log after `llmSummarize` returns
- `dashboard/app/page.tsx` — render `<WeeklyCostTile />` in the stats grid

---

## Task 1: Migration — `public.model_calls`

**Files:**
- Create: `supabase/migrations/037_model_calls.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 037_model_calls.sql
-- Per-LLM-response usage + estimated cost. One row per provider response
-- (i.e. one row per messages.create or chat/completions call). Used to
-- estimate weekly spend and spot expensive workflows.

create table if not exists public.model_calls (
  id              bigserial primary key,
  ts              timestamptz not null default now(),
  source          text        not null,        -- 'agent_chat' | 'agent_wake' | 'edge:processor-run' | 'edge:researcher-run' | ...
  model           text        not null,        -- exact model id as sent to provider
  provider        text        not null,        -- 'anthropic' | 'openrouter' | 'openai'
  input_tokens         integer not null default 0,
  output_tokens        integer not null default 0,
  cache_read_tokens    integer not null default 0,
  cache_write_tokens   integer not null default 0,
  est_cost_usd    numeric(12,6) not null default 0,
  agent_id        text,
  tool            text,
  latency_ms      integer,
  metadata        jsonb       not null default '{}'::jsonb
);

create index if not exists model_calls_ts_idx       on public.model_calls (ts desc);
create index if not exists model_calls_source_ts_idx on public.model_calls (source, ts desc);
create index if not exists model_calls_agent_ts_idx on public.model_calls (agent_id, ts desc) where agent_id is not null;

alter table public.model_calls enable row level security;

-- Service role writes; anon can read aggregate-only via the helper view below.
-- (We don't expose row-level reads to anon to avoid leaking model/tool patterns.)
create policy "service_role full access"
  on public.model_calls
  for all
  to service_role
  using (true) with check (true);

-- Aggregate view: per-day totals, last 30 days. Safe to expose to anon.
create or replace view public.model_calls_daily as
  select
    date_trunc('day', ts)::date as day,
    source,
    sum(input_tokens)        as input_tokens,
    sum(output_tokens)       as output_tokens,
    sum(cache_read_tokens)   as cache_read_tokens,
    sum(cache_write_tokens)  as cache_write_tokens,
    sum(est_cost_usd)        as est_cost_usd,
    count(*)                 as call_count
  from public.model_calls
  where ts > now() - interval '30 days'
  group by 1, 2;

grant select on public.model_calls_daily to anon, authenticated;
```

- [ ] **Step 2: Apply via Supabase MCP**

Use the `apply_migration` MCP tool with `project_id = obizmgugsqirmnjpirnh`, name `037_model_calls`, and the SQL above. Confirm result is `success: true`.

- [ ] **Step 3: Smoke-check**

Run via MCP `execute_sql`:
```sql
select column_name, data_type from information_schema.columns
where table_schema='public' and table_name='model_calls' order by ordinal_position;
select count(*) from public.model_calls;
```
Expected: 14 columns (id…metadata), count=0.

- [ ] **Step 4: Commit**

```bash
cd /Users/edmundmitchell/factory
git add supabase/migrations/037_model_calls.sql
git commit -m "db: add model_calls table for LLM cost tracking"
```

---

## Task 2: Pricing module (Node)

**Files:**
- Create: `dashboard/lib/llm-pricing.ts`

- [ ] **Step 1: Write pricing table**

```ts
// dashboard/lib/llm-pricing.ts
// LLM list-price reference (USD per 1M tokens). Update when providers change rates.
// Source: Anthropic + OpenAI public pricing pages, 2026-05-03.
// All values are list price; we don't model volume discounts or batch API rates.

export type ModelPricing = {
  input: number;        // $ per 1M input tokens
  output: number;       // $ per 1M output tokens
  cacheRead?: number;   // $ per 1M cached-read tokens (defaults to 0.1 * input)
  cacheWrite?: number;  // $ per 1M cache-write tokens (defaults to 1.25 * input)
};

// Keys are matched case-insensitively, with both the bare Anthropic id
// (e.g. "claude-sonnet-4-6") and the OpenRouter form ("anthropic/claude-sonnet-4-6")
// resolving to the same entry.
const PRICING: Record<string, ModelPricing> = {
  // Anthropic
  "claude-opus-4-7":     { input: 15.0, output: 75.0 },
  "claude-sonnet-4-6":   { input:  3.0, output: 15.0 },
  "claude-haiku-4-5":    { input:  1.0, output:  5.0 },
  // OpenAI
  "gpt-4o":              { input:  2.5, output: 10.0 },
  "gpt-4o-mini":         { input:  0.15, output: 0.6 },
  // Google
  "gemini-2.5-pro":      { input:  1.25, output: 10.0 },
  "gemini-2.5-flash":    { input:  0.30, output: 2.5 },
};

const FALLBACK: ModelPricing = { input: 3.0, output: 15.0 }; // assume Sonnet-ish if unknown

function normalizeModelId(model: string): string {
  const m = model.toLowerCase().trim();
  // Strip provider prefix used by OpenRouter ("anthropic/", "openai/", "google/")
  const slash = m.indexOf("/");
  return slash >= 0 ? m.slice(slash + 1) : m;
}

export function lookupPricing(model: string): { pricing: ModelPricing; matched: boolean } {
  const key = normalizeModelId(model);
  // exact match first
  if (PRICING[key]) return { pricing: PRICING[key], matched: true };
  // prefix match (e.g. "claude-haiku-4-5-20251001" → "claude-haiku-4-5")
  for (const k of Object.keys(PRICING)) {
    if (key.startsWith(k)) return { pricing: PRICING[k], matched: true };
  }
  return { pricing: FALLBACK, matched: false };
}

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

export function estimateCostUsd(model: string, usage: Usage): number {
  const { pricing } = lookupPricing(model);
  const cacheRead  = pricing.cacheRead  ?? pricing.input * 0.1;
  const cacheWrite = pricing.cacheWrite ?? pricing.input * 1.25;
  const cost =
    (usage.inputTokens       / 1_000_000) * pricing.input  +
    (usage.outputTokens      / 1_000_000) * pricing.output +
    ((usage.cacheReadTokens  ?? 0) / 1_000_000) * cacheRead +
    ((usage.cacheWriteTokens ?? 0) / 1_000_000) * cacheWrite;
  return Math.round(cost * 1_000_000) / 1_000_000; // 6dp
}
```

- [ ] **Step 2: Smoke test in REPL (optional, no commit)**

```bash
cd /Users/edmundmitchell/factory/dashboard
node --input-type=module -e "
import('./lib/llm-pricing.ts').then(m => {
  console.log(m.estimateCostUsd('claude-sonnet-4-6', { inputTokens: 1_000_000, outputTokens: 100_000 }));
  // expected: 3.0 + 1.5 = 4.5
});" 2>/dev/null || echo "skip if tsx not configured; verified in Task 3"
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/lib/llm-pricing.ts
git commit -m "lib: add LLM pricing table + estimateCostUsd helper"
```

---

## Task 3: Logger — Node side

**Files:**
- Create: `dashboard/lib/model-cost.ts`

- [ ] **Step 1: Write the logger**

```ts
// dashboard/lib/model-cost.ts
// Fire-and-forget insert into public.model_calls. NEVER throws — a failed
// insert must not break the LLM call it's instrumenting.

import { createClient } from "@supabase/supabase-js";
import { estimateCostUsd, type Usage } from "@/lib/llm-pricing";

let client: ReturnType<typeof createClient> | null = null;

function getClient() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

export type ProviderName = "anthropic" | "openrouter" | "openai";

export type LogModelCallInput = {
  source: string;             // 'agent_chat' | 'agent_wake' | 'edge:<fn-name>'
  model: string;
  provider: ProviderName;
  usage: Usage;
  agentId?: string;
  tool?: string;
  latencyMs?: number;
  metadata?: Record<string, unknown>;
};

export async function logModelCall(input: LogModelCallInput): Promise<void> {
  try {
    const sb = getClient();
    if (!sb) return;
    const cost = estimateCostUsd(input.model, input.usage);
    await sb.from("model_calls").insert({
      source: input.source,
      model: input.model,
      provider: input.provider,
      input_tokens:        input.usage.inputTokens       || 0,
      output_tokens:       input.usage.outputTokens      || 0,
      cache_read_tokens:   input.usage.cacheReadTokens   || 0,
      cache_write_tokens:  input.usage.cacheWriteTokens  || 0,
      est_cost_usd: cost,
      agent_id: input.agentId ?? null,
      tool: input.tool ?? null,
      latency_ms: input.latencyMs ?? null,
      metadata: input.metadata ?? {},
    });
  } catch (err) {
    // Swallow — instrumentation must never break the host call.
    console.error("[model-cost] log failed:", err);
  }
}
```

- [ ] **Step 2: Type-check**

```bash
cd /Users/edmundmitchell/factory/dashboard
npx tsc --noEmit lib/model-cost.ts lib/llm-pricing.ts
```
Expected: no errors. (If `--noEmit` complains about `paths`, run `npx tsc --noEmit -p tsconfig.json` and confirm clean compile of the project.)

- [ ] **Step 3: Commit**

```bash
git add dashboard/lib/model-cost.ts
git commit -m "lib: add fire-and-forget logModelCall helper"
```

---

## Task 4: Wrap the agent-wake call (`agent-runner.ts`)

**Files:**
- Modify: `dashboard/lib/agent-runner.ts` around line 215 (the `client.messages.create` call inside the wake loop)

- [ ] **Step 1: Add import**

At the top of `dashboard/lib/agent-runner.ts`, after the existing `import { getMessages } from "@/lib/slack";` line, add:

```ts
import { logModelCall } from "@/lib/model-cost";
```

- [ ] **Step 2: Capture timing + log usage**

Locate the wake loop (currently around lines 214–222):

```ts
      const response = await client.messages.create({
        model: WAKE_MODEL,
        max_tokens: 4000,
        system: [ ... ],
        tools,
        messages,
      });
```

Replace with:

```ts
      const callStart = Date.now();
      const response = await client.messages.create({
        model: WAKE_MODEL,
        max_tokens: 4000,
        system: [
          {
            type: "text" as const,
            text: systemPrompt,
            cache_control: { type: "ephemeral" as const },
          },
        ],
        tools,
        messages,
      });
      void logModelCall({
        source: "agent_wake",
        model: WAKE_MODEL,
        provider: "anthropic",
        usage: {
          inputTokens:       response.usage?.input_tokens ?? 0,
          outputTokens:      response.usage?.output_tokens ?? 0,
          cacheReadTokens:   response.usage?.cache_read_input_tokens ?? 0,
          cacheWriteTokens:  response.usage?.cache_creation_input_tokens ?? 0,
        },
        agentId: canonicalId,
        latencyMs: Date.now() - callStart,
        metadata: { stop_reason: response.stop_reason, loop: loops },
      });
```

(Keep the `system: [...]` block exactly as it was — the snippet above is the full replacement, not an abbreviation.)

- [ ] **Step 3: Type-check + run dev server**

```bash
cd /Users/edmundmitchell/factory/dashboard
npx tsc --noEmit -p tsconfig.json
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add dashboard/lib/agent-runner.ts
git commit -m "agent-runner: log model_calls usage on every wake"
```

---

## Task 5: Wrap the agent-chat stream (`anthropic.ts`)

**Files:**
- Modify: `dashboard/lib/anthropic.ts` (the `client.messages.stream` call site at line ~210 and the existing `stream.finalMessage()` return at line ~291)

- [ ] **Step 1: Re-confirm line numbers before editing**

```bash
grep -n "client.messages.stream\|stream.finalMessage" dashboard/lib/anthropic.ts
grep -n "export async function\|export function\|generator\|yield {" dashboard/lib/anthropic.ts | head -10
```

Use the actual line numbers returned. The current snapshot shows:
- `client.messages.stream({` near line 209
- `const finalMessage = await stream.finalMessage(); return finalMessage;` near line 291

Identify the parameter name carrying the agent identity in the function signature that wraps these calls. In the current file it is `agent: Agent`. Use that name in Step 3.

- [ ] **Step 2: Add import**

At the top of `dashboard/lib/anthropic.ts`, alongside the existing imports, add:

```ts
import { logModelCall } from "@/lib/model-cost";
```

- [ ] **Step 3: Capture start time before the stream and splice logging into the existing `finalMessage()` return**

Find the line:
```ts
  const stream = client.messages.stream({
```

Insert immediately *above* it:
```ts
  const streamStart = Date.now();
```

Find the existing return block at the end of the function:
```ts
  const finalMessage = await stream.finalMessage();
  return finalMessage;
}
```

Replace it with:
```ts
  const finalMessage = await stream.finalMessage();
  void logModelCall({
    source: "agent_chat",
    model: MODEL,
    provider: "anthropic",
    usage: {
      inputTokens:      finalMessage.usage?.input_tokens ?? 0,
      outputTokens:     finalMessage.usage?.output_tokens ?? 0,
      cacheReadTokens:  finalMessage.usage?.cache_read_input_tokens ?? 0,
      cacheWriteTokens: finalMessage.usage?.cache_creation_input_tokens ?? 0,
    },
    agentId: agent?.id,
    latencyMs: Date.now() - streamStart,
    metadata: { stop_reason: finalMessage.stop_reason },
  });
  return finalMessage;
}
```

(If Step 1's grep showed the agent parameter is named something other than `agent`, use that name. If no agent identifier is in scope of this function, drop the `agentId` field entirely — the migration allows null.)

- [ ] **Step 4: Type-check**

```bash
cd /Users/edmundmitchell/factory/dashboard
npx tsc --noEmit -p tsconfig.json
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add dashboard/lib/anthropic.ts
git commit -m "anthropic: log model_calls usage from streaming agent chat"
```

---

## Task 6: Pricing module + logger — both Edge Function trees

There are two Edge Function trees that need a logger: `dashboard/supabase/functions/` and repo-root `supabase/functions/`. They cannot share files (Supabase deploys them as separate function bundles), so we create a `cost-log.ts` in each tree. Each `cost-log.ts` inlines its own copy of the small pricing table — no separate `llm-pricing.ts` mirror, less drift.

**Files:**
- Create: `dashboard/supabase/functions/_shared/cost-log.ts`
- Create: `supabase/functions/_shared/cost-log.ts`

- [ ] **Step 1: Write the dashboard-tree logger**

Create `dashboard/supabase/functions/_shared/cost-log.ts`:

```ts
// dashboard/supabase/functions/_shared/cost-log.ts
// Fire-and-forget insert into public.model_calls. Mirror of the repo-root
// supabase/functions/_shared/cost-log.ts — keep both in sync. Pricing table
// is inlined to avoid cross-bundle imports under Deno deploy.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type ModelPricing = { input: number; output: number; cacheRead?: number; cacheWrite?: number };

const PRICING: Record<string, ModelPricing> = {
  "claude-opus-4-7":   { input: 15.0, output: 75.0 },
  "claude-sonnet-4-6": { input:  3.0, output: 15.0 },
  "claude-haiku-4-5":  { input:  1.0, output:  5.0 },
  "gpt-4o":            { input:  2.5, output: 10.0 },
  "gpt-4o-mini":       { input:  0.15, output: 0.6 },
  "gemini-2.5-pro":    { input:  1.25, output: 10.0 },
  "gemini-2.5-flash":  { input:  0.30, output: 2.5 },
};
const FALLBACK: ModelPricing = { input: 3.0, output: 15.0 };

function lookupPricing(model: string): ModelPricing {
  const m = model.toLowerCase().trim();
  const key = m.includes("/") ? m.slice(m.indexOf("/") + 1) : m;
  if (PRICING[key]) return PRICING[key];
  for (const k of Object.keys(PRICING)) if (key.startsWith(k)) return PRICING[k];
  return FALLBACK;
}

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

export function estimateCostUsd(model: string, u: Usage): number {
  const p = lookupPricing(model);
  const cr = p.cacheRead  ?? p.input * 0.1;
  const cw = p.cacheWrite ?? p.input * 1.25;
  const cost =
    (u.inputTokens       / 1e6) * p.input  +
    (u.outputTokens      / 1e6) * p.output +
    ((u.cacheReadTokens  ?? 0) / 1e6) * cr +
    ((u.cacheWriteTokens ?? 0) / 1e6) * cw;
  return Math.round(cost * 1e6) / 1e6;
}

let client: ReturnType<typeof createClient> | null = null;
function getClient() {
  if (client) return client;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

export type LogModelCallInput = {
  source: string;
  model: string;
  provider: "anthropic" | "openrouter" | "openai";
  usage: Usage;
  agentId?: string;
  tool?: string;
  latencyMs?: number;
  metadata?: Record<string, unknown>;
};

export async function logModelCall(input: LogModelCallInput): Promise<void> {
  try {
    const sb = getClient();
    if (!sb) return;
    const cost = estimateCostUsd(input.model, input.usage);
    await sb.from("model_calls").insert({
      source: input.source,
      model: input.model,
      provider: input.provider,
      input_tokens:       input.usage.inputTokens      || 0,
      output_tokens:      input.usage.outputTokens     || 0,
      cache_read_tokens:  input.usage.cacheReadTokens  || 0,
      cache_write_tokens: input.usage.cacheWriteTokens || 0,
      est_cost_usd: cost,
      agent_id: input.agentId ?? null,
      tool: input.tool ?? null,
      latency_ms: input.latencyMs ?? null,
      metadata: input.metadata ?? {},
    });
  } catch (err) {
    console.error("[cost-log] insert failed:", err);
  }
}
```

- [ ] **Step 2: Write the repo-root-tree logger**

Create `supabase/functions/_shared/cost-log.ts` with **identical content** to the file written in Step 1. Use `cp dashboard/supabase/functions/_shared/cost-log.ts supabase/functions/_shared/cost-log.ts`. Add a comment at the top: `// Mirror of dashboard/supabase/functions/_shared/cost-log.ts — keep in sync.`

- [ ] **Step 3: Commit**

```bash
git add dashboard/supabase/functions/_shared/cost-log.ts \
        supabase/functions/_shared/cost-log.ts
git commit -m "edge: add cost-log helper for both Edge Function trees"
```

---

## Task 7: Wrap `callLLM` in the dashboard `_shared/llm.ts`

**Files:**
- Modify: `dashboard/supabase/functions/_shared/llm.ts` (NOT the repo-root path — that file does not exist)

- [ ] **Step 1: Add import**

At the top of `dashboard/supabase/functions/_shared/llm.ts`, add:

```ts
import { logModelCall } from "./cost-log.ts";
```

- [ ] **Step 2: Extend `LLMCallOpts` and `ConsensusOpts` with attribution fields**

Find `export type LLMCallOpts = { ... }` (currently around line 200). Replace its closing brace area with:

```ts
export type LLMCallOpts = {
  tier?: ModelTier;
  model?: string;
  system: string;
  user: string;
  temperature?: number;
  jsonMode?: boolean;
  timeoutMs?: number;
  maxTokens?: number;
  /** Logical source of this call, used for cost attribution. */
  source?: string;
  /** Optional tool/task label for finer-grained cost slicing. */
  tool?: string;
};
```

Find `export type ConsensusOpts = { ... }` (currently around line 228). Add the same two optional fields:

```ts
export type ConsensusOpts = {
  // ... existing fields ...
  source?: string;
  tool?: string;
};
```

(Keep all existing ConsensusOpts fields. Read the current type from the file first and only append `source?: string;` and `tool?: string;` before the closing brace.)

- [ ] **Step 3: Log after a successful response inside `callLLM`**

Find the `return { content, parsed, model: modelForCall, tokens: ... }` block (currently lines ~180–195). Immediately before the `return`, insert:

```ts
    await logModelCall({
      source: opts.source ?? "edge:unknown",
      model: modelForCall,
      provider: header === "openrouter" ? "openrouter" : "openai",
      usage: {
        inputTokens:  payload.usage?.prompt_tokens ?? 0,
        outputTokens: payload.usage?.completion_tokens ?? 0,
      },
      tool: opts.tool,
      latencyMs: Date.now() - t0,
      metadata: opts.tier ? { tier: opts.tier } : {},
    });
```

(`await` rather than `void` — Edge isolates can shut down before unawaited promises resolve. The logger swallows its own errors so awaiting cannot break the host call.)

- [ ] **Step 4: Forward `source`/`tool` from `callLLMConsensus` into its internal `callLLM` calls**

Find the body of `callLLMConsensus` (currently around line 240+). It calls `callLLM(...)` internally (around line 279). Update those internal calls so each one forwards `source` and `tool` from the consensus opts:

```ts
const result = await callLLM({
  // ... existing fields built from consensusOpts ...
  source: opts.source,
  tool: opts.tool,
});
```

Read the existing call shape and add only the two fields — do not change any other argument.

- [ ] **Step 5: Pass `source` from each dashboard-tree Edge Function caller**

Run grep to enumerate every `callLLM(` and `callLLMConsensus(` call inside the dashboard tree:

```bash
grep -rn "callLLM(\|callLLMConsensus(" dashboard/supabase/functions/ --include="*.ts"
```

For every call site, add `source: "edge:<fn-name>"` to the options object. Expected functions and source labels:
- `dashboard/supabase/functions/processor-run/index.ts` → `source: "edge:processor-run"`
- `dashboard/supabase/functions/contradiction-scan/index.ts` → `source: "edge:contradiction-scan"`
- `dashboard/supabase/functions/permanent-gate/index.ts` → `source: "edge:permanent-gate"`
- `dashboard/supabase/functions/researcher-run/index.ts` → `source: "edge:researcher-run"`
- `dashboard/supabase/functions/research-director-synthesis/index.ts` → `source: "edge:research-director-synthesis"`

A function may call `callLLM` 2–4 times (e.g. processor consensus + processor escalation, permanent-gate parallel + judge). Add `source` to **every** call — they all share the same fn-level label. If a call would benefit from a finer slice, also add a `tool: "<short-task-name>"` label.

- [ ] **Step 6: Deploy dashboard-tree Edge Functions**

Per memory `feedback_edge_function_deploys_via_cli.md`:

```bash
cd /Users/edmundmitchell/factory/dashboard
set -a; source .env.local; set +a
for fn in processor-run contradiction-scan permanent-gate researcher-run research-director-synthesis; do
  npx supabase functions deploy "$fn" --project-ref obizmgugsqirmnjpirnh
done
```

Expected: each deploy ends with `Deployed Function ...`. If any fails, stop and inspect.

- [ ] **Step 7: Smoke-test one function**

Per memory `feedback_supabase_edge_smoke_keys.md`, use the service-role key. Use `processor-run` (lightest):

```bash
cd /Users/edmundmitchell/factory
set -a; source dashboard/.env.local; set +a
curl -sS -X POST \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"limit":1,"force":true}' \
  "https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/processor-run" | head -c 500
```

Then via Supabase MCP `execute_sql` (project_id `obizmgugsqirmnjpirnh`):
```sql
select ts, source, model, input_tokens, output_tokens, est_cost_usd
from public.model_calls order by ts desc limit 5;
```
Expected: at least one row with `source LIKE 'edge:%'` and `est_cost_usd > 0`. If `processor-run` returns "no work_log items" (because the inbox is empty at runtime), pick `researcher-run` instead with a tiny question payload.

- [ ] **Step 8: Commit**

```bash
git add dashboard/supabase/functions/_shared/llm.ts \
        dashboard/supabase/functions/processor-run/index.ts \
        dashboard/supabase/functions/contradiction-scan/index.ts \
        dashboard/supabase/functions/permanent-gate/index.ts \
        dashboard/supabase/functions/researcher-run/index.ts \
        dashboard/supabase/functions/research-director-synthesis/index.ts
git commit -m "edge: instrument callLLM/callLLMConsensus with model_calls logging"
```

---

## Task 7b: Wrap the repo-root Edge Functions (`curator_pass`, `mixture`, `delegate`)

These three live in `supabase/functions/` (NOT `dashboard/supabase/functions/`) and call LLMs directly via `fetch` — the dashboard `_shared/llm.ts` instrumentation does not cover them.

**Files:**
- Modify: `supabase/functions/curator_pass/index.ts` (local `callLLM` helper at ~line 77)
- Modify: `supabase/functions/mixture/index.ts` (`callOpenRouter` at ~line 32)
- Modify: `supabase/functions/delegate/index.ts` (`llmSummarize` at ~line 48)

- [ ] **Step 1: Confirm call shapes with grep**

```bash
grep -n "fetch(\|usage" supabase/functions/curator_pass/index.ts \
                          supabase/functions/mixture/index.ts \
                          supabase/functions/delegate/index.ts | head -40
```

Each function calls `fetch(...)` against OpenAI/OpenRouter and parses `payload.usage = { prompt_tokens, completion_tokens }` (mixture already does so explicitly). Confirm before editing.

- [ ] **Step 2: Instrument `curator_pass`**

In `supabase/functions/curator_pass/index.ts`, add at the top of imports:

```ts
import { logModelCall } from "../_shared/cost-log.ts";
```

Find the local `async function callLLM(...)` helper (~line 77). The current body is roughly:

```ts
const res = await fetch(llmAuth.base, { ... });
if (!res.ok) { ... throw ... }
const j = await res.json();
return (j.choices?.[0]?.message?.content ?? "").toString();
```

Modify to:

```ts
const t0 = Date.now();
const res = await fetch(llmAuth.base, { ... });
if (!res.ok) {
  const txt = await res.text();
  throw new Error(`llm ${res.status}: ${txt.slice(0, 500)}`);
}
const j = await res.json();
await logModelCall({
  source: "edge:curator_pass",
  model,
  provider: llmAuth.isOpenRouter ? "openrouter" : "openai",
  usage: {
    inputTokens:  j.usage?.prompt_tokens ?? 0,
    outputTokens: j.usage?.completion_tokens ?? 0,
  },
  latencyMs: Date.now() - t0,
});
return (j.choices?.[0]?.message?.content ?? "").toString();
```

(`await` rather than `void` because Edge isolates can shut down before an unawaited promise resolves; the logger swallows its own errors so awaiting is safe.)

- [ ] **Step 3: Instrument `mixture`**

In `supabase/functions/mixture/index.ts`, add the import:

```ts
import { logModelCall } from "../_shared/cost-log.ts";
```

`callOpenRouter` already captures `t0 = Date.now()` and parses `j = await res.json()`. Find the `return { content: ..., ms: ..., tokens: ... }` block at the end of `callOpenRouter` (~line 53). Insert immediately above the `return`:

```ts
await logModelCall({
  source: "edge:mixture",
  model,
  provider: "openrouter",
  usage: {
    inputTokens:  j.usage?.prompt_tokens ?? 0,
    outputTokens: j.usage?.completion_tokens ?? 0,
  },
  latencyMs: Date.now() - t0,
});
```

Keep the existing `return` exactly as written.

- [ ] **Step 4: Instrument `delegate`**

In `supabase/functions/delegate/index.ts`, add the import:

```ts
import { logModelCall } from "../_shared/cost-log.ts";
```

Find `async function llmSummarize(...)` (~line 48). The current body parses `const j = await res.json();` and returns `(j.choices?.[0]?.message?.content ?? "").trim()`. Modify to:

```ts
const t0 = Date.now();
// ... existing fetch + ok-check ...
const j = await res.json();
await logModelCall({
  source: "edge:delegate",
  model,
  provider: auth.isOpenRouter ? "openrouter" : "openai",
  usage: {
    inputTokens:  j.usage?.prompt_tokens ?? 0,
    outputTokens: j.usage?.completion_tokens ?? 0,
  },
  latencyMs: Date.now() - t0,
});
return (j.choices?.[0]?.message?.content ?? "").trim();
```

- [ ] **Step 5: Deploy repo-root tree**

```bash
cd /Users/edmundmitchell/factory
set -a; source dashboard/.env.local; set +a
for fn in curator_pass mixture delegate; do
  npx supabase functions deploy "$fn" --project-ref obizmgugsqirmnjpirnh
done
```

Expected: each deploy ends with `Deployed Function ...`.

- [ ] **Step 6: Smoke-test mixture (cheapest to invoke)**

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "x-capture-secret: $CAPTURE_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"question":"ping — testing cost logging"}' \
  "https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/mixture" | head -c 300
```

Then verify a row exists with `source = 'edge:mixture'`.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/curator_pass/index.ts \
        supabase/functions/mixture/index.ts \
        supabase/functions/delegate/index.ts
git commit -m "edge: instrument curator_pass / mixture / delegate with cost logging"
```

---

## Task 7c: Wrap the `signals-ingest` Gemini call

`dashboard/supabase/functions/signals-ingest/index.ts::summarize()` calls Gemini directly (not via `_shared/llm.ts`). Gemini's response shape differs from OpenAI's — usage lives at `body.usageMetadata.{ promptTokenCount, candidatesTokenCount }`.

**Files:**
- Modify: `dashboard/supabase/functions/signals-ingest/index.ts`

- [ ] **Step 1: Add the import**

At the top of `dashboard/supabase/functions/signals-ingest/index.ts`, alongside other shared imports, add:

```ts
import { logModelCall } from "../_shared/cost-log.ts";
```

- [ ] **Step 2: Extend the response type and log**

Find (around line 200):

```ts
    const body = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
```

Replace with:

```ts
    const body = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
```

Find the `summarize()` function entry (around line 170) and insert at the top, after the early-return for missing apiKey:

```ts
const t0 = Date.now();
```

(There may already be a `controller`/`timeout` block — put `const t0` immediately above `const controller = new AbortController();`.)

After the line `if (!text.trim()) throw new Error("gemini: empty response text");` insert:

```ts
await logModelCall({
  source: "edge:signals-ingest",
  model: "gemini-2.5-flash",
  provider: "openai", // closest enum match; Gemini direct calls fall under "openai" as a general non-anthropic non-openrouter bucket. (We could extend the enum, but signals-ingest is the only direct-Gemini caller right now.)
  usage: {
    inputTokens:  body.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0,
  },
  latencyMs: Date.now() - t0,
  metadata: { gemini_direct: true },
});
```

(If Edmund wants `provider: "gemini"` as a real category, extend the `provider` union in both `cost-log.ts` files and the migration column allows any text already, so no schema change needed. Default for now: tag `metadata.gemini_direct = true` so a query can split it out without a column change.)

- [ ] **Step 3: Deploy + smoke**

```bash
cd /Users/edmundmitchell/factory/dashboard
set -a; source .env.local; set +a
npx supabase functions deploy signals-ingest --project-ref obizmgugsqirmnjpirnh
```

`signals-ingest` is triggered by cron (signals feed). Either wait for the next cron tick, or invoke manually with a test payload from the function's existing docstring. Then verify a row with `source = 'edge:signals-ingest'` appears.

- [ ] **Step 4: Commit**

```bash
git add dashboard/supabase/functions/signals-ingest/index.ts
git commit -m "edge: instrument signals-ingest Gemini call with cost logging"
```

---

## Task 8: Home page widget

**Files:**
- Create: `dashboard/components/admin/weekly-cost-tile.tsx`
- Modify: `dashboard/app/page.tsx`

- [ ] **Step 1: Write the tile component**

```tsx
// dashboard/components/admin/weekly-cost-tile.tsx
import { createClient } from "@supabase/supabase-js";
import { Card, CardContent } from "@/components/ui/card";
import { DollarSign } from "@/lib/icons";

type DailyRow = { day: string; source: string; est_cost_usd: number };

async function fetchWeeklyCost(): Promise<{
  total7d: number;
  bySource: Array<{ source: string; cost: number }>;
  perDay: Array<{ day: string; cost: number }>;
} | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { data, error } = await sb
    .from("model_calls_daily")
    .select("day,source,est_cost_usd")
    .gte("day", since);
  if (error || !data) return null;
  const rows = data as DailyRow[];
  const total7d = rows.reduce((a, r) => a + Number(r.est_cost_usd || 0), 0);

  const sourceMap = new Map<string, number>();
  for (const r of rows) {
    sourceMap.set(r.source, (sourceMap.get(r.source) ?? 0) + Number(r.est_cost_usd || 0));
  }
  const bySource = [...sourceMap.entries()]
    .map(([source, cost]) => ({ source, cost }))
    .sort((a, b) => b.cost - a.cost);

  const dayMap = new Map<string, number>();
  for (const r of rows) {
    dayMap.set(r.day, (dayMap.get(r.day) ?? 0) + Number(r.est_cost_usd || 0));
  }
  const perDay = [...dayMap.entries()]
    .map(([day, cost]) => ({ day, cost }))
    .sort((a, b) => a.day.localeCompare(b.day));

  return { total7d, bySource, perDay };
}

function fmt(n: number): string {
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 10)  return `$${n.toFixed(1)}`;
  return `$${n.toFixed(2)}`;
}

export async function WeeklyCostTile() {
  const data = await fetchWeeklyCost();
  if (!data) {
    return (
      <Card className="border-border bg-card">
        <CardContent className="p-4">
          <p className="label-mono-sm text-muted-foreground">7-day LLM cost</p>
          <p className="text-2xl font-semibold text-foreground mt-1">—</p>
        </CardContent>
      </Card>
    );
  }
  const max = Math.max(0.0001, ...data.perDay.map((d) => d.cost));
  return (
    <Card className="border-border bg-card">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="label-mono-sm text-muted-foreground">7-day LLM cost (est.)</p>
            <p className="text-2xl font-semibold text-foreground mt-1">{fmt(data.total7d)}</p>
          </div>
          <DollarSign className="size-5 text-muted-foreground/50" />
        </div>
        <div className="flex items-end gap-1 mt-3 h-8">
          {data.perDay.map((d) => (
            <div
              key={d.day}
              className="flex-1 bg-primary/40 rounded-sm"
              style={{ height: `${Math.max(2, (d.cost / max) * 100)}%` }}
              title={`${d.day}: ${fmt(d.cost)}`}
            />
          ))}
        </div>
        <div className="mt-3 space-y-0.5">
          {data.bySource.slice(0, 4).map((s) => (
            <div key={s.source} className="flex justify-between text-xs text-muted-foreground">
              <span className="truncate">{s.source}</span>
              <span className="tabular-nums">{fmt(s.cost)}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify `DollarSign` icon export**

```bash
grep -n "DollarSign" dashboard/lib/icons.ts dashboard/lib/icons.tsx 2>/dev/null
```

If `DollarSign` is not re-exported, either add it to `lib/icons` (preferred — match existing pattern) or import it directly from `lucide-react` in the tile component. Prefer the existing-pattern fix:

```bash
# Edit dashboard/lib/icons.ts (or .tsx) and add DollarSign to the lucide-react re-export list.
```

- [ ] **Step 3: Wire into the home page**

In `dashboard/app/page.tsx`:

1. Import the tile near the top:

```tsx
import { WeeklyCostTile } from "@/components/admin/weekly-cost-tile";
```

2. Find the stats grid (currently lines ~145–162):

```tsx
<div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
  {[
    { label: "Agents", value: agents.length, icon: Users },
    { label: "Active Sessions", value: activeSessions.length, icon: MessageSquare },
    { label: "Changelog Entries", value: changelog.length, icon: FileText },
  ].map((stat) => ( ... ))}
</div>
```

Replace with:

```tsx
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
  {[
    { label: "Agents", value: agents.length, icon: Users },
    { label: "Active Sessions", value: activeSessions.length, icon: MessageSquare },
    { label: "Changelog Entries", value: changelog.length, icon: FileText },
  ].map((stat) => (
    <Card key={stat.label} className="border-border bg-card">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="label-mono-sm text-muted-foreground">{stat.label}</p>
            <p className="text-2xl font-semibold text-foreground mt-1">{stat.value}</p>
          </div>
          <stat.icon className="size-5 text-muted-foreground/50" />
        </div>
      </CardContent>
    </Card>
  ))}
  <WeeklyCostTile />
</div>
```

(The grid widens to 4 columns on `lg`; on small screens it stacks to 2.)

- [ ] **Step 4: Run dev server + verify**

```bash
cd /Users/edmundmitchell/factory/dashboard
npm run dev
```

Open `http://localhost:3000/`. Confirm the new "7-day LLM cost (est.)" card renders alongside the other three. With no `model_calls` rows yet it should show `$0.00` and an empty sparkline; that's expected.

- [ ] **Step 5: Type-check**

```bash
cd /Users/edmundmitchell/factory/dashboard
npx tsc --noEmit -p tsconfig.json
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add dashboard/components/admin/weekly-cost-tile.tsx \
        dashboard/app/page.tsx \
        dashboard/lib/icons.ts dashboard/lib/icons.tsx 2>/dev/null
git commit -m "home: add 7-day LLM cost tile"
```

---

## Task 9: End-to-end verification

- [ ] **Step 1: Trigger one of each call type**

  - **Edge:** already verified in Task 7 Step 7 + Task 7b Step 6. Confirm rows with both `source = 'edge:processor-run'` (or `edge:researcher-run`) and `source = 'edge:mixture'` exist.
  - **Agent wake:** trigger any agent wake (e.g. send a Slack message that mentions an agent, or call the wake endpoint manually). Confirm a row with `source = 'agent_wake'` appears.
  - **Agent chat:** open `/agents/<any-id>` in the dashboard and send one message. Confirm a row with `source = 'agent_chat'` appears.

- [ ] **Step 2: Inspect the rows**

```sql
select ts, source, model, input_tokens, output_tokens,
       cache_read_tokens, cache_write_tokens, est_cost_usd, agent_id
from public.model_calls
order by ts desc limit 10;
```

Sanity checks:
- `est_cost_usd > 0` for every row with non-zero output tokens.
- `cache_read_tokens > 0` should appear on the second consecutive agent-chat row (proves prompt caching is being captured).
- Sum: `select sum(est_cost_usd) from public.model_calls;` — should match what you'd estimate from the tokens × pricing table.

- [ ] **Step 3: Reload the home page**

Confirm the tile now shows a non-zero number and the sparkline renders.

- [ ] **Step 4: Push**

```bash
cd /Users/edmundmitchell/factory && git push origin main
cd /Users/edmundmitchell/factory/dashboard && git push origin main
```

(`dashboard` is a separate repo gitignored from `factory` — both get pushed.)

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Logger insert fails (network blip, RLS misconfig) and breaks the LLM call | Both loggers wrap inserts in try/catch — failures only `console.error`. Node side fires-and-forgets with `void`; Edge side awaits because Edge isolates can shut down before unawaited promises resolve. The try/catch makes the await safe. |
| Pricing drifts as Anthropic/OpenAI change rates | Pricing table is a single file (mirrored in two places). Add a calendar reminder to verify quarterly. |
| Dashboard service-role key missing in some env (e.g. preview) | `getClient()` returns `null` and the logger silently no-ops. The tile renders `—`. |
| Streaming `finalMessage()` not always populated when client disconnects mid-stream | Wrapped in try/catch; we lose the row but the user-facing stream is unaffected. |
| Adding columns later (e.g. user_id) | Migration uses `jsonb metadata` for forward-compat; structural columns can be added in a follow-up migration. |
| Cost numbers shown as truth and Edmund overcorrects | Tile label says "(est.)". Decisions log entry should note this is list-price approximation. |

---

## Done when

1. `public.model_calls` has rows from all three sources (`agent_chat`, `agent_wake`, `edge:*`) within 24h of merge.
2. Home page tile renders a 7-day total with a sparkline.
3. `npx tsc --noEmit` clean in `dashboard/`.
4. No regression in agent chat or wake throughput (smoke-test still completes within normal bounds).
5. Commits pushed to both `factory` and `dashboard` repos.

// Fire-and-forget insert into public.model_calls. Mirror of repo-root
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

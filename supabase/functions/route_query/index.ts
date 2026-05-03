// route_query() Edge Function
//
// Resolves a coarse user-intent label (`recent_activity`, `memory_lookup`,
// `concept_lookup`, etc.) into a routing plan via the public.intent_router +
// public.table_registry tables seeded by migration 020.
//
// v2 (2026-05-03) executes the obvious SQL intents server-side too:
// recent_activity, project_status, ingestion_status, concept_lookup,
// workflow_planning. memory_lookup still runs the vector pass.
// Other intents (research_question, content_idea_lookup, content_performance,
// business_lookup, agent_debugging) return the plan only — caller composes.
//
// Auth: shared-secret header `x-capture-secret` required (deployed with
// verify_jwt=false). Same pattern as capture() / signals-ingest /
// research-director-synthesis.
//
// Known limitation (v1): match_memory(namespace text NOT NULL) — if a
// memory_lookup call omits `namespace`, this function returns an empty
// result set (no error). Add a namespace or fix match_memory to support
// cross-namespace search.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const DEFAULT_DENY = [
  "clients",
  "profiles",
  "contact_submissions",
  "lead_magnet_submissions",
  "waitlist",
  "scorecard_responses",
  "assessment_results",
  "rhythm_plans",
  "rhythm_activities",
  "invoices",
  "invoice_items",
  "agent_scratchpad",
  "agent_memory",
  "agent_core_memory",
  "agent_data_store",
  "memory_dualread_log",
  "agent_retrieval_feedback",
  "agent_messages",
];

type RouteBody = {
  intent?: string;
  query?: string;
  namespace?: string;
  top_k?: number;
  scope?: { pii_ok?: boolean } | null;
};

type IntentRouterRow = {
  intent: string;
  description: string;
  primary_tables: string[];
  secondary_tables: string[] | null;
  forbidden_tables: string[] | null;
  query_style: "vector" | "sql" | "hybrid";
  required_filters: Record<string, unknown> | null;
  default_limit: number;
  notes: string | null;
};

function badRequest(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return badRequest("POST only", 405);

  const secret = Deno.env.get("CAPTURE_SECRET");
  if (!secret) return badRequest("CAPTURE_SECRET not set", 500);
  if (req.headers.get("x-capture-secret") !== secret) {
    return badRequest("unauthorized", 401);
  }

  let body: RouteBody;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalid JSON");
  }

  const intent = (body.intent || "").trim();
  if (!intent) return badRequest("intent required");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: irRows, error: irErr } = await supabase
    .from("intent_router")
    .select("*")
    .eq("intent", intent)
    .limit(1);

  if (irErr) return badRequest(`intent_router lookup failed: ${irErr.message}`, 500);
  if (!irRows || irRows.length === 0) {
    return badRequest(`unknown intent: ${intent}. See public.intent_router for valid values.`);
  }
  const ir = irRows[0] as IntentRouterRow;

  const { data: regRows, error: regErr } = await supabase
    .from("table_registry")
    .select("table_name, canonical_status, safe_for_default_retrieval")
    .in("table_name", ir.primary_tables);
  if (regErr) return badRequest(`table_registry lookup failed: ${regErr.message}`, 500);

  const regByName = new Map(regRows!.map((r) => [r.table_name as string, r]));
  const safePrimary = ir.primary_tables.filter((t) => {
    const r = regByName.get(t);
    return r && (r.canonical_status === "canonical" || r.canonical_status === "supporting");
  });

  const intentSecondary = ir.secondary_tables ?? [];
  const intentForbidden = ir.forbidden_tables ?? [];
  const piiOk = body.scope?.pii_ok === true;
  const forbiddenSet = new Set<string>(intentForbidden);
  for (const t of DEFAULT_DENY) {
    if (intentSecondary.includes(t)) continue;
    if (piiOk && intent === "business_lookup") continue;
    forbiddenSet.add(t);
  }

  const plan = {
    primary_tables: safePrimary,
    secondary_tables: intentSecondary,
    forbidden_tables: [...forbiddenSet].sort(),
    query_style: ir.query_style,
    required_filters: ir.required_filters,
    default_limit: ir.default_limit,
    notes: ir.notes,
  };

  let results: unknown[] = [];
  const limit = body.top_k && body.top_k > 0 ? Math.min(body.top_k, 50) : ir.default_limit;

  // ─── SQL-intent execution ────────────────────────────────────────────
  // Earlier versions returned only a routing plan for non-vector intents,
  // forcing callers to follow up with raw SQL they couldn't execute.
  // We now execute the obvious cases server-side.

  if (intent === "recent_activity") {
    const { data, error } = await supabase
      .from("work_log")
      .select("id, created_at, project, kind, summary, session_id")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return badRequest(`work_log query failed: ${error.message}`, 500);
    results = data ?? [];
  } else if (intent === "project_status" && body.query) {
    const { data, error } = await supabase
      .from("work_log")
      .select("id, created_at, project, kind, summary")
      .eq("project", body.query)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return badRequest(`work_log query failed: ${error.message}`, 500);
    results = data ?? [];
  } else if (intent === "ingestion_status") {
    const { data, error } = await supabase
      .from("ingest_runs")
      .select("id, started_at, status, source_title, items_processed, error_message")
      .order("started_at", { ascending: false })
      .limit(limit);
    if (error) return badRequest(`ingest_runs query failed: ${error.message}`, 500);
    results = data ?? [];
  } else if (intent === "concept_lookup" && body.query) {
    const q = body.query.trim();
    const { data, error } = await supabase
      .from("reference_docs")
      .select("id, slug, title, kind, status, updated_at")
      .or(`slug.ilike.%${q}%,title.ilike.%${q}%`)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error) return badRequest(`reference_docs query failed: ${error.message}`, 500);
    results = data ?? [];
  } else if (intent === "workflow_planning") {
    const { data, error } = await supabase
      .from("skill_versions")
      .select("skill_name, version, status, updated_at")
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error) return badRequest(`skill_versions query failed: ${error.message}`, 500);
    results = data ?? [];
  } else if (intent === "memory_lookup" && body.query) {
    const top_k = limit;
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return new Response(
        JSON.stringify({
          intent,
          plan,
          results: [],
          warning: "OPENAI_API_KEY not configured — memory_lookup needs an embedding step",
        }),
        { headers: { "content-type": "application/json" } },
      );
    }
    const embedRes = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: body.query,
      }),
    });
    if (!embedRes.ok) {
      const txt = await embedRes.text();
      return badRequest(`embedding failed: ${embedRes.status} ${txt}`, 502);
    }
    const embedJson = await embedRes.json();
    const embedding: number[] = embedJson.data?.[0]?.embedding;
    if (!embedding) return badRequest("embedding response missing data[0].embedding", 502);

    const { data: matches, error: matchErr } = await supabase.rpc("match_memory", {
      query_embedding: embedding,
      match_namespace: body.namespace ?? null,
      match_count: top_k,
    });
    if (matchErr) return badRequest(`match_memory failed: ${matchErr.message}`, 500);
    results = matches ?? [];
  }

  return new Response(JSON.stringify({ intent, plan, results }), {
    headers: { "content-type": "application/json" },
  });
});

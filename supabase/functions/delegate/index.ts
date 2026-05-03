// delegate() Edge Function
//
// Phase 5 of the Hermes-inspired build (2026-05-03).
//
// Lets a Claude session collapse a multi-step query into ONE tool call. The
// caller picks a named subroutine + passes params; the function does the
// heavy lifting server-side (multiple Supabase queries, optional LLM pass)
// and returns a single summary string. Caller's context stays small.
//
// Why a fixed registry of subroutines (not arbitrary eval)?
//   - Service-role key in this function. eval(callerScript) = RCE risk.
//   - Each task here is auditable + has a stable contract.
//   - Adding a new task = small PR, not a security review.
//
// Tasks v1:
//   summarize_recent_captures  (params: hours?: number)
//     → LLM-summary of the last N hours of inbox captures.
//   triage_pending_promotions  (params: none)
//     → bullet list of pending skill_versions proposals (one line each).
//   ingest_status_digest       (params: hours?: number)
//     → counts + failures from ingest_runs in the window.
//
// Auth: shared-secret header `x-capture-secret`.
//
// Deployed via Supabase MCP on 2026-05-03; this file is the canonical record.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { pickModel, pickFallback } from "../_shared/models.ts";

type Body = { task?: string; params?: Record<string, unknown> };

function badRequest(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function getRouterKey(): { key: string; base: string; isOpenRouter: boolean } | null {
  const openrouter = Deno.env.get("OPENROUTER_API_KEY");
  if (openrouter) return { key: openrouter, base: "https://openrouter.ai/api/v1/chat/completions", isOpenRouter: true };
  const openai = Deno.env.get("OPENAI_API_KEY");
  if (openai) return { key: openai, base: "https://api.openai.com/v1/chat/completions", isOpenRouter: false };
  return null;
}

async function llmSummarize(systemPrompt: string, userPrompt: string): Promise<string> {
  const auth = getRouterKey();
  if (!auth) throw new Error("no LLM API key configured");
  const headers: Record<string, string> = {
    "authorization": `Bearer ${auth.key}`,
    "content-type": "application/json",
  };
  if (auth.isOpenRouter) {
    headers["HTTP-Referer"] = "https://factory.edmundmitchell.com";
    headers["X-Title"] = "factory-delegate";
  }
  const model = auth.isOpenRouter ? pickModel("summarize") : pickFallback();
  console.log(JSON.stringify({ delegate_model: model }));
  const res = await fetch(auth.base, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      temperature: 0.4,
      max_tokens: 800,
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
    }),
  });
  if (!res.ok) throw new Error(`llm ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  return (j.choices?.[0]?.message?.content ?? "").trim();
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return badRequest("POST only", 405);

  const secret = Deno.env.get("CAPTURE_SECRET");
  if (!secret) return badRequest("CAPTURE_SECRET not set", 500);
  if (req.headers.get("x-capture-secret") !== secret) return badRequest("unauthorized", 401);

  let body: Body = {};
  try { body = await req.json(); } catch { /* allow empty body */ }
  const task = (body.task ?? "").trim();
  if (!task) return badRequest("task required");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    if (task === "summarize_recent_captures") {
      const hours = typeof body.params?.hours === "number" ? Math.min(body.params.hours as number, 168) : 24;
      const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("work_log")
        .select("id, created_at, project, kind, summary")
        .in("kind", ["note", "research"])
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) return badRequest(`work_log query failed: ${error.message}`, 500);
      const rows = data ?? [];
      if (rows.length === 0) {
        return new Response(JSON.stringify({ task, summary: `No captures in the last ${hours}h.`, count: 0 }), {
          headers: { "content-type": "application/json" },
        });
      }
      const summary = await llmSummarize(
        "You summarize Edmund Mitchell's recent inbox captures into a tight 3-5 bullet brief. Group by theme. No fluff.",
        `Last ${hours}h of captures (${rows.length} total):\n\n` +
          rows.map((r) => `- [${r.kind}] ${r.summary ?? "(no summary)"} (${(r as { project: string | null }).project ?? "unknown"})`).join("\n"),
      );
      return new Response(JSON.stringify({ task, summary, count: rows.length, hours }), {
        headers: { "content-type": "application/json" },
      });
    }

    if (task === "triage_pending_promotions") {
      const { data, error } = await supabase
        .from("skill_versions")
        .select("id, skill_name, version, changelog, created_by, created_at")
        .eq("status", "proposed")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) return badRequest(`skill_versions query failed: ${error.message}`, 500);
      const rows = data ?? [];
      if (rows.length === 0) {
        return new Response(JSON.stringify({ task, summary: "No pending promotions.", count: 0 }), {
          headers: { "content-type": "application/json" },
        });
      }
      const lines = rows.map((r) => {
        const reason = ((r as { changelog: string | null }).changelog ?? "").split("\n")[0].slice(0, 140);
        return `- ${(r as { skill_name: string }).skill_name} v${(r as { version: number }).version} — ${reason || "(no rationale)"}`;
      });
      return new Response(JSON.stringify({
        task,
        summary: `${rows.length} pending promotion${rows.length === 1 ? "" : "s"}:\n\n${lines.join("\n")}\n\nApprove/reject at /inbox/promotions.`,
        count: rows.length,
      }), { headers: { "content-type": "application/json" } });
    }

    if (task === "ingest_status_digest") {
      const hours = typeof body.params?.hours === "number" ? Math.min(body.params.hours as number, 168) : 24;
      const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("ingest_runs")
        .select("id, started_at, status, source_type, source_title, items_processed, error_message")
        .gte("started_at", since)
        .order("started_at", { ascending: false })
        .limit(50);
      if (error) return badRequest(`ingest_runs query failed: ${error.message}`, 500);
      const rows = data ?? [];
      const ok = rows.filter((r) => (r as { status: string }).status === "completed");
      const failed = rows.filter((r) => (r as { status: string }).status !== "completed");
      const lines: string[] = [];
      lines.push(`Last ${hours}h: ${rows.length} ingest run${rows.length === 1 ? "" : "s"}.`);
      lines.push(`  ✓ completed: ${ok.length}`);
      lines.push(`  ✗ failed: ${failed.length}`);
      if (failed.length > 0) {
        lines.push("");
        lines.push("Failures:");
        for (const f of failed.slice(0, 5)) {
          const r = f as { source_title: string | null; source_type: string; error_message: string | null };
          lines.push(`  - [${r.source_type}] ${r.source_title ?? "(no title)"}: ${(r.error_message ?? "unknown").slice(0, 100)}`);
        }
      }
      return new Response(JSON.stringify({ task, summary: lines.join("\n"), count: rows.length, ok_count: ok.length, fail_count: failed.length }), {
        headers: { "content-type": "application/json" },
      });
    }

    return badRequest(`unknown task: ${task}. Available: summarize_recent_captures, triage_pending_promotions, ingest_status_digest`);
  } catch (err) {
    return badRequest(`delegate crashed: ${err instanceof Error ? err.message : String(err)}`, 500);
  }
});

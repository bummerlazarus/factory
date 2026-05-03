// curator_pass() Edge Function
//
// Phase 2 of the Hermes-inspired build (2026-05-03).
//
// Runs nightly via pg_cron. Reads the last 24h of activity (work_log,
// ingest_runs, agent_conversations) and asks an LLM (via OpenRouter, same
// pattern as researcher-run + _shared/llm.ts) to suggest 0-3 skill updates.
// Each suggestion is written as a `skill_versions` row with status='proposed'.
// Edmund sees them at /inbox/promotions next morning.
//
// Auth: shared-secret header `x-capture-secret`.
// Logs every run to public.curator_runs.
//
// Cost: typically <$0.01/run (Claude Sonnet via OpenRouter, ~3-8k tokens).
//
// This file is the canonical record of the deployed function (version 2).
// Re-deploy via Supabase MCP `deploy_edge_function` if you change it.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = "anthropic/claude-sonnet-4-6";
const MAX_PROPOSALS = 3;
const LOOKBACK_HOURS = 24;

type Body = { hours?: number; dry_run?: boolean };
type Proposal = {
  skill_name: string;
  rationale: string;
  proposed_body_diff: string;
  source_refs: { kind: string; id: string; note: string }[];
};

function badRequest(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function getRouterKey(): { key: string; base: string; isOpenRouter: boolean } {
  const openrouter = Deno.env.get("OPENROUTER_API_KEY");
  if (openrouter) {
    return { key: openrouter, base: "https://openrouter.ai/api/v1/chat/completions", isOpenRouter: true };
  }
  const openai = Deno.env.get("OPENAI_API_KEY");
  if (openai) {
    return { key: openai, base: "https://api.openai.com/v1/chat/completions", isOpenRouter: false };
  }
  throw new Error("No LLM API key (OPENROUTER_API_KEY or OPENAI_API_KEY required)");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return badRequest("POST only", 405);

  const secret = Deno.env.get("CAPTURE_SECRET");
  if (!secret) return badRequest("CAPTURE_SECRET not set", 500);
  if (req.headers.get("x-capture-secret") !== secret) return badRequest("unauthorized", 401);

  let llmAuth: { key: string; base: string; isOpenRouter: boolean };
  try { llmAuth = getRouterKey(); }
  catch (e) { return badRequest((e as Error).message, 500); }

  let body: Body = {};
  try { body = await req.json(); } catch { /* allow empty body */ }
  const hours = typeof body.hours === "number" && body.hours > 0 ? Math.min(body.hours, 168) : LOOKBACK_HOURS;
  const dryRun = body.dry_run === true;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const { data: runRow, error: runErr } = await supabase
    .from("curator_runs")
    .insert({ status: "running", lookback_hours: hours, started_at: new Date().toISOString() })
    .select("id")
    .single();
  if (runErr) return badRequest(`curator_runs insert failed: ${runErr.message}`, 500);
  const runId = runRow.id as string;

  async function finishRun(patch: Record<string, unknown>) {
    await supabase.from("curator_runs").update({ ...patch, finished_at: new Date().toISOString() }).eq("id", runId);
  }

  try {
    const [workLog, ingestRuns, sessions, activeSkills] = await Promise.all([
      supabase.from("work_log")
        .select("id, created_at, project, kind, summary")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.from("ingest_runs")
        .select("id, started_at, status, source_type, source_title, items_processed, error_message")
        .gte("started_at", since)
        .order("started_at", { ascending: false })
        .limit(50),
      supabase.from("agent_conversations")
        .select("session_id, persona_id, title, updated_at")
        .gte("updated_at", since)
        .order("updated_at", { ascending: false })
        .limit(20),
      supabase.from("skill_versions")
        .select("skill_name, version, body")
        .eq("status", "approved")
        .order("version", { ascending: false }),
    ]);

    if (workLog.error || ingestRuns.error || sessions.error || activeSkills.error) {
      const msgs = [workLog.error, ingestRuns.error, sessions.error, activeSkills.error].filter(Boolean).map((e) => e!.message);
      await finishRun({ status: "error", error_message: msgs.join("; ") });
      return badRequest(`activity fetch failed: ${msgs.join("; ")}`, 500);
    }

    const latestBySkill = new Map<string, { version: number; body: string }>();
    for (const r of activeSkills.data ?? []) {
      const sn = (r as { skill_name: string }).skill_name;
      if (!latestBySkill.has(sn)) {
        latestBySkill.set(sn, { version: (r as { version: number }).version, body: (r as { body: string }).body });
      }
    }

    const totalActivity = (workLog.data?.length ?? 0) + (ingestRuns.data?.length ?? 0) + (sessions.data?.length ?? 0);
    if (totalActivity === 0) {
      await finishRun({ status: "ok", proposals_written: 0, items_examined: 0, notes: "no activity in window" });
      return new Response(JSON.stringify({ run_id: runId, proposals: [], note: "no activity" }), {
        headers: { "content-type": "application/json" },
      });
    }

    const skillNamesList = [...latestBySkill.keys()].slice(0, 30).join(", ") || "(none yet)";

    const systemPrompt = "You are Corva, Edmund Mitchell's curator agent. You output JSON only when asked, with no surrounding prose. Do NOT propose changes based on speculation, vibes, or generic best-practice. Tie each proposal to specific evidence in the data.";

    const userPrompt = [
      `Look at the last ${hours}h of Edmund's activity below and decide whether any existing skill SOPs should be updated, or if there is strong-enough signal to propose a brand-new skill.`,
      ``,
      `Active skill names: ${skillNamesList}.`,
      ``,
      `## Recent work_log entries (${workLog.data?.length ?? 0})`,
      JSON.stringify(workLog.data ?? [], null, 2),
      ``,
      `## Recent ingest_runs (${ingestRuns.data?.length ?? 0})`,
      JSON.stringify(ingestRuns.data ?? [], null, 2),
      ``,
      `## Recent chat sessions (${sessions.data?.length ?? 0})`,
      JSON.stringify(sessions.data ?? [], null, 2),
      ``,
      `## Rules`,
      `- Propose 0 to ${MAX_PROPOSALS} skill updates. Quality over quantity. Zero is a fine answer if nothing rose to the bar.`,
      `- Cite specific work_log/session/ingest ids in source_refs. No bare assertions.`,
      `- For an update to an existing skill, set skill_name to the existing name. proposed_body_diff is the FULL new body.`,
      `- For a brand-new skill, pick a kebab-case skill_name that doesn't already exist.`,
      ``,
      `Return JSON only matching this shape: {"proposals": [{"skill_name":"","rationale":"","proposed_body_diff":"","source_refs":[{"kind":"work_log|session|ingest_run","id":"","note":""}]}]}`,
    ].join("\n");

    const llmHeaders: Record<string, string> = {
      "authorization": `Bearer ${llmAuth.key}`,
      "content-type": "application/json",
    };
    if (llmAuth.isOpenRouter) {
      llmHeaders["HTTP-Referer"] = "https://factory.edmundmitchell.com";
      llmHeaders["X-Title"] = "factory-curator-pass";
    }

    const llmModel = llmAuth.isOpenRouter ? MODEL : "gpt-4o-mini";

    const llmRes = await fetch(llmAuth.base, {
      method: "POST",
      headers: llmHeaders,
      body: JSON.stringify({
        model: llmModel,
        temperature: 0.4,
        max_tokens: 4096,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!llmRes.ok) {
      const txt = await llmRes.text();
      await finishRun({ status: "error", error_message: `llm ${llmRes.status}: ${txt.slice(0, 500)}` });
      return badRequest(`LLM API failed: ${llmRes.status}`, 502);
    }

    const llmJson = await llmRes.json();
    const text = llmJson.choices?.[0]?.message?.content ?? "";
    let parsed: { proposals: Proposal[] };
    try {
      const cleaned = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```\s*$/, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      await finishRun({ status: "error", error_message: `json parse failed: ${(e as Error).message}; raw: ${text.slice(0, 300)}` });
      return badRequest(`curator returned invalid JSON: ${(e as Error).message}`, 502);
    }

    const proposals = Array.isArray(parsed.proposals) ? parsed.proposals.slice(0, MAX_PROPOSALS) : [];

    if (dryRun) {
      await finishRun({ status: "ok", proposals_written: 0, items_examined: totalActivity, notes: `dry_run: would write ${proposals.length}` });
      return new Response(JSON.stringify({ run_id: runId, proposals, dry_run: true }), {
        headers: { "content-type": "application/json" },
      });
    }

    let written = 0;
    const writtenIds: string[] = [];
    for (const p of proposals) {
      if (!p.skill_name || !p.proposed_body_diff || !p.rationale) continue;
      const existing = latestBySkill.get(p.skill_name);
      const nextVersion = existing ? existing.version + 1 : 1;
      const { data: ins, error: insErr } = await supabase
        .from("skill_versions")
        .insert({
          skill_name: p.skill_name,
          version: nextVersion,
          body: p.proposed_body_diff,
          changelog: p.rationale,
          status: "proposed",
          created_by: `curator_pass/run:${runId}`,
          metadata: { source_refs: p.source_refs ?? [], curator_run_id: runId },
        })
        .select("id")
        .single();
      if (insErr) {
        await finishRun({ status: "error", error_message: `skill_versions insert failed: ${insErr.message}`, proposals_written: written, items_examined: totalActivity });
        return badRequest(`skill_versions insert failed: ${insErr.message}`, 500);
      }
      written += 1;
      writtenIds.push(ins.id as string);
    }

    await finishRun({
      status: "ok",
      proposals_written: written,
      items_examined: totalActivity,
      notes: `wrote ${written}/${proposals.length} proposals`,
    });

    return new Response(JSON.stringify({ run_id: runId, proposals_written: written, proposal_ids: writtenIds }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishRun({ status: "error", error_message: msg });
    return badRequest(`curator_pass crashed: ${msg}`, 500);
  }
});

// curator_pass() Edge Function
//
// Phase 2 of the Hermes-inspired build. Two-stage as of 2026-05-03 cost-routing:
//   Stage A (audit_draft, cheap): Haiku reads source data, drafts proposals.
//   Stage B (review, mid):        Sonnet reviews the draft against an explicit
//                                 ID allow-list. No source data in stage B.
//
// Auth: shared-secret header `x-capture-secret`.
// Logs every run to public.curator_runs.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { pickModel, pickFallback } from "../_shared/models.ts";

const MAX_PROPOSALS = 3;
const LOOKBACK_HOURS = 24;

type Body = { hours?: number; dry_run?: boolean };
type SourceRef = { kind: string; id: string; note: string };
type Proposal = {
  skill_name: string;
  rationale: string;
  proposed_body_diff: string;
  source_refs: SourceRef[];
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

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function validateProposalShape(parsed: unknown): { ok: true; proposals: Proposal[] } | { ok: false; reason: string } {
  if (!parsed || typeof parsed !== "object") return { ok: false, reason: "not an object" };
  const top = parsed as Record<string, unknown>;
  if (!Array.isArray(top.proposals)) return { ok: false, reason: "proposals not an array" };
  const out: Proposal[] = [];
  for (const p of top.proposals as unknown[]) {
    if (!p || typeof p !== "object") return { ok: false, reason: "proposal not an object" };
    const o = p as Record<string, unknown>;
    if (typeof o.skill_name !== "string" || typeof o.rationale !== "string" || typeof o.proposed_body_diff !== "string") {
      return { ok: false, reason: "proposal missing required string fields" };
    }
    if (!Array.isArray(o.source_refs)) return { ok: false, reason: "source_refs not an array" };
    for (const r of o.source_refs as unknown[]) {
      if (!r || typeof r !== "object") return { ok: false, reason: "source_ref not an object" };
      const ro = r as Record<string, unknown>;
      if (typeof ro.kind !== "string" || typeof ro.id !== "string" || typeof ro.note !== "string") {
        return { ok: false, reason: "source_ref missing required string fields" };
      }
    }
    out.push({
      skill_name: o.skill_name,
      rationale: o.rationale,
      proposed_body_diff: o.proposed_body_diff,
      source_refs: o.source_refs as SourceRef[],
    });
  }
  return { ok: true, proposals: out };
}

async function callLLM(
  llmAuth: { key: string; base: string; isOpenRouter: boolean },
  model: string,
  systemPrompt: string,
  userPrompt: string,
  title: string,
): Promise<string> {
  const headers: Record<string, string> = {
    "authorization": `Bearer ${llmAuth.key}`,
    "content-type": "application/json",
  };
  if (llmAuth.isOpenRouter) {
    headers["HTTP-Referer"] = "https://factory.edmundmitchell.com";
    headers["X-Title"] = title;
  }
  const res = await fetch(llmAuth.base, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      temperature: 0.4,
      max_tokens: 4096,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`llm ${res.status}: ${txt.slice(0, 500)}`);
  }
  const j = await res.json();
  return (j.choices?.[0]?.message?.content ?? "").toString();
}

async function callWithRetry(
  llmAuth: { key: string; base: string; isOpenRouter: boolean },
  model: string,
  systemPrompt: string,
  userPrompt: string,
  title: string,
): Promise<{ ok: true; proposals: Proposal[]; raw: string } | { ok: false; reason: string; raw: string }> {
  let raw = "";
  try {
    raw = await callLLM(llmAuth, model, systemPrompt, userPrompt, title);
    const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```\s*$/, "").trim();
    const parsed = JSON.parse(cleaned);
    const v = validateProposalShape(parsed);
    if (v.ok) return { ok: true, proposals: v.proposals, raw };
  } catch (_e) { /* fall through to retry */ }

  const stricterSystem = `${systemPrompt}\n\nRETURN VALID JSON ONLY MATCHING {"proposals": [...]}. NO PROSE.`;
  try {
    raw = await callLLM(llmAuth, model, stricterSystem, userPrompt, title);
    const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```\s*$/, "").trim();
    const parsed = JSON.parse(cleaned);
    const v = validateProposalShape(parsed);
    if (v.ok) return { ok: true, proposals: v.proposals, raw };
    return { ok: false, reason: v.reason, raw };
  } catch (e) {
    return { ok: false, reason: (e as Error).message, raw };
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return badRequest("POST only", 405);

  const secret = Deno.env.get("CAPTURE_SECRET");
  if (!secret) return badRequest("CAPTURE_SECRET not set", 500);
  if (req.headers.get("x-capture-secret") !== secret) return badRequest("unauthorized", 401);

  let llmAuth: { key: string; base: string; isOpenRouter: boolean };
  try { llmAuth = getRouterKey(); }
  catch (e) { return badRequest((e as Error).message, 500); }

  // Resolve models. If only the OpenAI fallback is available, both stages use the cheap fallback.
  let draftModel: string;
  let reviewModel: string;
  try {
    if (llmAuth.isOpenRouter) {
      draftModel = pickModel("audit_draft");
      reviewModel = pickModel("review");
    } else {
      draftModel = pickFallback();
      reviewModel = pickFallback();
    }
  } catch (e) {
    return badRequest((e as Error).message, 500);
  }

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
    const { error } = await supabase.from("curator_runs").update({ ...patch, finished_at: new Date().toISOString() }).eq("id", runId);
    if (error) {
      console.error(JSON.stringify({ curator_finish_run_failed: error.message, run_id: runId, patch_keys: Object.keys(patch) }));
    }
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
      await finishRun({
        status: "ok",
        proposals_written: 0,
        items_examined: 0,
        notes: `no activity in window | draft_model=${draftModel} review_model=${reviewModel}`,
      });
      return new Response(JSON.stringify({ run_id: runId, proposals: [], note: "no activity" }), {
        headers: { "content-type": "application/json" },
      });
    }

    const skillNamesList = [...latestBySkill.keys()].slice(0, 30).join(", ") || "(none yet)";
    const validWorkLogIds = (workLog.data ?? []).map((r) => (r as { id: string }).id);
    const validIngestRunIds = (ingestRuns.data ?? []).map((r) => (r as { id: string }).id);
    const validSessionIds = (sessions.data ?? []).map((r) => (r as { session_id: string }).session_id);

    // ---- Stage A: draft (cheap tier) ----
    console.log(JSON.stringify({ curator_stage: "draft", model: draftModel, run_id: runId }));

    const draftSystem = "You are Corva, Edmund Mitchell's curator agent. You output JSON only when asked, with no surrounding prose. Do NOT propose changes based on speculation, vibes, or generic best-practice. Tie each proposal to specific evidence in the data. If unsure, return {\"proposals\": []}. Empty is correct.";

    const exampleShape = `{"proposals":[{"skill_name":"example-skill","rationale":"why this update is justified","proposed_body_diff":"FULL new body","source_refs":[{"kind":"work_log","id":"<uuid>","note":"why cited"}]}]}`;

    const draftUser = [
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
      `- If unsure, return {"proposals": []}. Empty is correct.`,
      ``,
      `Return JSON only. Example shape:`,
      exampleShape,
    ].join("\n");

    const draftResult = await callWithRetry(llmAuth, draftModel, draftSystem, draftUser, "factory-curator-pass-draft");
    if (!draftResult.ok) {
      await finishRun({
        status: "error",
        error_message: `draft stage failed: ${draftResult.reason}; raw: ${draftResult.raw.slice(0, 300)}`,
        notes: `draft_model=${draftModel} review_model=${reviewModel}`,
      });
      return badRequest(`curator draft returned invalid JSON: ${draftResult.reason}`, 502);
    }
    const draftProposals = draftResult.proposals.slice(0, MAX_PROPOSALS);

    // ---- Stage B: review (mid tier) ----
    console.log(JSON.stringify({ curator_stage: "review", model: reviewModel, run_id: runId, draft_count: draftProposals.length }));

    const reviewSystem = "You are reviewing draft skill-update proposals from a junior agent. Tighten rationales. DROP any proposal whose source_refs cite an id NOT in the provided allow-lists. Drop weak/speculative proposals (zero is fine). Return the SAME JSON shape with the same schema. Output JSON only. If unsure, return {\"proposals\": []}.";

    const reviewUser = [
      `## Draft proposals to review`,
      JSON.stringify({ proposals: draftProposals }, null, 2),
      ``,
      `## Active skill names (for skill_name conflict checks)`,
      skillNamesList,
      ``,
      `## ID allow-lists (drop any proposal citing an id NOT in these lists)`,
      `valid_work_log_ids: ${JSON.stringify(validWorkLogIds)}`,
      `valid_ingest_run_ids: ${JSON.stringify(validIngestRunIds)}`,
      `valid_session_ids: ${JSON.stringify(validSessionIds)}`,
      ``,
      `Return JSON only matching shape: ${exampleShape}`,
    ].join("\n");

    const reviewResult = await callWithRetry(llmAuth, reviewModel, reviewSystem, reviewUser, "factory-curator-pass-review");
    if (!reviewResult.ok) {
      await finishRun({
        status: "error",
        error_message: `review stage failed: ${reviewResult.reason}; raw: ${reviewResult.raw.slice(0, 300)}`,
        notes: `draft_model=${draftModel} review_model=${reviewModel} draft=${draftProposals.length}`,
      });
      return badRequest(`curator review returned invalid JSON: ${reviewResult.reason}`, 502);
    }
    const reviewedProposals = reviewResult.proposals.slice(0, MAX_PROPOSALS);

    // ---- Stage C: deterministic schema validation ----
    const validWorkLog = new Set(validWorkLogIds);
    const validIngest = new Set(validIngestRunIds);
    const validSession = new Set(validSessionIds);
    const dropReasons: string[] = [];
    const accepted: Proposal[] = [];
    for (const p of reviewedProposals) {
      if (!p.skill_name || !KEBAB_CASE.test(p.skill_name)) {
        dropReasons.push(`bad_skill_name:${p.skill_name}`);
        continue;
      }
      if (!p.proposed_body_diff || p.proposed_body_diff.trim().length === 0) {
        dropReasons.push(`empty_body:${p.skill_name}`);
        continue;
      }
      if (!p.rationale || p.rationale.trim().length === 0) {
        dropReasons.push(`empty_rationale:${p.skill_name}`);
        continue;
      }
      if (!Array.isArray(p.source_refs) || p.source_refs.length === 0) {
        dropReasons.push(`no_source_refs:${p.skill_name}`);
        continue;
      }
      let badRef = false;
      for (const ref of p.source_refs) {
        const set = ref.kind === "work_log"
          ? validWorkLog
          : ref.kind === "ingest_run"
          ? validIngest
          : ref.kind === "session"
          ? validSession
          : null;
        if (!set || !set.has(ref.id)) { badRef = true; break; }
      }
      if (badRef) {
        dropReasons.push(`fake_ref:${p.skill_name}`);
        continue;
      }
      accepted.push(p);
    }

    const notesBase = `draft: ${draftProposals.length} → reviewed: ${reviewedProposals.length} → inserted: ${dryRun ? 0 : accepted.length}`;
    const dropSuffix = dropReasons.length > 0 ? ` (dropped ${dropReasons.length} for ${dropReasons.join(",")})` : "";
    const modelSuffix = ` | draft_model=${draftModel} review_model=${reviewModel}`;

    if (dryRun) {
      await finishRun({
        status: "ok",
        proposals_written: 0,
        items_examined: totalActivity,
        notes: `dry_run | ${notesBase}${dropSuffix}${modelSuffix} | would_insert=${accepted.length}`,
      });
      return new Response(JSON.stringify({ run_id: runId, proposals: accepted, dry_run: true }), {
        headers: { "content-type": "application/json" },
      });
    }

    let written = 0;
    const writtenIds: string[] = [];
    for (const p of accepted) {
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
          metadata: { source_refs: p.source_refs ?? [], curator_run_id: runId, draft_model: draftModel, review_model: reviewModel },
        })
        .select("id")
        .single();
      if (insErr) {
        await finishRun({
          status: "error",
          error_message: `skill_versions insert failed: ${insErr.message}`,
          proposals_written: written,
          items_examined: totalActivity,
          notes: `${notesBase}${dropSuffix}${modelSuffix}`,
        });
        return badRequest(`skill_versions insert failed: ${insErr.message}`, 500);
      }
      written += 1;
      writtenIds.push(ins.id as string);
    }

    await finishRun({
      status: "ok",
      proposals_written: written,
      items_examined: totalActivity,
      notes: `${notesBase}${dropSuffix}${modelSuffix}`,
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

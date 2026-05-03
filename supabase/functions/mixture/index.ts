// mixture() Edge Function
//
// Phase 6 of the Hermes-inspired build (2026-05-03).
//
// Fans a single question out to N models in parallel, then runs a synthesis
// pass that consolidates the answers into one response with provenance.
// Same idea as Edmund's three-brain skill, exposed as a server-side tool any
// agent (not just Claude Code) can call.
//
// Default models: Claude Sonnet, GPT-4o, Gemini 2.5 Pro (via OpenRouter).
// Synthesizer: Claude Sonnet (last word).
//
// Auth: shared-secret header `x-capture-secret`.
// Cost: ~3-5x a single LLM call. Use for design decisions / hard questions.
//
// Deployed via Supabase MCP on 2026-05-03; this file is the canonical record.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { pickModel, assertAllowed } from "../_shared/models.ts";

type Body = { question?: string; system?: string; models?: string[]; synth_model?: string };

const MAX_MODELS = 5;

function badRequest(msg: string, status = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function callOpenRouter(model: string, system: string, user: string, key: string): Promise<{ content: string; ms: number; tokens: { in: number; out: number } }> {
  const t0 = Date.now();
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      "HTTP-Referer": "https://factory.edmundmitchell.com",
      "X-Title": "factory-mixture",
    },
    body: JSON.stringify({
      model,
      temperature: 0.5,
      max_tokens: 1500,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`${model} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return {
    content: (j.choices?.[0]?.message?.content ?? "").trim(),
    ms: Date.now() - t0,
    tokens: { in: j.usage?.prompt_tokens ?? 0, out: j.usage?.completion_tokens ?? 0 },
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return badRequest("POST only", 405);

  const secret = Deno.env.get("CAPTURE_SECRET");
  if (!secret) return badRequest("CAPTURE_SECRET not set", 500);
  if (req.headers.get("x-capture-secret") !== secret) return badRequest("unauthorized", 401);

  const openrouter = Deno.env.get("OPENROUTER_API_KEY");
  if (!openrouter) return badRequest("OPENROUTER_API_KEY not set", 500);

  let body: Body;
  try { body = await req.json(); } catch { return badRequest("invalid JSON"); }
  const question = (body.question ?? "").trim();
  if (!question) return badRequest("question required");
  const system = body.system?.trim() || "You are a thoughtful expert. Answer the user's question directly and concretely. If you're uncertain, say so.";

  let defaultModels: string[];
  let synthModel: string;
  try {
    defaultModels = [pickModel("vote"), pickModel("vote_mid"), pickModel("vote")];
    synthModel = pickModel("synthesize");
  } catch (e) {
    return badRequest((e as Error).message, 500);
  }

  const callerModels = Array.isArray(body.models) && body.models.length > 0 ? body.models : null;
  if (callerModels) {
    for (const id of callerModels) {
      try { assertAllowed(id); }
      catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return new Response(JSON.stringify({ error: "model_id_disallowed", id, detail: msg }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
    }
  }
  const models = (callerModels ?? defaultModels).slice(0, MAX_MODELS);

  if (typeof body.synth_model === "string" && body.synth_model.trim().length > 0) {
    try { assertAllowed(body.synth_model); }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return new Response(JSON.stringify({ error: "model_id_disallowed", id: body.synth_model, detail: msg }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    synthModel = body.synth_model;
  }

  const t0 = Date.now();
  const votes = await Promise.all(models.map(async (m) => {
    console.log(JSON.stringify({ mixture_voter: m }));
    try {
      const r = await callOpenRouter(m, system, question, openrouter);
      return { model: m, ok: true as const, content: r.content, ms: r.ms, tokens: r.tokens };
    } catch (e) {
      return { model: m, ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  }));

  const successful = votes.filter((v): v is Extract<typeof v, { ok: true }> => v.ok && v.content.length > 0);
  if (successful.length === 0) {
    return new Response(JSON.stringify({
      question,
      models,
      votes,
      synthesis: "All models failed.",
      ms: Date.now() - t0,
    }), { status: 502, headers: { "content-type": "application/json" } });
  }

  const synthSystem = "You are synthesizing answers from multiple AI models for Edmund Mitchell. Read the answers below, identify points of agreement and disagreement, and give Edmund ONE consolidated answer in 4-8 sentences. End with a line beginning 'Models agreed on:' or 'Models disagreed on:' summarizing the consensus shape. Cite model name in parens when noting disagreement.";
  const synthUser = [
    `## Question\n${question}`,
    "",
    "## Answers from each model",
    ...successful.map((v) => `### ${v.model}\n${v.content}`),
  ].join("\n\n");

  let synthesis = "";
  let synthMs = 0;
  try {
    console.log(JSON.stringify({ mixture_synth: synthModel }));
    const synth = await callOpenRouter(synthModel, synthSystem, synthUser, openrouter);
    synthesis = synth.content;
    synthMs = synth.ms;
  } catch (e) {
    synthesis = `Synthesis failed (${e instanceof Error ? e.message : String(e)}). Raw model outputs in 'votes'.`;
  }

  return new Response(JSON.stringify({
    question,
    models,
    synthesis,
    votes,
    ms_total: Date.now() - t0,
    ms_synth: synthMs,
    successful_count: successful.length,
    failed_count: votes.length - successful.length,
  }), { headers: { "content-type": "application/json" } });
});

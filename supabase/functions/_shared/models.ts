// Centralized model picker for factory Edge Functions.
//
// Defaults are baked in here. Optional env overrides:
//   MODEL_CHEAP, MODEL_MID, MODEL_STRONG
// Allowlist enforced: must match anthropic/<x>, openai/<x>, or google/gemini-<x>.
//
// See ops/plans/2026-05-03-cost-routing.md.

export type Task =
  | "summarize"
  | "classify"
  | "vote"
  | "vote_mid"
  | "audit_draft"
  | "synthesize"
  | "review"
  | "reason_hard";

const DEFAULTS = {
  cheap: "anthropic/claude-haiku-4-5",
  mid: "anthropic/claude-sonnet-4-6",
  strong: "anthropic/claude-opus-4-7",
} as const;

const FALLBACK_MODEL = "gpt-4o-mini";

const ALLOWLIST = /^(anthropic|openai)\/.+$|^google\/gemini-.+$/;

export function assertAllowed(modelId: string): void {
  if (typeof modelId !== "string" || !ALLOWLIST.test(modelId)) {
    throw new Error(`model_id_disallowed: ${modelId}`);
  }
}

function resolveTier(tier: "cheap" | "mid" | "strong"): string {
  const envName = tier === "cheap" ? "MODEL_CHEAP" : tier === "mid" ? "MODEL_MID" : "MODEL_STRONG";
  const override = Deno.env.get(envName);
  const id = override && override.trim().length > 0 ? override.trim() : DEFAULTS[tier];
  assertAllowed(id);
  return id;
}

export function pickModel(task: Task): string {
  switch (task) {
    case "summarize":
    case "classify":
    case "vote":
    case "audit_draft":
      return resolveTier("cheap");
    case "vote_mid":
    case "synthesize":
    case "review":
      return resolveTier("mid");
    case "reason_hard":
      return resolveTier("strong");
    default: {
      const _exhaustive: never = task;
      throw new Error(`unknown task: ${_exhaustive}`);
    }
  }
}

export function pickFallback(): string {
  return FALLBACK_MODEL;
}

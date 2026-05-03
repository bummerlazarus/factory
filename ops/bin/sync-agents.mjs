#!/usr/bin/env node
// sync-agents.mjs — DEPRECATED 2026-05-03
//
// The disk→DB push for agent identity/CLAUDE/soul markdown is gone.
// Source of truth is now public.agent_personas (versioned, RLS-protected).
//
// New convention:
//   - Edit personas through /inbox/promotions (writes a kind='persona-edit'
//     proposal; on approve it materializes into agent_personas).
//   - Pull DB → disk for offline/Cowork workflows:
//       node ops/bin/pull-personas-from-db.mjs --dry-run
//       node ops/bin/pull-personas-from-db.mjs
//
// Original implementation preserved at:
//   ops/bin/sync-agents.mjs.deprecated-2026-05-03
//
// Plan: ops/plans/2026-05-03-agent-personas-and-memory.md (v2)
// Convention: ops/docs/agent-source-of-truth.md

console.error(
  [
    "sync-agents.mjs is deprecated as of 2026-05-03.",
    "",
    "Disk is no longer the source of truth for agent personas.",
    "Source: public.agent_personas (Supabase). Edits go through",
    "/inbox/promotions on the dashboard.",
    "",
    "To pull the latest live personas to disk for Cowork workflows:",
    "  node ops/bin/pull-personas-from-db.mjs --dry-run",
    "  node ops/bin/pull-personas-from-db.mjs",
    "",
    "See ops/docs/agent-source-of-truth.md for the new convention.",
  ].join("\n")
);
process.exit(1);

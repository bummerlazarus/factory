# OA.4 — tsconfig cleanup

**Date:** 2026-04-19
**Epic:** OA.4 (Wave OA follow-up)
**Status:** 🟢 DONE
**Plan:** inline (XS, no separate plan file)

## What shipped

Excluded `ops/scripts/` and `supabase/functions/` from `dashboard/tsconfig.json`. These directories contain Deno/Node utility scripts unrelated to the Next.js build; their type errors were failing `npm run build`, blocking W9.5 prod deploy.

## Files touched

- `dashboard/tsconfig.json` — added two entries to `exclude`.
- `dashboard/.gitignore` — added `/.worktrees/` (support file for the run, committed separately).

## Commits (branch `feat/oa-4-tsconfig`, off `main`)

- `b36ff4b` chore: ignore .worktrees/ local state
- `4e76b6c` chore(tsconfig): exclude ops/scripts + supabase/functions

## Baseline failure (pre-fix)

```
./ops/scripts/ingest-youtube.ts:118:30
Type error: Argument of type 'string | null' is not assignable to parameter of type 'string'.
Next.js build worker exited with code: 1
```

## Verification output

```
$ npx tsc --noEmit
EXIT=0

$ npm run build  (with .env.local symlinked)
...
 ✓ Compiled successfully in 2.5s
 Running TypeScript ...
 ...Turbopack build complete with 1 warning (NFT trace for next.config.ts — pre-existing, unrelated)
EXIT=0
```

All routes (`/changelog`, `/chat`, `/clients`, `/files`, `/inbox`, `/inbox/promotions`, `/metrics`, `/research`, `/tasks`, `/workspace`, plus API routes) built cleanly.

## Subagents dispatched

None. XS task executed inline by the orchestrator.

## Follow-ups

- Open a PR from `feat/oa-4-tsconfig` → `main` when Edmund is ready to merge. No functional change, safe to fast-forward.
- W9.5 is now unblocked on the build-passes criterion. Still gated on W9.2 (Q10) + Edmund approval.

## Cost

Negligible. No LLM calls.

## What's next

- W9.2 (Q10 security hardening) — plan written, Edmund approved A+B+C+D, execution next.

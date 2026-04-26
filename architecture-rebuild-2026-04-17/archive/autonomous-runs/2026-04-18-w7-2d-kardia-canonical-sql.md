# W7.2d — Kardia canonical SQL + project-tag pattern

**Date:** 2026-04-18
**Mode:** Autonomous dispatch.
**Status:** Complete.

## What changed

Additive edit to Kardia's `## Rebuild 2026-04-17 extensions` block. No identity / soul / behavior changes. Pure documentation + enum tightening to match Edmund's W7.2 resolutions.

### File updated

`/Users/edmundmitchell/Library/Mobile Documents/com~apple~CloudDocs/CEO Cowork/Agent Personalities/agents/pm/CLAUDE.md`

Line count: 103 → 137 (+34 net). No lines deleted except the 4 enum/context lines replaced in-place (see diff below).

### Sections added

1. **`### Client-tag shape (bite-test pattern)`** — new subsection inside the Rebuild extensions block (3-line rule). Codifies: never write `project='cfcs'` (etc.) directly; always `project='dc-clients'` + `artifacts.client=<sub>`. Points to the FK as the enforcement mechanism.
2. **`### Canonical SQL`** — new subsection inside the Rebuild extensions block. Three verbatim snippets from plan §4 (scope read, drift check, drift observation write). Each prefixed with a "When to run" comment-line hint.

Both subsections sit between the existing routing-keywords paragraph and the `## Reference` block — additive, no reorder of existing content.

### Enum / context corrections (diff)

**Opening paragraph** — removed "Lisa" from the DC client list:
- Before: `Digital Continent clients (CFCS, Liv Harrison, Culture Project, Lisa)`
- After:  `Digital Continent clients (CFCS, Liv Harrison, Culture Project)`

**Project-tag bullet** — replaced 8-slug enum with final 6-slug enum + Cordial Catholics stream rule + IOC no-tag rule + `artifacts.client` tightened to 3:
- Before: `closed set zpm / real-true / faith-ai / dc-clients / em-brand / cordial-catholics / factory / other` and `artifacts.client: cfcs, liv-harrison, culture-project, or lisa`
- After:  `Closed set, 6 slugs: factory / dc-clients / zpm / real-true / faith-ai / em-brand` + `em-brand absorbs Cordial Catholics — for Cordial Catholics content, write project='em-brand' with artifacts.stream='cordial-catholics'` + `IOC content gets no project tag (infrastructure)` + `artifacts.client: exactly one of cfcs, liv-harrison, culture-project`

**Scope-read bullet** — tightened from `kind=scope or kind=brand_guide filtered by project` to `kind='client-scope' filtered by slug` (matches the seed in plan §1 and W9.1c vocab pattern). Pointer to the new Canonical SQL subsection.

**`culture-project` context line** — added Lisa-as-sub-contact note:
- Before: `culture-project — active consulting retainer (Teresa, Director of Formation).`
- After:  `culture-project — active consulting retainer (Teresa, Director of Formation). Lisa is a sub-contact within Culture Project, not her own client — log her work as project='dc-clients', artifacts={client:'culture-project', contact:'lisa'}.`

**Removed** the standalone `lisa — 2x/month consulting cadence` bullet (Lisa is no longer a separate entry).

### Routing keywords

Untouched. `lisa (client context)` still appears in the keyword list — preserved for routing hits on "lisa" to land on Kardia — but the scope resolution now sends her into Culture Project, not her own project. No behavior regression: the handoff still routes correctly; only the downstream logging shape changed.

## Decisions cited (Edmund's W7.2 resolutions)

1. **Lisa dropped from top-level DC enum.** She is a sub-contact inside Culture Project. `artifacts.client` enum tightened to 3: `cfcs`, `liv-harrison`, `culture-project`. Logging shape: `project='dc-clients', artifacts={client:'culture-project', contact:'lisa'}`.
2. **`em-brand` absorbs `cordial-catholics`.** Single top-level project slug. Cordial Catholics content tagged via `artifacts.stream='cordial-catholics'` under `project='em-brand'`.
3. **IOC gets no project tag.** Infrastructure — omitted from the 6-slug project enum.

Final project enum: `factory`, `dc-clients`, `zpm`, `real-true`, `faith-ai`, `em-brand` (6).
Final `artifacts.client` enum (when `project='dc-clients'`): `cfcs`, `liv-harrison`, `culture-project` (3).

## Verification

- `identity.md` mtime: **unchanged** (1776321519 before → 1776321519 after).
- `soul.md` mtime: **unchanged** (1776321529 before → 1776321529 after).
- `CLAUDE.md` mtime: updated (as expected).
- Canonical SQL block: three snippets present verbatim, each with a "When to run" hint.
- Project enum: 6 slugs, no `cordial-catholics`, no `other`.
- `artifacts.client` enum: 3 slugs, no `lisa`.
- Routing-keywords block: unchanged (zero behavior regression).
- `## Reference` block: unchanged.

## Backlog

W7.2d row: `⚪` → `🟢` — Kardia CLAUDE.md updated with canonical SQL + bite-test pattern + final enums.

## Related docs

- Plan: `architecture-rebuild-2026-04-17/05-design/plans/2026-04-17-w7-2-client-scaffolding.md` (§4 source of canonical SQL).
- Scope-reassignment decision: `architecture-rebuild-2026-04-17/03-decisions/2026-04-17-agent-scope-reassignment.md` (additive-only pattern respected).
- Companion epics: W7.2a (seed rows), W7.2b (FK), W7.2c (/clients surface) — not touched in this run.

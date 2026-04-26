#!/usr/bin/env bash
# setup-lab.sh — scaffold the EM Research Lab folder structure inside an empty (or
# nearly empty) target directory. Idempotent: safe to re-run, won't overwrite
# existing files.
#
# Run this AFTER you have:
#   1. Created the GitHub repo: bummerlazarus/em-research-lab (private)
#   2. Cloned it to ~/Documents/Claude/Projects/EM Research Lab/
#   3. Confirmed the working tree is empty (or has only README.md / .git/)
#
# Usage:
#   setup-lab.sh                       # default target: ~/Documents/Claude/Projects/EM Research Lab
#   setup-lab.sh /custom/target/path   # custom target
#
# What this does:
#   - Creates the folder skeleton (inbox, knowledge-atlas, research, ip, archive)
#   - Drops a README.md in each zone explaining what lives there
#   - Writes the .gitignore for the lab repo
#   - Writes the top-level README.md pointing at the design doc
#   - Writes _meta.yaml templates for each kind
#   - Writes agent.md skeleton (mode: ingest fleshed; mode: synthesize stubbed)
#   - Writes CHARTER.md placeholder (to be filled in Phase 2)
#   - Writes CLAUDE.md for the /research/ pipeline
#
# What it does NOT do:
#   - Doesn't initialize git (you've already cloned an existing repo)
#   - Doesn't apply the Supabase migration (that's a separate factory step)
#   - Doesn't create any actual content (that's Phase 1)

set -euo pipefail

LAB_ROOT="${1:-$HOME/Documents/Claude/Projects/EM Research Lab}"

if [[ ! -d "$LAB_ROOT" ]]; then
  echo "setup-lab: target does not exist: $LAB_ROOT" >&2
  echo "  Create it first by cloning the em-research-lab repo, e.g.:" >&2
  echo "    git clone git@github.com:bummerlazarus/em-research-lab.git \"$LAB_ROOT\"" >&2
  exit 1
fi

echo "setup-lab: scaffolding into $LAB_ROOT"

# ---------------------------------------------------------------------------
# Helper: write a file only if it doesn't already exist
# ---------------------------------------------------------------------------
write_if_missing() {
  local path="$1"
  if [[ -e "$path" ]]; then
    echo "  skip (exists): ${path#$LAB_ROOT/}"
    return 0
  fi
  mkdir -p "$(dirname "$path")"
  cat > "$path"
  echo "  wrote:        ${path#$LAB_ROOT/}"
}

# ---------------------------------------------------------------------------
# 1. Folder skeleton
# ---------------------------------------------------------------------------
echo "setup-lab: creating folder structure..."
mkdir -p "$LAB_ROOT"/{inbox,archive}
mkdir -p "$LAB_ROOT"/knowledge-atlas/{sources,documents,archive}
mkdir -p "$LAB_ROOT"/ip/{documents,archive}
mkdir -p "$LAB_ROOT"/research/{00-working,01-observations,02-synthesis,03-candidates,04-agent-instructions/templates,archive}
mkdir -p "$LAB_ROOT"/archive/{knowledge-atlas,ip,research}

# Keep empty subdirs in git
for d in \
  inbox \
  knowledge-atlas/sources knowledge-atlas/documents knowledge-atlas/archive \
  ip/documents ip/archive \
  research/00-working research/01-observations research/02-synthesis research/03-candidates research/archive \
  archive/knowledge-atlas archive/ip archive/research
do
  if [[ ! -e "$LAB_ROOT/$d/.gitkeep" && -z "$(ls -A "$LAB_ROOT/$d" 2>/dev/null || true)" ]]; then
    touch "$LAB_ROOT/$d/.gitkeep"
  fi
done

# ---------------------------------------------------------------------------
# 2. Top-level files
# ---------------------------------------------------------------------------

write_if_missing "$LAB_ROOT/README.md" <<'EOF'
# EM Research Lab

Personal knowledge and research system for Edmund Mitchell's brand (EM).

This is a *structured-RAG* system over a curated markdown wiki, with provenance
and decay tracking. The filesystem is the canonical source of truth; Supabase
is a derived index for vector + structured queries; Notion is for tracking
deferred recommendations as tasks (only).

## Where things live

| Zone | What |
|---|---|
| `/inbox/` | Catch-all drop zone. Triage continually. Nothing permanent. |
| `/knowledge-atlas/` | Vetted, trusted reference layer. Sources + documents. Cross-domain. |
| `/research/` | Working pipeline. Observations, synthesis, agent prompts. Nothing permanent. |
| `/ip/` | Edmund's named frameworks, articulations, brand IP. |
| `/archive/` | Retired and superseded versions. |

## Design + build references (in Claude Bootstrapper)

- `context/previous-setups/em-research-lab-design.md` — full design doc (v0.2)
- `context/previous-setups/em-research-lab-build-plan.md` — phased build plan
- `context/previous-setups/em-research-lab-visual.html` — visual overview

## Entry points

- Browse: dashboard Lab Browse view (Phase 2)
- Ingest: `~/factory/ops/bin/lab-ingest <url-or-path>`
- Validate: `~/factory/ops/bin/lab-validate`
- Schema: `~/factory/supabase/migrations/018_em_research_lab.sql`
EOF

write_if_missing "$LAB_ROOT/.gitignore" <<'EOF'
# OS / editor
.DS_Store
*.swp
*~
.vscode/
.idea/

# Working files that aren't knowledge assets
research/00-working/transcripts/
research/00-working/*.tmp
research/00-working/*-raw.*

# Local notes Edmund doesn't want versioned (override per-file with `git add -f`)
**/*.draft.md
**/*.local.md

# Python bytecode (in case validators get cached locally)
__pycache__/
*.pyc
EOF

# ---------------------------------------------------------------------------
# 3. Zone READMEs
# ---------------------------------------------------------------------------

write_if_missing "$LAB_ROOT/inbox/README.md" <<'EOF'
# /inbox

The gate. Everything entering the system lands here first.

**Triage continually.** Nothing lives here permanently. Each item gets routed
during a Cowork triage session:

- → `/knowledge-atlas/documents/` (vetted enough to trust)
- → `/research/` (needs pipeline treatment)
- → `/ip/documents/` (clearly brand IP)
- → Notion task (defer the recommendation; existing Tasks DB, tag `project: "EM Research Lab"`)
- → `/archive/` (interesting but not actionable)
- → delete (not worth keeping)

Items that land here include: dropped sources, voice memo transcripts, Claude
drafts, agent-surfaced recommendations (`kind: recommendation`), conflict
flags from the reading agent, and weekly staleness sweep lists.
EOF

write_if_missing "$LAB_ROOT/knowledge-atlas/README.md" <<'EOF'
# /knowledge-atlas

The trusted reference layer. Cross-domain. Shared across all of Edmund's
workspaces (CEO Cowork, CEO Desk, this lab). Agents query this when building
context for any task — outputs can confidently be built from these docs.

## Structure

- `sources/` — flat bibliographic registry. One file per external source.
  Thin entry: title, author, type, link, agreement level. Referenced by
  `source_refs:` in documents.
- `documents/` — everything Edmund or Claude created. Flat, slug-named. The
  `kind` and other metadata live in each doc's `_meta.yaml`.
- `archive/` — superseded versions specific to this zone.

## Document kinds (V1)

- `source-note` — structured analysis of one external source
- `reference` — methodology, definition, concept
- `playbook` — strategy or tactics for a domain
- `landscape-brief` — current state of a conversation or domain (living)
- `synthesis-memo` — pattern across 3+ sources (point-in-time)
- `sop` — step-by-step process
EOF

write_if_missing "$LAB_ROOT/knowledge-atlas/sources/README.md" <<'EOF'
# /knowledge-atlas/sources

Bibliographic registry only. Thin entries that exist to be referenced by
`source_refs:` in atlas/IP documents.

The processed content of a source (summary, structured analysis) lives in
`/knowledge-atlas/documents/[slug]/` as `kind: source-note` — NOT here.

Format:
```markdown
# [Title]
- **Author:**
- **Type:** book | paper | video | article | podcast | church-doc | talk
- **Published:**
- **Link:**
- **Agreement:** agree | disagree | neutral | irrelevant
- **Ingested:** YYYY-MM-DD
```
EOF

write_if_missing "$LAB_ROOT/knowledge-atlas/documents/README.md" <<'EOF'
# /knowledge-atlas/documents

Flat structure. One folder per doc, slug-named. Each folder contains:

```
[slug]/
  doc.md           # the content
  _meta.yaml       # kind, status, source_refs, domains, tags, etc.
```

Domains are metadata, not folders. To browse by domain/kind/tag/status, use
the dashboard Lab Browse view (Phase 2).

See `/research/04-agent-instructions/templates/` for `_meta.yaml` templates
per kind.
EOF

write_if_missing "$LAB_ROOT/ip/README.md" <<'EOF'
# /ip

Edmund's named frameworks, unique articulations, and brand-level intellectual
property. Same file structure as `knowledge-atlas/documents/` — but owned,
not just referenced.

## Kinds

- `framework` — named, structured model
- `articulation` — a way of saying something distinctly Edmund's
- `brand-concept` — a brand-level idea or angle
- `methodology` — a process Edmund developed

Emerging IP uses `status: draft` on a regular kind (no separate `candidate`
kind). Promote to `status: current` when ready to claim publicly.
EOF

write_if_missing "$LAB_ROOT/research/README.md" <<'EOF'
# /research

A working pipeline, NOT a storage system. Documents produced here flow out to
`/knowledge-atlas/` or `/ip/` when mature. Nothing lives here permanently.

## Structure

- `CLAUDE.md` — pipeline-specific instructions for any agent operating here
- `CHARTER.md` — mission, domains, guiding questions, evidence standards (filled in Phase 2)
- `00-working/` — transcripts, scratch, raw exports (temporary)
- `01-observations/` — raw synthesis-in-progress; feeds Supabase observations table
- `02-synthesis/` — in-progress synthesis before promotion
- `03-candidates/` — atlas / IP candidates before promotion
- `04-agent-instructions/` — agent prompts and templates
- `archive/` — completed pipeline batches
EOF

write_if_missing "$LAB_ROOT/archive/README.md" <<'EOF'
# /archive

Retired docs, superseded versions, and completed pipeline batches.

Write-only for humans. Agents can read for historical context but should never
surface archived docs in active queries (`status: archived` is filtered out
by default).

Subfolders mirror the zones: `knowledge-atlas/`, `ip/`, `research/`.
EOF

# ---------------------------------------------------------------------------
# 4. Research pipeline operational files
# ---------------------------------------------------------------------------

write_if_missing "$LAB_ROOT/research/CLAUDE.md" <<'EOF'
# /research — Pipeline Instructions

**Always loaded when working inside `/research/`.**

This is a working pipeline. Nothing here is permanent. Mature outputs flow out
to `/knowledge-atlas/` or `/ip/`; ephemeral working files get cleaned up.

## Trust level

`/research/` is **in-process**. Use with caution. Don't build deliverables
directly from these files — promote them to the atlas first.

## Where things go

| Subfolder | What |
|---|---|
| `00-working/` | Transcripts, scratch, raw exports. Discard after source notes are written. |
| `01-observations/` | Raw observation log; agent writes Supabase observations from here. |
| `02-synthesis/` | Pattern memos in progress. Promotes to atlas as `kind: landscape-brief` or `synthesis-memo`. |
| `03-candidates/` | Framework candidates (`status: draft`) before promotion to `/ip/`. |
| `04-agent-instructions/` | The single `agent.md` with `mode: ingest \| synthesize`. |

## Hard rules

1. Every doc that becomes a knowledge asset gets a `_meta.yaml`. No exceptions.
2. `source_refs:` MUST be populated for `source-note`, `playbook`,
   `landscape-brief`, `synthesis-memo`. The validator blocks otherwise.
3. Surface conflicts as `kind: recommendation` memos to `/inbox/` — never edit
   atlas docs silently.
4. Synthesis sessions surface gaps as `kind: recommendation` memos. Don't
   auto-execute external actions (arxiv search, etc.) — leave it for triage.

## See also

`~/Documents/Claude/Projects/Claude Bootstrapper/context/previous-setups/em-research-lab-design.md` (v0.2)
EOF

write_if_missing "$LAB_ROOT/research/CHARTER.md" <<'EOF'
# Charter — EM Research Lab

> **Status: placeholder.** Filled in during Phase 2, *after* at least one source
> has flowed cleanly through the reading-agent pipeline. The rationale: the
> charter should be informed by what the system actually produces, not by
> aspirational intentions.
>
> Skeleton below — fill once Phase 1 is shipped.

## Mission

[Translate Catholic thought, AI research, cultural analysis, and brand strategy
into frameworks and practical insights. Specialize in synthesis and application,
not original empirical research.]

## Active Domains (V1 pilot)

- **Brand & Content Strategy** ← pilot domain

(Catholic Ethics & AI, AI & Pastoral Ministry, Catholic Creator Economy,
Storytelling & Evangelization — staged for V2.)

## Guiding Questions for Brand & Content Strategy

- _to fill in_

## Evidence Standards

- Source types tagged: practitioner / empirical / speculative / theological / academic / papal
- Confidence levels: strongly-supported / recurring / emerging / speculative / contradicted
- Single-source claims flagged until enriched
- Attribution precise — never paraphrase a source as Edmund's idea

## Cadence

- Triage: continual during initial ingest; settle into a rhythm once volume stabilizes
- Synthesis: ad-hoc Cowork session per domain
- Compression: weekly factory cron (existing)
- Staleness sweep: weekly SQL cron (Phase 4)

## Definition of Done — V1 Pilot

- [ ] 5+ sources ingested cleanly into the atlas
- [ ] At least one playbook drafted with populated `source_refs`
- [ ] At least one recommendation surfaced and triaged end-to-end
- [ ] Dashboard Lab Browse view in regular use
EOF

# ---------------------------------------------------------------------------
# 5. agent.md — the single prompt with two modes
# ---------------------------------------------------------------------------

write_if_missing "$LAB_ROOT/research/04-agent-instructions/agent.md" <<'EOF'
# agent.md — Lab Reading & Synthesis Agent

A single prompt with two modes. The mode is selected by the calling context:
the `lab-ingest` script triggers `mode: ingest` via the edge function; an
explicit Cowork session triggers `mode: synthesize`.

---

## mode: ingest  (Reading Agent)

**Runs in:** factory edge function (extends `youtube-ingest` pattern). Atomic
filesystem + Supabase write.

### Job

Take one source (URL, PDF, transcript, or text), produce a clean source note,
register the source in the atlas, write a Supabase row, and cross-check
existing atlas docs for conflicts.

### Inputs

- `source_input` — URL, file path, or raw text
- `source_type` — youtube | pdf | article | transcript | text
- `tags` (optional) — array of strings; "lab" tag is always added
- `domains` (required) — at least one domain slug from the active domains list

### Required outputs

1. **Source registry entry** at `knowledge-atlas/sources/[slug].md`:
   ```markdown
   # [Title]
   - **Author:**
   - **Type:** [source_type]
   - **Published:**
   - **Link:** [if applicable]
   - **Agreement:** agree | disagree | neutral | irrelevant   ← initial guess; Edmund overrides during triage
   - **Ingested:** [today]
   ```

2. **Source note** at `knowledge-atlas/documents/[slug]/`:
   - `doc.md` matching the Source Note template (see Templates below)
   - `_meta.yaml` with:
     - `kind: source-note`
     - `status: current`
     - `source_refs: [slug]`   ← REQUIRED — same slug as the registry entry
     - `domains: [...]`         ← REQUIRED — at least one
     - `agreement_level`, `confidence`, `tags`
     - `created_at`, `reviewed_at` (= today), `review_frequency: on-new-source`

3. **Supabase row** in `reference_docs` with:
   - `slug`, `title`, `body` (the doc.md content)
   - `kind: source-note`
   - `lab_zone: knowledge-atlas`
   - `status: current`
   - `source_refs: [slug]`
   - `metadata` (jsonb): domain tags, agreement_level, confidence

4. **Conflict cross-check.** Vector-query existing atlas docs for topical
   overlap. If overlap score > threshold AND there's reason to suspect a
   contradiction or update:
   - Write a `kind: recommendation` memo to `/inbox/[date]-conflict-[slug].md`
   - The memo names the affected doc(s), summarizes the potential conflict,
     and proposes the action ("review and decide: update in place / supersede / ignore")

### Hard rules

- **`source_refs` must be populated.** No empty arrays for source-notes.
- **Atomic writes.** Either the source registry, source note, AND Supabase row
  all succeed, or none do. On failure, roll back filesystem writes.
- **Don't write to the atlas if the source is unclear.** If you can't extract
  a coherent summary, drop the raw input back into `/inbox/` with a note
  explaining what's wrong.
- **Don't auto-archive.** If a conflict is found, surface it; do not edit the
  affected doc.
- **Discard transcripts.** After the source note is written, the transcript in
  `/research/00-working/` can be deleted (or moved to `/research/archive/`).
  The source note is the asset.

### Source Note template (the doc.md content)

```markdown
# [Title]

## Summary (300 words max)
[Main argument in plain language]

## Central Claims
[1–3 key assertions]

## Key Arguments & Evidence
- Argument 1: [evidence]
- Argument 2: [evidence]

## Important Quotes
> "Quote" — [page/timestamp]

## Methodology (if applicable)

## Limitations & Gaps

## Connections
- [Related source notes or knowledge-atlas docs]

## Observations & Questions
```

---

## mode: synthesize  (Synthesis Agent — STUB, fleshed out in Phase 3)

**Runs in:** Cowork session, manual trigger.

### Job

Find patterns across source-notes and observations within a domain. Produce
synthesis memos, surface gaps as recommendations, and propose atlas/IP
candidates.

### Inputs (Phase 3 will detail)

- `domain` — which domain to synthesize over
- `scope` — optional date range or source set

### Outputs (Phase 3 will detail)

- `research/02-synthesis/[theme-slug].md` — the synthesis memo
- `research/03-candidates/[candidate-slug].md` — atlas/IP candidate (optional)
- `kind: recommendation` memos to `/inbox/` for surfaced gaps

### Hard rules (Phase 3 will detail)

- Synthesis memos require `source_refs` covering all sources cited.
- Candidates start with `status: draft`; promotion is human-approved.
- Don't make claims unsupported by source-notes — flag gaps as recommendations.

> **Phase 3 will replace this stub with the full prompt.**
EOF

# ---------------------------------------------------------------------------
# 6. _meta.yaml templates
# ---------------------------------------------------------------------------

TEMPLATE_DIR="$LAB_ROOT/research/04-agent-instructions/templates"

write_if_missing "$TEMPLATE_DIR/source-note.meta.yaml" <<'EOF'
# Template: _meta.yaml for kind: source-note
# Lives next to doc.md inside knowledge-atlas/documents/[slug]/
kind: source-note
status: current               # current | draft | stale | archived
created_at: YYYY-MM-DD
reviewed_at: YYYY-MM-DD
review_frequency: on-new-source
source_refs:
  - [source-slug]             # REQUIRED — at least one
domains:
  - [domain-slug]             # REQUIRED — at least one
agreement_level: agree        # agree | disagree | neutral | irrelevant
confidence: high              # high | medium | low
superseded_by: null
tags:
  - []
EOF

write_if_missing "$TEMPLATE_DIR/playbook.meta.yaml" <<'EOF'
# Template: _meta.yaml for kind: playbook
kind: playbook
status: current
created_at: YYYY-MM-DD
reviewed_at: YYYY-MM-DD
review_frequency: quarterly   # living document — review on cadence
source_refs:
  - [source-slug]             # REQUIRED — at least one
domains:
  - [domain-slug]
confidence: high
superseded_by: null
tags:
  - []
EOF

write_if_missing "$TEMPLATE_DIR/landscape-brief.meta.yaml" <<'EOF'
# Template: _meta.yaml for kind: landscape-brief
kind: landscape-brief
status: current
created_at: YYYY-MM-DD
reviewed_at: YYYY-MM-DD
review_frequency: quarterly
source_refs:
  - [source-slug]             # REQUIRED — at least one
domains:
  - [domain-slug]
confidence: high
superseded_by: null
tags:
  - []
EOF

write_if_missing "$TEMPLATE_DIR/synthesis-memo.meta.yaml" <<'EOF'
# Template: _meta.yaml for kind: synthesis-memo
# Lives in research/02-synthesis/[theme-slug]/_meta.yaml
kind: synthesis-memo
status: draft                 # promote to current when ready, or supersede
created_at: YYYY-MM-DD
reviewed_at: YYYY-MM-DD
review_frequency: once        # point-in-time snapshot; superseded, not edited
source_refs:                  # REQUIRED — list every source synthesized
  - [source-slug-1]
  - [source-slug-2]
domains:
  - [domain-slug]
confidence: emerging          # strongly-supported | recurring | emerging | speculative
superseded_by: null
tags:
  - []
EOF

write_if_missing "$TEMPLATE_DIR/recommendation.meta.yaml" <<'EOF'
# Template: _meta.yaml for kind: recommendation
# Lives in /inbox/[date]-[slug]/_meta.yaml (or alongside a flat .md)
kind: recommendation
status: open                  # open | in-progress | done | declined
created_at: YYYY-MM-DD
created_by: synthesis-agent   # or reading-agent | manual
effort: small                 # small | medium | large
agent_runnable: yes           # yes | partial | no
related_docs:                 # atlas/IP slugs this recommendation touches
  - []
domains:
  - [domain-slug]
notion_task_id: null          # set when deferred to Notion Tasks
EOF

write_if_missing "$TEMPLATE_DIR/ip-framework.meta.yaml" <<'EOF'
# Template: _meta.yaml for kind: framework (IP)
# Lives in ip/documents/[slug]/_meta.yaml
kind: framework
status: draft                 # draft until ready to claim publicly; then current
created_at: YYYY-MM-DD
reviewed_at: YYYY-MM-DD
review_frequency: annually
source_refs: []               # optional for IP — your own thinking
domains:
  - [domain-slug]
confidence: high
superseded_by: null
tags:
  - []
EOF

write_if_missing "$TEMPLATE_DIR/reference.meta.yaml" <<'EOF'
# Template: _meta.yaml for kind: reference
# Methodology, definition, concept — stable knowledge.
kind: reference
status: current
created_at: YYYY-MM-DD
reviewed_at: YYYY-MM-DD
review_frequency: annually
source_refs: []               # optional
domains:
  - [domain-slug]
confidence: high
superseded_by: null
tags:
  - []
EOF

# ---------------------------------------------------------------------------
# 7. Sources index stub
# ---------------------------------------------------------------------------

write_if_missing "$LAB_ROOT/knowledge-atlas/sources/_index.md" <<'EOF'
# Sources Index

Running bibliography. Updated by the reading agent on each ingest.

| Slug | Title | Author | Type | Ingested |
|---|---|---|---|---|
| _(empty — first ingest will populate this)_ |
EOF

# ---------------------------------------------------------------------------
# Done.
# ---------------------------------------------------------------------------
echo
echo "setup-lab: done."
echo
echo "Next steps:"
echo "  1. Apply Supabase migration:"
echo "       ~/factory/supabase/migrations/018_em_research_lab.sql"
echo "  2. Install lab-validate as the pre-commit hook (optional):"
echo "       cp ~/factory/ops/bin/lab-validate \"$LAB_ROOT/.git/hooks/pre-commit\""
echo "       chmod +x \"$LAB_ROOT/.git/hooks/pre-commit\""
echo "  3. Run lab-validate to confirm a clean tree:"
echo "       ~/factory/ops/bin/lab-validate \"$LAB_ROOT\""
echo "  4. Add the lab folder to Cowork so Claude can verify the result."
echo "  5. Initial commit + tag v0.0-foundations."

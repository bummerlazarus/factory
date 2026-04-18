# Rebuild Backlog

**Status:** Draft 2026-04-17. Ordered work queue for autonomous runs (see `autonomy-charter.md`). Edmund edits priority + status; orchestrator picks the top `⚪` item with satisfied dependencies.

## How to read this

- Epics are ordered by **wave** (roughly dependency-based, ship a wave before the next).
- Within a wave, the order is the recommended execution order.
- **Size:** S (1 run, <4h), M (1 run, 4–8h), L (multi-run, split further before starting).
- **Depends on:** epic IDs that must be `🟢 DONE` first. `-` means no dependencies.
- **Needs decision?:** open-questions.md Q# that must resolve before starting, if any.
- Each epic, when started, gets a plan at `05-design/plans/YYYY-MM-DD-<slug>.md` and a run log at `06-handoffs/autonomous-runs/`.

## Legend

⚪ not started · 🔵 in flight · 🟢 done · 🟡 blocked · 🔴 abandoned · ⛔ waiting on decision

---

## Wave 0 — Already shipped (no work)

| ID | Epic | Status | Notes |
|---|---|---|---|
| W0.1 | Phase 0.5 security fixes | 🟢 | 4 migrations applied; see decisions-log |
| W0.2 | Phase 1.5 schema: sessions / work_log / observations / skill_versions / reference_docs + session_id | 🟢 | Migrations 005–010 applied |
| W0.3 | Phase 2 schema: pgvector + memory table + match_memory() | 🟢 | Migrations 011–013 applied |
| W0.4 | Phase 3 MVP: Cordis + Corva + /inbox/promotions + Daily Recap | 🟢 | Execution log 2026-04-17-phase-3 |

---

## Wave 1 — Finish the foundation (unblocks everything)

| ID | Epic | Size | Depends on | Needs decision? | Status |
|---|---|---|---|---|---|
| W1.1 | **Complete Pinecone → pgvector data migration** — final counts knowledge=12,785, content=206, conversations=201 (total 13,192, exactly dry-run expectation). Dual-read instrumentation landed: `memory_dualread_log` + `supabase/functions/_shared/dualread.ts`. NUL-byte bug in source corpus fixed in migration script. | M | - | - | 🟢 |
| W1.2 | **Phase 2.5 — rewire semantic search callers to `match_memory()`.** Audit found **zero live callers in the factory codebase** — convention documented in `supabase/README.md` "Semantic search convention" section instead. Historical callers remain in GravityClaw until W9.4. | M | - | - | 🟢 |
| W1.3 | **Phase 1 — delete dead weight.** Edmund picked **leave** (2026-04-17). Stale local commit `5d32f83` stays unpushed; micro-cleanup of `notion_sync` + `recalibrate_pinecone` deferred to W9.4. See decisions-log. | S | - | - | 🟢 |
| W1.4 | **Dual-read parity report** — 1 week of logs comparing Pinecone vs pgvector results on same query. Green-light (or not) to proceed to Pinecone decommission. | S | W1.2 (+ 7 days) | - | ⚪ |

---

## Wave 2 — Capture pipeline skeleton (Track B foundation)

| ID | Epic | Size | Depends on | Needs decision? | Status |
|---|---|---|---|---|---|
| W2.1a | ~~**`capture()` Edge Function v1**~~ — partially shipped. Deployed `capture` (v5) validates text/URL, opens sessions, writes `work_log`, bare-fetch URL enrichment. | S | - | - | 🟢 |
| W2.1b | **`capture()` — embedding write to `memory`** — v6 deployed: generates 1536-dim embedding (text-embedding-3-small) and inserts into `public.memory` with `source='capture'`, `source_id=work_log.id`, namespace ∈ {'knowledge', 'content'}. Best-effort — returns `memory_warning` if OPENAI_API_KEY missing. | S | - | - | 🟢 |
| W2.1c | **`capture()` — Firecrawl URL enrichment** — v7 deployed: prefers Firecrawl `/v1/scrape` for clean page-body markdown (embedded into `memory`); falls back to bare-fetch when FIRECRAWL_API_KEY is missing or errors. Response reports `enrichment_source`. | S | - | - | 🟢 |
| W2.2 | **Dashboard `/inbox` page** — v1 shipped: server-rendered list of recent `work_log` captures (`kind ∈ {note, research}`), card UI differentiates text vs URL, shows enrichment source + markdown size for Firecrawl, project tag, relative timestamp. Sidebar "Inbox" link added. HTTP 200 verified end-to-end with seeded text+url rows. **Realtime subscription deferred** (needs anon SELECT policy on work_log + browser-side supabase-js client — follow-up W2.2b). | M | W2.1c | - | 🟢 |
| W2.2b | **Dashboard `/inbox` Realtime subscription** — migration 016 added anon SELECT + work_log to `supabase_realtime` publication. Browser singleton at `lib/supabase-browser.ts`. Client component `app/inbox/captures-list.tsx` subscribes on mount; new rows prepend with a "NEW" badge that fades after 10s. Verified via SSR + seed row rendering. | S | W2.2 | - | 🟢 |
| W2.3 | **Webhook doc** — `05-design/capture-api.md` published: API contract, iPhone Shortcut recipe, URL bookmarklet, email-forward via Zapier/Make, scheduled-task pattern, secrets setup, error map. | S | - | - | 🟢 |
| W2.4 | **MCP tool `capture`** — SHIPPED 2026-04-17 (path α). `capture-mcp` Edge Function deployed. Edmund added to his Claude Code via `claude mcp add`; live round-trip tested ("Captured. Session cbdea22a, work_log f0bd31f9, memory 242daa68"). Fully closed. See [run log](autonomous-runs/2026-04-17-w2-4-capture-mcp.md). | S | W2.1c | - | 🟢 |
| W2.5 | **File upload path** — SHIPPED 2026-04-17. `capture()` v18 adds `kind="file"` (MIME allowlist: pdf / png / jpeg / webp / md / plain). Binary files land in new `captures` bucket (50 MB cap, private) keyed `<session>/<uuid>.<ext>`; markdown/plain embed inline (1 MB cap, no Storage). PDFs get best-effort in-Deno text extraction → `memory` embed; image-only PDFs + images skip the embed with `memory_warning`. Verified across all four paths + MIME/size rejects; test data cleaned. See [plan](../05-design/plans/2026-04-17-w2-5-file-upload.md) + [run log](autonomous-runs/2026-04-17-w2-5-file-upload.md). | M | W2.1c | - | 🟢 |

---

## Wave 3 — Dashboard Track A (Supabase migration of existing app)

Per `/dashboard/docs/superpowers/plans/2026-04-17-supabase-migration.md`. **Most of Track A already shipped** per `dashboard/` git log — audit confirms (commit hashes in parens).

| ID | Epic | Size | Depends on | Needs decision? | Status |
|---|---|---|---|---|---|
| W3.0 | Supabase client singleton + dashboard schema | S | - | - | 🟢 (17a3172) |
| W3.1 | Sessions → `agent_conversations` | M | - | - | 🟢 (6e4ccd4) |
| W3.2 | Changelog → `agent_activity_log` | S | - | - | 🟢 (4952f4f) |
| W3.3 | Task inbox → `agent_tasks` | S | - | - | 🟢 (ca66036) |
| W3.4 | Workspace docs → `workspace_items` | M | - | - | 🟢 (2c2f55c) |
| W3.5 | Per-agent memory + run logs → Supabase | S | - | - | 🟢 (1b0bea7) |
| W3.6 | Slack-style messaging → `slack_messages` | S | - | - | 🟢 (99367a9) |
| W3.7 | **Picked (b) — SHIPPED (2026-04-17).** `/files` page is now a server component that renders a "disabled in this environment" placeholder when `COWORK_PATH` unset, otherwise hands off to `FilesClient`. `/api/files` + `/api/files/raw` early-return 404 `file-browser-disabled` when env unset. `lib/tools.ts` exports `FILE_TOOLS = []` in prod and `sandboxPath()` throws fast. Local dev behavior unchanged; prod-sim defer to W3.9 Vercel preview for real-world verification. See run log. | M | - | - | 🟢 |
| W3.8 | Agents table migration (bonus) | S | - | - | 🟢 (bfa7e47) |
| W3.9 | **Vercel preview deploy** of the migrated dashboard | S | W3.7 resolved + Q10 | Q10 (security hardening) for public | ⛔ |

Note: Track A proceeded independently of the rebuild notebook via direct commits. Update reflects observed state, not planned state.

---

## Wave 4 — Voice memos & ingest (Lev comes online)

| ID | Epic | Size | Depends on | Needs decision? | Status |
|---|---|---|---|---|---|
| W4.1 | **Lev agent** — 🔴 ABANDONED (wrong scope). Canonical Lev in `marketing/` is **Brand strategist & audience growth** per master roster at `COWORK_PATH/Agent Personalities/README.md`; the "ingest conductor" scaffold was wrong. Quarantined at `04-audit/2026-04-17-agent-misalignment-quarantine/lev-bad-scope-2026-04-17/`. **Replaced by: Feynman system-prompt extension (see decisions log `2026-04-17-agent-scope-reassignment.md`).** Tracked as W4.1b. | S | W0.4 | - | 🔴 |
| W4.1b | **Feynman ingest-orchestration scope extension** — 🟢 DONE 2026-04-17. Extended `research/CLAUDE.md` with a `## Rebuild 2026-04-17 extensions` section documenting ingest orchestration (voice memo / YouTube / signals / RSS / PDF), two-phase preview→confirm pattern, project-tagging, Edge Functions called (`capture`, `ingest-youtube`, `signals-ingest`), tables read/written, and new routing keywords. Pure additive — `identity.md` + `soul.md` untouched. Functional wiring (W4.2, W6.1) still required for the scope to be executable. See `03-decisions/2026-04-17-agent-scope-reassignment.md`. | S | W0.4 | - | 🟢 |
| W4.2 | **Voice memo capture path** — 🟢 DONE (backlog was stale). Shipped 2026-04-17 in commit `e14b882` bundled into the initial `capture()` Edge Function ship. Voice branch: base64 audio → `voice-captures` Storage bucket (private, 25 MB cap) → OpenAI Whisper `/v1/audio/transcriptions` (`whisper-1`, `verbose_json`) → transcript flows into the text-capture path (`memory` namespace `knowledge`, `metadata.voice=true`). Re-verified live 2026-04-18 with an 8 KB silent WAV: session+work_log+memory rows created, Storage object landed at `voice-captures/<session>/<uuid>.wav`, Whisper returned `duration_sec=0.5 language_detected=english`. Test data cleaned up. See [run](autonomous-runs/2026-04-18-w4-2-voice-reverify.md). | M | W2.1 | - | 🟢 |
| W4.3 | **iPhone Shortcut** — SHIPPED 2026-04-17. Doc-only epic. Canonical guide at [`05-design/iphone-shortcuts-guide.md`](../05-design/iphone-shortcuts-guide.md): three Shortcuts (text / URL / voice), shared secrets helper, testing matrix + curl equivalents. Voice Shortcut gated on W4.2 deploy (checkbox at top). `capture-api.md` iPhone section replaced with pointer. Edmund builds in Shortcuts.app (not auto). See [run log](autonomous-runs/2026-04-17-w4-3-iphone-shortcuts.md). | S | W2.3, W4.2 | - | 🟢 |
| W4.4 | **YouTube ingest** — SHIPPED 2026-04-17. Edge Function deployed (verify_jwt=false, option A two-phase). Companion `ops/scripts/ingest-youtube.ts` uses yt-dlp → POST. Verified: fresh ingest → chunks+embed+upsert, idempotency skip, force re-ingest. Test data cleaned. See [run log](autonomous-runs/2026-04-17-w4-4-youtube-ingest.md). | M | W1.1 | - | 🟢 |
| W4.5 | **Signals ingest** — SHIPPED 2026-04-17. Edge Function `signals-ingest` v1 deployed (verify_jwt=false, two-phase). Writes `signals` + `signal_source_health` + `memory` (namespace=`knowledge`, source=`signal`). **Missing-namespace bug fixed**: all signals embedded (no score gate) into canonical pgvector namespace instead of unused Pinecone `"signals"`. 5/5 acceptance checks green. Follow-ups: set `GOOGLE_API_KEY` secret for live Gemini scoring; ship a companion RSS/yt-dlp fetcher when full automation is wanted. See [run log](autonomous-runs/2026-04-17-w4-5-signals-ingest.md). | M | W1.1 | - | 🟢 |

---

## Wave 5 — Content engine foundation (Axel + metrics)

| ID | Epic | Size | Depends on | Needs decision? | Status |
|---|---|---|---|---|---|
| W5.1 | **Axel agent** — 🔴 ABANDONED (wrong scope). Canonical Axel in `developer/` is **Technical implementation specialist** per master roster, not ideation/drafting/repurposing. Quarantined at `04-audit/2026-04-17-agent-misalignment-quarantine/axel-bad-scope-2026-04-17/`. **Replaced by: Corva system-prompt extension (see decisions log `2026-04-17-agent-scope-reassignment.md`).** Tracked as W5.1b. | S | W0.4 | - | 🔴 |
| W5.1b | **Corva ideation + drafting + repurposing scope extension** — 🟢 DONE 2026-04-17. Extended `content/CLAUDE.md` with a `## Rebuild 2026-04-17 extensions` section documenting ideation → draft → repurpose pipeline (essays, newsletters, YT scripts, podcast outlines, IG carousel captions, Reels hooks, Shorts scripts), reference-doc consult order, workspace + `work_log` + `observations` writes, and new routing keywords (`repurpose`, `carousel`, `hook`, `cold open`, `show notes`, `script`, `caption`, etc.). Pure additive — `identity.md` + `soul.md` untouched. See `03-decisions/2026-04-17-agent-scope-reassignment.md`. | S | W0.4 | - | 🟢 |
| W5.2 | **IOC system import** — SHIPPED 2026-04-17. Canonical `IOC_DIRECTIVE.md` (v2.0+, 250 lines, 10.8 KB) imported from `reference/archive/ioc-system-v2/` into `public.reference_docs` as one row: slug `ioc-system-v2`, kind `framework`, id `df1b6b54-e722-47ec-a420-970a4d7f4b93`. 40 supporting A/N/E/B/O/S SOPs left in the archive (future backlog). `memory`-table embedding deferred (needs Edge-Function path with `OPENAI_API_KEY`). See [plan](../05-design/plans/2026-04-17-w5-2-ioc-import.md) + [run log](autonomous-runs/2026-04-17-w5-2-ioc-import.md). | S | - | - | 🟢 |
| W5.3 | **Metrics ingest — YouTube** — SHIPPED 2026-04-17. Edge Function `youtube-metrics` v1 deployed (verify_jwt=false). New additive `public.content_metrics` table (platform-agnostic time-series, `{platform, platform_id, metric_name, metric_value, fetched_at, metadata}`). Dual-write: refreshes `agent_youtube_videos.{view,like,comment}_count` AND appends one snapshot row per metric. Three input modes: `video_ids[]`, `channel_id`, or empty (uses `YOUTUBE_CHANNEL_ID` env). Public Data API only — Analytics API (watch-time/retention, OAuth) tracked as W5.3b. Verified on 2 real Edmund-owned videos (8 snapshot rows). See [run log](autonomous-runs/2026-04-17-w5-3-youtube-metrics.md). | M | - | - | 🟢 |
| W5.4 | **Metrics ingest — Instagram** — 🔴 ABANDONED 2026-04-17. Edmund has no Instagram access token and won't backfill one. Deployed Edge Function `instagram-metrics` tombstoned (returns HTTP 410, v2) — true delete deferred until Edmund generates a Supabase PAT or runs `supabase login`. Local files removed from `dashboard/supabase/functions/instagram-metrics/` (commit `9550fd0`). Original ship run log: [2026-04-17-w5-4-instagram-metrics.md](autonomous-runs/2026-04-17-w5-4-instagram-metrics.md). Retirement log: [2026-04-17-supabase-path-cleanup.md](autonomous-runs/2026-04-17-supabase-path-cleanup.md). | M | - | - | 🔴 |
| W5.5 | **Metrics ingest — Beehiiv** — SHIPPED 2026-04-17. Edge Function `beehiiv-metrics` v1 deployed (verify_jwt=false). Calls Beehiiv `GET /v2/publications/{id}/posts?expand=stats` with pagination, upserts per-post row into new `public.beehiiv_post_metrics` table (additive migration, PK `(publication_id, post_id)`, email+web stats columns + `raw` JSONB). Verified: fresh insert (3 rows), idempotent re-POST (`updated: 3`), `since` filter logic. Test data cleaned up. Follow-ups: set `BEEHIIV_PUBLICATION_ID` as a function secret so body param becomes optional; publication has only drafts today so live email stats will populate on first send. See [run log](autonomous-runs/2026-04-17-w5-5-beehiiv-metrics.md). | S | - | - | 🟢 |
| W5.6 | **Metrics ingest — Circle** — community metrics (signups, active users, engagement). | M | - | Q12 (Circle provisioner) | ⚪ |
| W5.7 | **Dashboard metrics panel** — SHIPPED 2026-04-17. New `/metrics` route (server component) reads `content_metrics_unified` view (additive migration) + platform-typed tables. Three sections: top-line cards w/ 30d delta (YouTube views, Beehiiv opens, Beehiiv web views, Instagram disconnected tile), top 5 per platform ordered by current lifetime metric, recent 20 snapshots timeline. Sidebar nav entry added. HTTP 200, renders 149,871 total YouTube views + 8 timeline rows in prod. Delta will compute after second scheduled snapshot run. See [run log](autonomous-runs/2026-04-17-w5-7-metrics-panel.md). | M | W5.3–W5.6 | - | 🟢 |
| W5.8 | **"Double-down" Skill** — SHIPPED 2026-04-17. Postgres function `public.double_down_scan(lookback_days, top_n)` + pg_cron `double-down-nightly` at 08:00 UTC. Reads `content_metrics_unified` (YouTube view_count + Beehiiv web_views), picks top N per platform by latest snapshot, writes `reference_docs` rows with `kind='promotion'` (no dedicated promotions table yet — fallback per spec, flagged for future split). Idempotent on slug `promotion-<date>-<platform>-<id>` via ON CONFLICT DO NOTHING. Verified live: first run processed=2 proposed=2; re-run skipped_existing=2 proposed=0. Test rows cleaned. See [run log](autonomous-runs/2026-04-17-w5-8-double-down.md). | M | W5.7 | - | 🟢 |
| W5.9 | **"Educated bets" Skill** — SHIPPED 2026-04-17. Postgres function `public.educated_bets_scan(lookback_days, top_n)` + pg_cron `educated-bets-weekly` at Monday 09:00 UTC. Forward-looking counterpart to W5.8: reads top performers from `content_metrics_unified`, extracts tag/keyword patterns, emits up to 3 template-based "bets" (double-hook-variant, platform-cross-post, framework-deepen) into `reference_docs` with `kind='educated-bet'`. Pure SQL — no LLM calls. Idempotent on slug `bet-<date>-<md5(template\|fragment)[:10]>`. Verified live: first run processed=2 proposed=2; re-run skipped_existing=2 proposed=0. Test rows cleaned. Only 2 of 3 templates materialized this run (no Beehiiv data yet for cross-post). See [plan](../05-design/plans/2026-04-17-w5-9-educated-bets.md) + [run log](autonomous-runs/2026-04-17-w5-9-educated-bets.md). | M | W5.8 | - | 🟢 |

---

## Wave 6 — Research-director layer (pillar 4 in full)

| ID | Epic | Size | Depends on | Needs decision? | Status |
|---|---|---|---|---|---|
| W6.1 | **Librarian scheduled task** — daily cluster of `observations` by topic/embedding. Writes summaries to `reference_docs` (type=cluster). `pg_cron` job `librarian-daily` 06:00 UTC runs `public.librarian_cluster_observations(7)`. Joins observations→memory via `(source='observation', source_id=obs.id::text)`. Zero-obs case returns clean. Migration `20260417214428_librarian_cluster`. Plan `05-design/plans/2026-04-17-w6-1-librarian.md`, run log `06-handoffs/autonomous-runs/2026-04-17-w6-1-librarian.md`. Follow-up: nothing writes observations yet — needed before clusters appear. | M | W4.2 + W0.2 | - | 🟢 |
| W6.2 | **Research-director Skill v1** — weekly cross-corpus scan. Surfaces: emergent themes, cross-silo connections, IP-map gaps. Writes proposals to `/inbox/promotions` (or new `/inbox/research` tab). **Split 2026-04-17** into W6.2a/b/c/d — see [split plan](../05-design/plans/2026-04-17-w6-2-research-director-split.md). Partial: W6.2a shipped. | L | W6.1 | - | 🔵 |
| W6.2a | **Emergent-theme SQL scan** — SHIPPED 2026-04-17. Postgres function `public.research_director_themes(window_days, baseline_days, top_n, similarity_threshold)` + pg_cron `research-director-weekly` Mon 07:00 UTC. Unions `memory` rows (namespaces knowledge/content/conversations), scores per-row density as window-neighbor / baseline-neighbor at threshold, clusters top-density rows via recursive-CTE connected components, writes `reference_docs` kind=`theme`. Idempotent on `theme-<date>-<md5[:8]>` (ON CONFLICT DO UPDATE, version bumps). Pure SQL — no LLM calls. Migration `20260417120000_research_director_themes.sql` also silently restores `'educated-bet'` to the kind CHECK (W6.4 had dropped it). Verified: empty-window returns clean no-op, real-data run (3650-day window) produced 7 themes including one spanning 2 sources (csv+markdown), seeded positive-path test produced a 3-member cluster with 2 distinct sources across 3 namespaces, idempotent re-run bumped version 1→2, cron registered. See [plan](../05-design/plans/2026-04-17-w6-2a-research-director-themes.md) + [run log](autonomous-runs/2026-04-17-w6-2a-research-director-themes.md). | M | W6.1 | - | 🟢 |
| W6.2b | **Cross-silo connections SQL scan** — SHIPPED 2026-04-17. `public.research_director_connections(window_days, top_n, similarity_threshold)` finds high-similarity PAIRS where members come from DIFFERENT `memory.source` values, writes one `reference_docs` row per pair (kind=`connection`). Idempotent on `connection-<date>-<md5(a_id||b_id)[:8]>` (ON CONFLICT DO UPDATE, version bumps). Migration `20260417130000_research_director_connections.sql` extends kind CHECK to 15 values (adds `'connection'`, preserves all 14 prior). Chained into existing `research-director-weekly` cron (Mon 07:00 UTC) as second SELECT after themes. Verified: empty-window clean no-op; real-data run over 10-year window produced 10 pairs, 10/10 cross-silo (`a_source <> b_source` in every metadata); idempotent re-run bumped version 1→2; cron command contains both scans; test rows cleaned up. Pure SQL, no LLM. See [plan](../05-design/plans/2026-04-17-w6-2b-research-director-connections.md) + [run log](autonomous-runs/2026-04-17-w6-2b-research-director-connections.md). | S | W6.2a | - | 🟢 |
| W6.2c | **Research-director synthesis Edge Function** — SHIPPED 2026-04-17. `research-director-synthesis` v1 deployed (verify_jwt=false). Reads unresolved `reference_docs` kind IN ('theme','connection') via `x-capture-secret` auth; calls `gpt-4o-mini` with per-kind prompts; rewrites `title`+`body` into 1-3 sentence proposals; stashes full JSON in `metadata.synthesis_json` (with `action` phrase) and preserves `original_title`/`original_body`; idempotent on `metadata.synthesis_version`. `pg_net` extension enabled; chained into existing `research-director-weekly` cron (Mon 07:00 UTC) as third statement after both scans. Verified: 2/2 seed rows synthesized (389+267 input tokens, $0.00018 total); re-run = 2/2 skipped; pg_net SQL smoke test HTTP 200; test rows cleaned. See [plan](../05-design/plans/2026-04-17-w6-2c-research-director-synthesis.md) + [run log](autonomous-runs/2026-04-17-w6-2c-research-director-synthesis.md). | M | W6.2a + W6.2b | - | 🟢 |
| W6.2d | **`/research` dashboard surface** — SHIPPED 2026-04-17. Server component at `dashboard/app/research/page.tsx` listing `reference_docs` kind IN (`theme`,`connection`) where `metadata.approved_at IS NULL AND metadata.dismissed_at IS NULL`, limit 30, most recent. Filter pills (`All/Themes/Connections`) as `?kind=` query param. Per-row: kind badge + size badge (cluster_size for themes, similarity % for connections) + truncated body + source-breakdown badges (4 visible + "+N more", reading `member_sources` for themes or `a_source`+`b_source` for connections) + relative `created_at`. Approve/Dismiss client island POSTs to `/api/research/decide` which merges `metadata.approved_at` or `metadata.dismissed_at = now()`. Empty state copy: "Clusters appear when data piles up. Check back after Monday 7am UTC when the weekly scan runs." Route chosen: `/research` (not `/inbox/research` — shorter, cleaner, sibling to `/metrics`; `/inbox/` has uncommitted edits). Sidebar NOT auto-updated (static array, Edmund has uncommitted edits there) — manual 1-line add needed: `{ href: "/research", label: "Research", icon: Search }` between Metrics and Changelog. Verified: HTTP 200, 2-row seed (1 theme, 1 connection) rendered with correct badges, filter isolates each kind, Approve populated `approved_at` + hid row, Dismiss populated `dismissed_at` + hid row, empty-state renders under filter. Plan `05-design/plans/2026-04-17-w6-2d-inbox-research.md`, run log `06-handoffs/autonomous-runs/2026-04-17-w6-2d-inbox-research.md`. | M | W6.2a | - | 🟢 |
| W6.3 | **IP map doc** — SHIPPED 2026-04-17. Canonical `reference_docs` row `slug='ip-map'`, `kind='ip-map'` (new kind seeded via `reference_docs_kinds` per W9.1c). Regenerated by `public.ip_map_regenerate()` + pg_cron `ip-map-weekly` Mon 08:00 UTC (after research-director 07:00). Four SQL-derived sections: Authored (frameworks with body≥400 chars OR metadata hint) / Hinted-at (themes whose tokens overlap no framework slug/title) / Market-asked-for (pain-point-cluster rows last 90d) / Gaps (thin frameworks + theme-head-words repeating across ≥2 distinct weeks in last 30d). Pure SQL, no LLM. Idempotent via `ON CONFLICT (slug) DO UPDATE`. Three migrations: `20260417150000_ip_map_kind.sql`, `20260417151000_ip_map_function.sql`, `20260417152000_ip_map_cron.sql`. First run: `{authored:1, hinted_at:0, market_asked_for:0, gaps:0}`. Seeded test exercised all four sections. Follow-ups: UI surface (`/ip-map` or render in `/research`), optional LLM polish layer. See [plan](../05-design/plans/2026-04-17-w6-3-ip-map.md) + [run log](autonomous-runs/2026-04-17-w6-3-ip-map.md). | M | W6.2 | - | 🟢 |
| W6.4 | **Audience pain-points Skill** — ingest comments / DMs / community threads; tag and cluster; surface top N to `/inbox/research`. v1 shipped 2026-04-17 as **YouTube comments only** (lexical pattern-match, no LLM, no embeddings). Scope narrowing: **DMs deferred** (W5.4 Instagram abandoned — no token); **community threads deferred** (Circle blocked on Q12). Migration `20260417110000_audience_pain_points.sql`; pg_cron `audience-painpoints-weekly` Mon 10:00 UTC → `public.audience_pain_points_scan(30, 10)` writes `reference_docs` rows with `kind='pain-point-cluster'`. Plan `05-design/plans/2026-04-17-w6-4-audience-pain-points.md`, run log `06-handoffs/autonomous-runs/2026-04-17-w6-4-audience-pain-points.md`. Follow-ups: comment embedding pipeline (for semantic clustering v2); `/inbox/research` UI; reopen DMs/Circle when sources unblock. | M | W5.3 + W5.6 | - | 🟢 |

---

## Wave 7 — Hild + client ops

| ID | Epic | Size | Depends on | Needs decision? | Status |
|---|---|---|---|---|---|
| W7.1 | **Hild agent** — 🔴 ABANDONED (wrong scope — Edmund corrected 2026-04-17). Canonical Hild in `designer/` is **Visual design specialist & art director** (graphics, branding, layouts, color, fonts), not client ops. Quarantined at `04-audit/2026-04-17-agent-misalignment-quarantine/hild-bad-scope-2026-04-17/`. **Replaced by: Kardia system-prompt extension (see decisions log `2026-04-17-agent-scope-reassignment.md`).** Tracked as W7.1b. | S | W0.4 | - | 🔴 |
| W7.1b | **Kardia client-ops scope extension** — 🟢 DONE 2026-04-17. Extended `pm/CLAUDE.md` with a `## Rebuild 2026-04-17 extensions` section documenting DC client stewardship (CFCS / Liv / Culture Project / Lisa) + ZPM / Real+True ops, project-tagging + `artifacts.client` slug convention, `due_date` discipline, scope-reads from `reference_docs`, drift-check query + observation pattern, and new routing keywords (client names, `retainer`, `drift`, `went quiet`, etc.). Pure additive — `identity.md` + `soul.md` untouched. Functional wiring (W7.2 client project scaffolding) still required. See `03-decisions/2026-04-17-agent-scope-reassignment.md`. | S | W0.4 | - | 🟢 |
| W7.2 | **Client project scaffolding** — shipped 2026-04-18. All sub-epics W7.2a/b/c/d closed. Edmund's 3 scope Qs resolved (Lisa→CP sub-contact; em-brand absorbs cordial-catholics; IOC no project tag). Canonical table is `public.workstreams` (portfolio `projects` table left intact). Follow-up: 5 of 9 scope docs are placeholders pending Edmund enrichment. [plan](../05-design/plans/2026-04-17-w7-2-client-scaffolding.md) | M | W7.1b | - | 🟢 |
| W7.2a | Seed canonical workstream list (6 rows) + 9 `client-scope` `reference_docs` rows (6 workstreams + 3 DC sub-clients; Lisa dropped, em-brand absorbs cordial-catholics, IOC no tag). Shipped 2026-04-18. [run](autonomous-runs/2026-04-18-w7-2ab-workstreams-fk.md) | S | W7.1b | - | 🟢 |
| W7.2b | `public.workstreams` table + FK refactor on `work_log` + `agent_tasks` (mirrors W9.1c pattern; FK names `work_log_workstream_fk` / `agent_tasks_workstream_fk`, `ON DELETE SET NULL`, `NOT VALID`+`VALIDATE`). Shipped 2026-04-18. [run](autonomous-runs/2026-04-18-w7-2ab-workstreams-fk.md) | S | W7.2a | - | 🟢 |
| W7.2c | `/clients` dashboard surface — server component; 6 tiles (factory/dc-clients/zpm/real-true/faith-ai/em-brand) with scope preview + recent captures + open-tasks pill + drift ramp; DC sub-client mini-cards; sidebar entry added. Shipped 2026-04-18. [run](autonomous-runs/2026-04-18-w7-2c-clients-dashboard.md) | M | W7.2b | - | 🟢 |
| W7.2d | Kardia CLAUDE.md "Canonical SQL" subsection + `project='dc-clients' + artifacts.client=<slug>` codification. Done 2026-04-18: 3 SQL snippets + bite-test rule + enums tightened to 6 projects / 3 DC clients per Edmund's W7.2 resolutions. [run](autonomous-runs/2026-04-18-w7-2d-kardia-canonical-sql.md) | S | W7.2a | - | 🟢 |

---

## Wave 8 — Expanding-team pattern

| ID | Epic | Size | Depends on | Needs decision? | Status |
|---|---|---|---|---|---|
| W8.1 | **Specialist-spawn workflow doc** — SHIPPED 2026-04-17. Canonical workflow at [`05-design/specialist-spawn.md`](../05-design/specialist-spawn.md) (329 lines). Decisions: proposal rows use `reference_docs` with `kind='specialist-proposal'` (no new table); approval flow Option A = `/inbox/specialists` dashboard surface (deferred until 2nd proposal), Option B = notebook-review bridge; tool allowlist inherits parent + narrows; memory namespace `<slug>-memory`; retirement preserves folder in `agents/_retired/` + memory namespace read-only. Six open questions flagged for Edmund (routing-table location, emoji/color governance, UI priority, retirement threshold, `match_memory()` cross-namespace default, handoff-keyword migration). Hypothetical "Scribe" walkthrough included, not a real proposal. See [run log](autonomous-runs/2026-04-17-w8-1-specialist-spawn-doc.md). | S | W5.x + W6.x running | - | 🟢 |
| W8.2 | **First specialist evaluated** — pick from volume data (likely Instagram repurposing or DC client ops). Proposal → approval → scaffold. | M | W8.1 + ≥2 months of usage data | Edmund taste | ⛔ |

---

## Wave 9 — Cutover & cleanup

| ID | Epic | Size | Depends on | Needs decision? | Status |
|---|---|---|---|---|---|
| W9.1a | **Phase 5 schema cleanup — additive** — 11 missing DESC indexes + 8 UUID defaults moved to `gen_random_uuid()`. Applied 2026-04-17 as migration `schema_cleanup_additive_2026_04_17`. See `06-handoffs/autonomous-runs/2026-04-17-w9-1-schema-cleanup-additive.md`. | S | W3.x + W1.2 | - | 🟢 |
| W9.1b | **Phase 5 schema cleanup — destructive** — dropped `public.scheduled_tasks` (7 rows), `public.agent_habits` (0 rows), and extension `"uuid-ossp"`. Pre-drop: 0 inbound FKs on both tables, 0 non-extension `pg_depend` rows for uuid-ossp, 0 user functions/defaults referencing `uuid_generate_v4`. Applied 2026-04-17 as migration `schema_cleanup_destructive_2026_04_17`. See `06-handoffs/autonomous-runs/2026-04-17-w9-1b-schema-cleanup-destructive.md`. | S | W9.1a | Edmund approval | 🟢 |
| W9.1c | 🟢 **Kind-vocabulary refactor (reference_docs_kinds table + FK)** — SHIPPED 2026-04-17. Lifted `reference_docs.kind` vocabulary out of `CHECK (kind IN (...))` (which had been rewritten 4x in one day, silently dropping `'educated-bet'` at one point) into `public.reference_docs_kinds` with a FK. 15 kinds seeded (14 documented + `connection` auto-captured from orphan audit — W6.2b had landed silently). Future Skills now add kinds via `INSERT ... ON CONFLICT DO NOTHING`. Convention in `dashboard/supabase/README.md`. Migration `20260417140000_reference_docs_kinds_table.sql`. Plan `05-design/plans/2026-04-17-kind-vocabulary-refactor.md`, run log `06-handoffs/autonomous-runs/2026-04-17-kind-vocabulary-refactor.md`. | S | - | - | 🟢 |
| W9.2 | **Q10 security hardening** — RLS on the 7 competitive-intel tables; fix mutable search_path on 3 functions; tighten `media` bucket; enable leaked-password protection. | M | - | Q10 | ⛔ |
| W9.3 | **Decommission Pinecone** — index deletion after dual-read parity + 1 week observation. Not automated. | S | W1.4 green | Edmund approval | ⛔ |
| W9.4 | **Decommission GravityClaw / Railway** — remove MCP registration; archive repo; cancel Railway. | S | All callers migrated | Edmund approval | ⛔ |
| W9.5 | **Production promotion of `/dashboard/`** — Vercel prod deploy; auth + magic link live. | S | W3.8 + W9.2 | Edmund approval | ⛔ |

---

## Stretch (depends on volume + taste; not autonomous)

- Circle provisioner → Edge Function + dashboard button (Q12 resolution)
- Supabase project split (Q8 — only if real customers)
- Agents-in-Supabase (move agent configs off filesystem)
- Mobile PWA polish
- Content-asset-ID system (photos/videos/events long-term compounding)

---

## Notes on ordering

- **Wave 1 is mandatory before anything that reads from `memory`** — pgvector must be populated and verified first.
- **Wave 2 is the unlock for almost everything downstream** — without `capture()`, voice memos / YouTube / signals have no landing path.
- **Wave 3 can run parallel** with Wave 2 as long as two sessions don't touch overlapping dashboard files. The existing Phase 2/Phase 3 parallel-run pattern worked.
- **Waves 5 and 6 depend on capture volume**, not just on the tables existing. May sit `⚪` for weeks while Wave 2 feeds the corpus. That's fine — the backlog isn't a gantt chart.
- **Waves 7–8 are optional for a while.** Hild only matters when DC client work volume justifies; specialist-spawn only matters when the core six are saturated.

## Wave OA — Agent infrastructure polish (2026-04-18)

Closes yesterday's verification gaps.

| ID | Epic | Size | Status | Notes |
|---|---|---|---|---|
| OA.1 | **Tool tag filtering** — `lib/agent-tools.ts` centralizes tag→tool-group mapping; `agents.tool_tags` column; import script parses master roster. Hild loses FILE tools; Axel keeps them. Closes Ask E. | S | 🟢 | [plan](../05-design/plans/2026-04-18-option-a-agent-infra.md) / [run](autonomous-runs/2026-04-18-option-a-agent-infra.md). Branch `feat/agent-infra-polish` (`abcdfed`). |
| OA.2 | **Doc-sync admin endpoint + sidebar button** — `POST /api/admin/sync-agents` wraps the iCloud→DB importer; sidebar button surfaces it with status chips. | S | 🟢 | `ef8be02`. |
| OA.3 | **Persistent wake queue** — `agent_wake_queue` table; `enqueueWake` on every Slack mention; `drainWakeQueue` triggered post-run (via `after()`) + every-minute Vercel cron. MAX_ATTEMPTS=10 on skipped + failed paths. Closes Ask C. | M | 🟢 | `63b60a3` + review fix `a19b24b`. |

**Follow-ups surfaced:**
- **OA.4 tsconfig cleanup** — exclude `ops/scripts/` and `supabase/functions/` so `npm run build` passes. Blocks W9.5 prod deploy. Size XS.
- **OA.5 admin `/queue` page** — read-only view of `agent_wake_queue`. Size S. Defer until real usage.
- **OA.6 move ceo approval from id-gate to tag-gate** — tighten once tool-tag filter has run a while. Size XS.

---

## Changes

- **2026-04-18** — Wave OA shipped: tool-tag filtering, doc-sync button, persistent wake queue.
- **2026-04-17** — Initial draft. Reflects state post Phase 0.5 / 1.5 / 2 / 3-MVP.

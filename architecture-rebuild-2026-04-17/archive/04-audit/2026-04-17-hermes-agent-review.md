# Hermes Agent Architecture Review — For Edmund's Rebuild

**Date:** 2026-04-17
**Source:** `/Users/edmundmitchell/factory/reference/reference-repos/hermes-agent/` (cloned at HEAD of `main`, MIT-licensed, v0.10.0 line)
**Repo:** [github.com/NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)

## 1. What is Hermes Agent?

Hermes Agent is Nous Research's open-source **autonomous agent runtime** — a Python framework that turns any OpenAI-compatible LLM endpoint (Hermes 4, Claude, GPT, local Ollama/vLLM, etc.) into a persistent personal agent with file-backed memory, a skill registry, a cron scheduler, and a gateway that plugs the agent into Telegram/Discord/Slack/WhatsApp/Signal/Matrix/Mattermost/email/SMS. It is not a model — it is the runtime Nous built to *compete with Claude Code + Routines + Projects as a local, self-hosted alternative* (see `hermes-already-has-routines.md`). For Edmund, it is essentially "GravityClaw, if Nous had built it open-source with a real plan" — which makes it the single most useful reference for what a Telegram-capture, memory-backed, skill-promoting agent looks like *when it is built well*.

## 2. Architecture Map

```
┌────────────────────────────────────────────────────────────────────┐
│ Hermes Agent                                                       │
├────────────────────────────────────────────────────────────────────┤
│ AIAgent (run_agent.py)   ← synchronous tool loop, any OpenAI LLM   │
│   ├── MemoryManager       (agent/memory_manager.py)               │
│   │     ├── Builtin: MEMORY.md + USER.md (file-backed, § delim)   │
│   │     └── ONE external plugin  (plugins/memory/<name>/)         │
│   │           honcho · hindsight · mem0 · supermemory · retaindb  │
│   ├── Skills              (skills/<category>/<name>/SKILL.md)     │
│   │     ├── bundled (repo)                                        │
│   │     ├── ~/.hermes/skills/  (user + agent-created + hub)       │
│   │     └── skill_manage tool: create/patch/edit/delete           │
│   ├── Tools (tools/registry.py — import-time self-registration)   │
│   └── SessionDB (hermes_state.py) — SQLite + FTS5                 │
├────────────────────────────────────────────────────────────────────┤
│ Gateway (gateway/run.py)                                           │
│   ├── Platform adapters (gateway/platforms/ABC = BasePlatformAdap)│
│   │     telegram · discord · slack · whatsapp · signal · matrix   │
│   │     mattermost · email · sms · bluebubbles · homeassistant    │
│   │     wecom · dingtalk · feishu · qqbot · weixin · webhook      │
│   └── One message loop; per-platform adapter normalizes events    │
├────────────────────────────────────────────────────────────────────┤
│ Cron (cron/)  ·  Webhooks (hermes_cli/webhook.py)                 │
│   Unlimited scheduled agent runs + GitHub/API triggers             │
├────────────────────────────────────────────────────────────────────┤
│ hermes_cli  — `hermes setup`, `hermes claw migrate`, `hermes cron`,│
│               `hermes skills`, `hermes tools`, `hermes gateway`    │
└────────────────────────────────────────────────────────────────────┘
User data: ~/.hermes/  (config.yaml · .env · memories/ · skills/ · state.db)
```

### Key abstractions

- **`AIAgent`** (`run_agent.py`) — synchronous OpenAI-compatible chat loop with tool dispatch; per-turn hooks into MemoryManager before and after API calls.
- **`MemoryProvider`** (`agent/memory_provider.py`) — ABC with `initialize / prefetch / sync_turn / get_tool_schemas / on_session_end / on_pre_compress / on_memory_write / on_delegation`. Pluggable.
- **`BasePlatformAdapter`** (`gateway/platforms/base.py`) — ABC for 18+ messaging platforms. `ADDING_A_PLATFORM.md` lists the 16 integration points every new adapter must touch.
- **`SKILL.md`** — YAML frontmatter (`name`, `description`) + markdown body + optional `references/`, `templates/`, `scripts/`, `assets/` subdirs.
- **Migration via script-module** — `hermes_cli/claw.py` dynamically imports a self-contained migration script from the `openclaw-migration` skill and runs a `Migrator` class that emits a structured JSON report.

## 3. Patterns worth stealing

### 3.1 Two-tier memory: frozen snapshot + live file
**File:** `tools/memory_tool.py:105-140` (`MemoryStore`)

Two MD files (`MEMORY.md` = agent's notes, `USER.md` = facts about the user), delimited by `§`. On session start, content is loaded *and snapshotted* for system-prompt injection. Mid-session tool writes update the files on disk immediately (durable) **but do not change the system prompt** — this preserves the prefix cache for the whole session. Snapshot refreshes on next session start.

**For Edmund:** This is the exact pattern Pillar 1 (rich capture) + prefix-caching discipline needs. Translated to Supabase: `agent_core_memory` is the live store; the system prompt assembly grabs a frozen snapshot per session. Stops the "every write invalidates the cache" problem. **Confidence: HIGH.**

### 3.2 MemoryManager: one builtin + one plugin, never more
**File:** `agent/memory_manager.py:83-141` + `plugins/memory/{honcho,hindsight,mem0,supermemory,retaindb,byterover,holographic,openviking}/`

Builtin is always first and cannot be removed. Exactly **one** external provider allowed — a second registration is *rejected with a warning*. Each plugin ships as `plugins/memory/<name>/plugin.yaml` + `client.py` + `session.py` + `README.md`. Optional hooks: `on_session_end` (fact extraction), `on_pre_compress` (preserve insights before context compression), `on_delegation` (parent observes subagent work).

**For Edmund:** Map directly. Builtin = Supabase MCP on `agent_core_memory` (always on). One plugin slot = Pinecone/pgvector recall. The "one external" rule is the defense against pillar 4 sprawl — you can experiment with Honcho-style providers without the tool schema exploding. The `on_pre_compress` hook is a clean answer to "where do session-retro promotions live?" — Hermes extracts insights *before* the compressor discards messages. **Confidence: HIGH.**

### 3.3 SKILL.md format = exactly Claude Skills
**File:** `tools/skill_manager_tool.py:150-186` (frontmatter validator), `skills/note-taking/obsidian/SKILL.md` (example), `optional-skills/migration/openclaw-migration/SKILL.md` (complex example with nested `metadata.hermes.tags`)

Required: YAML frontmatter with `name` + `description` (≤1024 chars), then markdown body. Supporting dirs `references/`, `templates/`, `scripts/`, `assets/` are the *only* write targets — enforced by `ALLOWED_SUBDIRS` and path-traversal checks. This is the **same format Anthropic uses for Claude Skills** — Hermes didn't fork it, they adopted it. Skills resolve across multiple dirs (`get_all_skills_dirs()`) so bundled + user-created + hub-installed all coexist.

**For Edmund:** Pillar 3 (SOPs-as-Skills) is literally this format. No invention needed. Store in `/skills/<topic>/SKILL.md`, same frontmatter, same body. It works in Claude Projects *and* in a Hermes-style fallback runtime if you ever want one. **Confidence: HIGH.**

### 3.4 Agent self-creates skills via a tool
**File:** `tools/skill_manager_tool.py:681-768` (`SKILL_MANAGE_SCHEMA`)

Single tool `skill_manage` with actions `create / patch / edit / delete / write_file / remove_file`. The description tells the model *when* to invoke: "Create when: complex task succeeded (5+ calls), errors overcome, user-corrected approach worked… After difficult/iterative tasks, offer to save as a skill." Every agent-authored skill is passed through `tools/skills_guard.py` for prompt-injection and exfiltration patterns before being written — same scanner used for community-hub installs.

**For Edmund:** This is the *promotion* mechanism Pillar 4 has been asking for. Dashboard session-retro skill = the Claude-side equivalent: after a session, the model proposes promotions and the user approves (approval gate instead of a security scanner — different threat model, same structure). The tool description pattern ("create when: N calls… user-corrected approach worked") is a ready-made prompt spec. **Confidence: HIGH.**

### 3.5 Gateway adapter ABC with a written checklist
**Files:** `gateway/platforms/base.py` (ABC), `gateway/platforms/ADDING_A_PLATFORM.md` (the 16-point checklist), `gateway/platforms/telegram.py` (2914 lines — reference implementation)

Every adapter implements `connect / disconnect / send / send_typing / send_image / get_chat_info`; optional `send_document / send_voice / send_video / send_animation`. The base handles image/audio caching (`cache_image_from_url` with SSRF guards, `cache_audio_from_bytes`), UTF-16 length math for Telegram's 4096 limit, proxy detection (including macOS `scutil --proxy` fallback), and a redirect-SSRF guard hook for httpx. `ADDING_A_PLATFORM.md` enumerates the 16 integration points (enum, factory, auth maps, session source, prompt hints, toolset, cron delivery, send-tool routing, cronjob schema, channel directory, status display, setup wizard, redaction regex, docs, tests).

**For Edmund:** If Q11 ever resolves toward "we want a Telegram/Signal/iMessage capture surface without building it from scratch," *this is the reference implementation*. The 2914-line `telegram.py` is not code to copy — it's a catalog of every edge case (reply loops, echo filters, backoff+jitter reconnect, phone redaction, group-chat filtering, per-message UTF-16 truncation) a production adapter has to handle. Reading it is the cheapest way to understand why the previous Telegram-on-Railway attempt failed: those 2914 lines of care weren't there. **Confidence: HIGH as a reference, LOW as a copy target.**

### 3.6 Migration pattern: preview → structured report → confirm → execute
**File:** `hermes_cli/claw.py:303-487` + `optional-skills/migration/openclaw-migration/scripts/openclaw_to_hermes.py` (2794 lines)

`hermes claw migrate` always runs a dry-run first (`execute=False`), emits a structured JSON report with per-item `{kind, source, destination, status, reason, details}`, then prompts before the second pass (`execute=True`). Options are **named** (`soul`, `memory`, `user-profile`, `messaging-settings`, `skills`, `tts-assets`, `discord-settings`, `mcp-servers`, `cron-jobs` …) — 30+ migration options grouped into two presets (`user-data`, `full`). Secret migration is opt-in (`--migrate-secrets`) and allowlisted: `TELEGRAM_BOT_TOKEN`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `VOICE_TOOLS_OPENAI_KEY` (`openclaw_to_hermes.py:36-43`). Includes process-detection (`_detect_openclaw_processes` at `claw.py:56-114`) to warn if both agents are running and will fight over the Telegram bot token (409 errors).

**For Edmund:** See §4.3 below — this is a direct cheat-sheet for the GravityClaw decommission.

## 4. Red flags Hermes already solved that the rebuild hasn't

### 4.1 Prefix cache invalidation from memory writes
`tools/memory_tool.py` separates the snapshot from the live file *specifically* to keep the prefix cache stable. The rebuild plan mentions caching nowhere. If `capture()` Edge Function dual-writes into a `agent_core_memory` table that's then read at every turn for system-prompt injection, you'll invalidate the cache on every write. Solve it at Phase 3, not when cache costs surprise you.

### 4.2 Tool schema bloat from multi-provider memory
`agent/memory_manager.py:107-119` rejects a second external memory provider precisely because each provider exposes its own tool schemas to the model, and stacking them destroys tool-call accuracy. The rebuild plan's "Pinecone for archive + Supabase for structured + maybe pgvector later" is three-provider thinking. Pick a primary, and demote the others behind a single read path.

### 4.3 Running-process detection during migration
`hermes_cli/claw.py:56-146` detects *both* "old agent still running" and "new agent gateway already running" because Telegram/Discord/Slack **only allow one active connection per bot token** — migrating tokens while both are live causes a 409 "terminated by other getUpdates request" fight. The GravityClaw decommission plan in `migration-plan.md` Phase 6 says "verify all surfaces work without GravityClaw MCP" but doesn't mention the bot-token uniqueness issue. If the rebuild ever gets a capture surface with a platform token, this matters.

### 4.4 Skill injection / exfiltration scanning
`tools/memory_tool.py:65-102` (`_MEMORY_THREAT_PATTERNS`) and `tools/skills_guard.py` scan *anything the agent is about to write to memory or a skill* for prompt-injection strings (`ignore previous instructions`, `you are now …`), invisible Unicode (zero-width chars, bidi overrides), and exfiltration primitives (`curl $KEY`, `cat .env`). Edmund's plan assumes Edmund is the only writer — but the moment the `capture()` Edge Function accepts a URL and scrapes it via Firecrawl, untrusted content is landing in the corpus. Copy the pattern list; it's 40 lines.

### 4.5 UTF-16 length math on messaging platforms
`gateway/platforms/base.py:24-55` — Telegram's 4096-char limit is UTF-16 code *units*, not Unicode code points. A message full of emoji silently truncates at half the expected length with a plain Python `s[:4096]`. If any part of the rebuild sends to messaging platforms, this is the kind of bug you find in production.

## 5. Anti-patterns / things NOT to copy

### 5.1 The whole thing, as a runtime
**The Guiding Principle says it.** Hermes Agent *is* a custom hosted agent runtime — the exact thing `principles.md` forbids Edmund from building. Nous can justify it because they make the models; Edmund cannot. Read Hermes for patterns; do not host Hermes as Edmund's agent.

### 5.2 18+ messaging platforms
`gateway/platforms/` has 18 adapters and an open "add your platform" process. Each one is 1000–3000 lines of edge cases. Edmund needs, at most, **one** (iPhone Shortcuts via webhook is smaller still — `gateway/platforms/webhook.py`). The breadth here is a product feature for Nous; for Edmund it's operational debt per principles.md "avoid mixing concerns."

### 5.3 The full Skills Hub / quarantine / audit-log stack
`tools/skills_hub.py` (3053 lines) + `hermes_cli/skills_hub.py` + `~/.hermes/skills/.hub/{lock.json, quarantine/, audit.log, taps.json, index-cache/}`. Makes sense for a multi-user community distributing untrusted skills. Edmund's skills repo is Edmund's own. A folder in the monorepo plus `git log` is the skills hub.

### 5.4 Cron, webhooks, and RL training in the same binary
`cron/`, `hermes_cli/webhook.py`, `environments/` (Atropos RL), `mini_swe_runner.py`, `batch_runner.py` all live in the same package. For Nous this is one product. For Edmund this is the *exact* "six folders that never touch each other" violation `principles.md` warns against. Cron → Claude scheduled tasks. Webhooks → Supabase Edge Function. RL → not in scope.

### 5.5 "hermes-already-has-routines.md" mindset
Top-level file in the repo argues Hermes shipped Claude Routines two months before Anthropic. The stance is valid for Nous's positioning. For Edmund, it's the *opposite* of `principles.md` — Edmund's thesis is *let Anthropic win the runtime war and use what they ship*. Noting this so the tone of this repo doesn't infect rebuild decisions.

## 6. Direct comparison to the rebuild plan

| Rebuild Pillar | Hermes's approach | Fit |
|---|---|---|
| **1. Rich data capture** | `MEMORY.md` / `USER.md` files + SessionDB SQLite (FTS5) + provider `sync_turn()` mirror | Structurally aligned. Swap files → Supabase rows, SQLite → Postgres. Adopt the frozen-snapshot pattern. |
| **2. One source of truth** | One builtin + one plugin memory provider, hard-enforced in `MemoryManager.add_provider()` | Direct copy. Primary = Supabase, one plugin slot = Pinecone (today) or pgvector (Q2). |
| **3. SOPs as Skills** | SKILL.md (YAML frontmatter + markdown), multi-dir discovery, `skill_manage` tool for agent self-authoring | Exact format. Use verbatim. |
| **4. Self-improving loops** | `skill_manage` tool description ("create when 5+ calls, errors overcome…") + `on_pre_compress` hook + `on_session_end` | Lift both the tool-description heuristics and the pre-compress hook. Build the approval gate (Edmund, not scanner) around them. |
| **5. Proactive surfacing** | `cron/` + `hermes webhook subscribe` + `send_message_tool` | Don't copy. Use Claude scheduled tasks. Hermes's cron is the anti-pattern `principles.md` explicitly lists. |
| **Q11 — Telegram/privacy** | Every platform adapter is 1000-3000 lines; `ADDING_A_PLATFORM.md` is a 16-point checklist | This is the *answer* to "why did Railway Telegram fail." The failure wasn't Telegram — it was building a production adapter with a weekend's worth of care. Either use Hermes as-is for this (reverses principles.md) or stick with Claude-chat capture. |
| **GravityClaw decommission** | `hermes claw migrate` — preview → structured report → confirm → execute, with named option flags and allowlisted secrets | Directly portable *as a model* for the GravityClaw → new-stack migration script Edmund will eventually want. |

## 7. Concrete recommendations

| # | Recommendation | Confidence |
|---|---|---|
| 1 | Adopt the **SKILL.md format verbatim** (YAML frontmatter `name` + `description`, markdown body, `references/templates/scripts/assets` subdirs). Same format Claude Skills uses — compatible both ways. | HIGH |
| 2 | Adopt the **frozen-snapshot memory pattern** in the rebuild's `capture()` + agent loop. Supabase row is the live store; system-prompt assembly takes a per-session snapshot. | HIGH |
| 3 | Adopt the **one-builtin + one-plugin memory provider** rule as architectural policy. Supabase MCP is always on; exactly one vector provider at a time. Revisit in Q2. | HIGH |
| 4 | Lift the **skill_manage tool description heuristics** ("create when: 5+ calls, errors overcome, user-corrected approach worked, user asks to remember") into the session-retro promotion Skill. Edmund's approval replaces Hermes's security scanner. | HIGH |
| 5 | Use `hermes claw migrate` as the **model for the eventual GravityClaw decommission script** — preview → structured `{kind, source, destination, status, reason}` JSON → confirm → execute. Allowlisted secrets only. | MED-HIGH |
| 6 | Copy the **memory threat-pattern list** (`tools/memory_tool.py:65-102`) when building `capture()`. Untrusted URL scraping lands in memory eventually. | MED |
| 7 | Read `gateway/platforms/ADDING_A_PLATFORM.md` + `gateway/platforms/telegram.py` **before** re-attempting any messaging-platform capture surface. Do not reimplement — either use Hermes as-is for that one concern, or stay with Claude chat + webhook. | MED |
| 8 | **Do not host Hermes as the agent runtime.** This is the `principles.md` line. Hermes is a reference, not a dependency. | HIGH |

### Questions to escalate into `03-decisions/open-questions.md`

- **Q12 (new) — Capture-surface strategy:** Given that Hermes Agent is the proof that a messaging-platform capture surface is a 2000+-line-per-platform commitment with real edge-case tax, should Q11's option (a) (Vercel + dashboard + iPhone webhook) be treated as *clearly dominant* over any Telegram/Signal-gateway option? Hermes's existence doesn't change the principles-level answer — but it *does* quantify the cost of the alternative, and the quantification favors (a). Consider resolving Q11 now on that basis.
- **Q13 (new) — Memory-provider slot:** Adopt the "one builtin + one plugin" rule as architectural policy *now* (Phase 1.5), so the Q2 vector decision is framed as "which slot wins the plugin seat," not "how many vector backends do we run." Framed this way, option (d) file-based is disqualified (it's the builtin), and the live contest is (a) integrated Pinecone vs. (b) BYO-Pinecone-via-SDK vs. (c) pgvector — exactly the shape of Q2 already.

---

*Sources: local clone at `/Users/edmundmitchell/factory/reference/reference-repos/hermes-agent/` — `run_agent.py`, `agent/memory_manager.py`, `agent/memory_provider.py`, `tools/memory_tool.py`, `tools/skill_manager_tool.py`, `tools/skills_hub.py`, `tools/skills_guard.py`, `gateway/platforms/base.py`, `gateway/platforms/ADDING_A_PLATFORM.md`, `gateway/platforms/telegram.py`, `hermes_cli/claw.py`, `optional-skills/migration/openclaw-migration/SKILL.md`, `optional-skills/migration/openclaw-migration/scripts/openclaw_to_hermes.py`, `plugins/memory/honcho/plugin.yaml`, `AGENTS.md`, `hermes-already-has-routines.md`.*

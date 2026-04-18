# factory

Edmund's top-level working directory — the in-progress rebuild of the personal/work AI stack plus research and reference material.

## Layout

| Path | What |
|---|---|
| `CLAUDE.md` | Project instructions for Claude Code (read first). |
| `architecture rebuild 2026-04-17/` | Living notebook driving the rebuild. Start at `00-README.md`. |
| `ops/` | Thin ops scripts (youtube ingest, env example). `.env` is gitignored. |
| `skills/` | Shared skill definitions (daily-recap, etc.). |
| `supabase/` | Factory-root Supabase artifacts (migrations + shared Edge Function helpers). |
| `.claude/launch.json` | Claude Code dev-server launch config. |
| `dashboard/` | **Not in this repo** — see below. |
| `reference/` | **Not in this repo** — ~1.8 GB of cloned external repos. |

## Sister repo: dashboard

The Next.js dashboard lives in its own repo: **[bummerlazarus/local-agents-dashboard](https://github.com/bummerlazarus/local-agents-dashboard)**. The `dashboard/` path is gitignored here so the two can be worked on independently.

---

## Bootstrap on a new machine

Step-by-step for getting Claude Code productive on this project on a fresh Mac.

### 1. Clone both repos

```
git clone git@github.com:bummerlazarus/factory.git
cd factory
git clone git@github.com:bummerlazarus/local-agents-dashboard.git dashboard
```

### 2. Fill in environment secrets

Both repos ship a `.env.example`. Copy and fill in values (ask Edmund for live secrets or regenerate them):

```
cp ops/.env.example ops/.env
cp dashboard/.env.local.example dashboard/.env.local
```

Both files are gitignored (`.env*` pattern). The examples enumerate every key the code expects.

### 3. `COWORK_PATH`

`dashboard/.env.local` needs `COWORK_PATH` set to the iCloud folder that holds the agent definitions. On macOS this is typically:

```
/Users/<you>/Library/Mobile Documents/com~apple~CloudDocs/CEO Cowork
```

iCloud sync'd, so on a new Mac signed into the same Apple ID the folder appears automatically. If it isn't there, Edmund can force download via Finder.

### 4. Install dashboard deps + dev server

```
cd dashboard
npm install
npm run dev  # http://localhost:3000
```

### 5. Push agent definitions from disk to Supabase

Agents in the dashboard are loaded from the `public.agents` Supabase table, not from disk at runtime. When you edit an agent's `identity.md`/`CLAUDE.md`/`soul.md` on disk, re-run the import script to sync:

```
cd dashboard
node --env-file=.env.local scripts/import-agents-from-icloud.mjs
```

(This is idempotent — safe to re-run any time.)

### 6. Connect MCP servers Claude Code needs

Edmund's MCP stack (install in order, each is `claude mcp add`):

- Supabase (official plugin)
- Pinecone (legacy, being retired)
- Notion (official plugin)
- Firecrawl
- Playwright
- Vercel
- `capture-mcp` — the custom Edge Function MCP at `https://<supabase-project>.supabase.co/functions/v1/capture-mcp` with `x-capture-secret: <SUPABASE_CAPTURE_SECRET>`.

Full config lives in `~/.claude/settings.json` on Edmund's Mac. That file is not part of this repo; the autonomy charter treats `~/.claude/` as off-limits.

### 7. Memory

Claude Code auto-memory lives at `~/.claude/projects/-Users-<you>-factory/memory/`. Not portable through git. Either:

- Sync `~/.claude/` via iCloud Drive / Dropbox / a private dotfiles repo
- Or let a fresh machine rebuild memory over the first few sessions

### 8. Read the notebook

Start here:

- `CLAUDE.md` (this repo's project instructions)
- `architecture rebuild 2026-04-17/00-README.md`
- `architecture rebuild 2026-04-17/06-handoffs/autonomy-charter.md` (rules of engagement for autonomous runs)
- Most recent handoff in `architecture rebuild 2026-04-17/06-handoffs/` (filename starts with today's date or the most recent one)

---

## Secrets posture

`.env` and `.env.*` are gitignored in both repos. The `*.example` variants are tracked (shape only, no values). Any notebook references to specific secret values have been scrubbed to placeholders like `<CAPTURE_SECRET — see ops/.env (gitignored)>`.

## Working style

- Markdown-first. Conversations → decisions/research logged to files → reviewed together.
- Don't over-engineer. Minimum complexity for the current task.
- Read files before modifying; never guess at business logic.
- Firecrawl is the primary web research tool.
- Never use `browser_subagent` — crashes the system.

See `CLAUDE.md` for the full project rules and `architecture rebuild 2026-04-17/06-handoffs/autonomy-charter.md` for autonomous-run rules of engagement.

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

The Next.js dashboard lives in its own repo: **[bummerlazarus/local-agents-dashboard](https://github.com/bummerlazarus/local-agents-dashboard)**.

When you clone `factory` fresh on a new machine, clone the dashboard alongside it:

```
git clone git@github.com:bummerlazarus/factory.git
cd factory
git clone git@github.com:bummerlazarus/local-agents-dashboard.git dashboard
```

The `dashboard/` path is gitignored in this repo so the two can be worked on independently. On Edmund's existing Mac, `dashboard/` is already in place — nothing to do.

## Secrets

`.env` and `.env.*` are gitignored. Live secrets for ops scripts sit in `ops/.env` on disk (never committed). Dashboard secrets live in `dashboard/.env.local` (also gitignored in its own repo).

References to specific secret values in notebook files are replaced with placeholders like `<CAPTURE_SECRET — see ops/.env (gitignored)>`.

## Working style

- Markdown-first. Conversations → decisions/research logged to files → reviewed together.
- Don't over-engineer. Minimum complexity for the current task.
- Read files before modifying; never guess at business logic.
- Firecrawl is the primary web research tool.
- Never use `browser_subagent` — crashes the system.

See `CLAUDE.md` for the full project rules and `architecture rebuild 2026-04-17/06-handoffs/autonomy-charter.md` for autonomous-run rules of engagement.

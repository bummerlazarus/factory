# Guiding Principles

## The non-negotiable

**Edmund will not outbuild Anthropic.**

Default priority order for every build decision:

1. **Claude platform features** — scheduled tasks, connectors, memory, Skills, Projects
2. **Native MCP servers** from source systems — Supabase, Pinecone, Firecrawl, Notion, Canva, Google, Vercel
3. **Supabase Edge Functions** — for genuinely unique business logic
4. **Custom MCP server** — last resort, narrowest possible scope

## Avoid

- Custom cron jobs
- Custom scheduled-task infra
- Custom hosted agent runtime
- Anything Anthropic is likely to ship better within 6 months
- Mixing concerns in a single repo (agent configs + scripts + keys + MCPs)

## Repo discipline

No Python scripts, CLIs, MCP servers, or API keys living in the same directory as agent configs. Ever.

Six folders that never touch each other (target):
```
/supabase    /pinecone    /skills    /agents    /dashboard    /ops
```

## Decision heuristics

- **Can Claude do this natively?** → Use Claude.
- **Does the source system have a native MCP?** → Use the native MCP.
- **Is this unique business logic?** → Edge Function.
- **None of the above?** → Think twice before writing a custom server.

## Architecture should tolerate replacement

- Pinecone stays for now; architect so consolidation to pgvector is a swap, not a rewrite.
- Notion is a surface; if it disappears tomorrow, Supabase still has the data.
- Dashboard is read-mostly; don't build writes there that could live in agents or edge functions.

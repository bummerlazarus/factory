# Current Tech Stack

## Data layer

- **Supabase** — source of truth for structured data + blobs
  - Postgres for rows (inbox cards, metadata, logs, pointers)
  - Storage for blobs (video, audio, images, long markdown)
  - pgvector available (not yet primary for semantic search)
- **Pinecone** — semantic search for the heavy archival corpus (video transcripts, books, signals). ~15–50K vectors currently.

## Surfaces

- **Notion** — source of truth for ops flows (Work DB, Creator Engine, CEO Desk Sessions, SOPs, Meetings, Pitches, Swipe Files, Podcast Outreach, People, Organizations, Strategies). Native MCP only.
- **Dashboard** — `/factory/dashboard/` (Next.js 16 / React 19 / TypeScript). Being migrated from filesystem I/O to Supabase; then deployable to Vercel or Tailscale-hosted (see Q11). Formerly "local agent dashboard."
- **Claude** (web / iPhone / desktop / Code) — the agent layer. CEO Desk Claude project is Edmund's primary capture surface today.

## Current middleware (being retired)

- **GravityClaw** — custom MCP server on Railway (`gravityclaw-production-8d93.up.railway.app`). Crashy. Mixes concerns. Slated for decommission after cutover.

## Integrations Edmund uses

- Firecrawl (web research — primary)
- Notion MCP (native)
- Supabase MCP (native)
- Pinecone MCP (native)
- Vercel MCP
- YouTube Data API (via Edge Functions)
- Instagram Graph API (via Edge Functions)
- Beehiiv (newsletter)
- Canva
- Google Workspace

## Preferences

- Firecrawl is the primary web research tool. Browser control only as last resort.
- Never use `browser_subagent` — crashes the system.
- If MCP tools fail twice, stop and ask before retrying.
- Check for existing CSS/utility classes before writing inline styles.

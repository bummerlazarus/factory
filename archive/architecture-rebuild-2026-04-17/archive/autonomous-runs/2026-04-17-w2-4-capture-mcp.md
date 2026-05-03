# Run log — W2.4 capture-mcp Edge Function (path α)

**Date:** 2026-04-17 (evening, late)
**Epic:** W2.4 — MCP tool `capture` exposed to Claude chat
**Plan file:** [2026-04-17-w2-4-capture-mcp.md](../../05-design/plans/2026-04-17-w2-4-capture-mcp.md)
**Status:** 🟢 DONE — server side. Client-side config pending Edmund (one-time setup).

## Files written

| File | Purpose |
|---|---|
| `dashboard/supabase/functions/capture-mcp/index.ts` | MCP-over-HTTP Edge Function, single tool `capture`, Bearer auth, JSON-RPC 2.0 |
| `dashboard/supabase/functions/capture-mcp/README.md` | Contract + Claude Desktop / Claude Code config snippets + curl smoke-test commands |

No migrations, no new secrets beyond what's already in place.

## Deployment

Deployed via Supabase MCP `deploy_edge_function`. Version 1, ACTIVE, `verify_jwt: false` (custom auth via Bearer token).
Function id: `2ced0cbb-edc8-4b91-8636-b0d4a8320fcd`.
URL: `https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/capture-mcp`.

## Auth model

- **MCP clients** send `Authorization: Bearer <token>`
- Token = `MCP_AUTH_TOKEN` if set, else `CAPTURE_SECRET` (default). This lets Edmund rotate MCP tokens independently later without touching capture().
- Current deployment uses `CAPTURE_SECRET` (same as capture() direct POST) — one secret, two surfaces.

## Verification — all 6 checks green

### 1. Discovery (GET, no auth)

```
GET /functions/v1/capture-mcp
```

Response:
```json
{
  "name": "capture-mcp",
  "version": "1.0.0",
  "protocol": "2025-03-26",
  "transport": "streamable-http",
  "endpoint": "POST JSON-RPC 2.0 payloads here with Authorization: Bearer <token>",
  "tools": ["capture"]
}
```

### 2. Auth failure

POST without `Authorization` → `HTTP 401`, body `{"error":"unauthorized","reason":"missing Authorization header"}`. Clear failure mode.

### 3. MCP initialize

POST `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{}}}`:
```json
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-03-26","capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"capture-mcp","version":"1.0.0"}}}
```

### 4. tools/list

Returns the single `capture` tool with full inputSchema (kind/content required; title/project/source/session_id/metadata optional).

### 5. tools/call capture (text) — THE round-trip test

POST `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"capture","arguments":{"kind":"text","content":"W2.4 MCP round-trip test — delete me","project":"factory-test"}}}`:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "isError": false,
    "content": [{
      "type": "text",
      "text": "{\n  \"session_id\": \"48184b74-a44b-43bb-9c13-9221dc35dd6d\",\n  \"work_log_id\": \"43bba71e-c8db-434b-afc0-0f1e42eedbb9\",\n  \"memory_id\": \"f19b3eb3-9260-4bec-81f2-2c42fae1e03e\"\n}"
    }]
  }
}
```

Full round-trip: MCP POST → JSON-RPC handler → proxy to `capture()` Edge Function → session + work_log + memory rows inserted → structured result back to caller.

### 6. notifications/initialized

POST `{"jsonrpc":"2.0","method":"notifications/initialized"}` → `HTTP 202` no body. Correct per MCP spec.

### Cleanup

```sql
WITH dm AS (DELETE FROM memory WHERE id='f19b…' RETURNING 1),
     dw AS (DELETE FROM work_log WHERE id='43bb…' RETURNING 1),
     ds AS (DELETE FROM sessions WHERE id='4818…' RETURNING 1)
SELECT (SELECT count(*) FROM dm), (SELECT count(*) FROM dw), (SELECT count(*) FROM ds);
-- → mem_deleted: 1, work_log_deleted: 1, session_deleted: 1
```

Production state restored.

## Key design decisions

1. **Thin proxy.** All `capture()` semantics (validation, enrichment, embedding) stay in the capture() function. The MCP layer is auth + JSON-RPC + passthrough. One code path, one contract.
2. **Bearer auth, token fallback chain.** `MCP_AUTH_TOKEN || CAPTURE_SECRET`. One secret today, ability to split later without redeploying.
3. **No SSE / no sessions.** Plain JSON responses. MCP Streamable HTTP permits both; the `capture` tool is fast (<2s worst case through Firecrawl) so streaming gains nothing and adds complexity.
4. **Co-located at `supabase/functions/capture-mcp/`** per Edmund's confirmation — one secrets scope, one deployment target.
5. **Written from scratch, no mcp-lite dependency.** The subagent's plan suggested `mcp-lite`; I wrote the protocol directly (~220 LOC incl. comments) for one reason: Deno Edge Functions + JSR/npm import resolution can surprise us, and MCP's core protocol is small enough that a from-scratch implementation is clearer than a dependency. Future: if we grow to many tools, reconsider `@modelcontextprotocol/sdk`.

## Client-side setup Edmund needs to do (not in scope for this run)

Add to Claude Desktop or Claude Code per the README. Suggested Claude Code invocation:

```bash
claude mcp add --transport http capture-mcp \
  https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/capture-mcp \
  --header "Authorization: Bearer $CAPTURE_SECRET"
```

Exact flag shape depends on CLI version. Then verify from within a Claude session:
- Tool `capture` appears in the tool list
- Calling it with `{kind:"text", content:"hello"}` returns work_log_id / memory_id
- A URL capture (`{kind:"url", content:"https://example.com"}`) gets Firecrawl-enriched

## Cost

$0 — function deployment free, one OpenAI embedding call during the smoke test (~$0.000002). Everything else is Supabase free tier.

## Charter compliance

- Worked in main dashboard dir (not worktree) — same reason as W3.7/W4.4, additive-only, no overlap with Edmund's uncommitted files.
- Additive deployment only. No migrations. No destructive SQL except the intentional narrow test-data cleanup.
- Full verification recorded (not summarized).

## Follow-ups

- [ ] Edmund: add the MCP server to Claude Desktop and/or Claude Code and confirm `capture` is callable from a live chat
- [ ] Optional hardening later: rate limiting (per-token or per-IP), structured error codes matching MCP's standard error range, SSE support if long-running tools arrive
- [ ] If we grow beyond 1 tool here (e.g., `search_memory`, `list_recent_captures`), add them alongside — no new function needed

## What's next

With W2.4 shipped, the immediate queue now reads:

- **W4.1** — Lev agent (voice + ingest) — small, unblocked, sets up for W4.2 voice memo path
- **W2.5** — File upload path (Storage + type-aware enrichment stubs) — M-sized
- **W4.2** — Voice memo capture path in capture()

I'll propose W4.1 next unless Edmund redirects — it's the smallest unblocked item and unblocks the voice-memo track.

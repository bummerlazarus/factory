# W2.4 Plan: Expose `capture()` Edge Function as MCP Tool

**Date:** 2026-04-17  
**Epic:** W2.4 — MCP tool `capture` exposed to Claude chat  
**Status:** Plan only (no code, no deploy)

---

## 1. Current MCP Configuration

Edmund has **exactly one** custom MCP server configured:

- **`supabase`** (production) — npm package `@supabase/mcp-server-supabase@latest`
  - Hosted source: Node.js npx invocation
  - Tools exposed: `list_projects`, `list_tables`, `execute_sql`, `apply_migration`, `deploy_edge_function`, `get_logs`, `get_edge_function`, etc.
  - Status: Active, **NOT retiring**
  
Retired/unused:
- **GravityClaw** — custom Python MCP (deprecated per W1.3)
- Cordis tools (`mcp__cordis__capture_thought`, etc.) — actually **remote MCP** loaded from an external source (not a local server), not a custom MCP

**Key finding:** Edmund has one healthy, non-retiring MCP server (Supabase) that he's actively using.

---

## 2. Supabase MCP + Edge Functions Interplay

**Supabase DOES expose Edge Functions to MCP clients:**

From Supabase docs ("Deploy MCP servers"):
- Supabase can **host MCP servers directly on Edge Functions** using the `@modelcontextprotocol/sdk` or `mcp-lite` framework
- The Supabase MCP server itself (the npm package Edmund uses) **does NOT expose a "call arbitrary Edge Function" tool**
- However, you can deploy a **new dedicated MCP server as an Edge Function** and add it to Edmund's config

**Bottom line:** Supabase doesn't offer "proxy to any Edge Function" as a built-in tool. You must either:
1. Deploy a new MCP server (as an Edge Function or standalone) that advertises `capture`
2. Add `capture` to the existing Supabase MCP server (not recommended — that's Supabase's tool)
3. Wrap `curl` into a Claude Skill (poor DX)

---

## 3. Three Concrete Paths (Ranked)

### **Path α (RECOMMENDED): Deploy a tiny MCP server as a second Edge Function**

- **Host:** Supabase Edge Functions (same project, `obizmgugsqirmnjpirnh`)
- **Framework:** `mcp-lite` (0 dependencies, 200–300 LOC)
- **What it does:** Single tool `capture(text, url, namespace)` → proxies to `https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/capture` (existing Edge Function)
- **Cost:** $0 (included in Supabase free tier; Edge Functions have no per-call billing)
- **DX:** Cordis calls `capture` like any other tool: `await mcp.capture({ text: "...", url: "..." })`
- **Files:** 3 files (index.ts, deno.json, config.toml snippet update)
- **LOC:** ~250 (most is boilerplate + Zod schema)
- **Ship time:** 30–45 min (scaffold, test locally, deploy)
- **Decision needed:** None (straightforward, low risk)

**Trade-offs:**
- Adds one more Edge Function to manage (minimal overhead)
- Splits concern: `capture` writes the data, the MCP tool invokes it (clean boundary)
- Supabase Edge Functions are cold-start friendly; no latency hit

---

### **Path β: Add `capture` to existing Supabase MCP server**

- **Host:** Modify the `@supabase/mcp-server-supabase` package (not viable)
- **Blocker:** This is Supabase's official package. Edmund can't easily fork + run a custom version
- **Fallback:** Uninstall the Supabase MCP, build a custom Node MCP that wraps both Supabase tools AND `capture`, redeploy
  - **Cost:** Lose the out-of-the-box Supabase tools; must maintain a custom fork
  - **LOC:** ~500 (need to re-export all Supabase SQL tools + add capture proxy)
  - **Ship time:** 2–3 hours (fork, test, configure, deploy)
  - **DX:** Same as α (Cordis calls `capture` directly)
- **Verdict:** Not worth it; Path α is simpler

---

### **Path γ: Use a Claude Skill to wrap `curl`**

- **Host:** Local skill file at `~/.claude/skills/capture/`
- **What it does:** Skill command `/capture text="..." url="..."` → shell out to `curl` with env var `SUPABASE_ANON_KEY`
- **Cost:** $0
- **DX:** Cordis types `/capture text="..." url="..."` (not a function call, so requires remembering syntax)
- **LOC:** ~100 (bash wrapper + CLAUDE.md snippet)
- **Ship time:** 15 min
- **Trade-off:** Not a real MCP tool, so no autocomplete in chat, no function-call contract, harder to integrate into agent loops
- **Verdict:** Viable fallback, but Path α is objectively better (1 tool call vs shell escape + manual arg parsing)

---

### **Path δ: Claude Projects / built-in HTTP integration**

- **Check:** Claude Desktop, Claude Code, and claude.ai do NOT currently expose a "add HTTP tool" UI
- **Status:** Unknown if this exists; Anthropic may add it in the future
- **Verdict:** Not viable today

---

## 4. Recommendation

**→ Path α: Deploy mcp-lite MCP server as a second Edge Function**

**Rationale:**
1. **Minimum complexity:** Only new file is the MCP function; nothing changes in the existing Supabase MCP
2. **Zero cost:** Edge Functions included in Supabase free tier
3. **Clean boundary:** Separates "capture logic" (existing Edge Function) from "MCP interface" (new function)
4. **Fastest ship:** 30–45 min vs 2+ hours for β, and better DX than γ
5. **Aligns with Edmund's principles:** "Don't outbuild Anthropic" (use mcp-lite, not a full Node.js server) + "minimum complexity"

**Decision Edmund must make:**
> Should the new MCP function live in the same `supabase/functions/` directory as `capture`, or in a separate repo / Supabase project?

(Recommendation: same directory, new function `capture-mcp`. Keeps it co-located with the backend logic.)

---

## 5. Acceptance Criteria

Assuming Path α:

1. **New Edge Function deployed** to `https://obizmgugsqirmnjpirnh.supabase.co/functions/v1/capture-mcp` 
   - Confirms: `supabase functions deploy capture-mcp` succeeds with no errors

2. **MCP tool callable from Claude chat**
   - Cordis (or any Claude session) adds the MCP server config and sees `capture` in the tool list
   - Confirms: `capture` appears in Cordis' `/tools` or function-call suggestions

3. **Round-trip test: text capture**
   - Cordis calls `capture(text="test note", namespace="knowledge")` 
   - Confirms: row inserted into `public.work_log` with `kind=note`, `namespace=knowledge`

4. **Round-trip test: URL capture with enrichment**
   - Cordis calls `capture(text="", url="https://example.com", namespace="content")`
   - Confirms: URL is fetched, Firecrawl markdown embedded, row + memory vector inserted

5. **Error handling**
   - Call `capture()` with invalid namespace → returns `{ error: "Invalid namespace" }` (no crash)
   - Confirms: MCP function gracefully handles bad input

---

## Summary

| Aspect | Path α | Path β | Path γ |
|---|---|---|---|
| **LOC** | ~250 | ~500 | ~100 |
| **Ship time** | 30–45 min | 2–3 h | 15 min |
| **Cost** | $0 | $0 | $0 |
| **DX (Cordis UX)** | 1 tool call | 1 tool call | shell escape |
| **Maintenance** | Low | High | Low |
| **Complexity** | Low | High | Very low |
| **Verdict** | ✅ PICK | ❌ Not worth it | ❌ Worse DX |

**Next:** Edmund confirms the co-location decision (same `supabase/functions/` or separate?), then proceed to execution on W2.4 sprint.

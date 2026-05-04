# Dashboard Spec System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class "Spec" primitive to the dashboard so every dashboard change starts as a 4-artifact spec (proposal / scenarios / design / tasks), auto-engages from Claude Code, and surfaces as a 5th tab inside `/workspace` with cross-page artifact links to `/files`, `/research`, and other workspace items.

**Architecture:** Reuse `workspace_items` (add `'spec'` type) + `reference_docs` (store the 4 artifact files) + `artifact_links` (cross-link). One new Claude Code skill (`writing-dashboard-spec`) auto-fires on dashboard-change phrasing, creates the spec row + artifact files + child task rows, and inserts everything via the existing service-role API. Specs nest under `/workspace`: list lives in the existing workspace page (new `Specs` tab), detail view lives at `/workspace/specs/[slug]` (the 4-artifact + cross-links view is too rich for the existing Sheet). Backfill specs for `/workspace`, `/files`, `/research` documenting current behavior + cross-page routing gaps.

**Tech Stack:** Next.js 16 App Router (dashboard), Supabase (workspace_items, reference_docs, artifact_links), TypeScript, shadcn/ui, Claude Code Skill format (SKILL.md frontmatter).

**Default decisions baked in (callable out by Edmund before execution):**
1. Spec storage = `workspace_items` row with `type='spec'`, NOT a new table.
2. **Specs nest under `/workspace`.** Add `spec` as a 5th tab in `dashboard/app/workspace/page.tsx`'s `typeTabs` (alongside Plans/Projects/Tasks/Scopes). Detail view lives at `/workspace/specs/[slug]` because the 4-artifact + cross-links view is too rich for the existing Sheet. NO top-level `/specs` route, NO new sidebar entry.
3. Backfill 3 areas only in this plan: `workspace`, `files`, `research`. Defer `chat`, `agents`, `inbox` to a follow-up.
4. Skill name: `writing-dashboard-spec` (factory-specific). Generalization deferred.
5. Phase boundaries are commit boundaries. Each phase produces working software.

**Verified facts (do not re-discover):**
- `Department` = `factory | marketing | design | strategy | general`. Use `factory` in all examples.
- Child tasks link to parent via `project_id` column (NOT `parent_id`).
- **CRITICAL: `project_id` stores the parent's SLUG, not its UUID.** Verified at `dashboard/app/workspace/page.tsx:173` — task→project lookup is `?type=project&slug=${selectedItem.project}`. All inserts/queries in this plan use `spec.slug`, not `spec.id`.
- `reference_docs.kind` is FK-backed by `reference_docs_kinds` lookup table. Any new `kind` value MUST be inserted there first.
- `dashboard/app/api/workspace/route.ts` has `VALID_TYPES = ["plan","project","task","scope"]` (line 11). Phase 3 MUST add `"spec"` or the Specs tab will 400.
- Top-level nav lives in `dashboard/components/layout/sidebar.tsx`. We are NOT touching it (specs nest under `/workspace`).
- `PageShell` props: `children | header | footer | className | scroll`. No `title` prop — render the title via the `header` slot.
- `MarkdownRender` props: `<MarkdownRender content={body} />`. NOT children.
- `dashboard/app/api/workspace/route.ts` does NOT use bearer auth — match its actual auth pattern in Phase 2.

---

## File Structure

| Path | Responsibility | Action |
|---|---|---|
| `supabase/migrations/038_workspace_items_spec_type.sql` | Add `'spec'` to workspace_items.type constraint AND insert 4 spec_* kinds into reference_docs_kinds | Create |
| `dashboard/types/index.ts` | Add `'spec'` to `WorkspaceItemType` union | Modify |
| `dashboard/lib/spec-artifacts.ts` | Helper: create spec + 4 reference_docs + N task rows + artifact_links sequentially with rollback-on-failure cleanup (NOT a real DB transaction — see Risks) | Create |
| `dashboard/app/api/specs/route.ts` | POST endpoint to create a spec from skill payload; GET to list | Create |
| `dashboard/app/api/specs/[id]/route.ts` | GET single spec with artifacts + child tasks + cross-page artifact links | Create |
| `dashboard/app/workspace/page.tsx` | Add `spec` to `typeTabs`. Spec list rows link to `/workspace/specs/[slug]` instead of opening the Sheet. | Modify |
| `dashboard/app/workspace/specs/[slug]/page.tsx` | Detail view: 4-artifact tabs (Proposal/Scenarios/Design/Tasks-md) + child task list + Cross-Page Links panel | Create |
| `~/.claude/skills/writing-dashboard-spec/SKILL.md` | Skill definition + workflow | Create |
| `ops/specs/<slug>/proposal.md` etc. | Local mirror of artifacts (optional, for git history) | Create per-spec |
| `ops/specs/baseline-workspace/` | Backfill spec #1 | Create |
| `ops/specs/baseline-files/` | Backfill spec #2 | Create |
| `ops/specs/baseline-research/` | Backfill spec #3 | Create |

---

## Phase 1: Schema + types

### Task 1.1: Discover existing workspace_items.type constraint

**Files:**
- Read: live Supabase schema for `public.workspace_items`

- [ ] **Step 1: Query the live constraint**

Run via Supabase MCP (`project_id: obizmgugsqirmnjpirnh`):

```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.workspace_items'::regclass
  AND contype = 'c';
```

Expected: a `CHECK` constraint listing the allowed values for `type`. Capture the exact constraint name and definition — Task 1.2 ALTERs it.

- [ ] **Step 2: Verify column shape**

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='workspace_items'
ORDER BY ordinal_position;
```

Expected: confirm `type text NOT NULL`, `slug text`, `parent_id` (or `project_id`) — note exact name; the spec-detail page joins child tasks on whichever column exists.

- [ ] **Step 3: Record findings**

Append to plan as a comment block under this task (do not commit yet — schema discovery is not a code change).

### Task 1.2: Migration to allow `type='spec'`

**Files:**
- Create: `supabase/migrations/038_workspace_items_spec_type.sql`

- [ ] **Step 1: Write migration**

```sql
-- 038_workspace_items_spec_type.sql
-- 1) Allow 'spec' as a workspace_items.type value.
-- 2) Register 4 spec artifact kinds in reference_docs_kinds (FK target).
-- A Spec is a planning artifact with 4 child reference_docs (proposal/scenarios/design/tasks)
-- and N child workspace_items rows of type='task' linked via project_id.

-- Replace <CONSTRAINT_NAME> with what Task 1.1 discovered.
alter table public.workspace_items drop constraint if exists <CONSTRAINT_NAME>;
alter table public.workspace_items add constraint <CONSTRAINT_NAME>
  check (type in ('plan','project','task','scope','spec'));

comment on column public.workspace_items.type is
  'plan | project | task | scope | spec. Specs are planning artifacts with 4 reference_docs children.';

-- Register the 4 spec kinds. ON CONFLICT DO NOTHING so re-running is safe.
insert into public.reference_docs_kinds (kind) values
  ('spec_proposal'),
  ('spec_scenarios'),
  ('spec_design'),
  ('spec_tasks')
on conflict (kind) do nothing;
```

- [ ] **Step 2: Apply via Supabase MCP**

Use `mcp__fb0388c7-...__apply_migration` with `project_id: obizmgugsqirmnjpirnh`, `name: workspace_items_spec_type`, body from step 1.

Expected: success, no rows affected.

- [ ] **Step 3: Verify constraint accepts 'spec' AND kinds registered**

```sql
INSERT INTO public.workspace_items
  (slug, title, type, department, status, content)
VALUES
  ('__spec_constraint_test', 'test', 'spec', 'factory', 'draft', '');
DELETE FROM public.workspace_items WHERE slug='__spec_constraint_test';

SELECT kind FROM public.reference_docs_kinds
WHERE kind LIKE 'spec_%' ORDER BY kind;
```

Expected: insert+delete succeed; SELECT returns 4 rows (spec_design, spec_proposal, spec_scenarios, spec_tasks).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/038_workspace_items_spec_type.sql
git commit -m "feat(db): allow 'spec' as workspace_items.type"
```

### Task 1.3: Extend WorkspaceItemType union

**Files:**
- Modify: `dashboard/types/index.ts:103`

- [ ] **Step 1: Update union**

Change:
```ts
export type WorkspaceItemType = "plan" | "project" | "task" | "scope";
```
To:
```ts
export type WorkspaceItemType = "plan" | "project" | "task" | "scope" | "spec";
```

- [ ] **Step 2: Typecheck**

Run from `/Users/edmundmitchell/factory/dashboard`:

```bash
npx tsc --noEmit
```

Expected: zero new errors. If `WorkspaceItemType` is exhaustively switched anywhere (look for `Record<WorkspaceItemType, …>` in workspace page typeTabs / statusColors), add a `spec` entry — fail-closed defaults are fine for now (the spec page does its own rendering).

- [ ] **Step 3: Commit**

```bash
git add dashboard/types/index.ts
# plus any exhaustive-switch fixups
git commit -m "feat(types): add 'spec' to WorkspaceItemType"
```

---

## Phase 2: Server-side spec creation

### Task 2.1: Spec artifact helper

**Files:**
- Create: `dashboard/lib/spec-artifacts.ts`
- Reference: `dashboard/lib/workspace.ts` (saveWorkspaceItem pattern), `dashboard/lib/artifact-links.ts` (link insertion)

- [ ] **Step 1: Define payload + helper**

```ts
// dashboard/lib/spec-artifacts.ts
import { supabase } from "./supabase";
import type { Department } from "@/types";

export type SpecArtifactPayload = {
  slug: string;
  title: string;
  department: Department;
  proposal: string;
  scenarios: string;     // Given/When/Then markdown
  design: string;
  tasks: Array<{ title: string; body?: string }>;
  tags?: string[];
};

export type CreatedSpec = {
  specId: string;
  artifactDocIds: { proposal: string; scenarios: string; design: string; tasks: string };
  taskIds: string[];
};

// NOTE: This helper performs 4 sequential inserts. Supabase JS does not support
// multi-statement transactions, so on any failure we attempt a best-effort cleanup
// of rows already created. For real atomicity, convert this to a Postgres RPC
// (deferred — see Risks).
export async function createSpec(p: SpecArtifactPayload): Promise<CreatedSpec> {
  let createdSpecId: string | null = null;
  let createdDocIds: string[] = [];
  let createdTaskIds: string[] = [];
  const cleanup = async () => {
    // Best-effort: each delete is independent. Failures are swallowed so the original
    // insert error always surfaces to the caller.
    const ops: Array<Promise<unknown>> = [];
    if (createdTaskIds.length)
      ops.push(supabase.from("workspace_items").delete().in("id", createdTaskIds));
    if (createdDocIds.length) {
      ops.push(supabase.from("artifact_links").delete().in("reference_doc_id", createdDocIds));
      ops.push(supabase.from("reference_docs").delete().in("id", createdDocIds));
    }
    if (createdSpecId)
      ops.push(supabase.from("workspace_items").delete().eq("id", createdSpecId));
    await Promise.allSettled(ops);
  };

  try {
  // 1. Insert spec row.
  const { data: spec, error: e1 } = await supabase
    .from("workspace_items")
    .insert({
      slug: p.slug,
      title: p.title,
      type: "spec",
      department: p.department,
      status: "draft",
      content: p.proposal,         // proposal doubles as the row's content for list previews
      tags: p.tags ?? [],
    })
    .select("id, slug")
    .single();
  if (e1 || !spec) throw new Error(`spec insert: ${e1?.message}`);
  createdSpecId = spec.id;

  // 2. Insert 4 reference_docs.
  const docs = [
    { kind: "spec_proposal", slug: `${p.slug}-proposal`, body: p.proposal },
    { kind: "spec_scenarios", slug: `${p.slug}-scenarios`, body: p.scenarios },
    { kind: "spec_design", slug: `${p.slug}-design`, body: p.design },
    { kind: "spec_tasks", slug: `${p.slug}-tasks`, body: renderTasksMd(p.tasks) },
  ];
  const { data: docRows, error: e2 } = await supabase
    .from("reference_docs")
    .insert(docs.map((d) => ({ ...d, status: "current", title: `${p.title} — ${d.kind}` })))
    .select("id, kind");
  if (e2 || !docRows) throw new Error(`reference_docs insert: ${e2?.message}`);
  createdDocIds = docRows.map((r) => r.id);

  const docIds = Object.fromEntries(docRows.map((r) => [r.kind, r.id])) as Record<string, string>;

  // 3. Cross-link each doc to the spec via artifact_links.
  const { error: e3 } = await supabase.from("artifact_links").insert(
    docRows.map((r) => ({
      workspace_item_id: spec.id,
      reference_doc_id: r.id,
      created_by: "writing-dashboard-spec",
    }))
  );
  if (e3) throw new Error(`artifact_links insert: ${e3.message}`);

  // 4. Insert child task rows. Existing convention: tasks reference their parent via project_id,
  //    and project_id stores the parent's SLUG (not UUID). Verified at app/workspace/page.tsx:173.
  const taskRows = p.tasks.map((t, i) => ({
    slug: `${p.slug}-t${String(i + 1).padStart(2, "0")}`,
    title: t.title,
    type: "task",
    department: p.department,
    status: "backlog",
    content: t.body ?? "",
    project_id: spec.slug,
  }));
  const { data: tasks, error: e4 } = await supabase
    .from("workspace_items")
    .insert(taskRows)
    .select("id");
  if (e4 || !tasks) throw new Error(`task insert: ${e4?.message}`);
  createdTaskIds = tasks.map((t) => t.id);

  return {
    specId: spec.id,
    artifactDocIds: {
      proposal: docIds.spec_proposal,
      scenarios: docIds.spec_scenarios,
      design: docIds.spec_design,
      tasks: docIds.spec_tasks,
    },
    taskIds: createdTaskIds,
  };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

function renderTasksMd(tasks: Array<{ title: string; body?: string }>): string {
  return tasks
    .map((t, i) => `- [ ] **T${i + 1}.** ${t.title}${t.body ? `\n  ${t.body}` : ""}`)
    .join("\n");
}
```

- [ ] **Step 2: Typecheck**

```bash
cd dashboard && npx tsc --noEmit
```

Expected: zero errors. If `reference_docs` row shape disagrees (e.g. required `summary` column), adjust insert to satisfy it — read the latest reference_docs migration to confirm.

- [ ] **Step 3: Commit**

```bash
git add dashboard/lib/spec-artifacts.ts
git commit -m "feat(specs): add createSpec helper"
```

### Task 2.2: API routes

**Files:**
- Create: `dashboard/app/api/specs/route.ts`
- Create: `dashboard/app/api/specs/[id]/route.ts`
- Reference: any existing route under `dashboard/app/api/workspace/` for the auth + service-role pattern

- [ ] **Step 1: Read existing routes for the pattern**

```bash
ls dashboard/app/api/workspace/ 2>/dev/null
head -60 dashboard/app/api/workspace/route.ts 2>/dev/null
```

Note: the workspace route does NOT use bearer auth. Mirror whatever auth scheme it actually uses (likely none, relying on the dashboard being local + service-role client server-side). Do NOT invent a new auth scheme. If the existing pattern is "no auth, server-side service role," do the same here — `/api/specs` runs server-side and the supabase client uses the service-role key.

- [ ] **Step 2: Write POST /api/specs**

```ts
// dashboard/app/api/specs/route.ts
import { NextResponse } from "next/server";
import { createSpec, type SpecArtifactPayload } from "@/lib/spec-artifacts";
import { supabase } from "@/lib/supabase";

export async function POST(req: Request) {
  // Auth: match dashboard/app/api/workspace/route.ts exactly (re-read it before writing this).
  // If workspace/route.ts has no auth check, do not add one here either — keep parity.

  const body = (await req.json()) as SpecArtifactPayload;
  if (!body.slug || !body.title || !body.proposal || !body.scenarios || !body.design || !Array.isArray(body.tasks)) {
    return NextResponse.json({ error: "missing required fields" }, { status: 400 });
  }
  try {
    const created = await createSpec(body);
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function GET() {
  const { data, error } = await supabase
    .from("workspace_items")
    .select("id, slug, title, status, department, tags, created_at, updated_at")
    .eq("type", "spec")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ specs: data });
}
```

- [ ] **Step 3: Write GET /api/specs/[id]**

```ts
// dashboard/app/api/specs/[id]/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // The id param is actually a slug for friendly URLs.
  const { data: spec, error: e1 } = await supabase
    .from("workspace_items")
    .select("*")
    .eq("type", "spec")
    .eq("slug", id)
    .maybeSingle();
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
  if (!spec) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: links, error: e2 } = await supabase
    .from("artifact_links")
    .select("reference_doc_id, disk_path")
    .eq("workspace_item_id", spec.id);
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

  const docIds = (links ?? []).map((l) => l.reference_doc_id).filter(Boolean) as string[];
  let docs: Array<{ id: string; kind: string; slug: string; title: string; body: string }> = [];
  if (docIds.length > 0) {
    const { data, error: e3 } = await supabase
      .from("reference_docs")
      .select("id, kind, slug, title, body")
      .in("id", docIds);
    if (e3) return NextResponse.json({ error: e3.message }, { status: 500 });
    docs = data ?? [];
  }

  const { data: tasks, error: e4 } = await supabase
    .from("workspace_items")
    .select("id, slug, title, status, content")
    .eq("type", "task")
    .eq("project_id", spec.slug)
    .order("slug");
  if (e4) return NextResponse.json({ error: e4.message }, { status: 500 });

  // Cross-page links: build from artifact_links rows that are NOT the 4 spec_* artifacts.
  const specArtifactDocIds = new Set(
    (docs ?? []).filter((d) => d.kind?.startsWith("spec_")).map((d) => d.id)
  );
  const crossLinks: Array<{ key: string; href: string; label: string; kind: string }> = [];
  for (const link of links ?? []) {
    if (link.disk_path) {
      crossLinks.push({
        key: `disk:${link.disk_path}`,
        href: `/files?path=${encodeURIComponent(link.disk_path)}`,
        label: link.disk_path,
        kind: "file",
      });
    } else if (link.reference_doc_id && !specArtifactDocIds.has(link.reference_doc_id)) {
      const d = (docs ?? []).find((x) => x.id === link.reference_doc_id);
      crossLinks.push({
        key: `ref:${link.reference_doc_id}`,
        href: `/research/${link.reference_doc_id}`,
        label: d?.title ?? link.reference_doc_id,
        kind: d?.kind ?? "reference_doc",
      });
    }
  }
  for (const t of tasks ?? []) {
    crossLinks.push({
      key: `task:${t.id}`,
      href: `/workspace?type=task&slug=${encodeURIComponent(t.slug)}`,
      label: t.title,
      kind: "task",
    });
  }

  return NextResponse.json({ spec, artifacts: docs ?? [], tasks: tasks ?? [], crossLinks });
}
```

- [ ] **Step 4: Smoke-test POST locally**

Edmund typically has `npm run dev` on port 3000. Verify:

```bash
lsof -ti:3000 || (cd dashboard && npm run dev &)
```

Then:

```bash
curl -sS -X POST http://localhost:3000/api/specs \
  -H "Content-Type: application/json" \
  -d '{
    "slug":"smoke-test-spec",
    "title":"Smoke test spec",
    "department":"factory",
    "proposal":"P","scenarios":"S","design":"D",
    "tasks":[{"title":"first task"}]
  }' | jq
```

(If workspace/route.ts uses bearer auth after all, add `-H "Authorization: Bearer $(grep SUPABASE_SERVICE_ROLE_KEY dashboard/.env.local | cut -d= -f2)"`.)

Expected: 201 with `{specId, artifactDocIds, taskIds}`. Then `DELETE FROM workspace_items WHERE slug LIKE 'smoke-test-spec%' OR slug LIKE 'smoke-test-spec-t%'` and the matching reference_docs rows.

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/api/specs
git commit -m "feat(specs): POST/GET /api/specs and GET /api/specs/[id]"
```

---

## Phase 3: `/workspace` Specs tab + detail UI

### Task 3.1: Add `spec` to workspace `typeTabs` + API VALID_TYPES

**Files:**
- Modify: `dashboard/app/workspace/page.tsx` (the `typeTabs` array around line 24, plus the row-click handler)
- Modify: `dashboard/app/api/workspace/route.ts` (line 11 — add `"spec"` to `VALID_TYPES`)
- Modify (maybe): `dashboard/lib/icons.ts` (add `ClipboardList` export if not present)

- [ ] **Step 1: Read the current typeTabs**

```bash
sed -n '20,40p' dashboard/app/workspace/page.tsx
```

Confirm shape: `{ key: WorkspaceItemType; label: string; icon: LucideIcon }[]`.

- [ ] **Step 2: Add Specs entry**

Append to the `typeTabs` array (or insert before `scope` — order is up to taste):

```ts
{ key: "spec", label: "Specs", icon: ClipboardList },
```

Add the `ClipboardList` import:

```ts
// existing import line:
import { Compass, FolderKanban, CheckSquare, Plus, ..., ClipboardList } from "@/lib/icons";
```

If `ClipboardList` isn't exported from `@/lib/icons`, add it:

```bash
grep -n "ClipboardList" dashboard/lib/icons.ts || \
  echo "Add: export { ClipboardList } from 'lucide-react';"
```

- [ ] **Step 3: Make spec list rows route to the detail page**

In `dashboard/app/workspace/page.tsx`, the existing inline row-click handler runs:

```ts
setSelectedItem(item);
setEditContent(item.content);
setEditing(false);
setCreating(false);
setMobileSidebar(false);
```

Add `useRouter` and short-circuit for specs at the TOP of that handler:

```tsx
// at top of file:
import { useRouter } from "next/navigation";

// inside WorkspacePage, alongside other useState calls:
const router = useRouter();

// at top of the row onClick handler, BEFORE setSelectedItem:
if (item.type === "spec") {
  router.push(`/workspace/specs/${item.slug}`);
  return;
}
```

This keeps Plans/Projects/Tasks/Scopes on the existing Sheet behavior; specs get the dedicated page.

- [ ] **Step 3b: Add `"spec"` to API VALID_TYPES**

In `dashboard/app/api/workspace/route.ts:11`:

```ts
const VALID_TYPES = ["plan", "project", "task", "scope", "spec"];
```

Without this, the workspace UI's fetch for `?type=spec` returns 400 and the Specs tab stays empty.

- [ ] **Step 4: Verify the tab renders**

```bash
curl -s "http://localhost:3000/workspace" | grep -i ">Specs<" | head
```

Expected: tab label present. Clicking it should show an empty list (no specs created yet) — that's fine; Phase 2 lets us create one.

- [ ] **Step 5: Commit**

```bash
git add dashboard/app/workspace/page.tsx dashboard/app/api/workspace/route.ts dashboard/lib/icons.ts
git commit -m "feat(workspace): add Specs tab + allow spec in API VALID_TYPES"
```

### Task 3.2: (removed — list view is handled by `/workspace` Specs tab from Task 3.1)

The existing `getWorkspaceItems(department, "spec")` call in `dashboard/lib/workspace.ts` already does list-fetch + grouping. No separate list page needed. The GET `/api/specs` endpoint stays (used by external surfaces / scripts) but the dashboard's own list lives in workspace.

### Task 3.3: Detail page with 4-artifact tabs

**Files:**
- Create: `dashboard/app/workspace/specs/[slug]/page.tsx`
- Reference: `dashboard/components/markdown-render.tsx` for body rendering, `dashboard/components/ui/tabs.tsx`

- [ ] **Step 1: Write the detail page**

```tsx
// dashboard/app/workspace/specs/[slug]/page.tsx
"use client";
import { useEffect, useState, use } from "react";
import { PageShell } from "@/components/layout/page-shell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MarkdownRender } from "@/components/markdown-render";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Doc = { id: string; kind: string; slug: string; title: string; body: string };
type Task = { id: string; slug: string; title: string; status: string; content: string };

export default function SpecDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [data, setData] = useState<{ spec: any; artifacts: Doc[]; tasks: Task[] } | null>(null);

  useEffect(() => {
    fetch(`/api/specs/${slug}`).then((r) => r.json()).then(setData);
  }, [slug]);

  if (!data) return <PageShell header={<h1 className="text-lg font-semibold">Spec</h1>}>Loading…</PageShell>;
  const get = (kind: string) => data.artifacts.find((a) => a.kind === kind)?.body ?? "_(missing)_";

  // Cross-page links: any artifact_link with a disk_path → /files; reference_doc with kind starting "synthesis-"/"landscape-"/"recommendation" → /research/[id]; tasks → /workspace.
  const crossPageLinks = data.crossLinks ?? []; // populated by GET /api/specs/[id]; see Task 2.2 step 3 update.

  return (
    <PageShell header={<h1 className="text-lg font-semibold">{data.spec.title}</h1>}>
      <div className="mb-4 flex items-center gap-2">
        <Badge>{data.spec.status}</Badge>
        <span className="text-xs opacity-60">{data.spec.slug}</span>
      </div>
      <Tabs defaultValue="proposal">
        <TabsList>
          <TabsTrigger value="proposal">Proposal</TabsTrigger>
          <TabsTrigger value="scenarios">Scenarios</TabsTrigger>
          <TabsTrigger value="design">Design</TabsTrigger>
          <TabsTrigger value="tasks-md">Tasks (md)</TabsTrigger>
          <TabsTrigger value="tasks-rows">Tasks ({data.tasks.length})</TabsTrigger>
          <TabsTrigger value="links">Cross-Page Links ({crossPageLinks.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="proposal"><MarkdownRender content={get("spec_proposal")} /></TabsContent>
        <TabsContent value="scenarios"><MarkdownRender content={get("spec_scenarios")} /></TabsContent>
        <TabsContent value="design"><MarkdownRender content={get("spec_design")} /></TabsContent>
        <TabsContent value="tasks-md"><MarkdownRender content={get("spec_tasks")} /></TabsContent>
        <TabsContent value="tasks-rows">
          <div className="space-y-2">
            {data.tasks.map((t) => (
              <Card key={t.id}>
                <CardContent className="p-3 flex items-center justify-between">
                  <div>
                    <div className="font-medium">{t.title}</div>
                    <div className="text-xs opacity-60">{t.slug}</div>
                  </div>
                  <Badge variant="outline">{t.status}</Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
        <TabsContent value="links">
          <div className="space-y-2">
            {crossPageLinks.length === 0 && (
              <div className="text-sm opacity-60">No cross-page links yet. Files written, research briefs created, or workspace items linked to this spec will appear here.</div>
            )}
            {crossPageLinks.map((l: any) => (
              <Card key={l.key}>
                <CardContent className="p-3 flex items-center justify-between">
                  <a className="text-sm underline" href={l.href}>{l.label}</a>
                  <Badge variant="outline">{l.kind}</Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
```

- [ ] **Step 2: Verify with the smoke-test spec from Task 2.2**

Re-create the smoke spec, then:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/workspace/specs/smoke-test-spec
```

Expected: 200. Open in browser, click each of the tabs (Proposal / Scenarios / Design / Tasks-md / Tasks-rows / Cross-Page Links), confirm content renders.

Also visit `http://localhost:3000/workspace`, **switch the department selector to "Factory"** (default is "general"; the smoke spec was inserted with `department='factory'`), click the Specs tab, confirm the smoke-test-spec row appears, and clicking it navigates to `/workspace/specs/smoke-test-spec`.

- [ ] **Step 3: Clean up smoke spec**

```sql
DELETE FROM artifact_links WHERE workspace_item_id IN
  (SELECT id FROM workspace_items WHERE slug='smoke-test-spec');
DELETE FROM reference_docs WHERE slug LIKE 'smoke-test-spec-%';
DELETE FROM workspace_items WHERE slug='smoke-test-spec' OR slug LIKE 'smoke-test-spec-t%';
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/app/workspace/specs/[slug]/page.tsx
git commit -m "feat(workspace/specs): detail page with 4-artifact tabs + cross-page links"
```

---

## Phase 4: Claude Code skill

### Task 4.1: Author the skill

**Files:**
- Create: `~/.claude/skills/writing-dashboard-spec/SKILL.md`

- [ ] **Step 1: Write SKILL.md**

```markdown
---
name: writing-dashboard-spec
description: Use BEFORE designing or building any dashboard change. Triggers when Edmund says "I want to add/change/fix/improve [page] in the dashboard", "let's improve the [feature] flow", "the [page] needs to do Y", or any phrasing that proposes a dashboard modification. Creates a 4-artifact spec (proposal/scenarios/design/tasks) in workspace_items + reference_docs and surfaces them under /workspace (Specs tab) with detail at /workspace/specs/[slug]. Skip ONLY for trivial copy/CSS tweaks.
---

# Writing a Dashboard Spec

When Edmund describes a dashboard change, do NOT start coding. Create a spec first.

## Step 1 — Check for an existing spec

Query Supabase (project_id `obizmgugsqirmnjpirnh`):

```sql
SELECT id, slug, title, status FROM workspace_items
WHERE type='spec' AND (title ILIKE '%<keyword>%' OR slug ILIKE '%<keyword>%');
```

If a relevant spec exists in draft or in-progress, ask Edmund whether to extend it instead of creating new.

## Step 2 — Pin scope (max 3 questions)

Ask Edmund only the questions you genuinely cannot infer:
- Which dashboard area(s) does this touch? (`/workspace`, `/files`, `/research`, `/chat`, `/agents`, `/inbox`, ...)
- What does success look like — what's the single observable behavior change?
- Any cross-page contracts? (e.g. "files generated by this should appear on /workspace project detail")

If Edmund's initial message answers these, skip the question.

## Step 3 — Draft the 4 artifacts in your head

- **proposal.md**: Problem (1 short paragraph). Proposed change (3-5 bullets). Out of scope (bullets). Success criteria (bullets).
- **scenarios.md**: 3-7 Given/When/Then user workflows. One per real path through the feature, including the cross-page contract paths.
- **design.md**: Affected files/routes/tables. Data shape changes. New API endpoints. Migration needed (yes/no). Open questions.
- **tasks.md**: Plan list, each task ≤ 30 min, organized in phases that each ship something. Include verification commands.

## Step 4 — POST to /api/specs

`/api/specs` runs server-side with the service-role client; it does NOT require an Authorization header (matches `/api/workspace`). Do NOT read or send the service-role key from the skill — that would put it in command history.

Slug = kebab-case from title, prefixed `spec-YYYY-MM-DD-`. Send all 4 artifacts + tasks array:

```bash
curl -sS -X POST http://localhost:3000/api/specs \
  -H "Content-Type: application/json" \
  -d @/tmp/spec-payload.json | jq
```

If port 3000 is not running, do NOT start it silently — tell Edmund and ask whether to spin up `cd dashboard && npm run dev`.

## Step 5 — Mirror to disk (optional, for git history)

Write the 4 artifacts to `/Users/edmundmitchell/factory/ops/workspace/specs/<slug>/{proposal,scenarios,design,tasks}.md`. Commit with message `spec: <title>`.

## Step 6 — Hand off

Show Edmund:
- The `/workspace/specs/<slug>` URL (clickable markdown).
- A 2-sentence summary of what the spec proposes.
- The next step ("Want me to start implementing? I can use superpowers:executing-plans on the tasks list.").

## Stop conditions

- If the change is genuinely trivial (typo, single CSS value, copy edit), skip the spec — note it in chat and just make the edit.
- If port 3000 is down AND Edmund hasn't authorized starting it, write the spec to disk only and tell him.
- If `/api/specs` returns 4xx/5xx, surface the error verbatim — do not retry blindly.
```

- [ ] **Step 2: Validate the skill triggers correctly**

In a fresh Claude Code session, type "I want to clean up how /workspace and /files share files" — confirm the skill auto-engages (Skill tool invocation announced). If not, tighten the description's trigger phrasing.

- [ ] **Step 3: Register skill in Supabase `skill_versions`**

Read the skill body, then via Supabase MCP (`project_id: obizmgugsqirmnjpirnh`):

```sql
-- Confirm columns first:
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='skill_versions';

-- Then insert (column list to match what the SELECT above returned):
INSERT INTO skill_versions (skill_name, version, status, body)
VALUES ('writing-dashboard-spec', '1.0.0', 'approved', $$<paste SKILL.md body here>$$);
```

If the columns don't match (`status` may be an enum, `body` may be `markdown`), adjust the INSERT. Skip this step with a note in the commit message if `skill_versions` doesn't exist or the schema is incompatible — DO NOT block the rest of Phase 4 on it.

- [ ] **Step 4: (Optional) Notion registration**

If `notion-create-pages` MCP is connected, add a row to the "Systems, SOPs & Skills Index" page (`313bfe74-5aa2-81f3-8ef7-e506065faf11`) with title=`writing-dashboard-spec`, status=approved, link to the local skill file. If the MCP isn't available, skip — Edmund can backfill manually.

- [ ] **Step 5: Note in commit log**

The skill file is at `~/.claude/skills/writing-dashboard-spec/SKILL.md`, outside the factory repo. Mention its creation in the Task 6.1 CLAUDE.md commit.

---

## Phase 5: Backfill specs for current pages

### Task 5.1: Baseline spec — `/workspace`

**Files:**
- Create: `ops/specs/baseline-workspace/{proposal,scenarios,design,tasks}.md` (mirror)
- Create: workspace_items row + 4 reference_docs via `/api/specs`

- [ ] **Step 1: Survey the current behavior**

Read in this order, capture observed behavior into draft proposal:
- `dashboard/app/workspace/page.tsx`
- `dashboard/lib/workspace.ts`
- `dashboard/lib/artifact-links.ts` (how files/research route into workspace)
- `dashboard/lib/tools.ts` (how `executeTool` populates `activeWorkspaceItemId`)

- [ ] **Step 2: Write proposal.md**

Sections: Current behavior. Known routing gaps (be specific — e.g. "research briefs created without `activeWorkspaceItemId` never appear on /workspace"). Desired contracts. Out of scope.

- [ ] **Step 3: Write scenarios.md** — Given/When/Then for at least:
  - Creating a Plan from chat
  - Promoting a Plan into a Project + child Tasks
  - A research brief created with `activeWorkspaceItemId` showing up on the project's Artifacts panel
  - A Task being marked done from the workspace UI
  - A Task being marked done from chat

- [ ] **Step 4: Write design.md** documenting current data flow + listing the gaps as numbered open questions.

- [ ] **Step 5: Write tasks.md** with a punch list of remediation tasks (these become real tasks under the spec — they're the to-do that future specs will fix).

- [ ] **Step 6: POST via the skill** (or the curl directly).

- [ ] **Step 7: Verify at `/workspace/specs/baseline-workspace`** — all tabs render, tasks appear.

- [ ] **Step 8: Commit mirror**

```bash
git add ops/specs/baseline-workspace
git commit -m "spec: baseline /workspace (current behavior + gaps)"
```

### Task 5.2: Baseline spec — `/files`

Same shape as Task 5.1, surveying:
- `dashboard/app/files/page.tsx`
- File-write tool implementation in `dashboard/lib/tools.ts`
- `COWORK_PATH` resolution in `dashboard/.env.local`

Pay special attention to: when does a file written by `write_file` show up on /workspace as an artifact? When does it not? Document the gap.

- [ ] Steps 1–8 mirror Task 5.1.

### Task 5.3: Baseline spec — `/research`

Same shape, surveying:
- `dashboard/app/research/page.tsx`
- `sophia_research` and `augustin_synthesize` tool definitions
- Cross-link insertion into `artifact_links`

Document: which research outputs land in `/research` vs. `/workspace` vs. neither, and why.

- [ ] Steps 1–8 mirror Task 5.1.

---

## Phase 6: Wire up + verify end-to-end

### Task 6.1: Update CLAUDE.md

**Files:**
- Modify: `/Users/edmundmitchell/factory/CLAUDE.md` ("Where things live" table)
- Modify: `/Users/edmundmitchell/.claude/CLAUDE.md` (add reference to spec workflow)

- [ ] **Step 1: Add `ops/specs/` row to the project CLAUDE.md "Where things live" table**

```
| `ops/specs/` | Local mirror of dashboard spec artifacts. Each subfolder = one spec, with proposal/scenarios/design/tasks .md files. Live versions in Supabase + /workspace (Specs tab). |
```

- [ ] **Step 2: Add a one-liner under "Working style"**

```
- Before any non-trivial dashboard change, write a spec via the `writing-dashboard-spec` skill. Specs surface under `/workspace` (Specs tab). Trivial = single CSS value, typo, copy edit.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): document spec workflow + ops/specs/"
```

### Task 6.2: End-to-end smoke test

- [ ] **Step 1: Fresh Claude Code session**, type: "I want to fix how files generated in chat appear on /workspace."

Expected: skill fires, asks ≤3 questions, drafts artifacts, POSTs, returns clickable `/workspace/specs/<slug>` link.

- [ ] **Step 2: Open the URL** — confirm 4 tabs + tasks render.

- [ ] **Step 3: Confirm cross-link** — query `artifact_links` for the new spec id; expect 4 rows.

- [ ] **Step 4: If anything fails**, write findings as a plain markdown file at `ops/specs/_failures/2026-05-04-spec-system-smoke.md` (do NOT try to use the failing spec system to file the failure — that risks recursion).

### Task 6.3: Push

- [ ] **Step 1: Push factory branch**

```bash
git push origin main
```

- [ ] **Step 2: Push dashboard sister repo**

```bash
cd dashboard && git push origin main
```

Vercel auto-deploys. Wait for green, then re-run Task 6.2 against the prod URL.

---

## Out of scope for this plan

- Editing specs after creation (UI is read-only in v1; edit via re-POST to `/api/specs/<id>` would require Phase 7).
- Closing the loop on task completion → spec status (separate plan).
- Backfill specs for `/chat`, `/agents`, `/inbox`, `/today`, `/metrics`, `/clients`, `/voice`, `/changelog`, `/compression` (follow-up).
- Generalizing the skill beyond `/factory/dashboard/` (defer until at least one other repo wants it).
- Spec-to-PR automation (defer).

## Risks & known gotchas (read before executing)

- **Schema discovery is real work.** Task 1.1 must run first; the migration in 1.2 has a `<CONSTRAINT_NAME>` placeholder that depends on it.
- **`reference_docs` insert may need extra columns.** Read the latest reference_docs migration before Task 2.1; if `summary` or other NOT NULL fields exist, populate them. Already known: `kind` is FK to `reference_docs_kinds` (handled in migration 038).
- **No real DB transaction.** `createSpec` is 4 sequential inserts with best-effort rollback on failure (Task 2.1). Partial-state rows are still possible if cleanup itself fails. For real atomicity, convert to a Postgres RPC (deferred — out of scope).
- **`/api/workspace` auth is "none."** Phase 2 mirrors that. If you add bearer auth here without adding it there, the dashboard's own client calls to `/api/specs` may break.
- **Skill triggering is fuzzy.** First test in Task 4.1 step 2 may show the skill missing the trigger; iterate the description until it fires on Edmund's natural phrasing.
- **`skill_versions` schema may have moved.** Task 4.1 step 3 SELECTs columns first; don't blindly INSERT.
- **The `/workspace/specs/` route conflicts with no existing route** (verified: `dashboard/app/workspace/` only contains `page.tsx`). If a future merge adds a folder there, rebase carefully.
- **Edmund's preference**: Claude Code runs all commands. The skill must POST itself, not tell Edmund to curl.
- **Cross-page links panel only shows what `artifact_links` already records.** It does NOT auto-discover files/research that should be linked but weren't. The baseline specs (Phase 5) document these missing wires as gaps to fix in follow-up specs — that's the point.

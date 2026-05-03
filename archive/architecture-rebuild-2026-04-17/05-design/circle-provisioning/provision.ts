#!/usr/bin/env -S deno run --allow-net --allow-read --allow-env
// Circle Community Provisioning
// Reads a JSON community template and creates or updates spaces, topics, and member tags
// via the Circle Admin API v2. Uploads cover images through the direct-uploads flow.
//
// Usage:
//   deno run --allow-net --allow-read --allow-env provision.ts <template.json> [--dry-run] [--update]
//
// Env:
//   CIRCLE_ADMIN_API_TOKEN  Admin API v2 token (from Circle dashboard → Developers → Tokens)

import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { crypto as stdCrypto } from "https://deno.land/std@0.224.0/crypto/mod.ts";
import { dirname, resolve } from "https://deno.land/std@0.224.0/path/mod.ts";

const ADMIN_BASE = "https://api-headless.circle.so/api/admin/v2";
const DIRECT_UPLOAD_URL = "https://app.circle.so/api/headless/v1/direct_uploads";

const TOKEN = Deno.env.get("CIRCLE_ADMIN_API_TOKEN");
if (!TOKEN) {
  console.error("✘ CIRCLE_ADMIN_API_TOKEN is not set. Export it or source ops/.env before running.");
  Deno.exit(1);
}

const args = Deno.args;
const templatePath = args.find((a) => !a.startsWith("--"));
const dryRun = args.includes("--dry-run");
const updateMode = args.includes("--update");

if (!templatePath) {
  console.error("Usage: deno run --allow-net --allow-read --allow-env provision.ts <template.json> [--dry-run] [--update]");
  Deno.exit(1);
}

const templateAbs = resolve(templatePath);
const templateDir = dirname(templateAbs);
const template = JSON.parse(await Deno.readTextFile(templateAbs));

type IdMap = {
  space_groups: Record<string, number>;
  spaces: Record<string, number>;
  topics: Record<string, number>;
  member_tags: Record<string, number>;
  uploads: Record<string, string>;
};

const idMapPath = `${templateAbs}.id-map.json`;
let idMap: IdMap;
try {
  idMap = JSON.parse(await Deno.readTextFile(idMapPath));
} catch {
  idMap = { space_groups: {}, spaces: {}, topics: {}, member_tags: {}, uploads: {} };
}

async function api(path: string, init: RequestInit = {}): Promise<any> {
  if (dryRun) {
    console.log(`  [dry-run] ${init.method ?? "GET"} ${path}`);
    if (init.body) console.log(`  [dry-run] body:`, typeof init.body === "string" ? JSON.parse(init.body) : init.body);
    return { id: 0, dryRun: true };
  }
  const res = await fetch(`${ADMIN_BASE}${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${init.method ?? "GET"} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

function mimeFor(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return {
    jpg: "image/jpeg", jpeg: "image/jpeg",
    png: "image/png", gif: "image/gif",
    webp: "image/webp", svg: "image/svg+xml",
  }[ext] ?? "application/octet-stream";
}

async function uploadImage(relPath: string): Promise<string> {
  const cacheKey = relPath;
  if (idMap.uploads[cacheKey]) {
    console.log(`    ↻ cached upload for ${relPath}`);
    return idMap.uploads[cacheKey];
  }
  const abs = resolve(templateDir, relPath);
  const bytes = await Deno.readFile(abs);
  const filename = abs.split("/").pop() ?? "upload";
  const contentType = mimeFor(filename);

  const md5 = await stdCrypto.subtle.digest("MD5", bytes);
  const checksum = encodeBase64(new Uint8Array(md5));

  if (dryRun) {
    console.log(`    [dry-run] would upload ${relPath} (${bytes.byteLength} bytes, ${contentType})`);
    return "DRY_RUN_SIGNED_ID";
  }

  const r1 = await fetch(DIRECT_UPLOAD_URL, {
    method: "POST",
    headers: { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      blob: {
        filename,
        content_type: contentType,
        byte_size: bytes.byteLength,
        checksum,
      },
    }),
  });
  if (!r1.ok) throw new Error(`direct_uploads ${r1.status}: ${await r1.text()}`);
  const j1 = await r1.json();
  const signedId = j1.signed_id ?? j1.blob?.signed_id;
  const upload = j1.direct_upload ?? j1.blob?.direct_upload;
  if (!signedId || !upload?.url) throw new Error(`direct_uploads response missing signed_id or direct_upload: ${JSON.stringify(j1)}`);

  const r2 = await fetch(upload.url, {
    method: "PUT",
    headers: upload.headers ?? {},
    body: bytes,
  });
  if (!r2.ok) throw new Error(`S3 PUT ${r2.status}: ${await r2.text()}`);

  idMap.uploads[cacheKey] = signedId;
  console.log(`    ↑ uploaded ${relPath} → signed_id cached`);
  return signedId;
}

async function saveIdMap() {
  if (dryRun) return;
  await Deno.writeTextFile(idMapPath, JSON.stringify(idMap, null, 2));
}

// ───────────────────────────────────────────────────────────────────────
// Topics
// ───────────────────────────────────────────────────────────────────────
async function provisionTopics() {
  if (!template.topics?.length) return;
  console.log("\n━━━ Topics ━━━");
  for (const t of template.topics) {
    if (idMap.topics[t.name] && !updateMode) {
      console.log(`  ✓ ${t.name} (existing id=${idMap.topics[t.name]})`);
      continue;
    }
    const res = await api("/topics", { method: "POST", body: JSON.stringify({ topic: t }) });
    if (res.id || res.topic?.id) {
      idMap.topics[t.name] = res.id ?? res.topic.id;
      console.log(`  + ${t.name} (id=${idMap.topics[t.name]})`);
    }
  }
  await saveIdMap();
}

// ───────────────────────────────────────────────────────────────────────
// Member tags
// ───────────────────────────────────────────────────────────────────────
async function provisionMemberTags() {
  if (!template.member_tags?.length) return;
  console.log("\n━━━ Member tags ━━━");
  for (const tag of template.member_tags) {
    if (idMap.member_tags[tag.name] && !updateMode) {
      console.log(`  ✓ ${tag.name} (existing id=${idMap.member_tags[tag.name]})`);
      continue;
    }
    const res = await api("/member_tags", { method: "POST", body: JSON.stringify({ member_tag: tag }) });
    if (res.id || res.member_tag?.id) {
      idMap.member_tags[tag.name] = res.id ?? res.member_tag.id;
      console.log(`  + ${tag.name} (id=${idMap.member_tags[tag.name]})`);
    }
  }
  await saveIdMap();
}

// ───────────────────────────────────────────────────────────────────────
// Space groups
// ───────────────────────────────────────────────────────────────────────
// NOTE: The v2 Admin API OpenAPI spec lists only GET /space_groups as of 2026-04-17.
// Creating new space groups via v2 may not be supported. If POST fails, create them
// manually in the Circle UI first, then list them and let the script resolve by slug.
async function provisionSpaceGroups() {
  if (!template.space_groups?.length) return;
  console.log("\n━━━ Space groups ━━━");

  // First, list existing space groups so we can resolve by slug
  const existing = await api("/space_groups?per_page=100");
  const bySlug = new Map<string, number>();
  for (const g of existing.records ?? existing ?? []) {
    if (g.slug) bySlug.set(g.slug, g.id);
  }

  for (const g of template.space_groups) {
    const existingId = bySlug.get(g.slug);
    if (existingId) {
      idMap.space_groups[g.slug] = existingId;
      console.log(`  ✓ ${g.name} (existing id=${existingId})`);
      continue;
    }
    try {
      const res = await api("/space_groups", { method: "POST", body: JSON.stringify({ space_group: g }) });
      if (res.id || res.space_group?.id) {
        idMap.space_groups[g.slug] = res.id ?? res.space_group.id;
        console.log(`  + ${g.name} (id=${idMap.space_groups[g.slug]})`);
      }
    } catch (err) {
      console.warn(`  ⚠ cannot create space group "${g.name}" via API — create in Circle UI then re-run. (${(err as Error).message.split("\n")[0]})`);
    }
  }
  await saveIdMap();
}

// ───────────────────────────────────────────────────────────────────────
// Spaces
// ───────────────────────────────────────────────────────────────────────
// The exact request field names for image inputs are not fully documented publicly.
// This script uses the conventional pattern: pass the signed_id as `cover_image`,
// `custom_emoji`, `custom_emoji_dark`. If a create call fails with "unknown field",
// try `cover_image_signed_id` etc. — log the API response to see what the server
// expects, then update resolveImageInputs() below.
async function resolveImageInputs(space: any) {
  if (space.cover_image_path) {
    space.cover_image = await uploadImage(space.cover_image_path);
    delete space.cover_image_path;
  }
  if (space.custom_emoji_path) {
    space.custom_emoji = await uploadImage(space.custom_emoji_path);
    delete space.custom_emoji_path;
  }
  if (space.custom_emoji_dark_path) {
    space.custom_emoji_dark = await uploadImage(space.custom_emoji_dark_path);
    delete space.custom_emoji_dark_path;
  }
  if (space.meta_tag_attributes?.opengraph_image_path) {
    space.meta_tag_attributes.opengraph_image = await uploadImage(space.meta_tag_attributes.opengraph_image_path);
    delete space.meta_tag_attributes.opengraph_image_path;
  }
}

async function provisionSpaces() {
  if (!template.spaces?.length) return;
  console.log("\n━━━ Spaces ━━━");

  // Resolve topic names → ids if the template references them by name
  const topicIdByName = idMap.topics;

  for (const raw of template.spaces) {
    const space = JSON.parse(JSON.stringify(raw));
    const slug = space.slug;

    // Resolve space_group_slug → space_group_id
    if (space.space_group_slug) {
      const gid = idMap.space_groups[space.space_group_slug];
      if (gid) space.space_group_id = gid;
      delete space.space_group_slug;
    }

    // Resolve topics by name if provided as strings
    if (Array.isArray(space.topic_names)) {
      space.topics = space.topic_names.map((n: string) => topicIdByName[n]).filter(Boolean);
      delete space.topic_names;
    }

    await resolveImageInputs(space);

    const existingId = idMap.spaces[slug];
    try {
      if (existingId) {
        await api(`/spaces/${existingId}`, { method: "PUT", body: JSON.stringify({ space }) });
        console.log(`  ↻ updated ${space.name} (id=${existingId})`);
      } else {
        const res = await api("/spaces", { method: "POST", body: JSON.stringify({ space }) });
        const newId = res.id ?? res.space?.id;
        if (newId) idMap.spaces[slug] = newId;
        console.log(`  + created ${space.name} (id=${newId})`);
      }
    } catch (err) {
      console.error(`  ✘ ${space.name}: ${(err as Error).message}`);
    }
    await saveIdMap();
  }
}

// ───────────────────────────────────────────────────────────────────────
// Community-level settings
// ───────────────────────────────────────────────────────────────────────
async function provisionCommunity() {
  if (!template.community) return;
  console.log("\n━━━ Community ━━━");
  const payload: any = { ...template.community };
  if (payload.logo_path) {
    payload.logo = await uploadImage(payload.logo_path);
    delete payload.logo_path;
  }
  if (payload.icon_path) {
    payload.icon = await uploadImage(payload.icon_path);
    delete payload.icon_path;
  }
  try {
    await api("/community", { method: "PUT", body: JSON.stringify({ community: payload }) });
    console.log(`  ↻ updated community settings`);
  } catch (err) {
    console.error(`  ✘ community update: ${(err as Error).message}`);
  }
}

// ───────────────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────────────
console.log(`Provisioning from ${templatePath}${dryRun ? "  [DRY RUN]" : ""}${updateMode ? "  [UPDATE MODE]" : ""}`);
console.log(`ID map: ${idMapPath}\n`);

await provisionCommunity();
await provisionSpaceGroups();
await provisionTopics();
await provisionMemberTags();
await provisionSpaces();

console.log(`\n✓ Done. ID map written to ${idMapPath}`);

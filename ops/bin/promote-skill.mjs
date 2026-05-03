#!/usr/bin/env node
/**
 * promote-skill.mjs
 *
 * Phase 3 of the Hermes-inspired build (2026-05-03).
 *
 * Reads an APPROVED skill_versions row by id and:
 *   1. Writes its body to ~/.claude/skills/<skill_name>/SKILL.md  (creates dir if absent).
 *   2. git commits the change in ~/.claude (best-effort; if .claude isn't a git repo, skip).
 *   3. Prints a one-line JSON status to stdout for the caller (dashboard approve handler).
 *
 * Idempotent: writing the same body twice is a no-op for git but not an error.
 *
 * Zero dependencies: uses Node 18+ global fetch and Supabase REST API directly.
 *
 * Usage:
 *   node ops/bin/promote-skill.mjs <skill_version_id>
 *
 * Env (read from process.env or dashboard/.env.local):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Exit codes:
 *   0  success
 *   1  bad args / id not found / row not approved
 *   2  write or git failure
 */
import { promises as fs } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";

function loadEnvLocal() {
  const path = "/Users/edmundmitchell/factory/dashboard/.env.local";
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf-8");
  for (const line of content.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    if (process.env[m[1]]) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[m[1]] = val;
  }
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

async function fetchRow(supabaseUrl, serviceKey, id) {
  const u = `${supabaseUrl}/rest/v1/skill_versions?id=eq.${encodeURIComponent(id)}&select=id,skill_name,version,status,body,changelog,created_by,approved_by,approved_at`;
  const res = await fetch(u, {
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const arr = await res.json();
  return arr[0] ?? null;
}

async function main() {
  const id = process.argv[2];
  if (!id) {
    out({ ok: false, error: "missing skill_version_id arg" });
    process.exit(1);
  }

  loadEnvLocal();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    out({ ok: false, error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing" });
    process.exit(1);
  }

  let row;
  try { row = await fetchRow(url, key, id); }
  catch (e) { out({ ok: false, error: `db: ${e.message}` }); process.exit(1); }

  if (!row) { out({ ok: false, error: `id not found: ${id}` }); process.exit(1); }
  if (row.status !== "approved") {
    out({ ok: false, error: `row status is '${row.status}', expected 'approved'` });
    process.exit(1);
  }

  const skillName = row.skill_name.replace(/[^a-z0-9_-]/gi, "");
  if (!skillName) { out({ ok: false, error: `invalid skill_name: ${row.skill_name}` }); process.exit(1); }

  const skillsDir = join(homedir(), ".claude", "skills", skillName);
  const skillFile = join(skillsDir, "SKILL.md");

  try {
    await fs.mkdir(skillsDir, { recursive: true });
    await fs.writeFile(skillFile, row.body, "utf-8");
  } catch (e) {
    out({ ok: false, error: `write failed: ${e.message}` });
    process.exit(2);
  }

  let gitResult = "skipped (no .claude git repo)";
  const claudeGitDir = join(homedir(), ".claude", ".git");
  if (existsSync(claudeGitDir)) {
    try {
      const cwd = join(homedir(), ".claude");
      execSync(`git add ${JSON.stringify(`skills/${skillName}/SKILL.md`)}`, { cwd, stdio: "pipe" });
      const status = execSync("git status --porcelain", { cwd, stdio: "pipe" }).toString();
      if (status.trim()) {
        const msg = `skills(${skillName}): promote v${row.version} (skill_versions ${row.id})`;
        execSync(`git commit -m ${JSON.stringify(msg)}`, { cwd, stdio: "pipe" });
        gitResult = "committed";
      } else {
        gitResult = "no changes to commit (idempotent)";
      }
    } catch (e) {
      gitResult = `git failed: ${e.message.slice(0, 200)}`;
    }
  }

  out({
    ok: true,
    skill_name: skillName,
    version: row.version,
    file: skillFile,
    body_len: row.body.length,
    git: gitResult,
  });
}

main().catch((e) => {
  out({ ok: false, error: `crashed: ${e.message}` });
  process.exit(2);
});

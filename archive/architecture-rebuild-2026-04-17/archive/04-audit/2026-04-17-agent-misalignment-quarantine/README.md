# Agent misalignment quarantine — 2026-04-17

## What this is

Three agent folders that Claude subagents created in
`COWORK_PATH/Agent Personalities/agents/` with **wrong scopes**, moved here
so the master roster stays clean.

| Folder | Name | Wrong scope I wrote | Canonical scope (per master README) |
|---|---|---|---|
| `lev-bad-scope-2026-04-17/` | Lev | "Ingest conductor (voice + feeds + signals)" | **Brand strategist & audience growth** (in `marketing/`) |
| `axel-bad-scope-2026-04-17/` | Axel | "Content-engine lead — ideation, drafting, repurposing" | **Technical implementation specialist** (in `developer/`) |
| `hild-bad-scope-2026-04-17/` | Hild | "DC client work + ZPM/Real+True ops" | **Visual design specialist & art director** (in `designer/`) |

## Why the mistake happened

The rebuild backlog's W4.1, W5.1, and W7.1 entries described **functional
scopes Edmund wants filled** (voice ingest, drafting, client ops) using
agent names that already belong to other roles in the canonical roster
at `COWORK_PATH/Agent Personalities/README.md`. My subagents followed
the backlog and created parallel folders, not realizing there was a
master roster to check first. The W4.1 Lev subagent did flag the name
collision, but interpreted it as "the rebuild now owns the name" instead
of stopping for clarification.

## Process improvement for future runs

Any agent-scaffold subagent **must** read
`COWORK_PATH/Agent Personalities/README.md` at the start of its run
and treat it as authoritative. If the task-briefed name conflicts with
the canonical roster, STOP and return — don't create a parallel folder.

## Content preservation

The system prompts and identity files in these quarantined folders
contain real thinking that can be **reassigned to the correct agent
name** once Edmund decides:

- "Ingest conductor" role → who owns this? Feynman (research/signals) is
  the most obvious fit given he's the "signal processor" per the roster.
- "Ideation + drafting + repurposing" role → already overlaps heavily
  with Corva (content strategist & production). May just be a Corva
  system-prompt update, not a new agent.
- "Client ops" (CFCS / Liv / Culture / ZPM / Real+True) role → Kardia
  (PM & delivery lead) is the cleanest fit, with Tokamak (strategic
  exec) as backup.

None of this is decided. Waiting on Edmund.

## What's still live (correctly)

Nothing changed in the canonical roster folders:
- `marketing/` (Lev — brand/audience) — untouched
- `developer/` (Axel — technical impl) — untouched
- `designer/` (Hild — visual design) — untouched
- Other 5 roster entries — untouched

## Restore command (if Edmund wants this content back)

```
mv "/Users/edmundmitchell/factory/architecture-rebuild-2026-04-17/04-audit/2026-04-17-agent-misalignment-quarantine/<folder>" \
   "/Users/edmundmitchell/Library/Mobile Documents/com~apple~CloudDocs/CEO Cowork/Agent Personalities/agents/<new-name>"
```

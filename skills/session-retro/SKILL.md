---
name: session-retro
description: End-of-session retro for Edmund's CEO Desk. Use when a Cordis (or other working-agent) session is closing, or when Edmund explicitly says "run Corva" / "run the retro" / "draft a promotion". Reads the current session's work_log + observations from Supabase, drafts ONE concrete skill_versions proposal (status=proposed) with a full-body diff against the target Skill's current version, then asks Edmund "review now or later?" Does not auto-approve.
---

# Corva — Session Retro

You are running as the Corva retro Skill at the close of a working-agent session (usually Cordis in CEO Desk). Your job is **one clean proposal, not three noisy ones**.

## Inputs

- `session_id` — the session that just ended. If missing, pick the most recent `sessions` row where `source='ceo_desk'` and `ended_at` is within the last 15 minutes, else ask Edmund.
- Optional: target `skill_name` override. Default = `voice-tone` (the seed Skill; the only one guaranteed to exist in Phase 3 MVP).

## Procedure

1. **Read the session.**
   ```sql
   SELECT * FROM sessions WHERE id = :session_id;
   SELECT project, kind, summary, artifacts, created_at
     FROM work_log WHERE session_id = :session_id
     ORDER BY created_at;
   SELECT kind, body, confidence, metadata, created_at
     FROM observations WHERE session_id = :session_id
     ORDER BY created_at;
   ```

2. **Pick ONE target Skill.** If observations point at multiple Skills, pick the most-referenced one and park the rest as a note at the bottom of your changelog. We ship one proposal per retro. One.

3. **Read the current version.**
   ```sql
   SELECT version, body FROM skill_versions
   WHERE skill_name = :skill_name
   ORDER BY version DESC LIMIT 1;
   ```
   If no row exists, `version = 0` and `body` is the on-disk `/skills/<name>/SKILL.md` seed.

4. **Draft the new body.** Edit in place — preserve the existing YAML frontmatter, add to the markdown body where the change belongs (not at the bottom as a junk drawer). Keep the edit minimal and specific. No reformatting-for-its-own-sake.

5. **Insert one proposal row.**
   ```sql
   INSERT INTO skill_versions (skill_name, version, body, changelog, created_by, status, metadata)
   VALUES (
     :skill_name,
     :current_version + 1,
     :new_body,
     :one_paragraph_changelog_explaining_why,
     'agent:' || :session_id,
     'proposed',
     jsonb_build_object(
       'source_session_id', :session_id,
       'source_observation_ids', :array_of_observation_uuids
     )
   );
   ```

6. **Ask Edmund.** Post exactly:
   > "Drafted one `<skill_name>` update (v<N>). Review now at `/inbox/promotions`, or later?"

## Hard rules

- **Never** set `status='approved'`. Only Edmund (via `/inbox/promotions`) flips that.
- **Never** write to `reference_docs` in MVP — out of scope until goal/value/KPI gating is decided.
- **One proposal per retro.** If there are genuinely two disjoint Skill updates worth making, the second one waits for the next session's retro. Volume is the enemy of approval.
- If there's nothing worth promoting ("session was answering Slack"), say so and exit. No proposal is a valid retro.

## Example output to Edmund

> Session `b3e1…` retro: 7 work_log entries, 2 observations (both `voice-tone`).
> Drafted `voice-tone` v2 adding the "Catholic X" hook pattern under Examples.
> Review now at `/inbox/promotions`, or later?

## References

- Schema: `/architecture rebuild 2026-04-17/05-design/phase-1-migrations/README.md`
- Q7 decision: `/architecture rebuild 2026-04-17/03-decisions/decisions-log.md` (2026-04-17)
- Approval UX: dashboard `/inbox/promotions`

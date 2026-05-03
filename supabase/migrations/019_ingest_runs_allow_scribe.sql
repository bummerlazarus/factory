-- 019_ingest_runs_allow_scribe.sql
-- Extend ingest_runs.source_type CHECK to allow new pipeline variants.
-- Original constraint (migration 017) allowed: youtube, article, pdf, transcript, other
-- Add: youtube-scribe (ElevenLabs Scribe pipeline; preserves speaker turns + audio events)
--
-- Discovered 2026-04-30 when ingest-youtube-scribe.sh runs succeeded but ingest_runs
-- rows silently failed to insert (`|| true` swallowed the 400 from this CHECK).
-- The data landed in public.memory + public.agent_youtube_videos correctly; only the
-- run-tracking row was lost.

ALTER TABLE public.ingest_runs DROP CONSTRAINT IF EXISTS ingest_runs_source_type_check;

ALTER TABLE public.ingest_runs ADD CONSTRAINT ingest_runs_source_type_check
  CHECK (source_type = ANY (ARRAY[
    'youtube'::text,
    'youtube-scribe'::text,
    'article'::text,
    'pdf'::text,
    'transcript'::text,
    'other'::text
  ]));

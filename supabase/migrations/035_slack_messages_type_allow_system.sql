-- Allow type='system' in public.slack_messages so postMessage() can post
-- in-channel system replies (e.g. "⚠️ No agent matches [foo]") for unresolved
-- @mentions. See dashboard/lib/slack.ts.
--
-- Applied to em-edmund-mitchell (obizmgugsqirmnjpirnh) on 2026-05-03 via the
-- Supabase MCP `apply_migration` tool. This file is a record-of-truth so
-- future migrations sync correctly.

ALTER TABLE public.slack_messages DROP CONSTRAINT IF EXISTS slack_messages_type_check;
ALTER TABLE public.slack_messages ADD CONSTRAINT slack_messages_type_check
  CHECK (type = ANY (ARRAY['message'::text, 'task'::text, 'alert'::text, 'report'::text, 'system'::text]));

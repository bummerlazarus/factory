-- 030_skill_versions_status_approved_at_idx.sql
-- Speeds up the /inbox/recent-approvals digest query and the home-tile count,
-- both of which filter by status='approved' and approved_at >= now() - 7 days.

CREATE INDEX IF NOT EXISTS skill_versions_status_approved_at_idx
  ON public.skill_versions (status, approved_at DESC);

-- Migration 0174: manual_owner + in_progress_branch lock on streamlit_modules
--
-- Purpose: continuous coordinator mode must skip rows actively owned by a human
-- (manual_owner) or under an open feature branch (in_progress_branch).
-- locked_at records when the lock was set; used for TTL enforcement (>7 days = stale).
--
-- DDL only. Backfill of known active locks is performed by
-- scripts/backfill-module-locks.ts (idempotent, run separately).

ALTER TABLE public.streamlit_modules
  ADD COLUMN IF NOT EXISTS manual_owner      text,
  ADD COLUMN IF NOT EXISTS in_progress_branch text,
  ADD COLUMN IF NOT EXISTS locked_at         timestamptz;

-- Partial index: coordinator eligibility query hits this index directly.
-- Only pending, unlocked rows appear — locked rows are invisible to the planner.
CREATE INDEX IF NOT EXISTS idx_streamlit_modules_unlocked
  ON public.streamlit_modules (suggested_tier DESC, path)
  WHERE port_status = 'pending'
    AND manual_owner IS NULL
    AND in_progress_branch IS NULL;

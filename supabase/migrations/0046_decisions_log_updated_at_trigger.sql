-- 0046_decisions_log_updated_at_trigger.sql
-- Follow-on to 0044: BEFORE UPDATE trigger that maintains decisions_log.updated_at.
--
-- Reviewer-agent finding (chunk #1 ship): direct UPDATEs to columns other than
-- the supersession path (which the route handles manually) leave updated_at
-- stale. A simple trigger closes the gap with no app-layer changes required.

CREATE OR REPLACE FUNCTION public.decisions_log_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER decisions_log_updated_at
  BEFORE UPDATE ON public.decisions_log
  FOR EACH ROW EXECUTE FUNCTION public.decisions_log_set_updated_at();

-- Verify:
--   SELECT tgname FROM pg_trigger WHERE tgname = 'decisions_log_updated_at';

-- Rollback:
--   DROP TRIGGER IF EXISTS decisions_log_updated_at ON public.decisions_log;
--   DROP FUNCTION IF EXISTS public.decisions_log_set_updated_at();

-- 0066_gmail_capability.sql
-- Adds gmail.* capability domain for arms_legs autonomous Gmail access.
--
-- (1) Extend domain CHECK to include 'gmail'.
-- (2) Seed 2 gmail capabilities (search, get).
--
-- Verify:
--   SELECT capability FROM capability_registry WHERE domain = 'gmail' ORDER BY capability;
--   -- expect 2 rows: gmail.get, gmail.search

ALTER TABLE public.capability_registry
  DROP CONSTRAINT capability_registry_domain_check;

ALTER TABLE public.capability_registry
  ADD CONSTRAINT capability_registry_domain_check
  CHECK (domain IN ('fs','net','db','shell','git','secret','sandbox','tool','browser','gmail'));

-- (2) Seed gmail capabilities
INSERT INTO public.capability_registry (capability, domain, description, default_enforcement, destructive)
VALUES
  ('gmail.search', 'gmail', 'List Gmail message stubs matching a query string',        'log_only', FALSE),
  ('gmail.get',    'gmail', 'Fetch a single Gmail message with metadata or full body', 'log_only', FALSE);

-- Rollback:
-- DELETE FROM public.capability_registry WHERE domain = 'gmail';
-- ALTER TABLE public.capability_registry DROP CONSTRAINT capability_registry_domain_check;
-- ALTER TABLE public.capability_registry ADD CONSTRAINT capability_registry_domain_check
--   CHECK (domain IN ('fs','net','db','shell','git','secret','sandbox','tool','browser'));

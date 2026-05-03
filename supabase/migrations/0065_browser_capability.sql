-- 0065_browser_capability.sql
-- Adds browser.* capability domain for autonomous Puppeteer operations.
-- Part of arms_legs S5.
--
-- (1) Extend domain CHECK to include 'browser'.
-- (2) Seed 5 browser capabilities (navigate, screenshot, evaluate, click, fill).
--
-- Verify post-apply:
--   SELECT capability FROM capability_registry WHERE domain = 'browser' ORDER BY capability;
--   -- expect 5 rows: browser.click, browser.evaluate, browser.fill, browser.navigate, browser.screenshot

-- (1) Extend domain CHECK
ALTER TABLE public.capability_registry
  DROP CONSTRAINT capability_registry_domain_check;

ALTER TABLE public.capability_registry
  ADD CONSTRAINT capability_registry_domain_check
  CHECK (domain IN ('fs','net','db','shell','git','secret','sandbox','tool','browser'));

-- (2) Seed browser capabilities
INSERT INTO public.capability_registry (capability, domain, description, default_enforcement, destructive) VALUES
  ('browser.navigate',   'browser', 'Navigate to a URL and return page title + HTML',                'log_only', FALSE),
  ('browser.screenshot', 'browser', 'Navigate to a URL and return a base64 PNG screenshot',          'log_only', FALSE),
  ('browser.evaluate',   'browser', 'Navigate to a URL and evaluate a JavaScript expression',        'log_only', FALSE),
  ('browser.click',      'browser', 'Navigate to a URL and click a CSS selector',                    'log_only', FALSE),
  ('browser.fill',       'browser', 'Navigate to a URL and fill a form input via CSS selector',      'log_only', FALSE);

-- Rollback:
-- DELETE FROM public.capability_registry WHERE domain = 'browser';
-- ALTER TABLE public.capability_registry DROP CONSTRAINT capability_registry_domain_check;
-- ALTER TABLE public.capability_registry ADD CONSTRAINT capability_registry_domain_check
--   CHECK (domain IN ('fs','net','db','shell','git','secret','sandbox','tool'));

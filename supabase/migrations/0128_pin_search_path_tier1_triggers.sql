-- 0128_pin_search_path_tier1_triggers.sql
--
-- Tier 1 of the search_path audit (Supabase advisor 2026-05-06,
-- function_search_path_mutable WARN class).
--
-- Locks search_path = '' on 4 trivial trigger functions whose bodies touch
-- only NEW.* columns and pg_catalog.now(). With search_path = '', pg_catalog
-- is still implicitly searched first, so now() resolves — but we qualify it
-- explicitly per Supabase's literal guidance for unambiguous lock-down.
--
-- Idempotent: CREATE OR REPLACE preserves the existing trigger bindings.
-- No body changes beyond schema-qualification — pure security hardening.

-- 1. set_updated_at — generic updated_at trigger used by many tables
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  NEW.updated_at = pg_catalog.now();
  RETURN NEW;
END;
$function$;

-- 2. decisions_log_set_updated_at — table-specific updated_at trigger
CREATE OR REPLACE FUNCTION public.decisions_log_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$function$;

-- 3. update_oura_daily_updated_at — table-specific updated_at trigger
CREATE OR REPLACE FUNCTION public.update_oura_daily_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  NEW.updated_at = pg_catalog.now();
  RETURN NEW;
END;
$function$;

-- 4. update_conversation_on_message — bumps conversation timestamp + count
--    when a new message row is inserted. Schema-qualified target table.
CREATE OR REPLACE FUNCTION public.update_conversation_on_message()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  UPDATE public.conversations
  SET updated_at    = pg_catalog.now(),
      message_count = message_count + 1
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$function$;

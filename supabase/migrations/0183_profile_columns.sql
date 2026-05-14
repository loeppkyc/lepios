-- MID batch 2: add display_name + module_preferences to user_profiles
-- user_profiles table created in 0138_user_profiles_and_invites.sql

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS display_name    text,
  ADD COLUMN IF NOT EXISTS module_prefs    jsonb NOT NULL DEFAULT '[]'::jsonb;

-- No new table — ALTER only. 
-- AD7-exempt

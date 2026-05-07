-- Phase 1 of security lockdown.
-- Adds invite-gated, role-pending account model matching the Streamlit baseline.
-- Pre-existing RLS policies (auth.uid() IS NOT NULL) remain untouched here;
-- migration 0139 rewrites them to use the helpers introduced below.

-- ── Roles enum ──────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE public.user_role AS ENUM ('admin', 'business', 'personal', 'accountant', 'pending');
  END IF;
END $$;

-- ── user_profiles ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_profiles (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       text NOT NULL,
  role        public.user_role NOT NULL DEFAULT 'pending',
  created_at  timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  approved_by uuid REFERENCES auth.users(id),
  notes       text
);

CREATE INDEX IF NOT EXISTS user_profiles_role_idx ON public.user_profiles(role);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- ── Auto-create profile on auth.users INSERT ────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  INSERT INTO public.user_profiles (user_id, email, role)
  VALUES (NEW.id, NEW.email, 'pending')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── Seed Colin as admin (idempotent) ────────────────────────────────────
INSERT INTO public.user_profiles (user_id, email, role, approved_at)
SELECT id, email, 'admin'::public.user_role, now()
FROM auth.users
WHERE email = 'loeppkycolin@gmail.com'
ON CONFLICT (user_id) DO UPDATE
  SET role = 'admin',
      email = EXCLUDED.email,
      approved_at = COALESCE(public.user_profiles.approved_at, now());

-- ── invite_codes ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invite_codes (
  code        text PRIMARY KEY,
  max_uses    integer NOT NULL DEFAULT 1,
  uses_count  integer NOT NULL DEFAULT 0,
  expires_at  timestamptz,
  created_by  uuid NOT NULL REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  note        text,
  CONSTRAINT max_uses_positive  CHECK (max_uses > 0),
  CONSTRAINT uses_within_limit  CHECK (uses_count <= max_uses)
);

CREATE INDEX IF NOT EXISTS invite_codes_active_idx
  ON public.invite_codes(code) WHERE uses_count < max_uses;

ALTER TABLE public.invite_codes ENABLE ROW LEVEL SECURITY;

-- ── Role helpers (SECURITY DEFINER, STABLE) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.user_role
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
STABLE
AS $$
  SELECT role FROM public.user_profiles WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = auth.uid() AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.has_business_access()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = auth.uid()
      AND role IN ('admin', 'business', 'accountant')
  );
$$;

CREATE OR REPLACE FUNCTION public.has_personal_access()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = auth.uid()
      AND role IN ('admin', 'personal', 'accountant')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_approved()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = auth.uid()
      AND role <> 'pending'
  );
$$;

GRANT EXECUTE ON FUNCTION public.current_user_role()    TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin()             TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_business_access()  TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_personal_access()  TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_approved()          TO authenticated;

-- ── RLS policies for user_profiles ──────────────────────────────────────
DROP POLICY IF EXISTS user_profiles_self_read   ON public.user_profiles;
DROP POLICY IF EXISTS user_profiles_admin_read  ON public.user_profiles;
DROP POLICY IF EXISTS user_profiles_admin_write ON public.user_profiles;

CREATE POLICY user_profiles_self_read
  ON public.user_profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY user_profiles_admin_read
  ON public.user_profiles FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY user_profiles_admin_write
  ON public.user_profiles FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ── RLS policies for invite_codes ───────────────────────────────────────
DROP POLICY IF EXISTS invite_codes_admin_all ON public.invite_codes;

CREATE POLICY invite_codes_admin_all
  ON public.invite_codes FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ── Atomic invite consumption (used by signup flow) ─────────────────────
-- Returns true if the code was successfully consumed (incremented uses_count).
-- Returns false if the code is missing, expired, or already exhausted.
-- SECURITY DEFINER so it can run before auth.uid() is set (during signup).
CREATE OR REPLACE FUNCTION public.consume_invite_code(p_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.invite_codes
     SET uses_count = uses_count + 1
   WHERE code = p_code
     AND uses_count < max_uses
     AND (expires_at IS NULL OR expires_at > now());

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_invite_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_invite_code(text) TO anon, authenticated;

-- ── Lock down direct table access from anon ─────────────────────────────
REVOKE ALL ON public.user_profiles FROM anon;
REVOKE ALL ON public.invite_codes  FROM anon;

COMMENT ON TABLE public.user_profiles IS
  'Per-user role + approval state. New users land here as ''pending'' via trigger; admin promotes them. RLS gates everything else by role helper functions.';
COMMENT ON TABLE public.invite_codes IS
  'Invite-only signup. Admin creates codes; signup flow calls consume_invite_code() before auth.signUp.';

-- Allow authenticated users to read non-secret harness_config rows.
-- The Systems page gauges (gpu_day_score, orb_day_score, business_review_pct)
-- use the user supabase client which is RLS-scoped. Without this policy,
-- all reads return empty and every gauge shows null.
-- Secret rows (is_secret = true) remain invisible to user-scoped clients.
CREATE POLICY "authenticated_read_non_secret_config"
ON harness_config
FOR SELECT
TO authenticated
USING (is_secret = false OR is_secret IS NULL);

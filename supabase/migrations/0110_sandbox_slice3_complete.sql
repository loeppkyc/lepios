-- 0110_sandbox_slice3_complete.sql
-- Sandbox Slice 3: HTTP endpoint live. process_isolation N/A on Vercel (honest 85% ceiling).
-- Note: acceptance doc specified slot 0107 but that slot was already taken by
-- 0107_orders_amazon_order_id.sql. Using next free slot 0110.

UPDATE public.harness_components
SET
  completion_pct = 85,
  notes = 'Slice 3 shipped: POST /api/harness/sandbox-run live. Sub-systems: runtime_worktree(30%) + fs_diff_capture(20%) + audit_log(20%) + boundary_check_wired(15%) = 85%. process_isolation(15%) permanently 0% on Vercel (no Docker). push_bash_automation sandbox gate lifted.',
  updated_at = now()
WHERE id = 'harness:sandbox';

UPDATE public.harness_components
SET
  notes = 'Sandbox gate lifted (sandbox 85%, HTTP endpoint live). security_layer gate already clear (100%). Ready for push_bash_automation implementation.',
  updated_at = now()
WHERE id = 'harness:push_bash_automation';

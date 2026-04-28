-- 0043_harness_foundation_renormalize.sql
-- Reseat harness_components from HARNESS_FOUNDATION_SPEC.md (doc-as-source).
-- Spec: docs/harness/HARNESS_FOUNDATION_SPEC.md (Draft 2 approved 2026-04-28).
--
-- Changes:
-- 1. Replace 24 drifted rows (sum 112) with 21 spec rows (sum 100).
-- 2. Collapse coordinator_core+coordinator_env+branch_naming → coordinator_loop.
--    Collapse twin_corpus+twin_fts+twin_ollama → digital_twin.
--    Collapse telegram_timeouts+telegram_remaining+telegram_drain_hourly → telegram_outbound.
-- 3. Add 8 new agentic-capability rows (T3 + T4: arms_legs, sandbox, security_layer,
--    self_repair, specialized_agents, push_bash_automation, debate_consensus, chat_ui).
-- 4. Move 7 product rows to new product_components table.
--
-- Expected post-migration:
--   harness_components: 21 rows, SUM(weight_pct) = 100, rollup ≈ 55.7%
--   product_components: 7 rows, SUM(weight_pct) = 14 (rebalance follow-on)
--
-- Verify with:
--   SELECT COUNT(*), SUM(weight_pct) FROM harness_components;
--   SELECT COUNT(*), SUM(weight_pct) FROM product_components;

-- ── product_components table ─────────────────────────────────────────────────

CREATE TABLE public.product_components (
  id              TEXT PRIMARY KEY,
  display_name    TEXT        NOT NULL,
  weight_pct      NUMERIC(5,2) NOT NULL
                  CHECK (weight_pct >= 0 AND weight_pct <= 100),
  completion_pct  NUMERIC(5,2) NOT NULL DEFAULT 0
                  CHECK (completion_pct >= 0 AND completion_pct <= 100),
  notes           TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.product_components IS
  'LepiOS product-feature rollup model. Sibling of harness_components. '
  'Tracks app modules (Amazon, Streamlit rebuild pages, etc.) separate from '
  'harness/build-system infrastructure. Weights start drifted (sum=14); '
  'rebalance to 100 in a follow-on migration when product roadmap stabilises.';

ALTER TABLE public.product_components ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_components_authenticated" ON public.product_components
  FOR ALL
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- ── seed product_components from current harness drift ───────────────────────

INSERT INTO public.product_components
  (id, display_name, weight_pct, completion_pct, notes)
VALUES
  ('product:amazon_orders_sync',                'Amazon orders sync cron',                4, 100, 'Migrated from harness:amazon_orders_sync (0043)'),
  ('product:amazon_settlements_sync',           'Amazon settlements sync cron',           4, 100, 'Migrated from harness:amazon_settlements_sync (0043)'),
  ('product:amazon_reports_view',               'Amazon reports view (/amazon page)',     1,   0, 'Migrated from harness:amazon_reports_view (0043)'),
  ('product:streamlit_module_scanner',          'Streamlit module scanner',               1, 100, 'Migrated from harness:streamlit_module_scanner (0043)'),
  ('product:streamlit_rebuild_utility_tracker', 'Streamlit rebuild — Utility Tracker',    1, 100, 'Migrated from harness:streamlit_rebuild_utility_tracker (0043)'),
  ('product:tax_sanity',                        'Tax sanity check',                       1, 100, 'Migrated from harness:tax_sanity (0043) — digest signal about business data'),
  ('product:prestaged_tasks',                   'Pre-staged tasks tracker',               2,  66, 'Migrated from harness:prestaged_tasks (0043) — meta tracker');

-- ── reseat harness_components ────────────────────────────────────────────────
-- DELETE all 24 drifted rows; INSERT 21 spec rows. No FKs reference this table
-- (verified via pg_constraint 2026-04-28).

DELETE FROM public.harness_components;

-- T1 — Core orchestration (24 weight, all shipped)
INSERT INTO public.harness_components
  (id, display_name, weight_pct, completion_pct, notes)
VALUES
  ('harness:coordinator_loop',     'Coordinator/builder loop',                  12, 100, 'Collapses coordinator_core + coordinator_env + branch_naming (0043)'),
  ('harness:task_pickup',          'Task pickup',                                5, 100, NULL),
  ('harness:remote_invocation',    'Remote invocation',                          4, 100, NULL),
  ('harness:deploy_gate',          'Deploy gate',                                3, 100, NULL);

-- T2 — Observability + improvement (16 weight)
INSERT INTO public.harness_components
  (id, display_name, weight_pct, completion_pct, notes)
VALUES
  ('harness:stall_detection',      'Stall detection (T1-T5)',                    3, 100, NULL),
  ('harness:notification_drain',   'Notification drain + dedup',                 3, 100, NULL),
  ('harness:f18_surfacing',        'F18 surfacing',                              3, 100, NULL),
  ('harness:improvement_loop',     '20% Better feedback loop',                   4, 100, NULL),
  ('harness:smoke_test_framework', 'Smoke test framework',                       3,  90, 'Per-module coverage incomplete (F-L11 / F-L6)');

-- T3 — Agentic capabilities (45 weight) — the unlock
INSERT INTO public.harness_components
  (id, display_name, weight_pct, completion_pct, notes)
VALUES
  ('harness:arms_legs',             'Arms & legs (file/shell/HTTP/browser)',     9,  30, 'Scattered today; needs unified contract under lib/harness/arms-legs/*'),
  ('harness:sandbox',               'Sandbox (isolated execution)',              7,   0, 'Worktree primitive exists in .claude/worktrees/; not yet hardened'),
  ('harness:security_layer',        'Security layer (capability + audit)',       7,  30, 'Branch guard + secrets rules; missing capability scope + audit trail'),
  ('harness:self_repair',           'Self-repair loop',                          6,   0, 'Gated on sandbox + security_layer'),
  ('harness:digital_twin',          'Digital Twin Q&A',                          6,  85, 'Collapses twin_corpus + twin_fts + twin_ollama (0043). Corpus gap = next +10%'),
  ('harness:specialized_agents',    'Specialized agents (planner/reviewer/etc)', 5,  40, 'Coordinator + builder shipped; reviewer/planner/deployer pending'),
  ('harness:push_bash_automation',  'Push/bash auto-decide',                     3,   0, 'Gated on sandbox + security_layer'),
  ('harness:debate_consensus',      'Debate / consensus before action',          2,  10, '/stochastic-consensus skill exists; not wired into harness decision points');

-- T4 — Interfaces + attribution (15 weight)
INSERT INTO public.harness_components
  (id, display_name, weight_pct, completion_pct, notes)
VALUES
  ('harness:chat_ui',               'Chat UI (claude.ai-style local)',           6,   0, 'Gated on arms_legs + digital_twin. Tracked in docs/orb-readiness.md'),
  ('harness:telegram_outbound',     'Telegram outbound + thumbs',                4,  50, 'Collapses telegram_timeouts + telegram_remaining + telegram_drain_hourly (0043)'),
  ('harness:attribution',           'Attribution (branch + actor)',              3,  30, 'Branch naming shipped; per-commit/PR attribution pending'),
  ('harness:ollama_daytime',        'Ollama daytime tick',                       2,  50, 'Tunnel live; daytime scheduler + work-routing pending');

-- ── invariant check (advisory, not enforced) ─────────────────────────────────
-- After this migration: SELECT SUM(weight_pct) FROM harness_components → 100.00
-- The rollup formula normalises by SUM, so off-by-rounding is tolerated, but
-- treat any SUM ≠ 100 as drift to investigate.

-- Rollback:
--   DELETE FROM public.harness_components;
--   DELETE FROM public.product_components;
--   DROP TABLE public.product_components;
--   -- then re-run 0032 + 0036 + 0037 + 0038 + 0040 to restore prior state.

-- Phase 2 of security lockdown.
-- Replaces every "auth.uid() IS NOT NULL" / "auth.role() = 'authenticated'" / "true"
-- policy on public tables with role-based gates that defer to the helpers
-- introduced in 0138 (is_admin, has_business_access).
--
-- Tier mapping:
--   admin-only      → harness, agent, knowledge, decisions, queue, sessions internals
--   business-or-up  → financial, transactional, business operations data
--
-- Already-correct policies are NOT touched:
--   public.user_profiles        (admin/self-scoped, created in 0138)
--   public.invite_codes         (admin-only, created in 0138)
--   public.conversations        (user_id = auth.uid())
--   public.messages             (joined via conversations)
--   public.utility_bills        (service_role only)

-- ── Helper: drop-then-create with safety ────────────────────────────────
-- We DROP each policy by name to ensure idempotency and a clean rewrite.

-- ════════════════════════════════════════════════════════════════════════
-- Admin-only tier
-- ════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS agent_actions_insert ON public.agent_actions;
DROP POLICY IF EXISTS agent_actions_select ON public.agent_actions;
CREATE POLICY agent_actions_admin_select ON public.agent_actions
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY agent_actions_admin_insert ON public.agent_actions
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS agent_capabilities_select ON public.agent_capabilities;
CREATE POLICY agent_capabilities_admin_select ON public.agent_capabilities
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS agent_events_insert_authenticated ON public.agent_events;
DROP POLICY IF EXISTS agent_events_read ON public.agent_events;
CREATE POLICY agent_events_admin_select ON public.agent_events
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY agent_events_admin_insert ON public.agent_events
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS attribution_log_authenticated ON public.attribution_log;
CREATE POLICY attribution_log_admin_select ON public.attribution_log
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS auto_proceed_patterns_authenticated ON public.auto_proceed_patterns;
CREATE POLICY auto_proceed_patterns_admin_all ON public.auto_proceed_patterns
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS capability_registry_select ON public.capability_registry;
CREATE POLICY capability_registry_admin_select ON public.capability_registry
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS decisions_log_authenticated ON public.decisions_log;
CREATE POLICY decisions_log_admin_all ON public.decisions_log
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS harness_components_authenticated ON public.harness_components;
CREATE POLICY harness_components_admin_all ON public.harness_components
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS idea_inbox_authenticated ON public.idea_inbox;
CREATE POLICY idea_inbox_admin_all ON public.idea_inbox
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS keepa_history_cache_authenticated ON public.keepa_history_cache;
CREATE POLICY keepa_history_cache_admin_all ON public.keepa_history_cache
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS knowledge_authenticated ON public.knowledge;
CREATE POLICY knowledge_admin_all ON public.knowledge
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS knowledge_dedupe_audit_insert ON public.knowledge_dedupe_audit;
DROP POLICY IF EXISTS knowledge_dedupe_audit_select ON public.knowledge_dedupe_audit;
CREATE POLICY knowledge_dedupe_audit_admin_select ON public.knowledge_dedupe_audit
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY knowledge_dedupe_audit_admin_insert ON public.knowledge_dedupe_audit
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS outbound_notifications_authenticated ON public.outbound_notifications;
CREATE POLICY outbound_notifications_admin_all ON public.outbound_notifications
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS people_read_authenticated ON public.people;
CREATE POLICY people_admin_select ON public.people
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS product_components_authenticated ON public.product_components;
CREATE POLICY product_components_admin_all ON public.product_components
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS self_repair_watchlist_authenticated ON public.self_repair_watchlist;
CREATE POLICY self_repair_watchlist_admin_all ON public.self_repair_watchlist
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS session_digests_authenticated ON public.session_digests;
CREATE POLICY session_digests_admin_all ON public.session_digests
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "authenticated can read handoffs" ON public.session_handoffs;
CREATE POLICY session_handoffs_admin_select ON public.session_handoffs
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS task_queue_authenticated ON public.task_queue;
CREATE POLICY task_queue_admin_all ON public.task_queue
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS twin_escalations_authenticated ON public.twin_escalations;
CREATE POLICY twin_escalations_admin_all ON public.twin_escalations
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Health data — admin-only too (Streamlit gated this behind extra password).
DROP POLICY IF EXISTS "authenticated users can read oura_daily" ON public.oura_daily;
CREATE POLICY oura_daily_admin_select ON public.oura_daily
  FOR SELECT TO authenticated USING (public.is_admin());

-- ════════════════════════════════════════════════════════════════════════
-- Business-or-higher tier (admin / business / accountant)
-- ════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Authenticated users can manage opening balances" ON public.account_opening_balances;
CREATE POLICY account_opening_balances_business ON public.account_opening_balances
  FOR ALL TO authenticated USING (public.has_business_access()) WITH CHECK (public.has_business_access());

DROP POLICY IF EXISTS amazon_settlements_authenticated ON public.amazon_settlements;
CREATE POLICY amazon_settlements_business ON public.amazon_settlements
  FOR ALL TO authenticated USING (public.has_business_access()) WITH CHECK (public.has_business_access());

DROP POLICY IF EXISTS "Authenticated users can manage balance sheet" ON public.balance_sheet_entries;
CREATE POLICY balance_sheet_entries_business ON public.balance_sheet_entries
  FOR ALL TO authenticated USING (public.has_business_access()) WITH CHECK (public.has_business_access());

DROP POLICY IF EXISTS bank_imports_authenticated ON public.bank_imports;
CREATE POLICY bank_imports_business ON public.bank_imports
  FOR ALL TO authenticated USING (public.has_business_access()) WITH CHECK (public.has_business_access());

DROP POLICY IF EXISTS bets_authenticated ON public.bets;
CREATE POLICY bets_business ON public.bets
  FOR ALL TO authenticated USING (public.has_business_access()) WITH CHECK (public.has_business_access());

DROP POLICY IF EXISTS business_expenses_authenticated ON public.business_expenses;
CREATE POLICY business_expenses_business ON public.business_expenses
  FOR ALL TO authenticated USING (public.has_business_access()) WITH CHECK (public.has_business_access());

DROP POLICY IF EXISTS chart_of_accounts_authenticated ON public.chart_of_accounts;
CREATE POLICY chart_of_accounts_business ON public.chart_of_accounts
  FOR ALL TO authenticated USING (public.has_business_access()) WITH CHECK (public.has_business_access());

DROP POLICY IF EXISTS daily_metrics_authenticated ON public.daily_metrics;
CREATE POLICY daily_metrics_business ON public.daily_metrics
  FOR ALL TO authenticated USING (public.has_business_access()) WITH CHECK (public.has_business_access());

DROP POLICY IF EXISTS deals_authenticated ON public.deals;
CREATE POLICY deals_business ON public.deals
  FOR ALL TO authenticated USING (public.has_business_access()) WITH CHECK (public.has_business_access());

DROP POLICY IF EXISTS gst_hst_filings_authenticated ON public.gst_hst_filings;
CREATE POLICY gst_hst_filings_business ON public.gst_hst_filings
  FOR ALL TO authenticated USING (public.has_business_access()) WITH CHECK (public.has_business_access());

DROP POLICY IF EXISTS hit_list_items_authenticated ON public.hit_list_items;
CREATE POLICY hit_list_items_business ON public.hit_list_items
  FOR ALL TO authenticated USING (public.has_business_access()) WITH CHECK (public.has_business_access());

DROP POLICY IF EXISTS hit_lists_authenticated ON public.hit_lists;
CREATE POLICY hit_lists_business ON public.hit_lists
  FOR ALL TO authenticated USING (public.has_business_access()) WITH CHECK (public.has_business_access());

DROP POLICY IF EXISTS "Authenticated users can manage inventory snapshots" ON public.inventory_snapshots;
CREATE POLICY inventory_snapshots_business ON public.inventory_snapshots
  FOR ALL TO authenticated USING (public.has_business_access()) WITH CHECK (public.has_business_access());

DROP POLICY IF EXISTS journal_entries_authenticated ON public.journal_entries;
CREATE POLICY journal_entries_business ON public.journal_entries
  FOR ALL TO authenticated USING (public.has_business_access()) WITH CHECK (public.has_business_access());

DROP POLICY IF EXISTS journal_entry_lines_authenticated ON public.journal_entry_lines;
CREATE POLICY journal_entry_lines_business ON public.journal_entry_lines
  FOR ALL TO authenticated USING (public.has_business_access()) WITH CHECK (public.has_business_access());

DROP POLICY IF EXISTS "Authenticated users can manage life milestones" ON public.life_milestones;
CREATE POLICY life_milestones_business ON public.life_milestones
  FOR ALL TO authenticated USING (public.has_business_access()) WITH CHECK (public.has_business_access());

DROP POLICY IF EXISTS mileage_log_authenticated ON public.mileage_log;
CREATE POLICY mileage_log_business ON public.mileage_log
  FOR ALL TO authenticated USING (public.has_business_access()) WITH CHECK (public.has_business_access());

DROP POLICY IF EXISTS "Authenticated users can manage monthly closes" ON public.monthly_closes;
CREATE POLICY monthly_closes_business ON public.monthly_closes
  FOR ALL TO authenticated USING (public.has_business_access()) WITH CHECK (public.has_business_access());

DROP POLICY IF EXISTS "Authenticated users can manage net worth snapshots" ON public.net_worth_snapshots;
DROP POLICY IF EXISTS nw_snapshots_authenticated ON public.net_worth_snapshots;
CREATE POLICY net_worth_snapshots_business ON public.net_worth_snapshots
  FOR ALL TO authenticated USING (public.has_business_access()) WITH CHECK (public.has_business_access());

DROP POLICY IF EXISTS orders_authenticated ON public.orders;
CREATE POLICY orders_business ON public.orders
  FOR ALL TO authenticated USING (public.has_business_access()) WITH CHECK (public.has_business_access());

DROP POLICY IF EXISTS payouts_authenticated ON public.payouts;
CREATE POLICY payouts_business ON public.payouts
  FOR ALL TO authenticated USING (public.has_business_access()) WITH CHECK (public.has_business_access());

DROP POLICY IF EXISTS pending_transactions_authenticated ON public.pending_transactions;
CREATE POLICY pending_transactions_business ON public.pending_transactions
  FOR ALL TO authenticated USING (public.has_business_access()) WITH CHECK (public.has_business_access());

DROP POLICY IF EXISTS products_authenticated ON public.products;
CREATE POLICY products_business ON public.products
  FOR ALL TO authenticated USING (public.has_business_access()) WITH CHECK (public.has_business_access());

DROP POLICY IF EXISTS receipts_authenticated ON public.receipts;
CREATE POLICY receipts_business ON public.receipts
  FOR ALL TO authenticated USING (public.has_business_access()) WITH CHECK (public.has_business_access());

DROP POLICY IF EXISTS recurring_templates_authenticated ON public.recurring_expense_templates;
CREATE POLICY recurring_templates_business ON public.recurring_expense_templates
  FOR ALL TO authenticated USING (public.has_business_access()) WITH CHECK (public.has_business_access());

DROP POLICY IF EXISTS "Authenticated users can manage savings goals" ON public.savings_goals;
CREATE POLICY savings_goals_business ON public.savings_goals
  FOR ALL TO authenticated USING (public.has_business_access()) WITH CHECK (public.has_business_access());

DROP POLICY IF EXISTS scan_results_authenticated ON public.scan_results;
CREATE POLICY scan_results_business ON public.scan_results
  FOR ALL TO authenticated USING (public.has_business_access()) WITH CHECK (public.has_business_access());

DROP POLICY IF EXISTS statement_coverage_overrides_authenticated ON public.statement_coverage_overrides;
CREATE POLICY statement_coverage_overrides_business ON public.statement_coverage_overrides
  FOR ALL TO authenticated USING (public.has_business_access()) WITH CHECK (public.has_business_access());

DROP POLICY IF EXISTS statement_lines_authenticated ON public.statement_lines;
CREATE POLICY statement_lines_business ON public.statement_lines
  FOR ALL TO authenticated USING (public.has_business_access()) WITH CHECK (public.has_business_access());

DROP POLICY IF EXISTS trades_authenticated ON public.trades;
CREATE POLICY trades_business ON public.trades
  FOR ALL TO authenticated USING (public.has_business_access()) WITH CHECK (public.has_business_access());

DROP POLICY IF EXISTS transactions_authenticated ON public.transactions;
CREATE POLICY transactions_business ON public.transactions
  FOR ALL TO authenticated USING (public.has_business_access()) WITH CHECK (public.has_business_access());

DROP POLICY IF EXISTS "Authenticated users can manage vehicle maintenance" ON public.vehicle_maintenance;
CREATE POLICY vehicle_maintenance_business ON public.vehicle_maintenance
  FOR ALL TO authenticated USING (public.has_business_access()) WITH CHECK (public.has_business_access());

DROP POLICY IF EXISTS "Authenticated users can manage vehicles" ON public.vehicles;
CREATE POLICY vehicles_business ON public.vehicles
  FOR ALL TO authenticated USING (public.has_business_access()) WITH CHECK (public.has_business_access());

DROP POLICY IF EXISTS vendor_rules_authenticated ON public.vendor_rules;
CREATE POLICY vendor_rules_business ON public.vendor_rules
  FOR ALL TO authenticated USING (public.has_business_access()) WITH CHECK (public.has_business_access());

COMMENT ON FUNCTION public.is_admin()             IS 'Returns true iff caller has user_profiles.role = admin. Used by RLS policies on harness/agent/knowledge tables.';
COMMENT ON FUNCTION public.has_business_access()  IS 'Returns true iff caller has user_profiles.role IN (admin, business, accountant). Used by RLS policies on financial tables.';

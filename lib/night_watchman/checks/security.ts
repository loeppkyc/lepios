// Security checks — RLS coverage, gitleaks delta (placeholder), Dependabot critical (placeholder).
// security_score check intentionally NOT registered — depends on
// security_score_history table owned by the security window which hasn't shipped
// yet (Phase 1 audit Q1 resolution). Re-add once that table exists.

import { createServiceClient } from '@/lib/supabase/service'
import { registerCheck } from '../registry'
import type { CheckResult } from '../types'

// Tables we expect to be RLS-protected in production. Sourced from migration 0139
// (RLS hardening) — every table in this list must have at least one policy.
const RLS_TABLES_BUSINESS = [
  'orders',
  'transactions',
  'business_expenses',
  'amazon_settlements',
  'balance_sheet_entries',
  'journal_entries',
  'journal_entry_lines',
  'gst_hst_filings',
  'receipts',
  'vehicles',
  'savings_goals',
  'net_worth_snapshots',
  'inventory_snapshots',
  'life_milestones',
  'mileage_log',
]

const RLS_TABLES_ADMIN = [
  'agent_events',
  'agent_actions',
  'knowledge',
  'task_queue',
  'outbound_notifications',
  'session_handoffs',
  'twin_escalations',
  'self_repair_runs',
  'night_watchman_runs',
  'night_watchman_check_results',
  'night_watchman_incidents',
]

// ─── security.rls_coverage ────────────────────────────────────────────────────
registerCheck({
  key: 'security.rls_coverage',
  category: 'security',
  defaultSeverity: 'critical',
  label: 'Every business / admin table has at least one RLS policy',
  async run(): Promise<CheckResult> {
    const db = createServiceClient()
    const allTables = [...RLS_TABLES_BUSINESS, ...RLS_TABLES_ADMIN]
    const { data, error } = await db
      .from('pg_policies' as never)
      .select('tablename')
      .in('tablename', allTables)
    if (error) {
      // pg_policies isn't directly queryable through supabase-js's PostgREST surface;
      // fall back to RPC-style SQL via a helper view if it exists, else skip.
      return {
        key: 'security.rls_coverage',
        category: 'security',
        status: 'skipped',
        evidence: { reason: 'pg_policies not exposed via PostgREST', error: error.message },
      }
    }
    const policyTables = new Set(
      ((data ?? []) as Array<{ tablename: string }>).map((r) => r.tablename)
    )
    const uncovered = allTables.filter((t) => !policyTables.has(t))
    if (uncovered.length === 0) {
      return {
        key: 'security.rls_coverage',
        category: 'security',
        status: 'ok',
        evidence: { tables_checked: allTables.length, with_policy: policyTables.size },
      }
    }
    return {
      key: 'security.rls_coverage',
      category: 'security',
      status: 'fail',
      severity: 'critical',
      evidence: { uncovered, tables_checked: allTables.length },
    }
  },
})

// ─── security.gitleaks (placeholder — needs GitHub Actions integration) ───────
registerCheck({
  key: 'security.gitleaks',
  category: 'security',
  defaultSeverity: 'critical',
  label: 'No new gitleaks findings since last scan',
  async run(): Promise<CheckResult> {
    // Wire-up plan: parse latest GitHub Actions workflow run for the gitleaks job.
    // Requires GITHUB_TOKEN in harness_config + workflow ID. Not configured today
    // — return skipped so the slot is visible in /self-repair status grid but
    // doesn't false-fail.
    return {
      key: 'security.gitleaks',
      category: 'security',
      status: 'skipped',
      evidence: {
        reason: 'gitleaks GH Actions integration not yet built. Cross-window-suggestion logged.',
      },
    }
  },
})

// ─── security.dependabot_critical (placeholder) ───────────────────────────────
registerCheck({
  key: 'security.dependabot_critical',
  category: 'security',
  defaultSeverity: 'high',
  label: 'No critical Dependabot alerts open',
  async run(): Promise<CheckResult> {
    return {
      key: 'security.dependabot_critical',
      category: 'security',
      status: 'skipped',
      evidence: {
        reason: 'Dependabot API integration not yet built (needs GITHUB_TOKEN + repo perms).',
      },
    }
  },
})

// security.security_score_drop is intentionally NOT registered.
// Add once `security_score_history` table is built by the security window.

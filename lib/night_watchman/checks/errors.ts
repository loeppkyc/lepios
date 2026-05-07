// Errors checks — Sentry new issue count, build / deploy state.
// Sentry uses REST API directly (token from harness_config). MCP isn't
// usable from a cron context, only from Claude Code IDE.

import { createServiceClient } from '@/lib/supabase/service'
import { registerCheck } from '../registry'
import type { CheckResult } from '../types'

async function readConfig(key: string): Promise<string | null> {
  try {
    const db = createServiceClient()
    const { data } = await db
      .from('harness_config')
      .select('value')
      .eq('key', key)
      .maybeSingle<{ value: string }>()
    return data?.value ?? null
  } catch {
    return null
  }
}

// ─── errors.sentry_new_issues ────────────────────────────────────────────────
registerCheck({
  key: 'errors.sentry_new_issues',
  category: 'errors',
  defaultSeverity: 'medium',
  label: 'No new Sentry issues opened in the last hour',
  async run(): Promise<CheckResult> {
    const token = await readConfig('SENTRY_API_TOKEN')
    const org = await readConfig('SENTRY_ORG_SLUG')
    const project = await readConfig('SENTRY_PROJECT_SLUG')
    if (!token || !org || !project) {
      return {
        key: 'errors.sentry_new_issues',
        category: 'errors',
        status: 'skipped',
        evidence: {
          reason: 'Sentry config missing',
          missing: [
            !token && 'SENTRY_API_TOKEN',
            !org && 'SENTRY_ORG_SLUG',
            !project && 'SENTRY_PROJECT_SLUG',
          ].filter(Boolean),
        },
      }
    }
    try {
      const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      const url = `https://sentry.io/api/0/projects/${org}/${project}/issues/?statsPeriod=1h&query=is:unresolved age:-1h`
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) {
        return {
          key: 'errors.sentry_new_issues',
          category: 'errors',
          status: 'warn',
          severity: 'low',
          evidence: { http_status: res.status, since },
        }
      }
      const issues = (await res.json()) as Array<{ id: string; title: string; level: string }>
      const critical = issues.filter((i) => i.level === 'error' || i.level === 'fatal')
      if (critical.length > 0) {
        return {
          key: 'errors.sentry_new_issues',
          category: 'errors',
          status: 'fail',
          severity: critical.length > 5 ? 'high' : 'medium',
          evidence: {
            count: critical.length,
            sample: critical.slice(0, 3).map((i) => ({ id: i.id, title: i.title })),
          },
        }
      }
      return {
        key: 'errors.sentry_new_issues',
        category: 'errors',
        status: 'ok',
        evidence: { issues_total: issues.length, critical: 0, since },
      }
    } catch (err) {
      return {
        key: 'errors.sentry_new_issues',
        category: 'errors',
        status: 'warn',
        severity: 'low',
        evidence: { error: err instanceof Error ? err.message : String(err) },
      }
    }
  },
})

// ─── errors.deploy_state ──────────────────────────────────────────────────────
// Most-recent Vercel deployment for main must be in READY state.
registerCheck({
  key: 'errors.deploy_state',
  category: 'errors',
  defaultSeverity: 'high',
  label: 'Latest production deployment is READY',
  async run(): Promise<CheckResult> {
    const token = await readConfig('VERCEL_TOKEN')
    const projectId = await readConfig('VERCEL_PROJECT_ID')
    if (!token || !projectId) {
      return {
        key: 'errors.deploy_state',
        category: 'errors',
        status: 'skipped',
        evidence: { reason: 'VERCEL_TOKEN / VERCEL_PROJECT_ID not in harness_config' },
      }
    }
    try {
      const url = `https://api.vercel.com/v6/deployments?projectId=${projectId}&target=production&limit=1`
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) {
        return {
          key: 'errors.deploy_state',
          category: 'errors',
          status: 'warn',
          severity: 'low',
          evidence: { http_status: res.status },
        }
      }
      const json = (await res.json()) as {
        deployments?: Array<{ uid: string; state: string; createdAt: number }>
      }
      const latest = json.deployments?.[0]
      if (!latest) {
        return {
          key: 'errors.deploy_state',
          category: 'errors',
          status: 'warn',
          severity: 'low',
          evidence: { reason: 'no deployments returned' },
        }
      }
      if (latest.state === 'READY') {
        return {
          key: 'errors.deploy_state',
          category: 'errors',
          status: 'ok',
          evidence: { uid: latest.uid, state: latest.state },
        }
      }
      return {
        key: 'errors.deploy_state',
        category: 'errors',
        status: latest.state === 'ERROR' ? 'fail' : 'warn',
        severity: latest.state === 'ERROR' ? 'high' : 'medium',
        evidence: {
          uid: latest.uid,
          state: latest.state,
          age_min: Math.floor((Date.now() - latest.createdAt) / 60000),
        },
      }
    } catch (err) {
      return {
        key: 'errors.deploy_state',
        category: 'errors',
        status: 'warn',
        severity: 'low',
        evidence: { error: err instanceof Error ? err.message : String(err) },
      }
    }
  },
})

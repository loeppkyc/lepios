import { createServiceClient } from '@/lib/supabase/service'
import type { CheckResult, Flag } from '../types'
import { httpRequest } from '@/lib/harness/arms-legs/http'

function getBaseUrl(): string {
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL)
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}

export async function checkSiteHealth(): Promise<CheckResult> {
  const start = Date.now()
  const flags: Flag[] = []
  const counts: Record<string, number> = { pass: 0, fail: 0 }

  // (a) db reachable
  try {
    const supabase = createServiceClient()
    const { error } = await supabase.from('agent_events').select('id').limit(1)
    if (error) throw new Error(error.message)
    counts.pass++
  } catch (err) {
    counts.fail++
    const msg = err instanceof Error ? err.message : String(err)
    flags.push({
      severity: 'critical',
      message: `Supabase db unreachable: ${msg}`,
      entity_type: 'database',
    })
  }

  // (b) knowledge table queryable
  try {
    const supabase = createServiceClient()
    const { error } = await supabase.from('knowledge').select('id').limit(1)
    if (error) throw new Error(error.message)
    counts.pass++
  } catch (err) {
    counts.fail++
    const msg = err instanceof Error ? err.message : String(err)
    flags.push({
      severity: 'warn',
      message: `knowledge table unqueryable: ${msg}`,
      entity_type: 'table',
    })
  }

  // (c) /api/health returns ok:true
  try {
    const result = await httpRequest({
      url: `${getBaseUrl()}/api/health`,
      method: 'GET',
      capability: 'net.outbound.vercel.read',
      agentId: 'orchestrator',
      timeoutMs: 5_000,
    })
    if (!result.ok) throw new Error(result.error ?? `HTTP ${result.status}`)
    const body = JSON.parse(result.body) as { ok?: boolean }
    if (!body.ok) throw new Error('ok:false')
    counts.pass++
  } catch (err) {
    counts.fail++
    const msg = err instanceof Error ? err.message : String(err)
    flags.push({
      severity: 'warn',
      message: `/api/health did not return ok:true: ${msg}`,
      entity_type: 'route',
    })
  }

  const total = counts.pass + counts.fail
  const status = counts.fail === 0 ? 'pass' : counts.fail === total ? 'fail' : 'warn'

  return { name: 'site_health', status, flags, counts, duration_ms: Date.now() - start }
}

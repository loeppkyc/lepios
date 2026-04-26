import { createServiceClient } from '@/lib/supabase/service'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RouteResult {
  path: string
  method: string
  status: number | null // null on network error/timeout
  latency_ms: number
  passed: boolean
  detail?: string // populated on failure
}

export interface RouteHealthResult {
  passed: boolean
  routes: RouteResult[]
  failed_routes: string[]
  total_ms: number
}

interface RouteSpec {
  path: string
  method: 'GET' | 'POST'
  expectedStatus: number
  body?: Record<string, unknown>
}

// ── Route registry ────────────────────────────────────────────────────────────

const ROUTES: RouteSpec[] = [
  { path: '/api/health', method: 'GET', expectedStatus: 200 },
  {
    path: '/api/twin/ask',
    method: 'POST',
    expectedStatus: 200,
    body: { question: 'smoke test' },
  },
  { path: '/api/telegram/webhook', method: 'GET', expectedStatus: 405 },
]

// ── Single route check ────────────────────────────────────────────────────────

async function checkRoute(baseUrl: string, spec: RouteSpec): Promise<RouteResult> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10_000)
  const start = Date.now()

  const url = `${baseUrl}${spec.path}`
  const init: RequestInit = {
    method: spec.method,
    signal: controller.signal,
  }

  if (spec.method === 'POST' && spec.body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(spec.body)
  }

  try {
    const res = await fetch(url, init)
    clearTimeout(timeoutId)
    const latency_ms = Date.now() - start
    const status = res.status
    const passed = status === spec.expectedStatus

    if (passed) {
      return { path: spec.path, method: spec.method, status, latency_ms, passed: true }
    }

    return {
      path: spec.path,
      method: spec.method,
      status,
      latency_ms,
      passed: false,
      detail: `expected HTTP ${spec.expectedStatus}, got ${status}`,
    }
  } catch (err) {
    clearTimeout(timeoutId)
    const latency_ms = Date.now() - start
    const isAbort = err instanceof Error && err.name === 'AbortError'
    const detail = isAbort
      ? 'timeout after 10s'
      : err instanceof Error
        ? err.message
        : 'unknown error'

    return {
      path: spec.path,
      method: spec.method,
      status: null,
      latency_ms,
      passed: false,
      detail,
    }
  }
}

// ── harness_config read ───────────────────────────────────────────────────────

async function readChatId(): Promise<string | null> {
  try {
    const db = createServiceClient()
    const { data, error } = await db
      .from('harness_config')
      .select('value')
      .eq('key', 'TELEGRAM_CHAT_ID')
      .maybeSingle()
    if (error || !data) return null
    return data.value || null
  } catch {
    return null
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runRouteHealthSmoke(
  baseUrl: string,
  commitSha?: string
): Promise<RouteHealthResult> {
  const overallStart = Date.now()

  const results = await Promise.all(ROUTES.map((spec) => checkRoute(baseUrl, spec)))

  const total_ms = Date.now() - overallStart
  const failed_routes = results.filter((r) => !r.passed).map((r) => r.path)
  const passed = failed_routes.length === 0

  const db = createServiceClient()
  const sha8 = commitSha ? commitSha.slice(0, 8) : 'unknown'

  if (passed) {
    // All routes healthy — log success event
    try {
      await db.from('agent_events').insert({
        domain: 'harness',
        action: 'smoke_test_passed',
        actor: 'route-health',
        status: 'success',
        meta: {
          routes: results,
          total_ms,
          base_url: baseUrl,
        },
      })
    } catch {
      // Non-fatal — event log failure must not mask a passing result
    }
  } else {
    // One or more routes failed — log failure event, alert, and queue incident task
    const chatId = await readChatId()

    const failedDescriptions = results
      .filter((r) => !r.passed)
      .map((r) => `${r.method} ${r.path} → ${r.status ?? 'no response'} (${r.detail ?? ''})`)
      .join(', ')

    const alertText = [
      'Route health smoke test FAILED',
      `commit: ${sha8}`,
      `base_url: ${baseUrl}`,
      `failed: ${failedDescriptions}`,
    ].join('\n')

    const correlationId = `smoke-fail-${sha8}`

    // Insert agent_events failure row
    try {
      await db.from('agent_events').insert({
        domain: 'harness',
        action: 'smoke_test_failed',
        actor: 'route-health',
        status: 'error',
        meta: {
          routes: results,
          total_ms,
          base_url: baseUrl,
          failed_routes,
        },
      })
    } catch {
      // Non-fatal
    }

    // Insert outbound_notifications row (Telegram alert)
    try {
      await db.from('outbound_notifications').insert({
        channel: 'telegram',
        payload: { text: alertText },
        correlation_id: correlationId,
        requires_response: false,
        ...(chatId ? { chat_id: chatId } : {}),
      })
    } catch {
      // Non-fatal
    }

    // Insert task_queue P1 incident row
    try {
      await db.from('task_queue').insert({
        task: 'Investigate production smoke test failure',
        description: `Route health check failed: ${failed_routes.join(', ')}`,
        priority: 1,
        status: 'queued',
        source: 'cron',
        metadata: {
          failed_routes,
          base_url: baseUrl,
          commit_sha: commitSha ?? null,
        },
      })
    } catch {
      // Non-fatal
    }
  }

  return { passed, routes: results, failed_routes, total_ms }
}

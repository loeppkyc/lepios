import { createServiceClient } from '@/lib/supabase/service'

export interface OllamaHealthResult {
  passed: boolean
  tunnel_url: string
  latency_ms: number
  models_found: string[]
  has_nomic: boolean
  detail?: string
}

const BENCHMARK_LATENCY_MS = 5_000
const REQUIRED_MODEL = 'nomic-embed-text'

export async function runOllamaHealthSmoke(): Promise<OllamaHealthResult> {
  const tunnelUrl = (process.env.OLLAMA_TUNNEL_URL ?? 'http://localhost:11434').replace(/\/$/, '')
  const tagsUrl = `${tunnelUrl}/api/tags`
  const start = Date.now()

  let models_found: string[] = []
  let has_nomic = false
  let latency_ms = 0
  let passed = false
  let detail: string | undefined

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), BENCHMARK_LATENCY_MS + 500)

    let res: Response
    try {
      res = await fetch(tagsUrl, { signal: controller.signal })
      clearTimeout(timeoutId)
    } catch (err) {
      clearTimeout(timeoutId)
      latency_ms = Date.now() - start
      const isAbort = err instanceof Error && err.name === 'AbortError'
      detail = isAbort
        ? `timeout after ${BENCHMARK_LATENCY_MS}ms`
        : err instanceof Error
          ? err.message
          : 'network error'
      await logFailure(tunnelUrl, latency_ms, detail)
      return { passed: false, tunnel_url: tunnelUrl, latency_ms, models_found, has_nomic, detail }
    }

    latency_ms = Date.now() - start

    if (!res.ok) {
      detail = `HTTP ${res.status}`
      await logFailure(tunnelUrl, latency_ms, detail)
      return { passed: false, tunnel_url: tunnelUrl, latency_ms, models_found, has_nomic, detail }
    }

    if (latency_ms > BENCHMARK_LATENCY_MS) {
      detail = `latency ${latency_ms}ms exceeds ${BENCHMARK_LATENCY_MS}ms benchmark`
      await logFailure(tunnelUrl, latency_ms, detail)
      return { passed: false, tunnel_url: tunnelUrl, latency_ms, models_found, has_nomic, detail }
    }

    const body = (await res.json()) as { models?: Array<{ name: string }> }
    models_found = (body.models ?? []).map((m) => m.name)
    has_nomic = models_found.some((n) => n.startsWith(REQUIRED_MODEL))

    if (!has_nomic) {
      detail = `${REQUIRED_MODEL} not found in model list`
      await logFailure(tunnelUrl, latency_ms, detail)
      return { passed: false, tunnel_url: tunnelUrl, latency_ms, models_found, has_nomic, detail }
    }

    passed = true
    await logPass(tunnelUrl, latency_ms, models_found)
    return { passed: true, tunnel_url: tunnelUrl, latency_ms, models_found, has_nomic }
  } catch {
    latency_ms = Date.now() - start
    detail = 'unexpected error'
    return { passed, tunnel_url: tunnelUrl, latency_ms, models_found, has_nomic, detail }
  }
}

async function logPass(
  tunnelUrl: string,
  latency_ms: number,
  models_found: string[]
): Promise<void> {
  try {
    const db = createServiceClient()
    await db.from('agent_events').insert({
      domain: 'harness',
      action: 'smoke_test_passed',
      actor: 'ollama-health',
      status: 'success',
      meta: { tunnel_url: tunnelUrl, latency_ms, models_found },
    })
  } catch {
    // Non-fatal
  }
}

async function logFailure(tunnelUrl: string, latency_ms: number, detail: string): Promise<void> {
  const db = createServiceClient()

  try {
    await db.from('agent_events').insert({
      domain: 'harness',
      action: 'smoke_test_failed',
      actor: 'ollama-health',
      status: 'critical',
      meta: { tunnel_url: tunnelUrl, latency_ms, detail },
    })
  } catch {
    // Non-fatal
  }

  const alertText = [
    'P1: Ollama tunnel smoke FAILED',
    `tunnel: ${tunnelUrl}`,
    `detail: ${detail}`,
    `latency: ${latency_ms}ms`,
  ].join('\n')

  try {
    const db2 = createServiceClient()
    const { data } = await db2
      .from('harness_config')
      .select('value')
      .eq('key', 'TELEGRAM_CHAT_ID')
      .maybeSingle()
    const chatId = data?.value ?? null

    await db2.from('outbound_notifications').insert({
      channel: 'telegram',
      payload: { text: alertText },
      correlation_id: `ollama-smoke-fail-${Date.now()}`,
      requires_response: false,
      ...(chatId ? { chat_id: chatId } : {}),
    })
  } catch {
    // Non-fatal
  }

  try {
    const db3 = createServiceClient()
    await db3.from('task_queue').insert({
      task: 'Investigate Ollama tunnel smoke test failure',
      description: `Ollama tunnel unreachable or nomic-embed-text missing: ${detail}`,
      priority: 1,
      status: 'queued',
      source: 'cron',
      metadata: { tunnel_url: tunnelUrl, latency_ms, detail },
    })
  } catch {
    // Non-fatal
  }
}

import { createServiceClient } from '@/lib/supabase/service'
import { requireCapability } from '@/lib/security/capability'

const MAX_BODY_BYTES = 256 * 1024
const DEFAULT_TIMEOUT_MS = 15_000
const MAX_TIMEOUT_MS = 60_000

// Strict host allowlist for capabilities that target a single external service.
// Capabilities not listed here (e.g. net.outbound.vercel.read) impose no host restriction
// at this layer — the capability string itself is the scope boundary.
const HOST_ALLOW: Record<string, string> = {
  'net.outbound.anthropic': 'api.anthropic.com',
  'net.outbound.github': 'api.github.com',
  'net.outbound.telegram': 'api.telegram.org',
  'net.outbound.openai': 'api.openai.com',
}

export interface HttpRequestArgs {
  url: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  capability: string
  agentId: string
  headers?: Record<string, string>
  body?: BodyInit | Record<string, unknown> | null
  timeoutMs?: number
}

export interface HttpResult {
  ok: boolean
  status: number
  body: string
  headers: Record<string, string>
  durationMs: number
  error?: string
}

export async function httpRequest({
  url,
  method,
  capability,
  agentId,
  headers = {},
  body = null,
  timeoutMs,
}: HttpRequestArgs): Promise<HttpResult> {
  const clampedTimeout = Math.min(timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)

  // 1. Capability gate — throws CapabilityDeniedError in enforce mode
  const capResult = await requireCapability({ agentId, capability })

  // 2. Host allowlist check for known single-service capabilities
  const allowedHost = HOST_ALLOW[capability]
  if (allowedHost) {
    let requestedHost: string
    try {
      requestedHost = new URL(url).hostname
    } catch {
      throw new Error(`Invalid URL for capability "${capability}": ${url}`)
    }
    if (requestedHost !== allowedHost) {
      throw new Error(
        `URL host "${requestedHost}" not allowed for capability "${capability}" (expected: "${allowedHost}")`
      )
    }
  }

  // 3. Normalise body: plain objects → JSON; BodyInit types pass through
  let fetchBody: BodyInit | null = null
  const fetchHeaders: Record<string, string> = { ...headers }

  if (body !== null && body !== undefined) {
    if (
      typeof body === 'string' ||
      body instanceof Blob ||
      body instanceof FormData ||
      body instanceof URLSearchParams ||
      body instanceof ArrayBuffer ||
      ArrayBuffer.isView(body)
    ) {
      fetchBody = body as BodyInit
    } else {
      fetchBody = JSON.stringify(body as Record<string, unknown>)
      if (!fetchHeaders['Content-Type'] && !fetchHeaders['content-type']) {
        fetchHeaders['Content-Type'] = 'application/json'
      }
    }
  }

  // 4. Fetch with AbortController timeout
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), clampedTimeout)
  const start = Date.now()

  let result: HttpResult
  try {
    const response = await fetch(url, {
      method,
      headers: fetchHeaders,
      body: fetchBody,
      signal: controller.signal,
    })

    const rawText = await response.text()
    const responseBody =
      rawText.length > MAX_BODY_BYTES ? rawText.slice(0, MAX_BODY_BYTES) : rawText
    const durationMs = Date.now() - start

    const responseHeaders: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value
    })

    result = {
      ok: response.ok,
      status: response.status,
      body: responseBody,
      headers: responseHeaders,
      durationMs,
    }
  } catch (err) {
    const durationMs = Date.now() - start
    const error = err instanceof Error ? err.message : String(err)
    result = { ok: false, status: 0, body: '', headers: {}, durationMs, error }
  } finally {
    clearTimeout(timer)
  }

  // 5. Log HTTP outcome to agent_events (non-fatal — never breaks the caller)
  await logHttpOutcome({ url, method, capability, agentId, result, auditId: capResult.audit_id })

  return result
}

async function logHttpOutcome(opts: {
  url: string
  method: string
  capability: string
  agentId: string
  result: HttpResult
  auditId: string
}): Promise<void> {
  try {
    let host: string
    try {
      host = new URL(opts.url).hostname
    } catch {
      host = opts.url
    }

    const db = createServiceClient()
    await db.from('agent_events').insert({
      domain: 'arms_legs',
      action:
        opts.result.error || opts.result.status >= 400
          ? 'arms_legs.http.error'
          : 'arms_legs.http.ok',
      actor: opts.agentId,
      status: opts.result.error ? 'error' : opts.result.ok ? 'success' : 'error',
      duration_ms: opts.result.durationMs,
      error_message: opts.result.error ?? null,
      meta: {
        url: opts.url,
        method: opts.method,
        capability: opts.capability,
        status: opts.result.status,
        durationMs: opts.result.durationMs,
        host,
        correlation_id: opts.auditId,
      },
    })
  } catch {
    // Logging must never break the caller
  }
}

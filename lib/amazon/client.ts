import { createHmac, createHash } from 'crypto'
import { logEvent } from '@/lib/knowledge/client'

const SP_API_BASE = 'https://sellingpartnerapi-na.amazon.com'

const MAX_RETRIES = 5
const BASE_DELAY_MS = 1_000
const MAX_DELAY_MS = 30_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
const SP_REGION = 'us-east-1'
const SP_SERVICE = 'execute-api'

// Module-level LWA token cache — avoids exchanging tokens on every request
let _cachedToken: string | null = null
let _tokenExpiresAt = 0

function creds() {
  return {
    refreshToken: process.env.AMAZON_SP_REFRESH_TOKEN!,
    clientId: process.env.AMAZON_SP_CLIENT_ID!,
    clientSecret: process.env.AMAZON_SP_CLIENT_SECRET!,
    awsAccessKey: process.env.AMAZON_AWS_ACCESS_KEY!,
    awsSecretKey: process.env.AMAZON_AWS_SECRET_KEY!,
  }
}

export function spApiConfigured(): boolean {
  const c = creds()
  return Boolean(c.refreshToken && c.clientId && c.clientSecret && c.awsAccessKey && c.awsSecretKey)
}

async function getLwaToken(): Promise<string> {
  if (_cachedToken && Date.now() < _tokenExpiresAt) return _cachedToken

  const c = creds()
  const res = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: c.refreshToken,
      client_id: c.clientId,
      client_secret: c.clientSecret,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`LWA token exchange failed (${res.status}): ${body}`)
  }

  const data = (await res.json()) as { access_token: string; expires_in: number }
  _cachedToken = data.access_token
  // Expire 60s early to avoid using a nearly-expired token
  _tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000
  return _cachedToken
}

// ── SigV4 ─────────────────────────────────────────────────────────────────────

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex')
}

function buildAuthHeaders(
  method: string,
  url: URL,
  lwaToken: string,
  body: string
): Record<string, string> {
  const c = creds()

  const now = new Date()
  const amzDate = now
    .toISOString()
    .replace(/[:-]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
  const dateStamp = amzDate.slice(0, 8)

  const baseHeaders: Record<string, string> = {
    host: url.hostname,
    'x-amz-date': amzDate,
    'x-amz-access-token': lwaToken,
    ...(body ? { 'content-type': 'application/json' } : {}),
  }

  const sortedKeys = Object.keys(baseHeaders).sort()
  const canonicalHdrs = sortedKeys.map((k) => `${k}:${baseHeaders[k]}\n`).join('')
  const signedHdrsStr = sortedKeys.join(';')

  // Sort and percent-encode query params for canonical request
  const sortedParams = [...url.searchParams.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')

  const canonicalRequest = [
    method.toUpperCase(),
    url.pathname,
    sortedParams,
    canonicalHdrs,
    signedHdrsStr,
    sha256Hex(body),
  ].join('\n')

  const credScope = `${dateStamp}/${SP_REGION}/${SP_SERVICE}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credScope, sha256Hex(canonicalRequest)].join(
    '\n'
  )

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${c.awsSecretKey}`, dateStamp), SP_REGION), SP_SERVICE),
    'aws4_request'
  )
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')

  return {
    ...baseHeaders,
    Authorization: `AWS4-HMAC-SHA256 Credential=${c.awsAccessKey}/${credScope}, SignedHeaders=${signedHdrsStr}, Signature=${signature}`,
  }
}

// ── Main SP-API fetch helper ──────────────────────────────────────────────────

export async function spFetch<T>(
  path: string,
  options: { method?: string; params?: Record<string, string>; body?: unknown } = {}
): Promise<T> {
  const { method = 'GET', params, body } = options

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const lwaToken = await getLwaToken()

    const url = new URL(SP_API_BASE + path)
    if (params) {
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
    }

    const bodyStr = body ? JSON.stringify(body) : ''
    const headers = buildAuthHeaders(method, url, lwaToken, bodyStr)

    const res = await fetch(url.toString(), {
      method,
      headers,
      ...(bodyStr ? { body: bodyStr } : {}),
    })

    if (res.status === 429) {
      if (attempt === MAX_RETRIES) {
        const text = await res.text()
        throw new Error(
          `SP-API ${method} ${path} (429): rate limited after ${MAX_RETRIES} retries. ${text.slice(0, 200)}`
        )
      }

      const retryAfterHeader = res.headers.get('Retry-After')
      const waitMs = retryAfterHeader
        ? Math.min(parseFloat(retryAfterHeader) * 1_000, MAX_DELAY_MS)
        : Math.min(BASE_DELAY_MS * 2 ** attempt + Math.random() * 500, MAX_DELAY_MS)

      void logEvent('amazon', 'sp_api.429_retry', {
        actor: 'system',
        status: 'pending',
        meta: {
          path,
          attempt: attempt + 1,
          waitMs: Math.round(waitMs),
          retryAfter: retryAfterHeader ?? null,
        },
      })

      await sleep(waitMs)
      continue
    }

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`SP-API ${method} ${path} (${res.status}): ${text.slice(0, 300)}`)
    }

    return res.json() as Promise<T>
  }

  // Unreachable: loop exits via return or throw above on every path
  throw new Error(`SP-API ${method} ${path}: retry loop exhausted`)
}

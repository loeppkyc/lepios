const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token'
const EBAY_BROWSE_BASE = 'https://api.ebay.com/buy/browse/v1'

// Module-level OAuth token cache — TTL is 7,200s, expire 60s early
let _cachedToken: string | null = null
let _tokenExpiresAt = 0

function creds() {
  return {
    appId: process.env.EBAY_APP_ID ?? '',
    certId: process.env.EBAY_CERT_ID ?? '',
  }
}

export function ebayConfigured(): boolean {
  const { appId, certId } = creds()
  return Boolean(appId && certId)
}

async function getAccessToken(): Promise<string> {
  if (_cachedToken && Date.now() < _tokenExpiresAt) return _cachedToken

  const { appId, certId } = creds()
  const encoded = Buffer.from(`${appId}:${certId}`).toString('base64')

  const res = await fetch(EBAY_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${encoded}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`eBay OAuth failed (${res.status}): ${text.slice(0, 200)}`)
  }

  const data = (await res.json()) as { access_token: string; expires_in: number }
  _cachedToken = data.access_token
  _tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000
  return _cachedToken
}

export async function ebayFetch<T>(path: string, params: Record<string, string>): Promise<T> {
  const token = await getAccessToken()

  const url = new URL(`${EBAY_BROWSE_BASE}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_CA',
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`eBay Browse API ${path} (${res.status}): ${text.slice(0, 200)}`)
  }

  return res.json() as Promise<T>
}

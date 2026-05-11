import { createServiceClient } from '@/lib/supabase/service'
import type { AccountBalance, QBOAccountsResponse, QBOTokenResponse } from './types'

const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const QBO_API_BASE = 'https://quickbooks.api.intuit.com/v3/company'
const MINOR_VERSION = '65'

function basicAuthHeader() {
  return (
    'Basic ' +
    Buffer.from(`${process.env.QBO_CLIENT_ID!}:${process.env.QBO_CLIENT_SECRET!}`).toString(
      'base64'
    )
  )
}

type DB = ReturnType<typeof createServiceClient>

async function readConfig(db: DB, key: string) {
  const { data } = await db.from('harness_config').select('value').eq('key', key).maybeSingle()
  return data?.value ?? null
}

async function writeConfig(db: DB, key: string, value: string) {
  await db.from('harness_config').upsert({ key, value }, { onConflict: 'key' })
}

export async function storeTokens(
  authCode: string,
  realmId: string,
  redirectUri: string
): Promise<void> {
  const res = await fetch(QBO_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: authCode,
      redirect_uri: redirectUri,
    }),
  })

  if (!res.ok) throw new Error(`QBO token exchange failed: ${res.status} ${await res.text()}`)

  const tokens = (await res.json()) as QBOTokenResponse
  const expiresAt = String(Date.now() + tokens.expires_in * 1000)
  const db = createServiceClient()

  await Promise.all([
    writeConfig(db, 'qbo_realm_id', realmId),
    writeConfig(db, 'qbo_access_token', tokens.access_token),
    writeConfig(db, 'qbo_access_token_expires_at', expiresAt),
    writeConfig(db, 'qbo_refresh_token', tokens.refresh_token),
  ])
}

async function getValidAccessToken(): Promise<{ token: string; realmId: string }> {
  const db = createServiceClient()
  const [realmId, accessToken, expiresAt, refreshToken] = await Promise.all([
    readConfig(db, 'qbo_realm_id'),
    readConfig(db, 'qbo_access_token'),
    readConfig(db, 'qbo_access_token_expires_at'),
    readConfig(db, 'qbo_refresh_token'),
  ])

  if (!realmId || !refreshToken) throw new Error('QBO not connected — run OAuth flow first')

  // Use existing token if still valid (with 5 min buffer)
  if (accessToken && expiresAt && Date.now() < Number(expiresAt) - 5 * 60 * 1000) {
    return { token: accessToken, realmId }
  }

  const res = await fetch(QBO_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  })

  if (!res.ok) throw new Error(`QBO token refresh failed: ${res.status} ${await res.text()}`)

  const tokens = (await res.json()) as QBOTokenResponse
  const newExpiresAt = String(Date.now() + tokens.expires_in * 1000)

  await Promise.all([
    writeConfig(db, 'qbo_access_token', tokens.access_token),
    writeConfig(db, 'qbo_access_token_expires_at', newExpiresAt),
    writeConfig(db, 'qbo_refresh_token', tokens.refresh_token),
  ])

  return { token: tokens.access_token, realmId }
}

export async function fetchAccounts(): Promise<AccountBalance[]> {
  const { token, realmId } = await getValidAccessToken()

  const query = encodeURIComponent(
    "SELECT * FROM Account WHERE AccountType IN ('Bank', 'Credit Card') AND Active = true"
  )
  const url = `${QBO_API_BASE}/${realmId}/query?query=${query}&minorversion=${MINOR_VERSION}`

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    next: { revalidate: 300 },
  })

  if (!res.ok) throw new Error(`QBO accounts query failed: ${res.status} ${await res.text()}`)

  const data = (await res.json()) as QBOAccountsResponse
  const accounts = data.QueryResponse?.Account ?? []

  return accounts.map((a) => ({
    id: a.Id,
    name: a.Name,
    type: a.AccountType === 'Credit Card' ? 'credit_card' : 'bank',
    subType: a.AccountSubType,
    balance: a.CurrentBalance,
    currency: a.CurrencyRef?.value ?? 'CAD',
  }))
}

export async function isConnected(): Promise<boolean> {
  const db = createServiceClient()
  return !!(await readConfig(db, 'qbo_realm_id'))
}

export async function disconnect(): Promise<void> {
  const db = createServiceClient()
  await Promise.all([
    writeConfig(db, 'qbo_realm_id', ''),
    writeConfig(db, 'qbo_access_token', ''),
    writeConfig(db, 'qbo_access_token_expires_at', ''),
    writeConfig(db, 'qbo_refresh_token', ''),
  ])
}

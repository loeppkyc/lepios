import { NextResponse } from 'next/server'

export const revalidate = 3600

// ── Account definitions ───────────────────────────────────────────────────────

const ACCOUNTS = [
  { key: 'td_bank', label: 'TD Bank', path: '/Colin Loeppky (1)/TD Chequing -9150' },
  { key: 'amex', label: 'Amex', path: '/Colin Loeppky (1)/american express statements' },
  { key: 'cibc', label: 'CIBC', path: '/Colin Loeppky (1)/Costco Credit Card Statement' },
  { key: 'ct_card', label: 'Canadian Tire CC', path: '/Colin Loeppky (1)/Canadian Tire MC - 6421' },
  { key: 'amex_bonvoy', label: 'Amex Bonvoy', path: '/Colin Loeppky (1)/Amex Marriot Bonvoy' },
  { key: 'capital_one', label: 'Capital One', path: '/Colin Loeppky (1)/Capital One MC - 3583' },
  { key: 'td_visa', label: 'TD Visa', path: '/Colin Loeppky (1)/TD Visa' },
  { key: 'td_usd', label: 'TD USD Chequing', path: '/Colin Loeppky (1)/TD USD Chequing - 9924' },
] as const

// ── Timezone helpers ──────────────────────────────────────────────────────────

/**
 * Given a UTC ISO timestamp string (e.g. "2026-05-01T05:30:00Z"),
 * returns the year and month as seen in the America/Edmonton timezone.
 *
 * Do NOT use .getMonth() / .getFullYear() — those return UTC values.
 * Use Intl.DateTimeFormat to extract the local Edmonton year+month.
 */
export function utcToEdmontonYearMonth(utcIso: string): { year: number; month: number } {
  const date = new Date(utcIso)
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Edmonton',
    year: 'numeric',
    month: '2-digit',
  })
  const parts = fmt.formatToParts(date)
  const year = Number(parts.find((p) => p.type === 'year')?.value ?? '0')
  const month = Number(parts.find((p) => p.type === 'month')?.value ?? '0')
  return { year, month }
}

/**
 * Returns the current year and month in the America/Edmonton timezone.
 */
export function currentEdmontonYearMonth(): { year: number; month: number } {
  return utcToEdmontonYearMonth(new Date().toISOString())
}

// ── Band generation ───────────────────────────────────────────────────────────

/** Generates "YYYY-MM" strings for all 12 months of 2025. Fixed. */
export function get2025Months(): string[] {
  return Array.from({ length: 12 }, (_, i) => {
    const month = String(i + 1).padStart(2, '0')
    return `2025-${month}`
  })
}

/** Generates "YYYY-MM" strings from Jan 2026 through the current Edmonton month. */
export function get2026YtdMonths(): string[] {
  const { year, month } = currentEdmontonYearMonth()
  // If somehow called before 2026, return empty (defensive)
  if (year < 2026) return []
  // If current year is beyond 2026, cap at full 12 months for 2026
  // (this is purely defensive; the 2026 band grows month by month)
  const endMonth = year === 2026 ? month : 12
  return Array.from({ length: endMonth }, (_, i) => {
    const m = String(i + 1).padStart(2, '0')
    return `2026-${m}`
  })
}

// ── Dropbox auth ──────────────────────────────────────────────────────────────

async function getDropboxAccessToken(): Promise<string> {
  // .trim() is mandatory: Vercel CLI stdin adds on Windows inject trailing \r\n
  // into stored values, making them 2 bytes longer than source. Dropbox (and
  // any strict-auth API) rejects these as invalid_client. See F15 in CLAUDE.md.
  const appKey = process.env.DROPBOX_APP_KEY?.trim()
  const appSecret = process.env.DROPBOX_APP_SECRET?.trim()
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN?.trim()

  if (!appKey || !appSecret || !refreshToken) {
    throw new Error('dropbox_credentials_missing')
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: appKey,
    client_secret: appSecret,
  })

  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`dropbox_auth_failed: HTTP ${res.status} — ${text}`)
  }

  const json = (await res.json()) as { access_token?: string }
  if (!json.access_token) {
    throw new Error('dropbox_auth_failed: no access_token in response')
  }

  return json.access_token
}

// ── Dropbox folder listing ────────────────────────────────────────────────────

interface DropboxEntry {
  '.tag': string
  name: string
  server_modified?: string
}

interface DropboxListFolderResponse {
  entries: DropboxEntry[]
  has_more: boolean
  error_summary?: string
}

interface DropboxErrorResponse {
  error_summary?: string
  error?: {
    '.tag'?: string
    path?: {
      '.tag'?: string
    }
  }
}

async function listFolderPdfs(
  accessToken: string,
  folderPath: string
): Promise<{ serverModified: string }[]> {
  const res = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path: folderPath }),
  })

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as DropboxErrorResponse
    const summary = errBody.error_summary ?? ''
    const tag = errBody.error?.path?.['.tag'] ?? errBody.error?.['.tag'] ?? ''

    if (tag === 'not_found' || summary.includes('not_found')) {
      throw new Error(`dropbox_path_not_found:${folderPath}`)
    }
    throw new Error(`dropbox_list_failed: HTTP ${res.status} for path "${folderPath}" — ${summary}`)
  }

  const data = (await res.json()) as DropboxListFolderResponse

  // No pagination needed — bank statement folders have ~12 files per year,
  // never approaches Dropbox's 2000-entry cap.
  return data.entries
    .filter(
      (e) =>
        e['.tag'] === 'file' &&
        e.name.toLowerCase().endsWith('.pdf') &&
        typeof e.server_modified === 'string'
    )
    .map((e) => ({ serverModified: e.server_modified! }))
}

// ── Response shape ────────────────────────────────────────────────────────────

export interface StatementCoverageResponse {
  bands: Array<{ label: string; months: string[] }>
  accounts: Array<{
    key: string
    label: string
    coverage: Record<string, boolean>
  }>
  fetchedAt: string
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET() {
  // Kill signal 1: credentials check (trim first — see F15)
  if (
    !process.env.DROPBOX_APP_KEY?.trim() ||
    !process.env.DROPBOX_APP_SECRET?.trim() ||
    !process.env.DROPBOX_REFRESH_TOKEN?.trim()
  ) {
    return NextResponse.json({ error: 'dropbox_credentials_missing' }, { status: 503 })
  }

  let accessToken: string
  try {
    accessToken = await getDropboxAccessToken()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 502 })
  }

  const months2025 = get2025Months()
  const months2026 = get2026YtdMonths()
  const allMonths = [...months2025, ...months2026]

  // Fetch all 8 folders in parallel
  const results = await Promise.allSettled(
    ACCOUNTS.map((account) => listFolderPdfs(accessToken, account.path))
  )

  // Kill signal 2: check for any not_found errors
  const notFoundPaths: string[] = []
  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    if (result.status === 'rejected') {
      const msg = result.reason instanceof Error ? result.reason.message : String(result.reason)
      if (msg.startsWith('dropbox_path_not_found:')) {
        notFoundPaths.push(msg.replace('dropbox_path_not_found:', ''))
      }
    }
  }

  if (notFoundPaths.length > 0) {
    return NextResponse.json(
      {
        error: 'dropbox_path_not_found',
        paths: notFoundPaths,
      },
      { status: 502 }
    )
  }

  // Build coverage maps
  const accounts = ACCOUNTS.map((account, i) => {
    const result = results[i]

    const coverage: Record<string, boolean> = {}
    for (const month of allMonths) {
      coverage[month] = false
    }

    if (result.status === 'fulfilled') {
      for (const { serverModified } of result.value) {
        const { year, month } = utcToEdmontonYearMonth(serverModified)
        const key = `${year}-${String(month).padStart(2, '0')}`
        if (key in coverage) {
          coverage[key] = true
        }
      }
    } else {
      // Non-not_found errors: mark as fetch error — return error rather than fabricating absence
      const msg = result.reason instanceof Error ? result.reason.message : String(result.reason)
      return NextResponse.json(
        { error: `dropbox_list_failed for account "${account.key}": ${msg}` },
        { status: 502 }
      )
    }

    return {
      key: account.key,
      label: account.label,
      coverage,
    }
  })

  // If any account returned a NextResponse (error), bubble it up
  for (const account of accounts) {
    if (account instanceof NextResponse) {
      return account
    }
  }

  const body: StatementCoverageResponse = {
    bands: [
      { label: '2025 · Tax Year', months: months2025 },
      { label: '2026 · YTD', months: months2026 },
    ],
    accounts: accounts as StatementCoverageResponse['accounts'],
    fetchedAt: new Date().toISOString(),
  }

  return NextResponse.json(body)
}

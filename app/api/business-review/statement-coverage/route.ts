import { NextResponse } from 'next/server'

export const revalidate = 0

// ── Month abbreviation helper ─────────────────────────────────────────────────

const MONTH_ABBREVS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

/** Converts a 3-letter month abbreviation (case-insensitive) to 1–12, or null if unrecognized. */
export function monthFromAbbrev(abbrev: string): number | null {
  return MONTH_ABBREVS[abbrev.toLowerCase()] ?? null
}

// ── Account definitions ───────────────────────────────────────────────────────

interface FilenameResult {
  year: number
  month: number
  /** When true, apply previousMonth() to get covered period. False = month IS the covered period. */
  applyMinus1: boolean
}

interface Account {
  key: string
  label: string
  path: string
  /** Returns the parsed date from a PDF filename, or null to fall back to server_modified. */
  filenameParser: (name: string) => FilenameResult | null
}

export const ACCOUNTS: Account[] = [
  {
    key: 'td_bank',
    label: 'TD Bank',
    path: '/Colin Loeppky (1)/TD Chequing -9150',
    // "Oct_01-Oct_31_2025.pdf" — period-end month = covered month, no M-1
    filenameParser: (name) => {
      const m = name.match(/[A-Za-z]{3}_\d{2}-([A-Za-z]{3})_\d{2}_(\d{4})\.pdf$/i)
      if (!m) return null
      const month = monthFromAbbrev(m[1])
      if (!month) return null
      return { year: Number(m[2]), month, applyMinus1: false }
    },
  },
  {
    key: 'amex',
    label: 'Amex',
    path: '/Colin Loeppky (1)/american express statements',
    // "2025-12-01.pdf" — issue date, M-1 applies
    filenameParser: (name) => {
      const m = name.match(/^(\d{4})-(\d{2})-\d{2}\.pdf$/i)
      if (!m) return null
      return { year: Number(m[1]), month: Number(m[2]), applyMinus1: true }
    },
  },
  {
    key: 'cibc',
    label: 'CIBC',
    path: '/Colin Loeppky (1)/Costco Credit Card Statement',
    // "onlineStatement_2026-01-14.pdf" — issue date, M-1 applies
    // undated "onlineStatement.pdf" / "onlineStatement (1).pdf" → null → server_modified fallback
    filenameParser: (name) => {
      const m = name.match(/onlineStatement_(\d{4})-(\d{2})-\d{2}\.pdf$/i)
      if (!m) return null
      return { year: Number(m[1]), month: Number(m[2]), applyMinus1: true }
    },
  },
  {
    key: 'ct_card',
    label: 'Canadian Tire CC',
    path: '/Colin Loeppky (1)/Canadian Tire MC - 6421',
    // "2026-02-13-TriangleMC.pdf" — issue date, M-1 applies
    filenameParser: (name) => {
      const m = name.match(/^(\d{4})-(\d{2})-\d{2}-Triangle/i)
      if (!m) return null
      return { year: Number(m[1]), month: Number(m[2]), applyMinus1: true }
    },
  },
  {
    key: 'amex_bonvoy',
    label: 'Amex Bonvoy',
    path: '/Colin Loeppky (1)/Amex Marriot Bonvoy',
    // "2025-01-04.pdf" — issue date, M-1 applies
    // older non-date filenames fall back to server_modified
    filenameParser: (name) => {
      const m = name.match(/^(\d{4})-(\d{2})-\d{2}\.pdf$/i)
      if (!m) return null
      return { year: Number(m[1]), month: Number(m[2]), applyMinus1: true }
    },
  },
  {
    key: 'capital_one',
    label: 'Capital One',
    path: '/Colin Loeppky (1)/Capital One MC - 3583',
    // "Statement_012025_....pdf" — groups: [1]=MM [2]=YYYY, issue date, M-1 applies
    filenameParser: (name) => {
      const m = name.match(/^Statement_(\d{2})(\d{4})_/i)
      if (!m) return null
      return { year: Number(m[2]), month: Number(m[1]), applyMinus1: true }
    },
  },
  {
    key: 'td_visa',
    label: 'TD Visa',
    path: '/Colin Loeppky (1)/TD Visa',
    // "TD_AEROPLAN_VISA_BUSINESS_1234_Feb_01-2026.pdf" — issue month, M-1 applies
    filenameParser: (name) => {
      const m = name.match(/TD_AEROPLAN_VISA_BUSINESS_\d+_([A-Za-z]{3})_\d{2}-(\d{4})\.pdf/i)
      if (!m) return null
      const month = monthFromAbbrev(m[1])
      if (!month) return null
      return { year: Number(m[2]), month, applyMinus1: true }
    },
  },
  {
    key: 'td_usd',
    label: 'TD USD Chequing',
    path: '/Colin Loeppky (1)/TD USD Chequing - 9924',
    // "View PDF Statement_2025-12-01.pdf" — issue date, M-1 applies
    filenameParser: (name) => {
      const m = name.match(/View PDF Statement_(\d{4})-(\d{2})-\d{2}\.pdf$/i)
      if (!m) return null
      return { year: Number(m[1]), month: Number(m[2]), applyMinus1: true }
    },
  },
]

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

/**
 * Returns the current year, month, and day-of-month in the America/Edmonton timezone.
 */
export function currentEdmontonDate(): { year: number; month: number; day: number } {
  const date = new Date()
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Edmonton',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = fmt.formatToParts(date)
  return {
    year: Number(parts.find((p) => p.type === 'year')?.value ?? '0'),
    month: Number(parts.find((p) => p.type === 'month')?.value ?? '0'),
    day: Number(parts.find((p) => p.type === 'day')?.value ?? '0'),
  }
}

/**
 * Returns the month immediately before (year, month), handling January → December rollback.
 * Upload in month M covers activity for month M-1.
 */
export function previousMonth(year: number, month: number): { year: number; month: number } {
  if (month === 1) return { year: year - 1, month: 12 }
  return { year, month: month - 1 }
}

export type CoverageStatus = 'filed' | 'pending' | 'missing' | 'no_activity'

/**
 * Returns the status for a grid cell that has no uploaded statement.
 * 'pending' = current or future Edmonton month (statement not yet due).
 * 'missing' = past month with no upload.
 */
export function cellStatus(
  cellYear: number,
  cellMonth: number,
  nowYear: number,
  nowMonth: number,
): 'pending' | 'missing' {
  if (cellYear > nowYear) return 'pending'
  if (cellYear === nowYear && cellMonth >= nowMonth) return 'pending'
  return 'missing'
}

// ── Band generation ───────────────────────────────────────────────────────────

/** Returns all 12 months of the current Edmonton year: "YYYY-01" through "YYYY-12". */
export function getCurrentYearMonths(): string[] {
  const { year } = currentEdmontonYearMonth()
  return Array.from({ length: 12 }, (_, i) => {
    const month = String(i + 1).padStart(2, '0')
    return `${year}-${month}`
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
): Promise<{ serverModified: string; name: string }[]> {
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
    .map((e) => ({ serverModified: e.server_modified!, name: e.name }))
}

// ── Response shape ────────────────────────────────────────────────────────────

export interface StatementCoverageResponse {
  bands: Array<{ label: string; months: string[] }>
  accounts: Array<{
    key: string
    label: string
    coverage: Record<string, CoverageStatus>
  }>
  fetchedAt: string
}

// ── No-activity overrides ─────────────────────────────────────────────────────

// Add (accountKey, 'YYYY-MM') here when an account doesn't issue a statement
// for that period (e.g. inactive credit card with zero balance).
const NO_ACTIVITY: Record<string, string[]> = {
  cibc: ['2026-03'],
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

  const allMonths = getCurrentYearMonths()
  const { year: currentYear } = currentEdmontonYearMonth()

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

  // Today in Edmonton — needed for pending/missing determination
  const { year: nowYear, month: nowMonth } = currentEdmontonDate()

  // Build coverage maps
  const accounts = ACCOUNTS.map((account, i) => {
    const result = results[i]

    // Initialize all cells as 'missing'; upload loop promotes to 'filed';
    // finalization pass promotes current month to 'pending'.
    const coverage: Record<string, CoverageStatus> = {}
    for (const month of allMonths) {
      coverage[month] = 'missing'
    }

    if (result.status === 'fulfilled') {
      // Resolution order: filename parser → server_modified fallback.
      // A file's date encodes the statement issue date; covered period is
      // typically M-1 (except TD Bank, which encodes the period-end date directly).
      for (const { serverModified, name } of result.value) {
        let coveredYear: number
        let coveredMonth: number

        const parsed = account.filenameParser(name)
        if (parsed) {
          // Sanity-check: skip implausible dates
          if (parsed.year < 2020 || parsed.year > currentYear + 1) continue
          if (parsed.applyMinus1) {
            const prev = previousMonth(parsed.year, parsed.month)
            coveredYear = prev.year
            coveredMonth = prev.month
          } else {
            coveredYear = parsed.year
            coveredMonth = parsed.month
          }
        } else {
          // Fallback: upload month M → covered month M-1
          const { year, month } = utcToEdmontonYearMonth(serverModified)
          const prev = previousMonth(year, month)
          coveredYear = prev.year
          coveredMonth = prev.month
        }

        const key = `${coveredYear}-${String(coveredMonth).padStart(2, '0')}`
        if (key in coverage) {
          coverage[key] = 'filed'
        }
      }
      // Finalization: apply no_activity overrides first (they win over filed too),
      // then correct 'missing' → 'pending' for current/future months.
      const accountOverrides = NO_ACTIVITY[account.key] ?? []
      for (const month of allMonths) {
        if (accountOverrides.includes(month)) {
          coverage[month] = 'no_activity'
        } else if (coverage[month] !== 'filed') {
          const [y, m] = month.split('-').map(Number)
          coverage[month] = cellStatus(y, m, nowYear, nowMonth)
        }
      }
    } else {
      // Non-not_found errors: return error rather than fabricating absence
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
    bands: [{ label: String(currentYear), months: allMonths }],
    accounts: accounts as StatementCoverageResponse['accounts'],
    fetchedAt: new Date().toISOString(),
  }

  return NextResponse.json(body)
}

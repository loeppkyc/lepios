import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/require-user'

export const revalidate = 300 // 5-minute cache; Gmail data updates hourly via cron

// ── Month abbreviation helper ─────────────────────────────────────────────────

const MONTH_ABBREVS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
}

/** Converts a 3-letter month abbreviation (case-insensitive) to 1–12, or null if unrecognized. */
export function monthFromAbbrev(abbrev: string): number | null {
  return MONTH_ABBREVS[abbrev.toLowerCase()] ?? null
}

// ── Timezone helpers ──────────────────────────────────────────────────────────

/**
 * Given a UTC ISO timestamp string (e.g. "2026-05-01T05:30:00Z"),
 * returns the year and month as seen in the America/Edmonton timezone.
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
 * Arrival in month M covers statement period M-1.
 */
export function previousMonth(year: number, month: number): { year: number; month: number } {
  if (month === 1) return { year: year - 1, month: 12 }
  return { year, month: month - 1 }
}

export type CoverageStatus = 'filed' | 'pending' | 'missing' | 'no_activity' | 'filed_override'

/**
 * Returns the status for a grid cell that has no filed statement.
 * 'pending' = current or future Edmonton month (statement not yet due).
 * 'missing' = past month with no arrival or override.
 */
export function cellStatus(
  cellYear: number,
  cellMonth: number,
  nowYear: number,
  nowMonth: number
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

// ── Account definitions (display order) ──────────────────────────────────────
// Capital One intentionally absent — filtered out per Colin 2026-04-24.
// CIBC and Canadian Tire CC have no email statement notifications — manual-override-only.

const STATEMENT_GRID_ACCOUNTS = [
  { key: 'td_bank', label: 'TD Bank', account_names: ['TD Chequing'] },
  { key: 'amex', label: 'Amex', account_names: ['Amex Business'] },
  { key: 'amex_bonvoy', label: 'Amex Bonvoy', account_names: ['Amex Bonvoy'] },
  { key: 'cibc', label: 'CIBC', account_names: [] as string[] }, // no email notifications
  { key: 'ct_card', label: 'Canadian Tire CC', account_names: [] as string[] }, // no email notifications
  { key: 'td_visa', label: 'TD Visa', account_names: ['TD Visa'] },
  { key: 'td_usd', label: 'TD USD Chequing', account_names: ['TD USD Chequing'] },
]

// ── No-activity overrides ─────────────────────────────────────────────────────

// Add (accountKey, 'YYYY-MM') here when an account doesn't issue a statement
// for that period (e.g. inactive credit card with zero balance).
const NO_ACTIVITY: Record<string, string[]> = {
  cibc: ['2026-03'],
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET() {
  const gate = await requireUser({ minRole: 'business' })
  if (!gate.ok) return gate.response

  // Fetch gmail_statement_arrivals — all rows, no date filter
  const { data: arrivals, error: arrivalsError } = await gate.supabase
    .from('gmail_statement_arrivals')
    .select('account_name, arrival_date')

  if (arrivalsError) {
    return NextResponse.json({ error: 'gmail_arrivals_fetch_failed' }, { status: 502 })
  }

  // Build coverage map: account_name → Set<'YYYY-MM'>
  // Coverage rule: arrival in month M → covered month M-1
  const gmailCoverage: Record<string, Set<string>> = {}
  for (const row of arrivals ?? []) {
    const arrival = new Date(row.arrival_date)
    // arrival_date is a date string YYYY-MM-DD; parse as UTC noon to avoid TZ shifts
    const arrivalIso = row.arrival_date.includes('T')
      ? row.arrival_date
      : `${row.arrival_date}T12:00:00Z`
    const { year: arrivalYear, month: arrivalMonth } = utcToEdmontonYearMonth(arrivalIso)
    const covered = previousMonth(arrivalYear, arrivalMonth)
    const coveredKey = `${covered.year}-${String(covered.month).padStart(2, '0')}`

    const accountName = row.account_name as string
    if (!gmailCoverage[accountName]) gmailCoverage[accountName] = new Set()
    gmailCoverage[accountName].add(coveredKey)
  }

  // Today in Edmonton — needed for pending/missing determination
  const { year: nowYear, month: nowMonth } = currentEdmontonDate()
  const { year: currentYear } = currentEdmontonYearMonth()
  const currentYearMonths = getCurrentYearMonths()

  // Both bands: 2025 (prior year) + 2026 (current year)
  const priorYear = currentYear - 1
  const priorYearMonths = Array.from({ length: 12 }, (_, i) => {
    const month = String(i + 1).padStart(2, '0')
    return `${priorYear}-${month}`
  })
  const allMonths = [...priorYearMonths, ...currentYearMonths]

  // Load manual overrides from DB; fail open (empty set) if unavailable.
  const manualOverrides = new Set<string>()
  try {
    const { data: rows } = await gate.supabase
      .from('statement_coverage_overrides')
      .select('account_key, year_month')
    for (const row of rows ?? []) {
      manualOverrides.add(`${row.account_key}:${row.year_month}`)
    }
  } catch {
    // Non-fatal — overrides unavailable, serve without them
  }

  // Build per-account coverage
  const accounts = STATEMENT_GRID_ACCOUNTS.map((account) => {
    const coverage: Record<string, CoverageStatus> = {}

    // Initialize all cells
    for (const month of allMonths) {
      coverage[month] = 'missing'
    }

    // Apply Gmail arrivals for this account's mapped account_names
    for (const accountName of account.account_names) {
      const arrivedMonths = gmailCoverage[accountName] ?? new Set()
      for (const month of arrivedMonths) {
        if (month in coverage) {
          coverage[month] = 'filed'
        }
      }
    }

    // Finalization — priority order (highest wins):
    //   1. no_activity  — NO_ACTIVITY const (overrides everything)
    //   2. filed        — real Gmail arrival found
    //   3. filed_override — manual DB override
    //   4. pending      — current or future Edmonton month
    //   5. missing      — past month, no arrival, no override
    const noActivityMonths = NO_ACTIVITY[account.key] ?? []
    for (const month of allMonths) {
      if (noActivityMonths.includes(month)) {
        coverage[month] = 'no_activity'
      } else if (coverage[month] === 'filed') {
        // real Gmail arrival — leave as-is
      } else if (manualOverrides.has(`${account.key}:${month}`)) {
        coverage[month] = 'filed_override'
      } else {
        const [y, m] = month.split('-').map(Number)
        coverage[month] = cellStatus(y, m, nowYear, nowMonth)
      }
    }

    return {
      key: account.key,
      label: account.label,
      coverage,
    }
  })

  const body: StatementCoverageResponse = {
    bands: [
      { label: String(priorYear), months: priorYearMonths },
      { label: String(currentYear), months: currentYearMonths },
    ],
    accounts,
    fetchedAt: new Date().toISOString(),
  }

  return NextResponse.json(body)
}

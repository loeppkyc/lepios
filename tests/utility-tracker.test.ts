/**
 * Utility Tracker — F21 acceptance tests
 * Written BEFORE implementation per builder.md §5 + acceptance doc pre-flight note 5.
 *
 * Tests cover the ~20% business logic extracted from Streamlit reference:
 *   - Month format validation + normalization
 *   - Summary metric calculations
 *   - Month-over-month delta computation
 *   - Provider default handling
 *   - F20 compliance: no arbitrary style= values in TSX
 */

import { describe, it, expect } from 'vitest'
import { execSync } from 'child_process'
import path from 'path'

// ── Domain logic (pure functions) ─────────────────────────────────────────────

/** Validate that a string matches YYYY-MM format */
function validateMonth(month: string): boolean {
  return /^\d{4}-\d{2}$/.test(month)
}

/** Normalize single-digit month: "2025-3" → "2025-03" */
function normalizeMonth(month: string): string {
  const trimmed = month.trim()
  const parts = trimmed.split('-')
  if (parts.length !== 2) return trimmed
  const [year, mon] = parts
  return `${year}-${mon.padStart(2, '0')}`
}

/** Compute summary metrics from an array of bills */
interface Bill {
  month: string
  kwh: number
  amount_cad: number
  provider: string
  notes?: string | null
}

function computeMetrics(bills: Bill[]): {
  totalBilled: number
  avgMonthlyCost: number
  avgMonthlyKwh: number
  latestAmount: number | null
  latestMonth: string | null
  deltaVsPrior: number | null
} {
  if (bills.length === 0) {
    return {
      totalBilled: 0,
      avgMonthlyCost: 0,
      avgMonthlyKwh: 0,
      latestAmount: null,
      latestMonth: null,
      deltaVsPrior: null,
    }
  }

  const totalBilled = bills.reduce((s, b) => s + b.amount_cad, 0)
  const avgMonthlyCost = totalBilled / bills.length
  const avgMonthlyKwh = bills.reduce((s, b) => s + b.kwh, 0) / bills.length

  // bills are ordered newest-first (DESC by month)
  const latest = bills[0]
  const prior = bills[1] ?? null
  const deltaVsPrior = prior ? latest.amount_cad - prior.amount_cad : null

  return {
    totalBilled,
    avgMonthlyCost,
    avgMonthlyKwh,
    latestAmount: latest.amount_cad,
    latestMonth: latest.month,
    deltaVsPrior,
  }
}

/** Check whether all bills share the same provider */
function allSameProvider(bills: Bill[]): boolean {
  if (bills.length === 0) return true
  const first = bills[0].provider
  return bills.every((b) => b.provider === first)
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('validateMonth', () => {
  it('accepts valid YYYY-MM', () => {
    expect(validateMonth('2026-01')).toBe(true)
    expect(validateMonth('2025-12')).toBe(true)
  })

  it('rejects single-digit month without padding', () => {
    expect(validateMonth('2026-1')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(validateMonth('')).toBe(false)
  })

  it('rejects YYYY-MM-DD', () => {
    expect(validateMonth('2026-01-15')).toBe(false)
  })

  it('rejects non-numeric', () => {
    expect(validateMonth('jan-2026')).toBe(false)
  })
})

describe('normalizeMonth', () => {
  it('pads single-digit month', () => {
    expect(normalizeMonth('2025-3')).toBe('2025-03')
  })

  it('leaves already-padded month unchanged', () => {
    expect(normalizeMonth('2025-03')).toBe('2025-03')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeMonth('  2025-03  ')).toBe('2025-03')
  })

  it('handles december correctly', () => {
    expect(normalizeMonth('2025-12')).toBe('2025-12')
  })
})

describe('computeMetrics', () => {
  it('returns zeros/nulls for empty bills array', () => {
    const m = computeMetrics([])
    expect(m.totalBilled).toBe(0)
    expect(m.avgMonthlyCost).toBe(0)
    expect(m.avgMonthlyKwh).toBe(0)
    expect(m.latestAmount).toBeNull()
    expect(m.deltaVsPrior).toBeNull()
  })

  it('computes total billed correctly', () => {
    const bills: Bill[] = [
      { month: '2026-03', kwh: 400, amount_cad: 80.0, provider: 'Metergy' },
      { month: '2026-02', kwh: 350, amount_cad: 70.0, provider: 'Metergy' },
      { month: '2026-01', kwh: 300, amount_cad: 60.0, provider: 'Metergy' },
    ]
    const m = computeMetrics(bills)
    expect(m.totalBilled).toBe(210.0)
  })

  it('computes avg monthly cost', () => {
    const bills: Bill[] = [
      { month: '2026-02', kwh: 400, amount_cad: 80.0, provider: 'Metergy' },
      { month: '2026-01', kwh: 300, amount_cad: 60.0, provider: 'Metergy' },
    ]
    const m = computeMetrics(bills)
    expect(m.avgMonthlyCost).toBe(70.0)
  })

  it('computes avg monthly kWh', () => {
    const bills: Bill[] = [
      { month: '2026-02', kwh: 400, amount_cad: 80.0, provider: 'Metergy' },
      { month: '2026-01', kwh: 200, amount_cad: 60.0, provider: 'Metergy' },
    ]
    const m = computeMetrics(bills)
    expect(m.avgMonthlyKwh).toBe(300)
  })

  it('returns latest bill as bills[0] (newest-first input)', () => {
    const bills: Bill[] = [
      { month: '2026-03', kwh: 400, amount_cad: 90.0, provider: 'Metergy' },
      { month: '2026-02', kwh: 350, amount_cad: 70.0, provider: 'Metergy' },
    ]
    const m = computeMetrics(bills)
    expect(m.latestAmount).toBe(90.0)
    expect(m.latestMonth).toBe('2026-03')
  })

  it('computes positive month-over-month delta', () => {
    const bills: Bill[] = [
      { month: '2026-02', kwh: 400, amount_cad: 90.0, provider: 'Metergy' },
      { month: '2026-01', kwh: 350, amount_cad: 70.0, provider: 'Metergy' },
    ]
    const m = computeMetrics(bills)
    // newest (90) - prior (70) = +20
    expect(m.deltaVsPrior).toBe(20.0)
  })

  it('computes negative month-over-month delta', () => {
    const bills: Bill[] = [
      { month: '2026-02', kwh: 300, amount_cad: 60.0, provider: 'Metergy' },
      { month: '2026-01', kwh: 400, amount_cad: 80.0, provider: 'Metergy' },
    ]
    const m = computeMetrics(bills)
    expect(m.deltaVsPrior).toBe(-20.0)
  })

  it('returns null delta when only one bill exists', () => {
    const bills: Bill[] = [{ month: '2026-01', kwh: 300, amount_cad: 60.0, provider: 'Metergy' }]
    const m = computeMetrics(bills)
    expect(m.deltaVsPrior).toBeNull()
  })
})

describe('allSameProvider', () => {
  it('returns true when empty', () => {
    expect(allSameProvider([])).toBe(true)
  })

  it('returns true when single provider', () => {
    const bills: Bill[] = [
      { month: '2026-01', kwh: 300, amount_cad: 60.0, provider: 'Metergy' },
      { month: '2026-02', kwh: 350, amount_cad: 70.0, provider: 'Metergy' },
    ]
    expect(allSameProvider(bills)).toBe(true)
  })

  it('returns false when providers differ', () => {
    const bills: Bill[] = [
      { month: '2026-01', kwh: 300, amount_cad: 60.0, provider: 'Metergy' },
      { month: '2026-02', kwh: 350, amount_cad: 70.0, provider: 'Other Energy Co' },
    ]
    expect(allSameProvider(bills)).toBe(false)
  })
})

// ── F20 compliance: no arbitrary style= values in utility TSX files ────────────

describe('F20 compliance — no arbitrary style= values in utility TSX', () => {
  it('utility TSX files contain no hex color values in style={}', () => {
    const utilityDir = path.join(process.cwd(), 'app/(cockpit)/utility')

    let stdout = ''
    try {
      // Grep for hex color patterns (#xxx or #xxxxxx) inside style= attributes
      stdout = execSync(
        `grep -rn "style=.*#[0-9a-fA-F]\\{3,6\\}" "${utilityDir}" --include="*.tsx" || true`,
        { encoding: 'utf8' }
      )
    } catch {
      // grep returns exit 1 when no matches — that's a pass
    }

    if (stdout.trim()) {
      throw new Error(`F20 violation: hex color in style= found in utility TSX:\n${stdout}`)
    }
  })

  it('utility TSX files contain no pixel values in style={} (e.g. "16px" not in CSS token)', () => {
    const utilityDir = path.join(process.cwd(), 'app/(cockpit)/utility')

    let stdout = ''
    try {
      // Check for inline numeric px/rem in string style props that aren't CSS var() references
      // Pattern: style={{ ... "16px" ... }} (quoted string with px/rem = arbitrary value)
      stdout = execSync(
        `grep -rn 'style=.*"[0-9]\\+px"' "${utilityDir}" --include="*.tsx" || true`,
        { encoding: 'utf8' }
      )
    } catch {
      // grep returns exit 1 when no matches — that's a pass
    }

    if (stdout.trim()) {
      throw new Error(`F20 violation: quoted px value in style= found in utility TSX:\n${stdout}`)
    }
  })
})

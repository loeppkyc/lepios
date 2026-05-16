import { describe, it, expect } from 'vitest'

// ── Business logic tests for hardware_components domain ────────────────────────
// These test the computation rules used in HardwareTable: variance calculation,
// sum-with-null, and status badge mapping. No Supabase or HTTP calls here.

// ── sumCad (mirrors HardwareTable's sumCad function) ──────────────────────────

type HardwareComponent = {
  budget_cad: number | null
  actual_cad: number | null
}

function sumCad(components: HardwareComponent[], field: keyof HardwareComponent): number {
  return components.reduce((acc, c) => acc + (Number(c[field]) || 0), 0)
}

describe('sumCad', () => {
  it('sums budget_cad values, treating null as 0', () => {
    const components: HardwareComponent[] = [
      { budget_cad: 1200, actual_cad: null },
      { budget_cad: null, actual_cad: 300 },
      { budget_cad: 500, actual_cad: 450 },
    ]
    expect(sumCad(components, 'budget_cad')).toBe(1700)
  })

  it('sums actual_cad values, treating null as 0', () => {
    const components: HardwareComponent[] = [
      { budget_cad: 1200, actual_cad: null },
      { budget_cad: null, actual_cad: 300 },
      { budget_cad: 500, actual_cad: 450 },
    ]
    expect(sumCad(components, 'actual_cad')).toBe(750)
  })

  it('returns 0 for an empty list', () => {
    expect(sumCad([], 'budget_cad')).toBe(0)
  })

  it('returns 0 when all values are null', () => {
    const components: HardwareComponent[] = [
      { budget_cad: null, actual_cad: null },
      { budget_cad: null, actual_cad: null },
    ]
    expect(sumCad(components, 'budget_cad')).toBe(0)
  })
})

// ── Variance calculation ───────────────────────────────────────────────────────

function calcVariance(actual: number | null, budget: number | null): number | null {
  if (actual == null || budget == null) return null
  return actual - budget
}

describe('calcVariance', () => {
  it('returns null when actual is null', () => {
    expect(calcVariance(null, 1200)).toBeNull()
  })

  it('returns null when budget is null', () => {
    expect(calcVariance(1149, null)).toBeNull()
  })

  it('returns null when both are null', () => {
    expect(calcVariance(null, null)).toBeNull()
  })

  it('returns negative variance (under budget) as a negative number', () => {
    expect(calcVariance(1149.99, 1200)).toBeCloseTo(-50.01)
  })

  it('returns positive variance (over budget) as a positive number', () => {
    expect(calcVariance(1350, 1200)).toBeCloseTo(150)
  })

  it('returns 0 when actual equals budget exactly', () => {
    expect(calcVariance(1200, 1200)).toBe(0)
  })
})

// ── Status badge mapping ───────────────────────────────────────────────────────

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'planned': return 'bg-secondary text-secondary-foreground'
    case 'ordered': return 'bg-amber-900/50 text-amber-300 border-amber-800'
    case 'received': return 'bg-blue-900/50 text-blue-300 border-blue-800'
    case 'installed': return 'bg-green-900/50 text-green-300 border-green-800'
    default: return 'bg-secondary text-secondary-foreground'
  }
}

describe('statusBadgeClass', () => {
  it('maps planned to gray secondary class', () => {
    expect(statusBadgeClass('planned')).toContain('bg-secondary')
  })

  it('maps ordered to amber class', () => {
    expect(statusBadgeClass('ordered')).toContain('text-amber-300')
  })

  it('maps received to blue class', () => {
    expect(statusBadgeClass('received')).toContain('text-blue-300')
  })

  it('maps installed to green class', () => {
    expect(statusBadgeClass('installed')).toContain('text-green-300')
  })

  it('falls back to secondary for unknown status', () => {
    expect(statusBadgeClass('unknown_status')).toContain('bg-secondary')
  })
})

// ── formatCad ─────────────────────────────────────────────────────────────────

function formatCad(val: number | null): string {
  if (val == null) return '—'
  return `$${val.toFixed(2)}`
}

describe('formatCad', () => {
  it('formats a positive number as $X.XX', () => {
    expect(formatCad(1200)).toBe('$1200.00')
  })

  it('formats null as em dash', () => {
    expect(formatCad(null)).toBe('—')
  })

  it('formats 0 as $0.00', () => {
    expect(formatCad(0)).toBe('$0.00')
  })

  it('formats a decimal value with two decimal places', () => {
    expect(formatCad(1149.99)).toBe('$1149.99')
  })
})

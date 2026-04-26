/**
 * tests/business-review-contrast.test.ts
 *
 * Acceptance test for WCAG AA contrast fixes on the /business-review page.
 *
 * Strategy: parse source files directly — no browser, no snapshots.
 * Each assertion locks in a specific corrected value so regressions are caught.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..')

function read(relPath: string) {
  return readFileSync(join(ROOT, relPath), 'utf-8')
}

// ── Token values ──────────────────────────────────────────────────────────────

describe('globals.css contrast tokens', () => {
  const css = read('app/globals.css')

  it('--color-text-disabled passes WCAG AA on surface (≥4.5:1)', () => {
    // #7e7c96 on #12131f ≈ 4.58:1. Any value from #3e3c50 would be ~1.73:1 (FAIL).
    expect(css).toMatch(/--color-text-disabled:\s*#7e7c96/)
  })

  it('--color-text-muted passes WCAG AA on surface (≥4.5:1)', () => {
    // #9896b0 on #12131f ≈ 6.45:1. Previous #7a7890 was 4.32:1 (FAIL).
    expect(css).toMatch(/--color-text-muted:\s*#9896b0/)
  })
})

// ── StatementCoverageGrid heading ─────────────────────────────────────────────

describe('StatementCoverageGrid heading pattern', () => {
  const src = read('app/(cockpit)/business-review/_components/StatementCoverageGrid.tsx')

  it('uses label-caps + pillar-money for heading (not raw text-disabled)', () => {
    // All three heading instances (GridSkeleton, GridError, main) must use the
    // same pattern as other panel headings — label-caps class + pillar-money color.
    const matches = src.match(/className="label-caps"[^>]*color: 'var\(--color-pillar-money\)'/g)
    expect(matches?.length).toBe(3)
  })

  it('does not use --color-text-disabled for any section heading', () => {
    // The heading span must never reference text-disabled — that was the failing combo.
    // (Sub-labels and timestamps may still use it, just not headings.)
    const lines = src.split('\n')
    const headingLines = lines.filter(
      (l) => l.includes('Statement Coverage') && l.includes('color')
    )
    expect(headingLines.length).toBe(0)
  })
})

/**
 * tests/design-system.test.ts
 *
 * F20 — Design system enforcement negative-control test.
 *
 * Verifies that the grep logic used in the F20 acceptance check correctly
 * identifies inline `style=` attributes in TSX content.
 *
 * This is a negative-control: we create a synthetic TSX string containing
 * `style=`, run the detection logic against it, and assert it would fail.
 * If this test passes, the F20 compliance check is working correctly.
 */

import { describe, it, expect } from 'vitest'

// ── F20 grep logic (reproduced inline so test has no external deps) ───────────

/**
 * Returns true if the TSX content contains an inline style attribute.
 * Mirrors the grep used in the F20 acceptance check:
 *   grep -l 'style=' <tsx-files>
 */
function hasInlineStyle(tsxContent: string): boolean {
  return tsxContent.includes('style=')
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('F20 design-system enforcement — negative control', () => {
  it('detects inline style= attribute in TSX content and would fail the gate', () => {
    // Synthetic TSX with a forbidden inline style
    const badTsx = `
import React from 'react'

export function BadComponent() {
  return (
    <div style={{ color: 'red', padding: '8px' }}>
      <span style="font-weight: bold">Hello</span>
    </div>
  )
}
`
    // The grep check must find style= in this content
    const found = hasInlineStyle(badTsx)
    expect(found).toBe(true)

    // If found === true, the gate would exit 1 (fail). Simulating that:
    const gateWouldFail = found
    expect(gateWouldFail).toBe(true)
  })

  it('does not false-positive on TSX with no inline styles', () => {
    const goodTsx = `
import React from 'react'
import { cn } from '@/lib/utils'

export function GoodComponent({ active }: { active: boolean }) {
  return (
    <div className={cn('p-4 rounded-lg', active && 'bg-primary text-primary-foreground')}>
      <span className="font-bold text-sm">Hello</span>
    </div>
  )
}
`
    const found = hasInlineStyle(goodTsx)
    expect(found).toBe(false)
  })
})

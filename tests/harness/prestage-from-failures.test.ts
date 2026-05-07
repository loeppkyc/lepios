/**
 * Tests for lib/harness/prestage/sources/from_failures.ts (parser only — no DB).
 *
 * Spec: docs/sprint-5/overnight-autonomy-acceptance.md §4.3 + AC-B2.
 */

import { describe, it, expect } from 'vitest'
import { parseFailures } from '@/lib/harness/prestage/sources/from_failures'

const SAMPLE = `## FAILURES

**F-N7: Sample failure title (2026-05-01)**
This is body text describing the failure.
The system did X and broke Y.
→ Queue task: do Z to fix it.

**F-N8: Another failure — with em dash (2026-05-02)**
A different failure body.
No follow-up directive here.

### SUCCESSES

**S-N1: This should not parse as a failure**
Body of a success.
`

describe('parseFailures', () => {
  it('extracts F-numbered entries from a markdown blob', () => {
    const out = parseFailures(SAMPLE)
    expect(out.length).toBe(2)
    expect(out[0].number).toBe('F-N7')
    expect(out[1].number).toBe('F-N8')
  })

  it('captures title text after the F-number', () => {
    const out = parseFailures(SAMPLE)
    expect(out[0].title).toContain('Sample failure title')
  })

  it('captures body text up to the next entry or section', () => {
    const out = parseFailures(SAMPLE)
    expect(out[0].body).toMatch(/system did X/)
    expect(out[0].body).toMatch(/Queue task/)
    expect(out[0].body).not.toMatch(/em dash/)
  })

  it('flags hasQueueTask when "Queue task:" appears in body', () => {
    const out = parseFailures(SAMPLE)
    expect(out[0].hasQueueTask).toBe(true)
    expect(out[1].hasQueueTask).toBe(false)
  })

  it('stops parsing at ### section boundary (does not pick up successes)', () => {
    const out = parseFailures(SAMPLE)
    expect(out.find((f) => f.number === 'S-N1')).toBeUndefined()
  })

  it('handles F-L (legacy) and F-N (new) numbering', () => {
    const out = parseFailures(`**F-L99: legacy entry**
body
**F-N42: new entry**
body
`)
    expect(out.map((f) => f.number)).toEqual(['F-L99', 'F-N42'])
  })

  it('returns empty array on empty input', () => {
    expect(parseFailures('')).toEqual([])
  })

  it('returns empty array when no F-entries present', () => {
    expect(parseFailures('## Just markdown\nno failures here')).toEqual([])
  })
})

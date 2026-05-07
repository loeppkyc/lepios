import { describe, expect, it } from 'vitest'

const lib = await import('../../scripts/check-f18-compliance.mjs')

function makeReader(map: Record<string, string>) {
  return (path: string) => map[path] ?? null
}

describe('findNewCockpitModules', () => {
  it('extracts modules from added files only', () => {
    const added = [
      'app/(cockpit)/example/page.tsx',
      'app/(cockpit)/example/loaders.ts',
      'app/(cockpit)/another/page.tsx',
      'lib/utils/helpers.ts',
      'tests/foo.test.ts',
    ]
    const result = lib.findNewCockpitModules(added)
    expect(result).toEqual([
      { slug: 'example', pageFile: 'app/(cockpit)/example/page.tsx' },
      { slug: 'another', pageFile: 'app/(cockpit)/another/page.tsx' },
    ])
  })

  it('ignores edits to nested files (only top-level page.tsx)', () => {
    const added = [
      'app/(cockpit)/example/_components/Card.tsx',
      'app/(cockpit)/example/sub/page.tsx',
    ]
    const result = lib.findNewCockpitModules(added)
    expect(result).toEqual([])
  })
})

describe('checkModuleCompliance', () => {
  it('flags missing F18 marker and missing capture', () => {
    const reader = makeReader({
      'app/(cockpit)/example/page.tsx': `
        export default function Page() { return <div>Hello</div> }
      `,
    })
    const findings = lib.checkModuleCompliance('example', reader)
    expect(findings.hasF18Marker).toBe(false)
    expect(findings.hasF18Exempt).toBe(false)
    expect(findings.hasCapture).toBe(false)

    const summary = lib.summarizeFindings(findings)
    expect(summary.ok).toBe(false)
    expect(summary.missing).toContain('F18: marker comment in page.tsx')
    expect(summary.missing).toContain('metrics capture (agent_events / logEvent / module table)')
  })

  it('passes when marker + capture both present in page.tsx', () => {
    const reader = makeReader({
      'app/(cockpit)/example/page.tsx': `
        // F18: bench=Streamlit_Q1_2026; surface=morning_digest weekly line
        import { logEvent } from '@/lib/knowledge/client'
        export default function Page() {
          void logEvent('example', 'example.viewed')
          return <div>Hello</div>
        }
      `,
    })
    const findings = lib.checkModuleCompliance('example', reader)
    expect(findings.hasF18Marker).toBe(true)
    expect(findings.hasCapture).toBe(true)

    const summary = lib.summarizeFindings(findings)
    expect(summary.ok).toBe(true)
  })

  it('passes when capture is in lib/<slug>/queries.ts', () => {
    const reader = makeReader({
      'app/(cockpit)/example/page.tsx': `
        // F18: bench=Colin_target; surface=widget on page
        import { loadData } from '@/lib/example/queries'
        export default function Page() { return <div>{loadData()}</div> }
      `,
      'lib/example/queries.ts': `
        export async function loadData() {
          await db.from('agent_events').insert({ domain: 'example', action: 'view' })
          return 'data'
        }
      `,
    })
    const findings = lib.checkModuleCompliance('example', reader)
    expect(findings.hasCapture).toBe(true)
    expect(findings.captureEvidence).toContain('lib/example/queries.ts')

    const summary = lib.summarizeFindings(findings)
    expect(summary.ok).toBe(true)
  })

  it('honors F18-EXEMPT marker', () => {
    const reader = makeReader({
      'app/(cockpit)/hub/page.tsx': `
        // F18-EXEMPT: hub page composes other tiles, no own metric
        export default function Page() { return <div>Hub</div> }
      `,
    })
    const findings = lib.checkModuleCompliance('hub', reader)
    expect(findings.hasF18Exempt).toBe(true)
    expect(findings.exemptReason).toBe('hub page composes other tiles, no own metric')

    const summary = lib.summarizeFindings(findings)
    expect(summary.ok).toBe(true)
    expect(summary.reason).toContain('exempt')
  })

  it('exempt short-circuits — does not require capture', () => {
    const reader = makeReader({
      'app/(cockpit)/internal/page.tsx': `
        // F18-EXEMPT: internal admin tool
        export default function Page() { return <div>Admin</div> }
      `,
    })
    const findings = lib.checkModuleCompliance('internal', reader)
    expect(lib.summarizeFindings(findings).ok).toBe(true)
  })

  it('detects logEvent() as capture', () => {
    const reader = makeReader({
      'app/(cockpit)/m/page.tsx': `
        // F18: bench=x; surface=y
        import { logEvent } from '@/lib/knowledge/client'
        export default function P() { logEvent('m', 'm.view'); return null }
      `,
    })
    const findings = lib.checkModuleCompliance('m', reader)
    expect(findings.hasCapture).toBe(true)
  })

  it('detects module_metric table writes as capture', () => {
    const reader = makeReader({
      'app/(cockpit)/m/page.tsx': `
        // F18: bench=x; surface=y
        export default function P() { return null }
      `,
      'lib/m/index.ts': `
        await db.from('module_metric').insert({ module: 'm', value: 1 })
      `,
    })
    const findings = lib.checkModuleCompliance('m', reader)
    expect(findings.hasCapture).toBe(true)
  })

  it('does not flag a module where only marker is missing if capture exists (still fails)', () => {
    const reader = makeReader({
      'app/(cockpit)/m/page.tsx': `
        import { logEvent } from '@/lib/knowledge/client'
        export default function P() { logEvent('m', 'view'); return null }
      `,
    })
    const findings = lib.checkModuleCompliance('m', reader)
    const summary = lib.summarizeFindings(findings)
    // Capture present but no marker — fails on marker requirement
    expect(summary.ok).toBe(false)
    expect(summary.missing).toEqual(['F18: marker comment in page.tsx'])
  })
})

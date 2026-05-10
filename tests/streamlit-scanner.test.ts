import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { scanStreamlitModules } from '../lib/scanners/streamlit-module-scanner'
import { categorize } from '../lib/scanners/streamlit-categories'
import { generateTaskSpecs } from '../lib/scanners/spec-generator'

function makeTempPages(files: Record<string, string>): string {
  const root = join(tmpdir(), `lepios-scanner-test-${Date.now()}`)
  mkdirSync(join(root, 'pages'), { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    const filePath = join(root, 'pages', name)
    mkdirSync(join(filePath, '..'), { recursive: true })
    writeFileSync(filePath, content, 'utf-8')
  }
  return root
}

describe('streamlit-scanner', () => {
  it('throws a clear error when rootPath does not exist', () => {
    expect(() => scanStreamlitModules('/nonexistent/path/that/does/not/exist')).toThrow(
      /cannot read pages\//i
    )
  })

  it('skips files that start with _ or .', () => {
    const root = makeTempPages({
      '_internal.py': 'import streamlit as st\nst.title("Internal")\n',
      '.hidden.py': 'import streamlit as st\nst.title("Hidden")\n',
      '10_Admin.py': 'import streamlit as st\nst.title("Admin")\n',
    })
    try {
      const candidates = scanStreamlitModules(root)
      const names = candidates.map((c) => c.filename)
      expect(names).not.toContain('_internal.py')
      expect(names).not.toContain('.hidden.py')
      expect(names).toContain('10_Admin.py')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('assigns category misc when categorize confidence is below 0.5', () => {
    // A file with no matching keywords should land in misc with confidence < 0.5
    const result = categorize('99_Zorp_Blargle.py', 'import streamlit as st\nst.title("Zorp")\n')
    expect(result.category).toBe('misc')
    expect(result.confidence).toBeLessThan(0.5)
  })

  it('spec generator returns valid TaskSpec shape for empty input', () => {
    const specs = generateTaskSpecs([])
    expect(specs).toEqual([])
  })

  it('spec generator handles modules with zero external APIs', () => {
    const root = makeTempPages({
      '91_Welcome.py': 'import streamlit as st\nst.title("Welcome")\nst.write("Hello")\n',
    })
    try {
      const candidates = scanStreamlitModules(root)
      const specs = generateTaskSpecs(candidates)
      expect(specs).toHaveLength(1)
      const spec = specs[0]
      expect(spec.module_filename).toBe('91_Welcome.py')
      expect(spec.title).toContain('Welcome')
      expect(spec.prereqs).toEqual([])
      expect(Array.isArray(spec.audit_hints)).toBe(true)
      expect(['critical', 'high', 'medium', 'low']).toContain(spec.priority)
      expect(['small', 'medium', 'large']).toContain(spec.estimated_weight)
      expect(Array.isArray(spec.gotchas)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  // Part A: subdir detection tests
  it('subdir with stub __init__.py falls through to largest .py file', () => {
    const bigContent = Array.from({ length: 110 }, (_, i) => `# line ${i}`).join('\n') +
      '\nimport streamlit as st\nst.title("Tax Centre")\n'
    const root = makeTempPages({
      'tax_centre/__init__.py': '# stub\nimport streamlit\n',
      'tax_centre/colin_tax.py': bigContent,
    })
    try {
      const candidates = scanStreamlitModules(root)
      expect(candidates).toHaveLength(1)
      expect(candidates[0].filename).toBe('tax_centre')
      expect(candidates[0].line_count).toBeGreaterThanOrEqual(100)
      expect(candidates[0].title).toContain('Tax Centre')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('subdir with non-stub __init__.py (>= 10 lines) is skipped', () => {
    const fatInit = Array.from({ length: 15 }, (_, i) => `# line ${i}`).join('\n')
    const root = makeTempPages({
      'big_module/__init__.py': fatInit,
      'big_module/main.py': Array.from({ length: 200 }, (_, i) => `# line ${i}`).join('\n'),
    })
    try {
      const candidates = scanStreamlitModules(root)
      expect(candidates).toHaveLength(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  // Part B: dead reference detection tests
  it('detects show_load_time dead reference', () => {
    const root = makeTempPages({
      '50_Dashboard.py': [
        'import streamlit as st',
        'st.title("Dashboard")',
        'show_load_time(start)',
      ].join('\n'),
    })
    try {
      const candidates = scanStreamlitModules(root)
      expect(candidates).toHaveLength(1)
      expect(candidates[0].gotchas.some((g) => /show_load_time/.test(g))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('does NOT flag get_sheet when sheets is imported', () => {
    const root = makeTempPages({
      '30_Finance.py': [
        'from utils.sheets import get_sheet',
        'import streamlit as st',
        'st.title("Finance")',
        "data = get_sheet('mysheet')",
      ].join('\n'),
    })
    try {
      const candidates = scanStreamlitModules(root)
      expect(candidates).toHaveLength(1)
      expect(candidates[0].gotchas.some((g) => /get_sheet/.test(g))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

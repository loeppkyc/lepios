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
    writeFileSync(join(root, 'pages', name), content, 'utf-8')
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
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

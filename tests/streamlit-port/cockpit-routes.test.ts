/**
 * Port of tests/test_page_imports.py — verifies cockpit page routes exist on disk.
 * Streamlit: checked app.py page references + py_compile. LepiOS: checks Next.js
 * app/(cockpit)/<route>/page.tsx exists for every declared cockpit route.
 */
import { describe, it, expect } from 'vitest'
import { existsSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..', '..')
const COCKPIT = join(ROOT, 'app', '(cockpit)')

// Core cockpit routes that must always exist
const REQUIRED_ROUTES = [
  'amazon',
  'bookkeeping',
  'bookkeeping-hub',
  'business-review',
  'cash-forecast',
  'failures',
  'gst-return',
  'inventory',
  'money',
  'monthly-expenses',
  'monthly-pnl',
  'net-worth',
  'receipts',
  'reconciliation',
  'recurring',
  'scan',
  'tax-centre',
]

describe('cockpit routes exist on disk', () => {
  for (const route of REQUIRED_ROUTES) {
    it(`app/(cockpit)/${route}/page.tsx`, () => {
      const pagePath = join(COCKPIT, route, 'page.tsx')
      expect(existsSync(pagePath), `missing: ${pagePath}`).toBe(true)
    })
  }
})

describe('cockpit layout exists', () => {
  it('app/(cockpit)/layout.tsx', () => {
    expect(existsSync(join(COCKPIT, 'layout.tsx'))).toBe(true)
  })
})

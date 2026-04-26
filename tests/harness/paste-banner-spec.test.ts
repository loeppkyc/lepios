/**
 * Tests for F-L9 paste banner standard.
 *
 * Asserts both agent specs (coordinator.md, builder.md) carry the
 * `=== PASTE THIS ===` / `=== END PASTE ===` delimiter standard.
 * If either section is deleted, the standard silently rots — this test
 * fails loudly instead. Doc-only enforcement isn't enough; a transcript
 * grep would be overkill since transcripts aren't in-repo.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const COORDINATOR_PATH = resolve(__dirname, '../../.claude/agents/coordinator.md')
const BUILDER_PATH = resolve(__dirname, '../../.claude/agents/builder.md')

function read(path: string): string {
  return readFileSync(path, 'utf-8')
}

describe('F-L9 paste banner standard', () => {
  it('coordinator.md contains the open delimiter', () => {
    expect(read(COORDINATOR_PATH)).toContain('=== PASTE THIS ===')
  })

  it('coordinator.md contains the close delimiter', () => {
    expect(read(COORDINATOR_PATH)).toContain('=== END PASTE ===')
  })

  it('coordinator.md has the named section header', () => {
    expect(read(COORDINATOR_PATH)).toMatch(/Paste Block Banner Standard \(F-L9\)/)
  })

  it('builder.md contains the open delimiter', () => {
    expect(read(BUILDER_PATH)).toContain('=== PASTE THIS ===')
  })

  it('builder.md contains the close delimiter', () => {
    expect(read(BUILDER_PATH)).toContain('=== END PASTE ===')
  })

  it('builder.md has the named section header', () => {
    expect(read(BUILDER_PATH)).toMatch(/Paste Block Banner Standard \(F-L9\)/)
  })
})

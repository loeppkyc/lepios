/**
 * Caps parity gate — validates that the `caps:` frontmatter array in each
 * .claude/agents/*.md file exactly matches the capability strings seeded in
 * supabase/migrations/0045_security_layer_schema.sql.
 *
 * This test runs at CI time (no live DB required — it diffs two local files).
 * Purpose: catch frontmatter ↔ migration drift before any enforce-mode flip.
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

const ROOT = path.resolve(__dirname, '../..')

// ── Frontmatter parser ────────────────────────────────────────────────────────

/**
 * Extracts the `caps:` YAML list from a markdown file's frontmatter block.
 * Expects the block to start at line 1 with `---`.
 */
function parseCapsFromAgentFile(filePath: string): string[] {
  const raw = fs.readFileSync(filePath, 'utf8')
  // Normalize CRLF → LF so Windows-authored files parse correctly
  const lines = raw.replace(/\r\n/g, '\n').split('\n')

  if (lines[0].trim() !== '---') {
    throw new Error(`${filePath}: first line is not "---" — no frontmatter`)
  }

  const endIdx = lines.indexOf('---', 1)
  if (endIdx === -1) {
    throw new Error(`${filePath}: frontmatter closing "---" not found`)
  }

  const frontmatter = lines.slice(1, endIdx)
  const caps: string[] = []
  let inCaps = false

  for (const line of frontmatter) {
    if (line.trim() === 'caps:') {
      inCaps = true
      continue
    }
    if (inCaps) {
      // Indented list item: "  - capability.string"
      const match = line.match(/^\s+-\s+(.+)$/)
      if (match) {
        caps.push(match[1].trim())
      } else if (line.trim() !== '') {
        // Hit a non-list, non-empty line — caps section ended
        inCaps = false
      }
    }
  }

  return caps
}

// ── Migration parser ──────────────────────────────────────────────────────────

/**
 * Extracts the capability strings granted to `agentId` from the
 * 0045 migration's INSERT statements.
 */
function parseCapsFromMigration(agentId: string): string[] {
  const migPath = path.join(ROOT, 'supabase/migrations/0045_security_layer_schema.sql')
  const sql = fs.readFileSync(migPath, 'utf8')

  const caps: string[] = []
  // Match lines like:  ('coordinator', 'shell.run',   'log_only', ...)
  // or               ('builder',      'db.read.*',    'log_only', ...)
  const lineRe = new RegExp(`^\\s*\\('${agentId}'\\s*,\\s*'([^']+)'\\s*,`, 'gm')
  let m: RegExpExecArray | null
  while ((m = lineRe.exec(sql)) !== null) {
    caps.push(m[1])
  }
  return caps
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const AGENTS = ['coordinator', 'builder'] as const

describe.each(AGENTS)('%s — caps frontmatter matches migration 0045', (agentId) => {
  const agentFile = path.join(ROOT, `.claude/agents/${agentId}.md`)
  const frontmatterCaps = parseCapsFromAgentFile(agentFile).sort()
  const migrationCaps = parseCapsFromMigration(agentId).sort()

  it('agent file has a non-empty caps: list', () => {
    expect(frontmatterCaps.length).toBeGreaterThan(0)
  })

  it('migration has a non-empty grant list', () => {
    expect(migrationCaps.length).toBeGreaterThan(0)
  })

  it('frontmatter count matches migration row count', () => {
    expect(frontmatterCaps.length).toBe(migrationCaps.length)
  })

  it('every frontmatter cap exists in the migration', () => {
    const missing = frontmatterCaps.filter((c) => !migrationCaps.includes(c))
    expect(missing).toEqual([])
  })

  it('every migration grant appears in frontmatter', () => {
    const extra = migrationCaps.filter((c) => !frontmatterCaps.includes(c))
    expect(extra).toEqual([])
  })
})

describe('coordinator — specific known caps present', () => {
  const agentFile = path.join(ROOT, '.claude/agents/coordinator.md')
  const caps = parseCapsFromAgentFile(agentFile)

  it.each([
    'shell.run',
    'git.commit',
    'git.branch',
    'fs.read',
    'fs.write',
    'secret.read.CRON_SECRET',
    'net.outbound.telegram',
  ])('has cap: %s', (cap) => {
    expect(caps).toContain(cap)
  })

  it('does NOT have git.push (escalation-gated)', () => {
    expect(caps).not.toContain('git.push')
  })

  it('does NOT have net.outbound.vercel.deploy (coordinator cannot deploy)', () => {
    expect(caps).not.toContain('net.outbound.vercel.deploy')
  })
})

describe('builder — specific known caps present', () => {
  const agentFile = path.join(ROOT, '.claude/agents/builder.md')
  const caps = parseCapsFromAgentFile(agentFile)

  it.each([
    'shell.run',
    'git.commit',
    'git.push',
    'git.branch',
    'db.migrate',
    'net.outbound.vercel.deploy',
    'secret.read.SUPABASE_SERVICE_ROLE_KEY',
  ])('has cap: %s', (cap) => {
    expect(caps).toContain(cap)
  })

  it('does NOT have git.force_push (absent from registry)', () => {
    expect(caps).not.toContain('git.force_push')
  })
})

describe('parseCapsFromAgentFile — error handling', () => {
  it('throws if frontmatter delimiter is missing', () => {
    // Write a temp file with no frontmatter
    const tmp = path.join(ROOT, 'tests/security/__tmp_no_frontmatter.md')
    fs.writeFileSync(tmp, '# No frontmatter here\n')
    try {
      expect(() => parseCapsFromAgentFile(tmp)).toThrow(/first line is not/)
    } finally {
      fs.unlinkSync(tmp)
    }
  })

  it('throws if closing --- is missing', () => {
    const tmp = path.join(ROOT, 'tests/security/__tmp_unclosed.md')
    fs.writeFileSync(tmp, '---\nname: test\n# no closing ---\n')
    try {
      expect(() => parseCapsFromAgentFile(tmp)).toThrow(/closing.*not found/)
    } finally {
      fs.unlinkSync(tmp)
    }
  })

  it('returns empty array when caps: key is absent', () => {
    const tmp = path.join(ROOT, 'tests/security/__tmp_no_caps.md')
    fs.writeFileSync(tmp, '---\nname: test\ntools: Read\n---\n# body\n')
    try {
      const caps = parseCapsFromAgentFile(tmp)
      expect(caps).toEqual([])
    } finally {
      fs.unlinkSync(tmp)
    }
  })
})

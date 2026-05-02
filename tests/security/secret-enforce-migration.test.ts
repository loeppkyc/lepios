/**
 * Tests for migration 0063: secret capability enforce flip.
 *
 * Static parse — verifies the SQL targets exactly the right capabilities
 * before the migration is applied to production. Guards against:
 *   - Accidentally including TELEGRAM_CHAT_ID (non-secret, must stay log_only)
 *   - Missing any of the five real secret caps
 *   - Typos in capability strings
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const sql = readFileSync(
  resolve(__dirname, '../../supabase/migrations/0063_secret_capability_enforce.sql'),
  'utf8'
)

const EXPECTED_CAPS = [
  'secret.read.SUPABASE_SERVICE_ROLE_KEY',
  'secret.read.CRON_SECRET',
  'secret.read.TELEGRAM_BOT_TOKEN_ALERTS',
  'secret.read.TELEGRAM_BOT_TOKEN_BUILDER',
  'secret.read.TELEGRAM_BOT_TOKEN_DAILY',
]

const MUST_NOT_ENFORCE = ['secret.read.TELEGRAM_CHAT_ID', 'secret.read.*']

describe('migration 0063 — secret capability enforce flip', () => {
  it('targets all five real secret capabilities in the registry UPDATE', () => {
    for (const cap of EXPECTED_CAPS) {
      expect(sql).toContain(cap)
    }
  })

  it('does not enforce TELEGRAM_CHAT_ID (non-secret, must stay log_only)', () => {
    // Only allowed occurrence is in the explanatory comment
    const lines = sql
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')
    expect(lines).not.toContain('secret.read.TELEGRAM_CHAT_ID')
  })

  it('does not use the wildcard secret.read.* in enforce UPDATEs', () => {
    const nonCommentLines = sql
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n')
    expect(nonCommentLines).not.toContain("'secret.read.*'")
  })

  it('updates capability_registry default_enforcement', () => {
    expect(sql).toContain('UPDATE public.capability_registry')
    expect(sql).toContain("default_enforcement = 'enforce'")
  })

  it('updates agent_capabilities enforcement_mode', () => {
    expect(sql).toContain('UPDATE public.agent_capabilities')
    expect(sql).toContain("enforcement_mode = 'enforce'")
  })

  it('bumps harness_components security_layer to 85', () => {
    expect(sql).toContain('harness:security_layer')
    expect(sql).toContain('completion_pct = 85')
  })

  it('includes a rollback block', () => {
    expect(sql).toContain('Rollback')
    expect(sql).toContain("'log_only'")
  })

  for (const cap of MUST_NOT_ENFORCE) {
    it(`does not enforce ${cap} in non-comment SQL`, () => {
      const nonCommentLines = sql
        .split('\n')
        .filter((l) => !l.trim().startsWith('--'))
        .join('\n')
      expect(nonCommentLines).not.toContain(`'${cap}'`)
    })
  }
})

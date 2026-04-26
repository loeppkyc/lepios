/**
 * F21 acceptance tests for lib/harness/telegram-escape.ts
 *
 * Covers escapeTelegramMarkdown():
 *   - Branch names with underscores (the root cause of 1579a94c)
 *   - Task IDs with hyphens
 *   - Commit messages with asterisks, backticks
 *   - Empty string
 *   - All MarkdownV2 special chars: _ * [ ] ( ) ~ ` > # + - = | { } . !
 *   - Clean strings pass through unchanged
 */

import { describe, it, expect } from 'vitest'
import { escapeTelegramMarkdown } from '@/lib/harness/telegram-escape'

describe('escapeTelegramMarkdown', () => {
  it('escapes underscores in branch names (root cause of 1579a94c)', () => {
    expect(escapeTelegramMarkdown('feat/ollama_tunnel_smoke')).toBe(
      'feat/ollama\\_tunnel\\_smoke'
    )
    expect(escapeTelegramMarkdown('fix/h1_coordinator_drain_403')).toBe(
      'fix/h1\\_coordinator\\_drain\\_403'
    )
  })

  it('escapes underscores in field names like task_id', () => {
    expect(escapeTelegramMarkdown('task_id: 915d1fee-18bd-4718-bde5-8a6956a72084')).toBe(
      'task\\_id: 915d1fee\\-18bd\\-4718\\-bde5\\-8a6956a72084'
    )
  })

  it('escapes hyphens in task IDs and UUIDs', () => {
    expect(escapeTelegramMarkdown('915d1fee-18bd-4718-bde5-8a6956a72084')).toBe(
      '915d1fee\\-18bd\\-4718\\-bde5\\-8a6956a72084'
    )
  })

  it('escapes asterisks in commit messages', () => {
    expect(escapeTelegramMarkdown('fix: resolve **critical** auth bug')).toBe(
      'fix: resolve \\*\\*critical\\*\\* auth bug'
    )
    expect(escapeTelegramMarkdown('feat: add * wildcard support')).toBe(
      'feat: add \\* wildcard support'
    )
  })

  it('escapes backticks in commit messages', () => {
    expect(escapeTelegramMarkdown('fix: escape `parse_mode` before send')).toBe(
      'fix: escape \\`parse\\_mode\\` before send'
    )
  })

  it('handles empty string without throwing', () => {
    expect(escapeTelegramMarkdown('')).toBe('')
  })

  it('escapes all MarkdownV2 special chars: _ * [ ] ( ) ~ ` > # + - = | { } . !', () => {
    const allSpecial = '_*[]()~`>#+-=|{}.!'
    const escaped = escapeTelegramMarkdown(allSpecial)
    // Every char should be backslash-prefixed
    expect(escaped).toBe('\\_\\*\\[\\]\\(\\)\\~\\`\\>\\#\\+\\-\\=\\|\\{\\}\\.\\!')
  })

  it('leaves clean alphanumeric strings unchanged', () => {
    expect(escapeTelegramMarkdown('LepiOS Coordinator')).toBe('LepiOS Coordinator')
    expect(escapeTelegramMarkdown('Status: complete')).toBe('Status: complete')
    expect(escapeTelegramMarkdown('abc123 XYZ')).toBe('abc123 XYZ')
  })

  it('preserves newlines (used in all coordinator messages)', () => {
    const msg = 'Line 1\nLine 2\nLine 3'
    expect(escapeTelegramMarkdown(msg)).toBe('Line 1\nLine 2\nLine 3')
  })

  it('escapes a realistic coordinator completion message', () => {
    const raw =
      '[LepiOS Coordinator] button-data-invalid\nStatus: complete\ntask_id: 915d1fee-18bd-4718-bde5-8a6956a72084\nBuilder task 6d4f2276 queued.'
    const escaped = escapeTelegramMarkdown(raw)
    // Brackets, underscores, and hyphens all escaped
    expect(escaped).toContain('\\[LepiOS Coordinator\\]')
    expect(escaped).toContain('task\\_id')
    expect(escaped).toContain('915d1fee\\-18bd')
    expect(escaped).toContain('6d4f2276 queued\\.')
  })
})

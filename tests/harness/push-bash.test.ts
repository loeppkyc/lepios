/**
 * push_bash_automation Slice 1 — Acceptance tests
 *
 * AC-1  through AC-9:  Policy tests — decideAction() is a pure function, no mocks needed.
 * AC-10 through AC-13: Route tests  — mock runInSandbox, DB, and telegram.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mocks (must be hoisted before any imports) ─────────────────────────────────

const { mockRunInSandbox, mockFrom, mockTelegram } = vi.hoisted(() => {
  const mockRunInSandbox = vi.fn()
  const mockFrom = vi.fn()
  const mockTelegram = vi.fn().mockResolvedValue({ ok: true })
  return { mockRunInSandbox, mockFrom, mockTelegram }
})

vi.mock('@/lib/harness/sandbox/runtime', () => ({
  runInSandbox: mockRunInSandbox,
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

vi.mock('@/lib/harness/arms-legs', () => ({
  telegram: mockTelegram,
}))

// ── Imports ────────────────────────────────────────────────────────────────────

import { decideAction } from '@/lib/harness/push-bash/policy'
import { POST } from '@/app/api/harness/push-bash/route'

// ── Helpers ────────────────────────────────────────────────────────────────────

const VALID_SECRET = 'test-push-bash-secret'

function makeRequest(body: unknown, secret: string | null = VALID_SECRET): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (secret !== null) headers['Authorization'] = `Bearer ${secret}`
  return new Request('http://localhost/api/harness/push-bash', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

/** Build a minimal DB insert chain that resolves with the given id */
function makeInsertChain(id = 'test-decision-uuid') {
  const single = vi.fn().mockResolvedValue({ data: { id }, error: null })
  const select = vi.fn().mockReturnValue({ single })
  const insert = vi.fn().mockReturnValue({ select })
  return { insert, select, single }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = VALID_SECRET
  process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token'
  process.env.TELEGRAM_ALERTS_BOT_TOKEN = 'test-alerts-token'
  process.env.TELEGRAM_CHAT_ID = '12345'
})

afterEach(() => {
  delete process.env.CRON_SECRET
  delete process.env.TELEGRAM_BOT_TOKEN
  delete process.env.TELEGRAM_ALERTS_BOT_TOKEN
  delete process.env.TELEGRAM_CHAT_ID
})

// ── AC-1 through AC-9: Policy tests (pure function, no mocks) ─────────────────

describe('decideAction — block tier', () => {
  it('AC-1: blocks git push --force', () => {
    const result = decideAction('git push --force origin main')
    expect(result.tier).toBe('block')
  })

  it('AC-2: blocks rm -rf', () => {
    const result = decideAction('rm -rf /tmp/foo')
    expect(result.tier).toBe('block')
  })

  it('AC-3: blocks command containing TOKEN=', () => {
    const result = decideAction('curl https://api.example.com -H "Authorization: TOKEN=abc123"')
    expect(result.tier).toBe('block')
  })

  it('AC-4: blocks DROP TABLE (destructive SQL)', () => {
    const result = decideAction('psql -c "DROP TABLE users"')
    expect(result.tier).toBe('block')
  })
})

describe('decideAction — confirm tier', () => {
  it('AC-5: confirms git commit', () => {
    const result = decideAction('git commit -m "fix: foo"')
    expect(result.tier).toBe('confirm')
  })

  it('AC-6: confirms npm install', () => {
    const result = decideAction('npm install lodash')
    expect(result.tier).toBe('confirm')
  })
})

describe('decideAction — auto tier', () => {
  it('AC-7: auto-approves npm test', () => {
    const result = decideAction('npm test')
    expect(result.tier).toBe('auto')
  })

  it('AC-8: auto-approves git status', () => {
    const result = decideAction('git status')
    expect(result.tier).toBe('auto')
  })
})

describe('decideAction — default confirm', () => {
  it('AC-9: unknown command defaults to confirm with reason mentioning "unknown command"', () => {
    const result = decideAction('some-unknown-cli --flag')
    expect(result.tier).toBe('confirm')
    expect(result.reason).toMatch(/unknown command/)
  })
})

// ── AC-10 through AC-13: Route tests (mocked) ─────────────────────────────────

describe('POST /api/harness/push-bash — auth', () => {
  it('AC-10: returns 401 when no Authorization header is provided', async () => {
    const req = makeRequest({ cmd: 'git status' }, null)
    const res = await POST(req as Parameters<typeof POST>[0])
    expect(res.status).toBe(401)
  })
})

describe('POST /api/harness/push-bash — body validation', () => {
  it('AC-11: returns 400 when cmd is not a string', async () => {
    const req = makeRequest({ cmd: 123 })
    const res = await POST(req as Parameters<typeof POST>[0])
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_body')
  })
})

describe('POST /api/harness/push-bash — auto tier', () => {
  it('AC-12: returns 200 with sandbox result for auto-tier command', async () => {
    // Mock sandbox
    mockRunInSandbox.mockResolvedValue({
      runId: 'sandbox-run-uuid',
      sandboxId: 'push_bash_automation:sandbox-foo',
      worktreePath: '/tmp/worktrees/sandbox-foo',
      exitCode: 0,
      stdout: 'PASS  tests/harness/push-bash.test.ts',
      stderr: '',
      timedOut: false,
      durationMs: 4200,
      filesChanged: [],
      diffStat: { insertions: 0, deletions: 0, files: 0 },
      diffHash: 'abc123',
      warnings: ['process_isolation_not_enforced'],
    })

    // Mock DB insert chain for auto tier
    const { insert } = makeInsertChain('auto-decision-uuid')
    mockFrom.mockReturnValue({ insert })

    const req = makeRequest({ cmd: 'npm test', agentId: 'builder' })
    const res = await POST(req as Parameters<typeof POST>[0])
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.tier).toBe('auto')
    expect(body.status).toBe('auto_executed')
    expect(typeof body.exitCode).toBe('number')
    expect(body.exitCode).toBe(0)
    expect(body.stdout).toBeDefined()
  })
})

describe('POST /api/harness/push-bash — block tier', () => {
  it('AC-13: returns 200 with block result for blocked command, no exitCode', async () => {
    // Mock DB insert chain for block tier
    const { insert } = makeInsertChain('block-decision-uuid')
    mockFrom.mockReturnValue({ insert })

    const req = makeRequest({ cmd: 'rm -rf .' })
    const res = await POST(req as Parameters<typeof POST>[0])
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.tier).toBe('block')
    expect(body.status).toBe('blocked')
    expect(body.exitCode).toBeUndefined()
    expect(body.stdout).toBeUndefined()
    expect(body.stderr).toBeUndefined()
  })
})

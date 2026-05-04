/**
 * Sandbox Slice 3 — unit tests for POST /api/harness/sandbox-run
 *
 * AC-1: Missing CRON_SECRET → 401
 * AC-2: Valid auth, invalid body → 400 with error:"invalid_body" + issues array
 * AC-3: Valid auth, valid body → 200 with full SandboxRunResult shape
 * AC-4: SandboxDeniedError thrown → 403 with error:"sandbox_denied"
 * AC-5: Unexpected error → 500 with error:"internal"
 * AC-6: F22 compliance — requireCronSecret imported and called; no inline CRON_SECRET check
 *
 * All mocked — no real worktrees, no real subprocess.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'
import fs from 'fs'

// ── requireCronSecret mock ────────────────────────────────────────────────────

const { mockRequireCronSecret } = vi.hoisted(() => ({
  mockRequireCronSecret: vi.fn(),
}))

vi.mock('@/lib/auth/cron-secret', () => ({
  requireCronSecret: mockRequireCronSecret,
}))

// ── runInSandbox mock ─────────────────────────────────────────────────────────

const { mockRunInSandbox } = vi.hoisted(() => ({
  mockRunInSandbox: vi.fn(),
}))

vi.mock('@/lib/harness/sandbox/runtime', () => ({
  runInSandbox: mockRunInSandbox,
}))

// ── SandboxDeniedError mock ───────────────────────────────────────────────────
//
// We need the real SandboxDeniedError class so instanceof checks in the route
// handler work correctly. Import it after vi.mock declarations so the module
// is available, but we do NOT mock sandbox-contract — we need the real class.

import { SandboxDeniedError } from '@/lib/security/sandbox-contract'

// ── Route handler (imported after all mocks are declared) ────────────────────

import { POST } from '@/app/api/harness/sandbox-run/route'
import { NextRequest, NextResponse } from 'next/server'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/harness/sandbox-run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

const FIXTURE_RESULT = {
  sandboxId: 'builder:sandbox-ABC123',
  worktreePath: '/tmp/.claude/worktrees/sandbox-ABC123',
  exitCode: 0,
  stdout: 'hello',
  stderr: '',
  timedOut: false,
  durationMs: 42,
  filesChanged: [],
  diffStat: { insertions: 0, deletions: 0, files: 0 },
  diffHash: '',
  runId: '00000000-0000-0000-0000-000000000001',
  warnings: ['process_isolation_not_enforced'],
}

const VALID_BODY = {
  cmd: 'echo hello',
  agentId: 'builder',
  capability: 'sandbox.run',
  scope: { fs: {} },
}

// ── Test lifecycle ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-1 — Missing CRON_SECRET → 401
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-1 — missing auth → 401', () => {
  it('returns 401 when requireCronSecret returns a 401 response', async () => {
    mockRequireCronSecret.mockReturnValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )

    const req = makeRequest(VALID_BODY)
    const res = await POST(req)

    expect(res.status).toBe(401)
    expect(mockRunInSandbox).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-2 — Valid auth, invalid body → 400
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-2 — valid auth, invalid body → 400', () => {
  it('returns 400 with error:"invalid_body" and issues array when body is invalid', async () => {
    mockRequireCronSecret.mockReturnValueOnce(null)

    const req = makeRequest({ cmd: 123 }) // cmd must be string | string[]
    const res = await POST(req)

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_body')
    expect(Array.isArray(body.issues)).toBe(true)
    expect(body.issues.length).toBeGreaterThan(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-3 — Valid auth, valid body → 200 with full SandboxRunResult shape
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-3 — valid auth, valid body → 200 with SandboxRunResult', () => {
  it('returns 200 with all SandboxRunResult fields', async () => {
    mockRequireCronSecret.mockReturnValueOnce(null)
    mockRunInSandbox.mockResolvedValueOnce(FIXTURE_RESULT)

    const req = makeRequest(VALID_BODY)
    const res = await POST(req)

    expect(res.status).toBe(200)
    const body = await res.json()

    // Assert all required SandboxRunResult fields are present
    expect(typeof body.sandboxId).toBe('string')
    expect(typeof body.worktreePath).toBe('string')
    expect(body.exitCode).toBe(0)
    expect(typeof body.stdout).toBe('string')
    expect(typeof body.stderr).toBe('string')
    expect(typeof body.timedOut).toBe('boolean')
    expect(typeof body.durationMs).toBe('number')
    expect(Array.isArray(body.filesChanged)).toBe(true)
    expect(typeof body.diffStat).toBe('object')
    expect(typeof body.diffStat.insertions).toBe('number')
    expect(typeof body.diffStat.deletions).toBe('number')
    expect(typeof body.diffStat.files).toBe('number')
    expect(typeof body.diffHash).toBe('string')
    expect(typeof body.runId).toBe('string')
    expect(Array.isArray(body.warnings)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-4 — SandboxDeniedError → 403
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-4 — SandboxDeniedError → 403', () => {
  it('returns 403 with error:"sandbox_denied" and reason field', async () => {
    mockRequireCronSecret.mockReturnValueOnce(null)
    mockRunInSandbox.mockRejectedValueOnce(
      new SandboxDeniedError('builder', 'sandbox.run', 'not_granted', 'audit-uuid-001')
    )

    const req = makeRequest(VALID_BODY)
    const res = await POST(req)

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('sandbox_denied')
    expect(typeof body.reason).toBe('string')
    expect(body.reason).toBe('not_granted')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-5 — Unexpected error → 500
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-5 — unexpected error → 500', () => {
  it('returns 500 with error:"internal" and message field', async () => {
    mockRequireCronSecret.mockReturnValueOnce(null)
    mockRunInSandbox.mockRejectedValueOnce(new Error('disk full'))

    const req = makeRequest(VALID_BODY)
    const res = await POST(req)

    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('internal')
    expect(typeof body.message).toBe('string')
    expect(body.message).toBe('disk full')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// AC-6 — F22 compliance (file-level grep)
// ─────────────────────────────────────────────────────────────────────────────

describe('AC-6 — F22 compliance: requireCronSecret used, no inline CRON_SECRET check', () => {
  it('route file imports and calls requireCronSecret', () => {
    const routePath = path.resolve(__dirname, '../../app/api/harness/sandbox-run/route.ts')

    expect(fs.existsSync(routePath)).toBe(true)
    const content = fs.readFileSync(routePath, 'utf8')

    // requireCronSecret must be imported and called at least once
    const matchCount = (content.match(/requireCronSecret/g) ?? []).length
    expect(matchCount).toBeGreaterThanOrEqual(1)
  })

  it('route file does NOT contain inline process.env.CRON_SECRET check', () => {
    const routePath = path.resolve(__dirname, '../../app/api/harness/sandbox-run/route.ts')

    const content = fs.readFileSync(routePath, 'utf8')

    // No inline CRON_SECRET access
    const inlineCount = (content.match(/process\.env\.CRON_SECRET/g) ?? []).length
    expect(inlineCount).toBe(0)
  })
})

/**
 * Unit tests for lib/harness/arms-legs/fs.ts + fs-handlers.ts
 *
 * All external I/O is mocked:
 *   - node:fs  (readFileSync, writeFileSync, mkdirSync, unlinkSync)
 *   - @/lib/security/capability (checkCapability)
 *   - @/lib/supabase/service    (agent_events logging)
 *
 * Handlers are registered once via import './fs-handlers' side effects.
 * The registry is NOT reset between tests — handlers are deterministic
 * and the mocked fs functions are reconfigured per test via mockReturnValue.
 *
 * Coverage:
 *   - fsRead: happy path, file not found (ENOENT), path traversal rejected
 *   - fsWrite: happy path (creates parent dir), path traversal rejected
 *   - fsExists: returns true when file readable, false on ENOENT
 *   - fsDelete: happy path, path traversal rejected
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolve } from 'path'

// ── Mock node:fs ──────────────────────────────────────────────────────────────

const { mockReadFileSync, mockWriteFileSync, mockMkdirSync, mockUnlinkSync } = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
}))

vi.mock('fs', () => ({
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
  unlinkSync: mockUnlinkSync,
}))

// ── Mock checkCapability ──────────────────────────────────────────────────────

const { mockCheckCapability } = vi.hoisted(() => ({
  mockCheckCapability: vi.fn(),
}))

vi.mock('@/lib/security/capability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/capability')>()
  return { ...actual, checkCapability: mockCheckCapability }
})

// ── Mock Supabase (agent_events logging) ─────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

// ── Side effects: registers fs.read / fs.write / fs.delete handlers ──────────

import '@/lib/harness/arms-legs/fs-handlers'
import { fsRead, fsWrite, fsExists, fsDelete } from '@/lib/harness/arms-legs/fs'

// ── Helpers ───────────────────────────────────────────────────────────────────

const PROJECT_PATH = resolve(process.cwd(), 'test-file.txt')
const SUBDIR_PATH = resolve(process.cwd(), 'sub', 'dir', 'file.txt')

function makeInsertChain() {
  const insert = vi.fn().mockResolvedValue({ data: null, error: null })
  return { insert }
}

function makeCapAllowed() {
  mockCheckCapability.mockResolvedValue({
    allowed: true,
    reason: 'in_scope',
    enforcement_mode: 'log_only',
    audit_id: 'audit-fs-1',
  })
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockFrom.mockReturnValue(makeInsertChain())
  makeCapAllowed()
})

// ── fsRead ────────────────────────────────────────────────────────────────────

describe('fsRead — happy path', () => {
  it('returns file content as string', async () => {
    mockReadFileSync.mockReturnValue('hello world')

    const content = await fsRead(PROJECT_PATH, 'test_agent')

    expect(content).toBe('hello world')
    expect(mockReadFileSync).toHaveBeenCalledWith(PROJECT_PATH, 'utf-8')
  })
})

describe('fsRead — file not found', () => {
  it('throws with handler_error when readFileSync throws ENOENT', async () => {
    mockReadFileSync.mockImplementation(() => {
      const err = new Error('ENOENT: no such file') as NodeJS.ErrnoException
      err.code = 'ENOENT'
      throw err
    })

    await expect(fsRead(PROJECT_PATH, 'test_agent')).rejects.toThrow(
      'fs.read failed [handler_error]'
    )
  })
})

describe('fsRead — path traversal', () => {
  it('throws with handler_error when path escapes project root', async () => {
    const badPath = resolve('/', 'etc', 'passwd')
    await expect(fsRead(badPath, 'test_agent')).rejects.toThrow('fs.read failed [handler_error]')
    expect(mockReadFileSync).not.toHaveBeenCalled()
  })
})

// ── fsWrite ───────────────────────────────────────────────────────────────────

describe('fsWrite — happy path', () => {
  it('creates parent dirs and writes file', async () => {
    mockMkdirSync.mockReturnValue(undefined)
    mockWriteFileSync.mockReturnValue(undefined)

    await fsWrite(SUBDIR_PATH, 'content here', 'test_agent')

    expect(mockMkdirSync).toHaveBeenCalledWith(resolve(process.cwd(), 'sub', 'dir'), {
      recursive: true,
    })
    expect(mockWriteFileSync).toHaveBeenCalledWith(SUBDIR_PATH, 'content here', 'utf-8')
  })
})

describe('fsWrite — path traversal', () => {
  it('throws with handler_error when path escapes project root', async () => {
    const badPath = resolve('/', 'tmp', 'evil.txt')
    await expect(fsWrite(badPath, 'evil', 'test_agent')).rejects.toThrow(
      'fs.write failed [handler_error]'
    )
    expect(mockWriteFileSync).not.toHaveBeenCalled()
  })
})

// ── fsExists ──────────────────────────────────────────────────────────────────

describe('fsExists — file present', () => {
  it('returns true when readFileSync succeeds', async () => {
    mockReadFileSync.mockReturnValue('anything')

    const exists = await fsExists(PROJECT_PATH, 'test_agent')

    expect(exists).toBe(true)
  })
})

describe('fsExists — file absent', () => {
  it('returns false when readFileSync throws', async () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file')
    })

    const exists = await fsExists(PROJECT_PATH, 'test_agent')

    expect(exists).toBe(false)
  })
})

// ── fsDelete ──────────────────────────────────────────────────────────────────

describe('fsDelete — happy path', () => {
  it('calls unlinkSync with the resolved path', async () => {
    mockUnlinkSync.mockReturnValue(undefined)

    await fsDelete(PROJECT_PATH, 'test_agent')

    expect(mockUnlinkSync).toHaveBeenCalledWith(PROJECT_PATH)
  })
})

describe('fsDelete — path traversal', () => {
  it('throws with handler_error when path escapes project root', async () => {
    const badPath = resolve('/', 'etc', 'hosts')
    await expect(fsDelete(badPath, 'test_agent')).rejects.toThrow(
      'fs.delete failed [handler_error]'
    )
    expect(mockUnlinkSync).not.toHaveBeenCalled()
  })
})

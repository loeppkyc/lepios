/**
 * Unit tests for readFileTool.
 * Covers: valid path, path traversal, disallowed prefix, deny pattern (.env),
 *         ENOENT, and content truncation at 8192 bytes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockReadFileSync } = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
}))

vi.mock('fs', () => ({
  default: {
    readFileSync: mockReadFileSync,
  },
  readFileSync: mockReadFileSync,
}))

import { readFileTool } from '@/lib/orb/tools/read-file'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('readFileTool metadata', () => {
  it('has correct name and capability', () => {
    expect(readFileTool.name).toBe('readFile')
    expect(readFileTool.capability).toBe('tool.chat_ui.read.file')
  })
})

describe('readFileTool execute', () => {
  it('returns content for a valid allowed path', async () => {
    mockReadFileSync.mockReturnValueOnce('export const x = 1\n')

    const result = await readFileTool.execute({ path: 'lib/orb/tools/registry.ts' }, {} as never)

    expect('error' in result).toBe(false)
    if (!('error' in result)) {
      expect(result.path).toBe('lib/orb/tools/registry.ts')
      expect(result.content).toContain('export const x = 1')
      expect(result.truncated).toBe(false)
    }
  })

  it('denies path traversal (../../../etc/passwd)', async () => {
    const result = await readFileTool.execute({ path: '../../../etc/passwd' }, {} as never)

    expect(result).toMatchObject({ error: 'path_not_allowed' })
    expect(mockReadFileSync).not.toHaveBeenCalled()
  })

  it('denies path outside allowed prefixes', async () => {
    const result = await readFileTool.execute({ path: 'node_modules/react/index.js' }, {} as never)

    expect(result).toMatchObject({ error: 'path_not_allowed' })
    expect(mockReadFileSync).not.toHaveBeenCalled()
  })

  it('denies path containing .env (deny pattern)', async () => {
    const result = await readFileTool.execute({ path: 'lib/.env.local' }, {} as never)

    expect(result).toMatchObject({ error: 'path_not_allowed' })
    expect(mockReadFileSync).not.toHaveBeenCalled()
  })

  it('denies path containing "secret" (deny pattern)', async () => {
    const result = await readFileTool.execute({ path: 'docs/my-secret-file.md' }, {} as never)

    expect(result).toMatchObject({ error: 'path_not_allowed' })
    expect(mockReadFileSync).not.toHaveBeenCalled()
  })

  it('returns not_found on ENOENT', async () => {
    const err = Object.assign(new Error('no such file'), { code: 'ENOENT' })
    mockReadFileSync.mockImplementationOnce(() => {
      throw err
    })

    const result = await readFileTool.execute({ path: 'docs/missing.md' }, {} as never)

    expect(result).toMatchObject({ error: 'not_found', path: 'docs/missing.md' })
  })

  it('returns read_error for other fs errors', async () => {
    mockReadFileSync.mockImplementationOnce(() => {
      throw new Error('permission denied')
    })

    const result = await readFileTool.execute({ path: 'docs/something.md' }, {} as never)

    expect(result).toMatchObject({ error: 'read_error' })
    if ('error' in result && result.error === 'read_error') {
      expect(result.message).toContain('permission denied')
    }
  })

  it('truncates content larger than 8192 bytes', async () => {
    const bigContent = 'a'.repeat(9000)
    mockReadFileSync.mockReturnValueOnce(bigContent)

    const result = await readFileTool.execute({ path: 'docs/large-file.md' }, {} as never)

    expect('error' in result).toBe(false)
    if (!('error' in result)) {
      expect(result.truncated).toBe(true)
      expect(result.content).toContain('[truncated]')
      // content should not exceed 8192 + length of '\n[truncated]'
      expect(result.content.length).toBeLessThanOrEqual(8192 + '\n[truncated]'.length)
    }
  })

  it('strips leading slash from path', async () => {
    mockReadFileSync.mockReturnValueOnce('hello')

    const result = await readFileTool.execute({ path: '/lib/orb/tools/registry.ts' }, {} as never)

    expect('error' in result).toBe(false)
    if (!('error' in result)) {
      expect(result.path).toBe('lib/orb/tools/registry.ts')
    }
  })
})

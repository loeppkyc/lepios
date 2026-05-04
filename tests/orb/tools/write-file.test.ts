/**
 * writeFileTool tests.
 *
 * Covers:
 *   (a) dryRun=true (default) — preview returned, no disk write
 *   (b) dryRun=false — file written, correct result
 *   (c) Path security — same deny rules as readFileTool
 *   (d) Content size guard — >32KB rejected
 *   (e) Capability is action (requires approval gate)
 *
 * Uses real fs for the dryRun=false path (writes to docs/test-tmp/).
 * Cleanup: deletes the test file after each write test.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { writeFileTool } from '@/lib/orb/tools/write-file'

const CTX = { agentId: 'chat_ui' as const, conversationId: 'c', userId: 'u', toolCallId: 't' }

// Temp file path — inside docs/ (allowed prefix), clearly test-scoped
const TMP_PATH = 'docs/test-tmp/write-file-test.txt'
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const TMP_FULL = path.join(REPO_ROOT, TMP_PATH)

afterEach(() => {
  try {
    fs.rmSync(path.dirname(TMP_FULL), { recursive: true, force: true })
  } catch {
    // ignore
  }
})

// ── (a) dryRun=true ───────────────────────────────────────────────────────────

describe('writeFileTool — dryRun=true (default)', () => {
  it('returns preview with written=false and does not create any file', async () => {
    const result = await writeFileTool.execute({ path: TMP_PATH, content: 'hello\nworld' }, CTX)

    expect(result).toMatchObject({
      written: false,
      preview: {
        path: TMP_PATH,
        content: 'hello\nworld',
        new_lines: 2,
      },
    })
    expect(fs.existsSync(TMP_FULL)).toBe(false)
  })

  it('reports current_lines=null for a new (non-existent) file', async () => {
    const result = await writeFileTool.execute({ path: TMP_PATH, content: 'x' }, CTX)
    expect(
      (result as { preview: { current_lines: number | null } }).preview.current_lines
    ).toBeNull()
  })

  it('reports current_lines count for an existing file', async () => {
    // Pre-create the file
    fs.mkdirSync(path.dirname(TMP_FULL), { recursive: true })
    fs.writeFileSync(TMP_FULL, 'line1\nline2\nline3')

    const result = await writeFileTool.execute({ path: TMP_PATH, content: 'new content' }, CTX)
    expect((result as { preview: { current_lines: number } }).preview.current_lines).toBe(3)
  })
})

// ── (b) dryRun=false ──────────────────────────────────────────────────────────

describe('writeFileTool — dryRun=false', () => {
  it('writes the file and returns written=true with size_bytes', async () => {
    const content = 'This is a test file.\nSecond line.'
    const result = await writeFileTool.execute({ path: TMP_PATH, content, dryRun: false }, CTX)

    expect(result).toMatchObject({ written: true, path: TMP_PATH })
    expect((result as { size_bytes: number }).size_bytes).toBeGreaterThan(0)
    expect(fs.existsSync(TMP_FULL)).toBe(true)
    expect(fs.readFileSync(TMP_FULL, 'utf-8')).toBe(content)
  })

  it('creates parent directories if they do not exist', async () => {
    const nestedPath = 'docs/test-tmp/nested/deep/file.txt'
    const nestedFull = path.join(REPO_ROOT, nestedPath)

    const result = await writeFileTool.execute(
      { path: nestedPath, content: 'deep file', dryRun: false },
      CTX
    )
    expect(result).toMatchObject({ written: true })
    expect(fs.existsSync(nestedFull)).toBe(true)

    // Cleanup nested dir
    fs.rmSync(path.join(REPO_ROOT, 'docs/test-tmp'), { recursive: true, force: true })
  })

  it('overwrites an existing file', async () => {
    fs.mkdirSync(path.dirname(TMP_FULL), { recursive: true })
    fs.writeFileSync(TMP_FULL, 'old content')

    await writeFileTool.execute({ path: TMP_PATH, content: 'new content', dryRun: false }, CTX)
    expect(fs.readFileSync(TMP_FULL, 'utf-8')).toBe('new content')
  })
})

// ── (c) Path security ─────────────────────────────────────────────────────────

describe('writeFileTool — path security', () => {
  it('blocks path traversal (../../)', async () => {
    const result = await writeFileTool.execute({ path: '../../.env', content: 'x' }, CTX)
    expect(result).toMatchObject({ error: 'path_not_allowed' })
  })

  it('blocks leading slash (/etc/passwd)', async () => {
    const result = await writeFileTool.execute({ path: '/etc/passwd', content: 'x' }, CTX)
    expect(result).toMatchObject({ error: 'path_not_allowed' })
  })

  it('blocks non-allowed prefix (config/)', async () => {
    const result = await writeFileTool.execute({ path: 'config/settings.ts', content: 'x' }, CTX)
    expect(result).toMatchObject({ error: 'path_not_allowed' })
  })

  it('blocks .env pattern', async () => {
    const result = await writeFileTool.execute({ path: 'lib/.env.local', content: 'x' }, CTX)
    expect(result).toMatchObject({ error: 'path_not_allowed' })
  })

  it('blocks secret keyword', async () => {
    const result = await writeFileTool.execute({ path: 'lib/my-secrets.ts', content: 'x' }, CTX)
    expect(result).toMatchObject({ error: 'path_not_allowed' })
  })

  it('blocks .pem extension', async () => {
    const result = await writeFileTool.execute({ path: 'docs/cert.pem', content: 'x' }, CTX)
    expect(result).toMatchObject({ error: 'path_not_allowed' })
  })
})

// ── (d) Content size guard ────────────────────────────────────────────────────

describe('writeFileTool — content size guard', () => {
  it('rejects content larger than 32KB', async () => {
    const bigContent = 'A'.repeat(33_000)
    const result = await writeFileTool.execute({ path: TMP_PATH, content: bigContent }, CTX)
    expect(result).toMatchObject({ error: 'content_too_large', max_bytes: 32_768 })
    expect(fs.existsSync(TMP_FULL)).toBe(false)
  })

  it('accepts content exactly at the 32KB limit', async () => {
    const okContent = 'A'.repeat(32_768)
    const result = await writeFileTool.execute({ path: TMP_PATH, content: okContent }, CTX)
    // dryRun=true by default — should return preview, not error
    expect(result).toMatchObject({ written: false })
  })
})

// ── (e) Capability ────────────────────────────────────────────────────────────

describe('writeFileTool — capability', () => {
  it('capability is an action capability (requires approval gate)', () => {
    expect(writeFileTool.capability).toContain('action')
  })
})

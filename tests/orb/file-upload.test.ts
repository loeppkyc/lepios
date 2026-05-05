/**
 * Unit tests for lib/orb/file-upload.ts (orb-A4).
 *
 * Spec: docs/specs/orb-a4-file-upload.md.
 */

import { describe, it, expect } from 'vitest'
import {
  ALLOWED_EXTENSIONS,
  MAX_FILES,
  MAX_FILE_SIZE,
  MAX_TOTAL_SIZE,
  buildAttachmentsText,
  combineTextAndFiles,
  getExtension,
  isAllowedExtension,
  stripHtml,
  validateAndProcessText,
  type AttachedFile,
} from '@/lib/orb/file-upload'

describe('getExtension / isAllowedExtension', () => {
  it('extracts lowercase extensions', () => {
    expect(getExtension('foo.TS')).toBe('.ts')
    expect(getExtension('script.PY')).toBe('.py')
    expect(getExtension('noext')).toBe('')
  })

  it('accepts every spec-listed extension', () => {
    for (const ext of ALLOWED_EXTENSIONS) {
      expect(isAllowedExtension(`file${ext}`)).toBe(true)
    }
  })

  it('rejects images, PDFs, binaries', () => {
    expect(isAllowedExtension('photo.png')).toBe(false)
    expect(isAllowedExtension('doc.pdf')).toBe(false)
    expect(isAllowedExtension('archive.zip')).toBe(false)
    expect(isAllowedExtension('video.mp4')).toBe(false)
    expect(isAllowedExtension('binary.exe')).toBe(false)
  })
})

describe('stripHtml', () => {
  it('removes script blocks entirely', () => {
    const html = '<p>visible</p><script>alert("evil")</script><p>more</p>'
    expect(stripHtml(html)).toBe('visible more')
  })

  it('removes style blocks entirely', () => {
    expect(stripHtml('<style>body{color:red}</style><p>text</p>')).toBe('text')
  })

  it('strips remaining tags but preserves text', () => {
    expect(stripHtml('<div><h1>Title</h1><p>Body</p></div>')).toBe('Title Body')
  })
})

describe('validateAndProcessText', () => {
  it('accepts a small text file', () => {
    const r = validateAndProcessText('hello.txt', 'hello world', 0, 0)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.file.name).toBe('hello.txt')
      expect(r.file.content).toBe('hello world')
      expect(r.file.truncated).toBe(false)
    }
  })

  it('rejects unsupported extensions', () => {
    const r = validateAndProcessText('photo.png', 'binary-bytes', 0, 0)
    expect(r.ok).toBe(false)
  })

  it('rejects when at max file count', () => {
    const r = validateAndProcessText('hello.txt', 'x', 0, MAX_FILES)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain(`Maximum ${MAX_FILES}`)
  })

  it('truncates a file larger than MAX_FILE_SIZE and marks it', () => {
    const big = 'a'.repeat(MAX_FILE_SIZE + 5_000)
    const r = validateAndProcessText('big.txt', big, 0, 0)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.file.truncated).toBe(true)
      expect(r.file.content.length).toBeLessThanOrEqual(MAX_FILE_SIZE + 200) // +200 for "[truncated…]" marker
      expect(r.file.content).toContain('[truncated')
    }
  })

  it('rejects when adding the file would exceed total size', () => {
    const big = 'b'.repeat(20 * 1024)
    // 6 such files would be 120 KB, under cap. The 7th (8 KB more) tests cap.
    const r = validateAndProcessText('one.txt', big, MAX_TOTAL_SIZE - 1024, 0)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('exceed')
  })

  it('strips script tags from html before counting size', () => {
    const html = `<script>${'x'.repeat(50_000)}</script><p>hi</p>`
    const r = validateAndProcessText('page.html', html, 0, 0)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.file.content).toBe('hi')
      expect(r.file.size).toBeLessThan(20)
    }
  })
})

describe('buildAttachmentsText / combineTextAndFiles', () => {
  const files: AttachedFile[] = [
    { name: 'a.ts', size: 10, content: 'const a = 1', truncated: false },
    { name: 'b.md', size: 12, content: '# heading\n', truncated: true },
  ]

  it('returns empty string for no files', () => {
    expect(buildAttachmentsText([])).toBe('')
  })

  it('emits one block per file with delimiters', () => {
    const out = buildAttachmentsText(files)
    expect(out).toContain('--- attached: a.ts ---')
    expect(out).toContain('--- attached: b.md (truncated) ---')
    expect(out).toContain('const a = 1')
    expect(out).toContain('# heading')
  })

  it('combines user text + attachments', () => {
    const combined = combineTextAndFiles('explain this', files)
    expect(combined.startsWith('explain this')).toBe(true)
    expect(combined).toContain('--- attached: a.ts ---')
  })

  it('returns just attachments if user text is empty', () => {
    const combined = combineTextAndFiles('', files)
    expect(combined.startsWith('---')).toBe(true)
    expect(combined).toContain('a.ts')
  })

  it('returns just text when no files', () => {
    expect(combineTextAndFiles('hello', [])).toBe('hello')
  })
})

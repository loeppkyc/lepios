/**
 * webFetchTool tests.
 *
 * Covers:
 *   (a) SSRF blocking — private IPs, localhost, metadata endpoints, HTTP
 *   (b) Happy path — HTTPS fetch returns content
 *   (c) HTML stripping — script/style removed, tags stripped
 *   (d) Truncation — response >16KB is cut and flagged
 *   (e) Non-text response — rejected
 *   (f) Network error — fetch_failed returned, no throw
 *   (g) Capability string
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock global fetch ─────────────────────────────────────────────────────────

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}))

vi.stubGlobal('fetch', mockFetch)

// ── Import after mock ─────────────────────────────────────────────────────────

import { webFetchTool } from '@/lib/orb/tools/web-fetch'

const CTX = { agentId: 'chat_ui' as const, conversationId: 'c', userId: 'u', toolCallId: 't' }

function makeResponse(body: string, contentType = 'text/plain', status = 200): Response {
  return {
    ok: status < 400,
    status,
    headers: { get: (h: string) => (h === 'content-type' ? contentType : null) },
    text: async () => body,
  } as unknown as Response
}

beforeEach(() => vi.clearAllMocks())

// ── (a) SSRF blocking ─────────────────────────────────────────────────────────

describe('webFetchTool — SSRF blocking', () => {
  it('blocks HTTP (non-HTTPS) URLs', async () => {
    const result = await webFetchTool.execute({ url: 'http://example.com/page' }, CTX)
    expect(result).toMatchObject({ error: 'blocked_url', reason: 'only HTTPS URLs are allowed' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('blocks localhost', async () => {
    const result = await webFetchTool.execute({ url: 'https://localhost/admin' }, CTX)
    expect(result).toMatchObject({ error: 'blocked_url', reason: 'private or reserved address' })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('blocks 127.x loopback', async () => {
    const result = await webFetchTool.execute({ url: 'https://127.0.0.1/anything' }, CTX)
    expect(result).toMatchObject({ error: 'blocked_url' })
  })

  it('blocks RFC-1918 10.x', async () => {
    const result = await webFetchTool.execute({ url: 'https://10.0.0.1/' }, CTX)
    expect(result).toMatchObject({ error: 'blocked_url' })
  })

  it('blocks RFC-1918 192.168.x', async () => {
    const result = await webFetchTool.execute({ url: 'https://192.168.1.1/' }, CTX)
    expect(result).toMatchObject({ error: 'blocked_url' })
  })

  it('blocks link-local 169.254.x (AWS metadata)', async () => {
    const result = await webFetchTool.execute(
      { url: 'https://169.254.169.254/latest/meta-data/' },
      CTX
    )
    expect(result).toMatchObject({ error: 'blocked_url' })
  })

  it('blocks invalid URLs', async () => {
    const result = await webFetchTool.execute({ url: 'not-a-url' }, CTX)
    expect(result).toMatchObject({ error: 'blocked_url' })
  })
})

// ── (b) Happy path ────────────────────────────────────────────────────────────

describe('webFetchTool — happy path', () => {
  it('returns content, status, and truncated=false for a short response', async () => {
    mockFetch.mockResolvedValue(makeResponse('Hello from the web', 'text/plain'))

    const result = await webFetchTool.execute({ url: 'https://example.com/hello' }, CTX)

    expect(result).toMatchObject({
      url: 'https://example.com/hello',
      content: 'Hello from the web',
      status: 200,
      truncated: false,
    })
  })

  it('returns JSON content as-is', async () => {
    const json = JSON.stringify({ foo: 'bar' })
    mockFetch.mockResolvedValue(makeResponse(json, 'application/json'))

    const result = await webFetchTool.execute({ url: 'https://api.example.com/data' }, CTX)
    expect(result).toMatchObject({ content: json })
  })

  it('capability is a read capability', () => {
    expect(webFetchTool.capability).toContain('read')
  })
})

// ── (c) HTML stripping ────────────────────────────────────────────────────────

describe('webFetchTool — HTML stripping', () => {
  it('strips script and style tags from HTML responses', async () => {
    const html =
      '<html><head><style>body{color:red}</style><script>alert(1)</script></head>' +
      '<body><h1>Title</h1><p>Hello world</p></body></html>'
    mockFetch.mockResolvedValue(makeResponse(html, 'text/html'))

    const result = await webFetchTool.execute({ url: 'https://example.com/' }, CTX)
    const content = (result as { content: string }).content
    expect(content).not.toContain('<style>')
    expect(content).not.toContain('<script>')
    expect(content).not.toContain('<h1>')
    expect(content).toContain('Title')
    expect(content).toContain('Hello world')
  })

  it('decodes HTML entities', async () => {
    const html = '<p>5 &gt; 3 &amp; &lt;2</p>'
    mockFetch.mockResolvedValue(makeResponse(html, 'text/html'))

    const result = await webFetchTool.execute({ url: 'https://example.com/' }, CTX)
    const content = (result as { content: string }).content
    expect(content).toContain('5 > 3 & <2')
  })
})

// ── (d) Truncation ────────────────────────────────────────────────────────────

describe('webFetchTool — truncation', () => {
  it('truncates response larger than 16KB and sets truncated=true', async () => {
    const bigText = 'A'.repeat(20_000)
    mockFetch.mockResolvedValue(makeResponse(bigText, 'text/plain'))

    const result = await webFetchTool.execute({ url: 'https://example.com/big' }, CTX)
    expect((result as { truncated: boolean }).truncated).toBe(true)
    expect((result as { content: string }).content).toContain('[truncated]')
    expect((result as { content: string }).content.length).toBeLessThan(20_000)
  })
})

// ── (e) Non-text response ─────────────────────────────────────────────────────

describe('webFetchTool — non-text response', () => {
  it('returns non_text_response error for image content-type', async () => {
    mockFetch.mockResolvedValue(makeResponse('binary', 'image/png'))

    const result = await webFetchTool.execute({ url: 'https://example.com/img.png' }, CTX)
    expect(result).toMatchObject({ error: 'non_text_response', content_type: 'image/png' })
  })

  it('returns non_text_response error for binary content-type', async () => {
    mockFetch.mockResolvedValue(makeResponse('binary', 'application/octet-stream'))

    const result = await webFetchTool.execute({ url: 'https://example.com/file.bin' }, CTX)
    expect(result).toMatchObject({ error: 'non_text_response' })
  })
})

// ── (f) Network errors ────────────────────────────────────────────────────────

describe('webFetchTool — network errors', () => {
  it('returns fetch_failed without throwing when fetch rejects', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))

    const result = await webFetchTool.execute({ url: 'https://example.com/' }, CTX)
    expect(result).toMatchObject({ error: 'fetch_failed' })
    expect((result as { message: string }).message).toContain('ECONNREFUSED')
  })
})

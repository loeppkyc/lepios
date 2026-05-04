/**
 * webFetch — chat_ui read tool.
 *
 * Fetches a URL and returns its text content. Read-only; no approval gate.
 * Domain allowlist prevents SSRF against internal services and local network.
 * Response truncated to 16KB to keep context manageable.
 */

import { z } from 'zod'
import type { ChatTool } from './registry'

// Max response body to return (characters after text extraction)
const MAX_CHARS = 16_384

// Blocked host patterns — SSRF prevention
// Covers localhost, link-local, RFC-1918, cloud metadata endpoints
const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
  /metadata\.google\.internal/i,
  /169\.254\.169\.254/,
]

type Input = {
  url: string
  selector?: string
}

type Output =
  | { url: string; content: string; status: number; truncated: boolean }
  | { error: 'blocked_url'; reason: string }
  | { error: 'fetch_failed'; message: string }
  | { error: 'non_text_response'; content_type: string }

function isBlockedHost(url: URL): boolean {
  const host = url.hostname
  return BLOCKED_HOST_PATTERNS.some((p) => p.test(host))
}

export const webFetchTool: ChatTool<Input, Output> = {
  name: 'webFetch',
  description:
    'Fetch a public URL and return its text content. ' +
    'Only HTTPS URLs are allowed. Internal/private IP ranges are blocked. ' +
    'Response is truncated to 16KB. Optionally provide a CSS selector to extract a specific element.',
  parameters: z.object({
    url: z.string().url().describe('HTTPS URL to fetch'),
    selector: z
      .string()
      .optional()
      .describe(
        'Optional CSS selector to extract a specific element (not yet implemented — full body returned)'
      ),
  }),
  capability: 'tool.chat_ui.read.web',
  execute: async ({ url: rawUrl }) => {
    // 1. Parse and validate URL
    let parsed: URL
    try {
      parsed = new URL(rawUrl)
    } catch {
      return { error: 'blocked_url', reason: 'invalid URL' }
    }

    // 2. HTTPS only
    if (parsed.protocol !== 'https:') {
      return { error: 'blocked_url', reason: 'only HTTPS URLs are allowed' }
    }

    // 3. SSRF guard
    if (isBlockedHost(parsed)) {
      return { error: 'blocked_url', reason: 'private or reserved address' }
    }

    // 4. Fetch with timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15_000)

    let response: Response
    try {
      response = await fetch(parsed.toString(), {
        signal: controller.signal,
        headers: {
          'User-Agent': 'LEPIOS/1.0 (LepiOS personal assistant; +https://lepios-one.vercel.app)',
          Accept: 'text/html,text/plain,application/json,*/*',
        },
        redirect: 'follow',
      })
    } catch (err) {
      return { error: 'fetch_failed', message: String(err) }
    } finally {
      clearTimeout(timeoutId)
    }

    // 5. Check content-type — only text responses
    const contentType = response.headers.get('content-type') ?? ''
    const isText =
      contentType.includes('text/') ||
      contentType.includes('application/json') ||
      contentType.includes('application/xml') ||
      contentType.includes('+json') ||
      contentType.includes('+xml')

    if (!isText) {
      return { error: 'non_text_response', content_type: contentType }
    }

    // 6. Read body with size cap
    let text: string
    try {
      text = await response.text()
    } catch (err) {
      return { error: 'fetch_failed', message: String(err) }
    }

    // 7. Strip HTML tags for readability when content-type is HTML
    if (contentType.includes('text/html')) {
      text = text
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s{3,}/g, '\n\n')
        .trim()
    }

    const truncated = text.length > MAX_CHARS
    const content = truncated ? text.slice(0, MAX_CHARS) + '\n[truncated]' : text

    return {
      url: parsed.toString(),
      content,
      status: response.status,
      truncated,
    }
  },
}

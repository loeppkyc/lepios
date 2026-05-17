import { describe, it, expect } from 'vitest'

// --- Business logic extracted from route handlers for unit testing ---

// stripHtml: copied from app/api/git-hackers/hn-hiring/route.ts
// Tests the HTML tag and entity stripping used for comment_text display.
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

// sevenDaysAgo: mirrors app/api/git-hackers/github-trending/route.ts logic
function sevenDaysAgo(now: Date = new Date()): string {
  const d = new Date(now)
  d.setDate(d.getDate() - 7)
  return d.toISOString().slice(0, 10)
}

describe('stripHtml', () => {
  it('strips basic HTML tags', () => {
    expect(stripHtml('<p>Hello world</p>')).toBe('Hello world')
  })

  it('strips nested tags', () => {
    expect(stripHtml('<b>We are hiring <em>TypeScript</em> devs</b>')).toBe(
      'We are hiring TypeScript devs'
    )
  })

  it('replaces HTML entities', () => {
    expect(stripHtml('&amp; &lt; &gt; &quot; &#x27;')).toBe("& < > \" '")
  })

  it('collapses whitespace', () => {
    expect(stripHtml('<p>  Too   many   spaces  </p>')).toBe('Too many spaces')
  })

  it('handles empty string', () => {
    expect(stripHtml('')).toBe('')
  })

  it('handles string with no HTML', () => {
    expect(stripHtml('Plain text post')).toBe('Plain text post')
  })

  it('handles self-closing tags', () => {
    expect(stripHtml('Line one<br/>Line two')).toBe('Line one Line two')
  })

  it('handles anchor tags with href', () => {
    expect(stripHtml('<a href="https://example.com">Click here</a>')).toBe('Click here')
  })
})

describe('sevenDaysAgo', () => {
  it('returns a date 7 days before the given date', () => {
    const now = new Date('2026-05-16T12:00:00Z')
    expect(sevenDaysAgo(now)).toBe('2026-05-09')
  })

  it('returns a valid ISO date string (YYYY-MM-DD format)', () => {
    const result = sevenDaysAgo()
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('handles month boundary correctly', () => {
    const now = new Date('2026-05-05T00:00:00Z')
    expect(sevenDaysAgo(now)).toBe('2026-04-28')
  })

  it('handles year boundary correctly', () => {
    const now = new Date('2026-01-04T00:00:00Z')
    expect(sevenDaysAgo(now)).toBe('2025-12-28')
  })
})

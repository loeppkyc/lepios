/**
 * Unit tests for lib/harness/safety/v2/e2e/test-user.ts.
 */

import { describe, it, expect, vi } from 'vitest'
import { getTestUserSessionCookie } from '@/lib/harness/safety/v2/e2e/test-user'

type RowResult = { data: { value: string | null } | null; error: unknown }

function fakeDb(row: RowResult) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => row),
        })),
      })),
    })),
  } as never
}

describe('getTestUserSessionCookie', () => {
  it('returns the cookie when set', async () => {
    const out = await getTestUserSessionCookie(
      fakeDb({ data: { value: 'sb-access=abc' }, error: null })
    )
    expect(out).toBe('sb-access=abc')
  })

  it('returns null when row is missing', async () => {
    const out = await getTestUserSessionCookie(fakeDb({ data: null, error: null }))
    expect(out).toBe(null)
  })

  it('returns null when value is empty string', async () => {
    const out = await getTestUserSessionCookie(fakeDb({ data: { value: '' }, error: null }))
    expect(out).toBe(null)
  })

  it('returns null when value is whitespace only', async () => {
    const out = await getTestUserSessionCookie(fakeDb({ data: { value: '   ' }, error: null }))
    expect(out).toBe(null)
  })

  it('trims trailing whitespace (Vercel-CLI-on-Windows defensive)', async () => {
    const out = await getTestUserSessionCookie(
      fakeDb({ data: { value: 'sb-access=abc\r\n' }, error: null })
    )
    expect(out).toBe('sb-access=abc')
  })

  it('returns null when query returns an error', async () => {
    const out = await getTestUserSessionCookie(fakeDb({ data: null, error: { code: 'oops' } }))
    expect(out).toBe(null)
  })
})

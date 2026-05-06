import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockGetSecret } = vi.hoisted(() => ({ mockGetSecret: vi.fn() }))

vi.mock('@/lib/security/secrets', () => ({ getSecret: mockGetSecret }))

import { buildAdvisorBackstopLine } from '@/lib/security/advisor-backstop'

const FAKE_TOKEN = 'sbp_fake_test_token'

function mockFetchOnce(body: unknown, status = 200): void {
  const response = {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSecret.mockResolvedValue(FAKE_TOKEN)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('buildAdvisorBackstopLine', () => {
  it('returns ✅ when no actionable findings', async () => {
    mockFetchOnce({ lints: [] })
    expect(await buildAdvisorBackstopLine()).toBe('Advisor: 0 new findings ✅')
  })

  it('treats accepted findings as not actionable', async () => {
    mockFetchOnce({
      lints: [
        {
          cache_key: 'auth_leaked_password_protection',
          level: 'WARN',
          name: 'auth_leaked_password_protection',
          detail: 'plan-gated',
        },
      ],
    })
    expect(await buildAdvisorBackstopLine()).toBe('Advisor: 0 new findings ✅')
  })

  it('ignores INFO-level findings', async () => {
    mockFetchOnce({
      lints: [
        {
          cache_key: 'rls_enabled_no_policy_public_foo',
          level: 'INFO',
          name: 'rls_enabled_no_policy',
          detail: 'no policy',
        },
        {
          cache_key: 'rls_enabled_no_policy_public_bar',
          level: 'INFO',
          name: 'rls_enabled_no_policy',
          detail: 'no policy',
        },
      ],
    })
    expect(await buildAdvisorBackstopLine()).toBe('Advisor: 0 new findings ✅')
  })

  it('flags ⚠️ for non-accepted WARN findings', async () => {
    mockFetchOnce({
      lints: [
        {
          cache_key: 'extension_in_public_foobar',
          level: 'WARN',
          name: 'extension_in_public',
          detail: 'foobar in public',
        },
      ],
    })
    const line = await buildAdvisorBackstopLine()
    expect(line).toContain('1 WARN')
    expect(line).toContain('⚠️')
    expect(line).toContain('extension_in_public_foobar')
    expect(line).not.toContain('🚨')
  })

  it('flags 🚨 when any ERROR is present', async () => {
    mockFetchOnce({
      lints: [
        {
          cache_key: 'rls_disabled_in_public_secret_table',
          level: 'ERROR',
          name: 'rls_disabled_in_public',
          detail: 'no rls',
        },
        {
          cache_key: 'extension_in_public_foobar',
          level: 'WARN',
          name: 'extension_in_public',
          detail: 'foobar in public',
        },
      ],
    })
    const line = await buildAdvisorBackstopLine()
    expect(line).toContain('1 ERROR')
    expect(line).toContain('1 WARN')
    expect(line).toContain('🚨')
  })

  it('caps the sample list at 3 cache_keys', async () => {
    mockFetchOnce({
      lints: [
        { cache_key: 'finding_a', level: 'WARN', name: 'x', detail: 'x' },
        { cache_key: 'finding_b', level: 'WARN', name: 'x', detail: 'x' },
        { cache_key: 'finding_c', level: 'WARN', name: 'x', detail: 'x' },
        { cache_key: 'finding_d', level: 'WARN', name: 'x', detail: 'x' },
        { cache_key: 'finding_e', level: 'WARN', name: 'x', detail: 'x' },
      ],
    })
    const line = await buildAdvisorBackstopLine()
    expect(line).toContain('finding_a')
    expect(line).toContain('finding_b')
    expect(line).toContain('finding_c')
    expect(line).not.toContain('finding_d')
    expect(line).not.toContain('finding_e')
    expect(line).toContain('5 WARN')
  })

  it('returns "backstop unavailable" on missing token (getSecret throws)', async () => {
    mockGetSecret.mockRejectedValueOnce(new Error('Secret "SUPABASE_MANAGEMENT_TOKEN" not found'))
    expect(await buildAdvisorBackstopLine()).toBe('Advisor: backstop unavailable')
  })

  it('returns "backstop unavailable" on non-2xx API response', async () => {
    mockFetchOnce({}, 500)
    expect(await buildAdvisorBackstopLine()).toBe('Advisor: backstop unavailable')
  })

  it('returns "backstop unavailable" on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ENOTFOUND'))
    expect(await buildAdvisorBackstopLine()).toBe('Advisor: backstop unavailable')
  })

  it('returns "backstop unavailable" on malformed JSON', async () => {
    const badResponse = {
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('Unexpected token')
      },
    } as unknown as Response
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(badResponse)
    expect(await buildAdvisorBackstopLine()).toBe('Advisor: backstop unavailable')
  })
})

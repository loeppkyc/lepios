/**
 * Acceptance tests for lib/auth/cron-secret.ts requireCronSecret() helper.
 *
 * F17 contract:
 *   - CRON_SECRET unset         -> 500 with { error: 'CRON_SECRET not configured' }
 *   - wrong bearer token        -> 401 with { error: 'Unauthorized' }
 *   - missing authorization     -> 401 with { error: 'Unauthorized' }
 *   - missing Bearer prefix     -> 401 with { error: 'Unauthorized' }
 *   - correct bearer token      -> null (caller proceeds)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { requireCronSecret } from '@/lib/auth/cron-secret'

const ORIGINAL_SECRET = process.env.CRON_SECRET

function reqWith(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/test', { method: 'POST', headers })
}

describe('requireCronSecret', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret-123'
  })
  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = ORIGINAL_SECRET
  })

  it('returns 500 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET
    const res = requireCronSecret(reqWith({ authorization: 'Bearer anything' }))
    expect(res).not.toBeNull()
    expect(res!.status).toBe(500)
    expect(await res!.json()).toEqual({ error: 'CRON_SECRET not configured' })
  })

  it('returns 401 when the bearer token is wrong', async () => {
    const res = requireCronSecret(reqWith({ authorization: 'Bearer wrong-secret' }))
    expect(res).not.toBeNull()
    expect(res!.status).toBe(401)
    expect(await res!.json()).toEqual({ error: 'Unauthorized' })
  })

  it('returns 401 when the authorization header is missing', async () => {
    const res = requireCronSecret(reqWith())
    expect(res).not.toBeNull()
    expect(res!.status).toBe(401)
    expect(await res!.json()).toEqual({ error: 'Unauthorized' })
  })

  it('returns 401 when the Bearer prefix is missing', async () => {
    const res = requireCronSecret(reqWith({ authorization: 'test-secret-123' }))
    expect(res).not.toBeNull()
    expect(res!.status).toBe(401)
  })

  it('returns null when the bearer token matches', () => {
    const res = requireCronSecret(reqWith({ authorization: 'Bearer test-secret-123' }))
    expect(res).toBeNull()
  })
})

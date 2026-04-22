import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { GET } from '@/app/api/health/route'

describe('GET /api/health', () => {
  beforeEach(() => {
    delete process.env.VERCEL_GIT_COMMIT_SHA
  })

  afterEach(() => {
    delete process.env.VERCEL_GIT_COMMIT_SHA
  })

  it('returns HTTP 200', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
  })

  it('returns ok:true with a timestamp', async () => {
    const res = await GET()
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(typeof body.timestamp).toBe('string')
  })

  it('returns commit sha when VERCEL_GIT_COMMIT_SHA is set', async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = 'abc1234'
    const res = await GET()
    const body = await res.json()
    expect(body.commit).toBe('abc1234')
  })

  it('returns commit null when VERCEL_GIT_COMMIT_SHA is not set', async () => {
    const res = await GET()
    const body = await res.json()
    expect(body.commit).toBeNull()
  })
})

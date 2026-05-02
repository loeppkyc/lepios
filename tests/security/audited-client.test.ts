/**
 * Tests for lib/supabase/audited.ts
 *
 * Coverage:
 *   - createAuditedServiceClient calls getSecret('SUPABASE_SERVICE_ROLE_KEY', { agentId })
 *   - Returns a Supabase client created with the resolved key
 *   - Re-throws when getSecret throws (CapabilityDeniedError or missing-secret)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock getSecret ────────────────────────────────────────────────────────────

const { mockGetSecret } = vi.hoisted(() => ({
  mockGetSecret: vi.fn(),
}))

vi.mock('@/lib/security/secrets', () => ({
  getSecret: mockGetSecret,
}))

// ── Mock createClient ─────────────────────────────────────────────────────────

const { mockCreateClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: mockCreateClient,
}))

import { createAuditedServiceClient } from '@/lib/supabase/audited'

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSecret.mockResolvedValue('test-service-role-key')
  mockCreateClient.mockReturnValue({ from: vi.fn() })
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createAuditedServiceClient', () => {
  it('calls getSecret with SUPABASE_SERVICE_ROLE_KEY and the provided agentId', async () => {
    await createAuditedServiceClient('builder')

    expect(mockGetSecret).toHaveBeenCalledOnce()
    expect(mockGetSecret).toHaveBeenCalledWith('SUPABASE_SERVICE_ROLE_KEY', { agentId: 'builder' })
  })

  it('creates supabase client with the resolved key', async () => {
    mockGetSecret.mockResolvedValue('resolved-key-abc')

    await createAuditedServiceClient('coordinator')

    expect(mockCreateClient).toHaveBeenCalledWith(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      'resolved-key-abc'
    )
  })

  it('returns the client created by createClient', async () => {
    const fakeClient = { from: vi.fn(), id: 'fake-client' }
    mockCreateClient.mockReturnValue(fakeClient)

    const result = await createAuditedServiceClient('builder')

    expect(result).toBe(fakeClient)
  })

  it('re-throws when getSecret throws', async () => {
    mockGetSecret.mockRejectedValue(new Error('Secret not found'))

    await expect(createAuditedServiceClient('builder')).rejects.toThrow('Secret not found')
  })
})

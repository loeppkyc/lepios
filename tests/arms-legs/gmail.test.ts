/**
 * Unit tests for lib/harness/arms-legs/gmail.ts + gmail-handlers.ts
 *
 * All external I/O is mocked:
 *   - @/lib/gmail/client        (createGmailService)
 *   - @/lib/security/capability (checkCapability)
 *   - @/lib/supabase/service    (agent_events logging)
 *
 * Handlers registered once via import side effects.
 * Registry NOT reset between tests.
 *
 * Coverage:
 *   - gmailSearch: returns message stubs + pagination token
 *   - gmailGet: returns message with payload/headers
 *   - capability denied: rejects with capability_denied, never calls Gmail
 *   - Gmail API error: propagates as handler_error
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock createGmailService ───────────────────────────────────────────────────

const mockMessagesList = vi.fn()
const mockMessagesGet = vi.fn()

const { mockCreateGmailService } = vi.hoisted(() => ({
  mockCreateGmailService: vi.fn(),
}))

vi.mock('@/lib/gmail/client', () => ({
  createGmailService: mockCreateGmailService,
  GmailNotConfiguredError: class GmailNotConfiguredError extends Error {
    constructor() {
      super('not configured')
      this.name = 'GmailNotConfiguredError'
    }
  },
}))

// ── Mock checkCapability ──────────────────────────────────────────────────────

const { mockCheckCapability } = vi.hoisted(() => ({
  mockCheckCapability: vi.fn(),
}))

vi.mock('@/lib/security/capability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/capability')>()
  return { ...actual, checkCapability: mockCheckCapability }
})

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

// ── Side effects: registers gmail.* handlers ──────────────────────────────────

import '@/lib/harness/arms-legs/gmail-handlers'
import { gmailSearch, gmailGet } from '@/lib/harness/arms-legs/gmail'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInsertChain() {
  return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
}

function makeCapAllowed() {
  mockCheckCapability.mockResolvedValue({
    allowed: true,
    reason: 'in_scope',
    enforcement_mode: 'log_only',
    audit_id: 'audit-gmail-1',
  })
}

function makeGmailService() {
  return {
    users: {
      messages: {
        list: mockMessagesList,
        get: mockMessagesGet,
      },
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFrom.mockReturnValue(makeInsertChain())
  makeCapAllowed()
  mockCreateGmailService.mockResolvedValue(makeGmailService())
})

// ── gmailSearch ───────────────────────────────────────────────────────────────

describe('gmailSearch — happy path', () => {
  it('returns message stubs from list response', async () => {
    mockMessagesList.mockResolvedValue({
      data: {
        messages: [
          { id: 'msg1', threadId: 'thr1' },
          { id: 'msg2', threadId: 'thr2' },
        ],
        nextPageToken: undefined,
        resultSizeEstimate: 2,
      },
    })

    const result = await gmailSearch('subject:invoice', 'coordinator')

    expect(result.messages).toHaveLength(2)
    expect(result.messages[0]).toEqual({ id: 'msg1', threadId: 'thr1' })
    expect(mockMessagesList).toHaveBeenCalledWith({
      userId: 'me',
      q: 'subject:invoice',
      maxResults: 100,
      pageToken: undefined,
    })
  })

  it('returns nextPageToken when present', async () => {
    mockMessagesList.mockResolvedValue({
      data: {
        messages: [{ id: 'msg1' }],
        nextPageToken: 'tok123',
        resultSizeEstimate: 50,
      },
    })

    const result = await gmailSearch('from:amazon', 'coordinator', { maxResults: 10 })

    expect(result.nextPageToken).toBe('tok123')
    expect(mockMessagesList).toHaveBeenCalledWith(expect.objectContaining({ maxResults: 10 }))
  })

  it('returns empty messages array when none found', async () => {
    mockMessagesList.mockResolvedValue({
      data: { messages: null, resultSizeEstimate: 0 },
    })

    const result = await gmailSearch('subject:nothing', 'coordinator')

    expect(result.messages).toEqual([])
  })

  it('passes pageToken through to the API', async () => {
    mockMessagesList.mockResolvedValue({ data: { messages: [] } })

    await gmailSearch('q', 'coordinator', { pageToken: 'pt99' })

    expect(mockMessagesList).toHaveBeenCalledWith(expect.objectContaining({ pageToken: 'pt99' }))
  })
})

// ── gmailGet ──────────────────────────────────────────────────────────────────

describe('gmailGet — happy path', () => {
  it('returns message with headers and payload', async () => {
    mockMessagesGet.mockResolvedValue({
      data: {
        id: 'msg1',
        threadId: 'thr1',
        snippet: 'Hello world',
        payload: {
          mimeType: 'text/plain',
          headers: [
            { name: 'From', value: 'sender@example.com' },
            { name: 'Subject', value: 'Test invoice' },
          ],
          parts: [],
        },
      },
    })

    const result = await gmailGet('msg1', 'coordinator')

    expect(result.id).toBe('msg1')
    expect(result.snippet).toBe('Hello world')
    expect(result.payload?.headers).toContainEqual({
      name: 'From',
      value: 'sender@example.com',
    })
    expect(mockMessagesGet).toHaveBeenCalledWith({
      userId: 'me',
      id: 'msg1',
      format: 'metadata',
      metadataHeaders: undefined,
    })
  })

  it('passes format and metadataHeaders through', async () => {
    mockMessagesGet.mockResolvedValue({ data: { id: 'msg2' } })

    await gmailGet('msg2', 'coordinator', {
      format: 'full',
      metadataHeaders: ['From', 'Subject'],
    })

    expect(mockMessagesGet).toHaveBeenCalledWith({
      userId: 'me',
      id: 'msg2',
      format: 'full',
      metadataHeaders: ['From', 'Subject'],
    })
  })

  it('handles missing payload gracefully', async () => {
    mockMessagesGet.mockResolvedValue({
      data: { id: 'msg3', snippet: 'stub' },
    })

    const result = await gmailGet('msg3', 'coordinator')

    expect(result.payload).toBeUndefined()
    expect(result.snippet).toBe('stub')
  })
})

// ── capability denied ─────────────────────────────────────────────────────────

describe('capability denied', () => {
  it('rejects with capability_denied and never calls Gmail', async () => {
    mockCheckCapability.mockResolvedValue({
      allowed: false,
      reason: 'no_grant_for_agent',
      enforcement_mode: 'enforce',
      audit_id: 'audit-denied',
    })

    await expect(gmailSearch('subject:invoice', 'rogue_agent')).rejects.toThrow(
      'gmail.search failed [capability_denied]'
    )
    expect(mockCreateGmailService).not.toHaveBeenCalled()
  })

  it('rejects gmailGet with capability_denied', async () => {
    mockCheckCapability.mockResolvedValue({
      allowed: false,
      reason: 'no_grant_for_agent',
      enforcement_mode: 'enforce',
      audit_id: 'audit-denied-2',
    })

    await expect(gmailGet('msgX', 'rogue_agent')).rejects.toThrow(
      'gmail.get failed [capability_denied]'
    )
    expect(mockCreateGmailService).not.toHaveBeenCalled()
  })
})

// ── Gmail API errors ──────────────────────────────────────────────────────────

describe('Gmail API errors', () => {
  it('propagates createGmailService failure as handler_error', async () => {
    mockCreateGmailService.mockRejectedValue(new Error('OAuth token expired'))

    await expect(gmailSearch('subject:invoice', 'coordinator')).rejects.toThrow(
      'gmail.search failed [handler_error]'
    )
  })

  it('propagates list API error as handler_error', async () => {
    mockMessagesList.mockRejectedValue(new Error('quota exceeded'))

    await expect(gmailSearch('subject:invoice', 'coordinator')).rejects.toThrow(
      'gmail.search failed [handler_error]'
    )
  })

  it('propagates get API error as handler_error', async () => {
    mockMessagesGet.mockRejectedValue(new Error('message not found'))

    await expect(gmailGet('msg404', 'coordinator')).rejects.toThrow(
      'gmail.get failed [handler_error]'
    )
  })
})

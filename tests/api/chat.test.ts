/**
 * F21 acceptance tests for the orb chat API.
 *
 * Routes covered:
 *   - POST   /api/chat
 *   - GET    /api/chat/conversations
 *   - GET    /api/chat/conversations/[id]/messages
 *
 * Mocks:
 *   - @/lib/supabase/server   → auth.getUser()
 *   - @/lib/orb/persistence   → DB-touching helpers
 *   - ollama-ai-provider + ai → no real Ollama calls
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockGetUser,
  mockCreateConversation,
  mockAppendMessage,
  mockGetConversationOwner,
  mockListConversations,
  mockLoadConversationMessages,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockCreateConversation: vi.fn(),
  mockAppendMessage: vi.fn(),
  mockGetConversationOwner: vi.fn(),
  mockListConversations: vi.fn(),
  mockLoadConversationMessages: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
  }),
}))

vi.mock('@/lib/orb/persistence', () => ({
  createConversation: mockCreateConversation,
  appendMessage: mockAppendMessage,
  getConversationOwner: mockGetConversationOwner,
  listConversations: mockListConversations,
  loadConversationMessages: mockLoadConversationMessages,
}))

vi.mock('ollama-ai-provider', () => {
  const mockModel = { modelId: 'qwen2.5-coder:3b', provider: 'ollama.chat' }
  const mockProvider = vi.fn((_modelId: string) => mockModel)
  return {
    createOllama: vi.fn(() => mockProvider),
  }
})

vi.mock('ai', () => ({
  streamText: vi.fn(),
  convertToModelMessages: vi.fn((msgs: unknown[]) => msgs),
  stepCountIs: vi.fn((n: number) => ({ type: 'stepCount', n })),
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { POST as chatPost } from '@/app/api/chat/route'
import { GET as conversationsGet } from '@/app/api/chat/conversations/route'
import { GET as messagesGet } from '@/app/api/chat/conversations/[id]/messages/route'
import { streamText } from 'ai'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_A = { id: 'user-a-uuid', email: 'a@example.com' }
const USER_B = { id: 'user-b-uuid', email: 'b@example.com' }
const CONV_A = 'conv-a-uuid'
const CONV_NEW = 'conv-new-uuid'

function makeStreamResponse() {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      ctrl.enqueue(encoder.encode('f:{"messageId":"test-msg-1"}\n'))
      ctrl.enqueue(encoder.encode('0:"Hello from Ollama"\n'))
      ctrl.enqueue(
        encoder.encode(
          'e:{"finishReason":"stop","usage":{"promptTokens":5,"completionTokens":4}}\n',
        ),
      )
      ctrl.close()
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Vercel-AI-Data-Stream': 'v1',
    },
  })
}

function makeChatRequest(body: object = {}) {
  const defaultBody = {
    messages: [{ role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
  }
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    body: JSON.stringify({ ...defaultBody, ...body }),
    headers: { 'Content-Type': 'application/json' },
  })
}

// ── POST /api/chat — base streaming behavior ─────────────────────────────────

describe('POST /api/chat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: USER_A }, error: null })
    mockCreateConversation.mockResolvedValue({ id: CONV_NEW, user_id: USER_A.id })
    mockAppendMessage.mockResolvedValue({ id: 'msg-1' })
    mockGetConversationOwner.mockResolvedValue(USER_A.id)
    vi.mocked(streamText).mockReturnValue({
      toUIMessageStreamResponse: vi.fn(() => makeStreamResponse()),
    } as unknown as ReturnType<typeof streamText>)
  })

  it('(a) returns 200 for a valid messages array', async () => {
    const res = await chatPost(makeChatRequest())
    expect(res.status).toBe(200)
  })

  it('(b) signals streaming protocol via X-Vercel-AI-Data-Stream header', async () => {
    const res = await chatPost(makeChatRequest())
    expect(res.headers.get('x-vercel-ai-data-stream')).toBe('v1')
  })

  it('(b) response body contains text delta chunk', async () => {
    const res = await chatPost(makeChatRequest())
    const body = await res.text()
    expect(body).toContain('0:')
  })

  it('(c) passes qwen2.5-coder:3b model to streamText', async () => {
    await chatPost(makeChatRequest())
    const callArg = vi.mocked(streamText).mock.calls[0][0]
    expect((callArg.model as { modelId: string }).modelId).toBe('qwen2.5-coder:3b')
  })

  it('(d) returns 401 when no authenticated user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null })
    const res = await chatPost(makeChatRequest())
    expect(res.status).toBe(401)
  })

  it('(e) creates a new conversation when conversationId is null and returns X-Conversation-Id header', async () => {
    const res = await chatPost(makeChatRequest({ conversationId: null }))
    expect(mockCreateConversation).toHaveBeenCalledOnce()
    expect(mockCreateConversation).toHaveBeenCalledWith(USER_A.id, expect.any(String))
    expect(res.headers.get('x-conversation-id')).toBe(CONV_NEW)
  })

  it('(e) derives title from first 50 chars of first user message', async () => {
    const longText = 'a'.repeat(200)
    await chatPost(
      makeChatRequest({
        conversationId: null,
        messages: [{ role: 'user', parts: [{ type: 'text', text: longText }] }],
      }),
    )
    const titleArg = mockCreateConversation.mock.calls[0][1]
    expect(titleArg).toHaveLength(50)
  })

  it('(f) appends to existing conversation without creating a new one', async () => {
    const res = await chatPost(makeChatRequest({ conversationId: CONV_A }))
    expect(mockCreateConversation).not.toHaveBeenCalled()
    expect(res.headers.get('x-conversation-id')).toBeNull()
  })

  it('(g) returns 403 when conversationId belongs to another user', async () => {
    mockGetConversationOwner.mockResolvedValue(USER_B.id)
    const res = await chatPost(makeChatRequest({ conversationId: CONV_A }))
    expect(res.status).toBe(403)
    expect(mockAppendMessage).not.toHaveBeenCalled()
  })

  it('(h) persists user message before streaming', async () => {
    await chatPost(makeChatRequest({ conversationId: CONV_A }))
    expect(mockAppendMessage).toHaveBeenCalledWith(
      CONV_A,
      'user',
      expect.arrayContaining([expect.objectContaining({ type: 'text' })]),
    )
  })

  it('persists assistant message via onFinish callback', async () => {
    let capturedOnFinish: ((event: { text: string; usage: { inputTokens: number; outputTokens: number }; finishReason: string }) => unknown) | undefined
    vi.mocked(streamText).mockImplementation((opts: unknown) => {
      capturedOnFinish = (opts as { onFinish?: typeof capturedOnFinish }).onFinish
      return {
        toUIMessageStreamResponse: vi.fn(() => makeStreamResponse()),
      } as unknown as ReturnType<typeof streamText>
    })
    await chatPost(makeChatRequest({ conversationId: CONV_A }))
    expect(capturedOnFinish).toBeDefined()
    await capturedOnFinish?.({
      text: 'assistant reply',
      usage: { inputTokens: 5, outputTokens: 4 },
      finishReason: 'stop',
    })
    const assistantCall = mockAppendMessage.mock.calls.find((c: unknown[]) => c[1] === 'assistant')
    expect(assistantCall).toBeDefined()
    expect(assistantCall?.[2]).toEqual([{ type: 'text', text: 'assistant reply' }])
    expect(assistantCall?.[3]).toBe('qwen2.5-coder:3b')
  })
})

// ── GET /api/chat/conversations ───────────────────────────────────────────────

describe('GET /api/chat/conversations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: USER_A }, error: null })
  })

  it('returns 401 when not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null })
    const res = await conversationsGet()
    expect(res.status).toBe(401)
  })

  it('returns the list scoped to the authenticated user', async () => {
    const fixture = [
      {
        id: 'c1',
        user_id: USER_A.id,
        title: 'Hi',
        message_count: 2,
        created_at: '2026-04-27T00:00:00Z',
        updated_at: '2026-04-27T00:01:00Z',
        archived_at: null,
      },
    ]
    mockListConversations.mockResolvedValue(fixture)
    const res = await conversationsGet()
    expect(res.status).toBe(200)
    expect(mockListConversations).toHaveBeenCalledWith(USER_A.id)
    expect(await res.json()).toEqual(fixture)
  })
})

// ── GET /api/chat/conversations/[id]/messages ─────────────────────────────────

describe('GET /api/chat/conversations/[id]/messages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: USER_A }, error: null })
    mockGetConversationOwner.mockResolvedValue(USER_A.id)
  })

  it('returns 401 when not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null })
    const res = await messagesGet(new Request('http://localhost'), {
      params: Promise.resolve({ id: CONV_A }),
    })
    expect(res.status).toBe(401)
  })

  it('returns messages for a conversation owned by the user', async () => {
    const fixture = [
      {
        id: 'm1',
        conversation_id: CONV_A,
        role: 'user',
        content: [{ type: 'text', text: 'hi' }],
        model: null,
        tokens_used: null,
        created_at: '2026-04-27T00:00:00Z',
      },
    ]
    mockLoadConversationMessages.mockResolvedValue(fixture)
    const res = await messagesGet(new Request('http://localhost'), {
      params: Promise.resolve({ id: CONV_A }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(fixture)
  })

  it('returns 403 for a conversation owned by another user (RLS enforcement at app layer)', async () => {
    mockGetConversationOwner.mockResolvedValue(USER_B.id)
    const res = await messagesGet(new Request('http://localhost'), {
      params: Promise.resolve({ id: CONV_A }),
    })
    expect(res.status).toBe(403)
    expect(mockLoadConversationMessages).not.toHaveBeenCalled()
  })
})

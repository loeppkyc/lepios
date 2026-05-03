import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockHttpRequest } = vi.hoisted(() => ({
  mockHttpRequest: vi.fn(),
}))

vi.mock('@/lib/harness/arms-legs/http', () => ({
  httpRequest: mockHttpRequest,
}))

// Mock getSecret so postMessage tests don't require a live DB connection.
// The mock mirrors getSecret's process.env fallback: resolves to the env value,
// or resolves to undefined when the env var is absent (preserving null-check behavior).
vi.mock('@/lib/security/secrets', () => ({
  getSecret: vi.fn().mockImplementation((key: string) => Promise.resolve(process.env[key])),
}))

import { postMessage, MissingTelegramConfigError } from '@/lib/orchestrator/telegram'

describe('MissingTelegramConfigError', () => {
  it('is an instance of Error', () => {
    const err = new MissingTelegramConfigError()
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('MissingTelegramConfigError')
    expect(err.message).toContain('TELEGRAM_BOT_TOKEN')
  })
})

describe('postMessage', () => {
  const savedToken = process.env.TELEGRAM_BOT_TOKEN
  const savedChat = process.env.TELEGRAM_CHAT_ID

  beforeEach(() => {
    vi.clearAllMocks()
    mockHttpRequest.mockReset()
  })

  afterEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = savedToken
    process.env.TELEGRAM_CHAT_ID = savedChat
    vi.unstubAllGlobals()
  })

  it('throws MissingTelegramConfigError when BOT_TOKEN is missing', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN
    process.env.TELEGRAM_CHAT_ID = 'chat123'
    await expect(postMessage('test')).rejects.toBeInstanceOf(MissingTelegramConfigError)
  })

  it('throws MissingTelegramConfigError when CHAT_ID is missing', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'token123'
    delete process.env.TELEGRAM_CHAT_ID
    await expect(postMessage('test')).rejects.toBeInstanceOf(MissingTelegramConfigError)
  })

  it('throws MissingTelegramConfigError when both are missing', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN
    delete process.env.TELEGRAM_CHAT_ID
    await expect(postMessage('test')).rejects.toBeInstanceOf(MissingTelegramConfigError)
  })

  it('calls fetch with the correct Telegram URL when creds are set', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'testtoken'
    process.env.TELEGRAM_CHAT_ID = 'chat123'

    mockHttpRequest.mockResolvedValue({
      ok: true,
      status: 200,
      body: '{}',
      headers: {},
      durationMs: 5,
    })

    await postMessage('Hello World')

    expect(mockHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://api.telegram.org/bottesttoken/sendMessage',
        method: 'POST',
        capability: 'net.outbound.telegram',
        agentId: 'orchestrator',
      })
    )
  })

  it('includes chat_id and text in the request body', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'tok'
    process.env.TELEGRAM_CHAT_ID = 'cid'

    mockHttpRequest.mockResolvedValue({
      ok: true,
      status: 200,
      body: '{}',
      headers: {},
      durationMs: 5,
    })

    await postMessage('my message')

    expect(mockHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { chat_id: 'cid', text: 'my message' },
      })
    )
  })

  it('throws on non-ok Telegram API response', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'token'
    process.env.TELEGRAM_CHAT_ID = 'chat'

    mockHttpRequest.mockResolvedValue({
      ok: false,
      status: 400,
      body: 'Bad Request',
      headers: {},
      durationMs: 5,
    })

    await expect(postMessage('test')).rejects.toThrow('400')
  })
})

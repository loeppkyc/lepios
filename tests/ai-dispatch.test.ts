import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/knowledge/client', () => ({
  logEvent: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'test-task-id-abc123' }, error: null }),
    })),
  })),
}))

vi.mock('@/lib/ollama/client', () => {
  class OllamaUnreachableError extends Error {
    readonly name = 'OllamaUnreachableError'
    constructor(public readonly cause?: unknown) {
      super('Ollama is unreachable')
    }
  }
  return {
    hydrateOllamaConfig: vi.fn().mockResolvedValue(undefined),
    generate: vi.fn().mockResolvedValue({
      text: 'Ollama response text',
      confidence: 0.9,
      model: 'qwen2.5:7b',
      tokens_used: 42,
    }),
    OllamaUnreachableError,
  }
})

const CRON_SECRET = 'test-secret-xyz'

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/ai/dispatch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${CRON_SECRET}`,
    },
    body: JSON.stringify(body),
  })
}

describe('classifyTask', () => {
  it('routes coordinator keywords to coordinator tier', async () => {
    const { classifyTask } = await import('@/app/api/ai/dispatch/route')
    expect(classifyTask('write a migration for the users table')).toBe('coordinator')
    expect(classifyTask('update the schema for orders')).toBe('coordinator')
    expect(classifyTask('write an acceptance doc for this feature')).toBe('coordinator')
    expect(classifyTask('design the new architecture')).toBe('coordinator')
    expect(classifyTask('add grounding to the migration')).toBe('coordinator')
  })

  it('routes short plain tasks to ollama tier', async () => {
    const { classifyTask } = await import('@/app/api/ai/dispatch/route')
    expect(classifyTask('summarise this deal')).toBe('ollama')
    expect(classifyTask('what is the capital of France')).toBe('ollama')
    expect(classifyTask('explain exponential backoff in one sentence')).toBe('ollama')
  })

  it('routes tasks over 300 characters to coordinator regardless of content', async () => {
    const { classifyTask } = await import('@/app/api/ai/dispatch/route')
    const longTask = 'summarise this deal '.repeat(20)
    expect(longTask.length).toBeGreaterThan(300)
    expect(classifyTask(longTask)).toBe('coordinator')
  })
})

describe('POST /api/ai/dispatch', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = CRON_SECRET
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('returns 401 with wrong auth', async () => {
    const { POST } = await import('@/app/api/ai/dispatch/route')
    const req = new Request('http://localhost/api/ai/dispatch', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong', 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'hello' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 400 for missing task field', async () => {
    const { POST } = await import('@/app/api/ai/dispatch/route')
    const res = await POST(makeRequest({ context: 'some context' }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/task/)
  })

  it('"migration" in task → routed_to: coordinator, task_id returned', async () => {
    const { POST } = await import('@/app/api/ai/dispatch/route')
    const res = await POST(makeRequest({ task: 'write a migration for the new table' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.routed_to).toBe('coordinator')
    expect(typeof json.task_id).toBe('string')
    expect(json.task_id).toBeTruthy()
  })

  it('"summarise this deal" → routed_to: ollama, result returned', async () => {
    const { POST } = await import('@/app/api/ai/dispatch/route')
    const res = await POST(makeRequest({ task: 'summarise this deal' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.routed_to).toBe('ollama')
    expect(typeof json.text).toBe('string')
  })

  it('Ollama unreachable → falls back to coordinator, returns task_id', async () => {
    // Import the mock module first to get the shared OllamaUnreachableError class and generate mock.
    // The route imports from the same module instance, so instanceof checks pass correctly.
    const { generate, OllamaUnreachableError } = await import('@/lib/ollama/client')
    vi.mocked(generate).mockRejectedValueOnce(new OllamaUnreachableError())

    const { POST } = await import('@/app/api/ai/dispatch/route')
    const res = await POST(makeRequest({ task: 'explain this concept clearly' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.routed_to).toBe('coordinator')
    expect(typeof json.task_id).toBe('string')
  })

  it('logs ai_dispatch.routed event on success', async () => {
    const { POST } = await import('@/app/api/ai/dispatch/route')
    await POST(makeRequest({ task: 'summarise this deal' }))
    const { logEvent } = await import('@/lib/knowledge/client')
    expect(vi.mocked(logEvent)).toHaveBeenCalledWith(
      'ai_dispatch',
      'ai_dispatch.routed',
      expect.objectContaining({ status: 'success' })
    )
  })
})

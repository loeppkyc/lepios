import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/ollama/client', () => ({
  generate: vi.fn(),
}))

vi.mock('@/lib/knowledge/client', () => ({
  logEvent: vi.fn().mockResolvedValue('mock-event-id'),
}))

vi.mock('@/lib/ollama/models', () => ({
  OLLAMA_MODELS: { ANALYSIS: 'qwen2.5:32b' },
}))

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { generate } from '@/lib/ollama/client'
import { logEvent } from '@/lib/knowledge/client'
import { askOllama, isSycophantic, getAnalystPrompt } from '@/lib/llm/ollama'

const mockGenerate = vi.mocked(generate)
const mockLogEvent = vi.mocked(logEvent)

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeGenerateResult(text: string) {
  return { text, confidence: 0.85, model: 'qwen2.5:32b', tokens_used: null }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

describe('analyst system prompt injection', () => {
  it('injects analyst prompt by default', async () => {
    mockGenerate.mockResolvedValue(makeGenerateResult('No. The data does not support this.'))

    await askOllama('Is this a good idea?')

    expect(mockGenerate).toHaveBeenCalledOnce()
    const [, opts] = mockGenerate.mock.calls[0]
    expect(opts?.systemPrompt).toBe(getAnalystPrompt())
  })

  it('uses opts.system override instead of analyst prompt', async () => {
    mockGenerate.mockResolvedValue(makeGenerateResult('Custom response.'))

    const customSystem = 'You are a tax accountant.'
    await askOllama('What deductions apply?', { system: customSystem })

    const [, opts] = mockGenerate.mock.calls[0]
    expect(opts?.systemPrompt).toBe(customSystem)
    expect(opts?.systemPrompt).not.toBe(getAnalystPrompt())
  })
})

describe('connection error handling', () => {
  it('returns null on OllamaUnreachableError, does not throw', async () => {
    mockGenerate.mockRejectedValue(new Error('Ollama is unreachable'))

    const result = await askOllama('Is this a good investment?')

    expect(result).toBeNull()
  })

  it('logs failure event when generate throws', async () => {
    mockGenerate.mockRejectedValue(new Error('connection refused'))

    await askOllama('Any question')

    expect(mockLogEvent).toHaveBeenCalledWith(
      'ollama',
      'ollama.analyst_call',
      expect.objectContaining({ status: 'failure' })
    )
  })
})

describe('sycophancy detection', () => {
  it.each([
    ['Great question, that is interesting!', true],
    ['Interesting point you raise there.', true],
    ["You're right that this is complex.", true],
    ['You are right about that.', true],
    ["I think you're onto something here.", true],
    ['GREAT QUESTION — let me explain.', true],
    ['No. The data contradicts your hypothesis.', false],
    ['Ambiguous. The spread is wide.', false],
    ['The flaw is in the assumption that revenue equals profit.', false],
  ])('isSycophantic(%s) === %s', (text, expected) => {
    expect(isSycophantic(text)).toBe(expected)
  })

  it('sets sycophancy_flag=true on result when opener matches', async () => {
    mockGenerate.mockResolvedValue(makeGenerateResult('Great question, here is my analysis.'))

    const result = await askOllama('Tell me what I want to hear.')

    expect(result?.sycophancy_flag).toBe(true)
  })

  it('sets sycophancy_flag=false on a direct analytical response', async () => {
    mockGenerate.mockResolvedValue(makeGenerateResult('No. Revenue fell 12% QoQ per the data.'))

    const result = await askOllama('Was last quarter good?')

    expect(result?.sycophancy_flag).toBe(false)
  })

  it('includes sycophancy_flag in the agent_events log', async () => {
    mockGenerate.mockResolvedValue(makeGenerateResult('Great question! Here we go.'))

    await askOllama('Test')

    expect(mockLogEvent).toHaveBeenCalledWith(
      'ollama',
      'ollama.analyst_call',
      expect.objectContaining({
        meta: expect.objectContaining({ sycophancy_flag: true }),
      })
    )
  })
})

describe('Modelfile integrity', () => {
  it('Modelfile SYSTEM block contains the full analyst.md content', () => {
    const analystMd = fs
      .readFileSync(path.join(process.cwd(), 'lib/llm/prompts/analyst.md'), 'utf-8')
      .trim()

    const modelfile = fs.readFileSync(
      path.join(process.cwd(), 'infra/ollama/Modelfile.qwen-analyst'),
      'utf-8'
    )

    expect(modelfile).toContain(analystMd)
  })
})

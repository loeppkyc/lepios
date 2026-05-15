/**
 * Unit tests for lib/harness/pre-research.ts
 *
 * Mocks:
 *   - @/lib/supabase/service — no real Supabase connection
 *   - @/lib/ollama/client — no real Ollama calls
 *   - @/lib/knowledge/client — logEvent is fire-and-forget, mocked to no-op
 *
 * Tests: PR-1 through PR-8 per acceptance doc.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock Supabase ─────────────────────────────────────────────────────────────

const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mockFrom })),
}))

// ── Mock Ollama client ────────────────────────────────────────────────────────

const { mockGenerate } = vi.hoisted(() => ({
  mockGenerate: vi.fn(),
}))

vi.mock('@/lib/ollama/client', () => ({
  generate: mockGenerate,
  OllamaUnreachableError: class OllamaUnreachableError extends Error {
    override readonly name = 'OllamaUnreachableError'
    constructor(cause?: unknown) {
      super('Ollama is unreachable')
      void cause
    }
  },
}))

// ── Mock knowledge/client ─────────────────────────────────────────────────────

vi.mock('@/lib/knowledge/client', () => ({
  logEvent: vi.fn().mockResolvedValue('mock-event-id'),
}))

// ── Mock ollama/models ────────────────────────────────────────────────────────

vi.mock('@/lib/ollama/models', () => ({
  OLLAMA_MODELS: {
    ANALYSIS: 'qwen2.5:32b',
  },
}))

// ── Import after mocks ────────────────────────────────────────────────────────

import { extractModuleHints, fetchSourceSnippets, runPreResearch } from '@/lib/harness/pre-research'
import { OllamaUnreachableError } from '@/lib/ollama/client'

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a chainable Supabase query mock that resolves to `result` at the terminal call.
 * Supports: .select().eq().ilike().order().limit() → result
 *           .select().eq().maybeSingle() → result
 *           .update().eq() → result
 */
function makeQueryChain(result: { data: unknown; error: unknown }) {
  const terminal = vi.fn().mockResolvedValue(result)
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    ilike: vi.fn(),
    order: vi.fn(),
    limit: terminal,
    maybeSingle: terminal,
    update: vi.fn(),
  }
  chain.select.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  chain.ilike.mockReturnValue(chain)
  chain.order.mockReturnValue(chain)
  chain.update.mockReturnValue(chain)
  return { chain, terminal }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

// ── PR-1: extractModuleHints — file pattern ───────────────────────────────────

describe('PR-1: extractModuleHints — file pattern', () => {
  it('extracts "utility_tracker" from "port 52_Utility_Tracker.py"', () => {
    const hints = extractModuleHints('port 52_Utility_Tracker.py')
    expect(hints).toContain('utility_tracker')
  })

  it('also extracts the page-number slug "52_utility"', () => {
    const hints = extractModuleHints('port 52_Utility_Tracker.py')
    expect(hints).toContain('52_utility')
  })
})

// ── PR-2: extractModuleHints — no hints ──────────────────────────────────────

describe('PR-2: extractModuleHints — no Streamlit hint in description', () => {
  it('returns [] when description has no Streamlit module pattern', () => {
    const hints = extractModuleHints('build auth module')
    expect(hints).toEqual([])
  })
})

// ── PR-3: fetchSourceSnippets — 3 rows ───────────────────────────────────────

describe('PR-3: fetchSourceSnippets — mock knowledge returns 3 rows', () => {
  it('returns concatenated context, total ≤ 6000 chars', async () => {
    const rows = [
      {
        entity: 'pages/52_Utility_Tracker.py',
        title: 'render_utility',
        context: 'def render_utility(): pass',
      },
      {
        entity: 'pages/52_Utility_Tracker.py',
        title: 'load_data',
        context: 'def load_data(): return []',
      },
      {
        entity: 'pages/52_Utility_Tracker.py',
        title: 'calc_totals',
        context: 'def calc_totals(df): return df.sum()',
      },
    ]

    const { chain } = makeQueryChain({ data: rows, error: null })
    mockFrom.mockReturnValue(chain)

    const result = await fetchSourceSnippets(['utility_tracker'])

    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
    expect(result.length).toBeLessThanOrEqual(6000)
    expect(result).toContain('render_utility')
    expect(result).toContain('load_data')
    expect(result).toContain('calc_totals')
  })
})

// ── PR-4: fetchSourceSnippets — empty result ─────────────────────────────────

describe('PR-4: fetchSourceSnippets — knowledge returns empty', () => {
  it('returns "" when knowledge table has no matching rows', async () => {
    const { chain } = makeQueryChain({ data: [], error: null })
    mockFrom.mockReturnValue(chain)

    const result = await fetchSourceSnippets(['utility_tracker'])
    expect(result).toBe('')
  })
})

// ── PR-5: runPreResearch — Ollama reachable, knowledge hit ───────────────────

describe('PR-5: runPreResearch — Ollama reachable, knowledge hit', () => {
  it('writes research_notes to task_queue metadata', async () => {
    // task_queue fetch returns one queued task without research_notes
    const queuedTask = {
      id: 'task-uuid-1',
      task: 'Port 52_Utility_Tracker.py',
      description: null,
      metadata: {},
    }

    // knowledge rows for the hint
    const knowledgeRows = [
      {
        entity: 'pages/52_Utility_Tracker.py',
        title: 'render_utility',
        context: 'def render_utility(): pass # business rule: show monthly totals',
      },
    ]

    // Track task_queue calls separately from knowledge calls
    let taskQueueCallCount = 0

    mockFrom.mockImplementation((table: string) => {
      if (table === 'task_queue') {
        taskQueueCallCount++

        if (taskQueueCallCount === 1) {
          // First task_queue call: fetch queued tasks — returns array
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ data: [queuedTask], error: null }),
          }
        }
        if (taskQueueCallCount === 2) {
          // Second task_queue call: read current metadata (maybeSingle chain)
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { metadata: {} }, error: null }),
          }
        }
        if (taskQueueCallCount === 3) {
          // Third task_queue call: write merged metadata
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ data: null, error: null }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      }

      if (table === 'knowledge') {
        // Knowledge select: return matching rows
        const { chain } = makeQueryChain({ data: knowledgeRows, error: null })
        return chain
      }

      const { chain } = makeQueryChain({ data: null, error: null })
      return chain
    })

    // Ollama returns a summary
    mockGenerate.mockResolvedValue({
      text: 'Business rule: show monthly totals. Data flow: loads from Google Sheets.',
      model: 'qwen2.5:32b',
      confidence: 0.85,
      tokens_used: 120,
    })

    const result = await runPreResearch()

    expect(result.tasks_processed).toBe(1)
    expect(result.tasks_skipped).toBe(0)
    expect(result.errors).toEqual([])
  })
})

// ── PR-6: runPreResearch — Ollama throws OllamaUnreachableError ───────────────

describe('PR-6: runPreResearch — Ollama throws OllamaUnreachableError', () => {
  it('skips gracefully, does NOT write metadata, does NOT throw', async () => {
    const queuedTask = {
      id: 'task-uuid-2',
      task: 'Port 52_Utility_Tracker.py',
      description: null,
      metadata: {},
    }

    const knowledgeRows = [
      { entity: 'pages/52_Utility_Tracker.py', title: 'render', context: 'def render(): pass' },
    ]

    let callCount = 0
    const updateMock = vi.fn()
    mockFrom.mockImplementation((table: string) => {
      callCount++
      if (table === 'task_queue' && callCount === 1) {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: [queuedTask], error: null }),
        }
      }
      if (table === 'knowledge') {
        const { chain } = makeQueryChain({ data: knowledgeRows, error: null })
        return chain
      }
      // Should never reach update — track if it does
      return { update: updateMock }
    })

    // Ollama throws
    mockGenerate.mockRejectedValue(new OllamaUnreachableError())

    const result = await runPreResearch()

    expect(result.tasks_ollama_error).toBe(1)
    expect(result.tasks_processed).toBe(0)
    expect(updateMock).not.toHaveBeenCalled()
    // Must not throw — function returns normally
    expect(result.errors).toEqual([])
  })
})

// ── PR-7: runPreResearch — no queued tasks ────────────────────────────────────

describe('PR-7: runPreResearch — no queued tasks', () => {
  it('returns early with zero counts, no Ollama call', async () => {
    mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
    }))

    const result = await runPreResearch()

    expect(result.tasks_processed).toBe(0)
    expect(result.tasks_skipped).toBe(0)
    expect(result.tasks_no_hints).toBe(0)
    expect(result.tasks_ollama_error).toBe(0)
    expect(mockGenerate).not.toHaveBeenCalled()
  })
})

// ── PR-8: runPreResearch — task already has research_notes (idempotent) ───────

describe('PR-8: runPreResearch — task already has research_notes', () => {
  it('skips that task and does not call Ollama', async () => {
    const taskWithNotes = {
      id: 'task-uuid-3',
      task: 'Port 52_Utility_Tracker.py',
      description: null,
      metadata: {
        research_notes: 'Already summarized: monthly totals, Google Sheets data source.',
        research_notes_model: 'qwen2.5:32b',
        research_notes_generated_at: '2026-05-15T10:00:00Z',
        research_notes_source_files: ['pages/52_Utility_Tracker.py'],
      },
    }

    mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [taskWithNotes], error: null }),
    }))

    const result = await runPreResearch()

    expect(result.tasks_skipped).toBe(1)
    expect(result.tasks_processed).toBe(0)
    expect(mockGenerate).not.toHaveBeenCalled()
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateDebrief } from '@/lib/sports/debrief'
import type { SportsPick } from '@/lib/sports/picks'

// ── Mock Anthropic ────────────────────────────────────────────────────────────

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }))

vi.mock('@anthropic-ai/sdk', () => ({
  // Use a class so `new Anthropic(...)` works without Vitest constructor warnings
  default: class {
    messages = { create: mockCreate }
  },
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePick(overrides: Partial<SportsPick> = {}): SportsPick {
  return {
    id: 'pick-123',
    picked_on: '2026-05-15',
    sport_key: 'icehockey_nhl',
    league: 'NHL',
    game_id: 'nhl_EDM_CGY',
    home: 'Edmonton Oilers',
    away: 'Calgary Flames',
    favorite: 'Edmonton Oilers',
    fav_odds: -165,
    dog_odds: 140,
    implied_prob: 62.3,
    commence_str: 'Thu May 15 7:00 PM MT',
    tier: 'green',
    winner: 'Edmonton Oilers',
    fav_won: true,
    pnl: 60.61,
    updated_at: '2026-05-16T02:00:00Z',
    created_at: '2026-05-15T10:00:00Z',
    ...overrides,
  }
}

const validDebriefJson = JSON.stringify({
  summary: 'Edmonton dominated with superior possession and goaltending.',
  factors: ['Home ice advantage', 'Connor McDavid line performance', 'Oilers power play'],
  lesson: 'Heavy favorites at home tend to cover in NHL playoffs.',
  quality_rating: 8,
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('generateDebrief', () => {
  beforeEach(() => {
    mockCreate.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns a DebriefResult with all required fields', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: validDebriefJson }],
    })

    const result = await generateDebrief(makePick())

    expect(result).toHaveProperty('summary')
    expect(result).toHaveProperty('factors')
    expect(result).toHaveProperty('lesson')
    expect(result).toHaveProperty('quality_rating')
  })

  it('summary is a non-empty string', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: validDebriefJson }],
    })

    const result = await generateDebrief(makePick())
    expect(typeof result.summary).toBe('string')
    expect(result.summary.length).toBeGreaterThan(0)
  })

  it('factors is an array with at most 3 items', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: validDebriefJson }],
    })

    const result = await generateDebrief(makePick())
    expect(Array.isArray(result.factors)).toBe(true)
    expect(result.factors.length).toBeLessThanOrEqual(3)
  })

  it('quality_rating is a number', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: validDebriefJson }],
    })

    const result = await generateDebrief(makePick())
    expect(typeof result.quality_rating).toBe('number')
  })

  it('quality_rating from mock is 8', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: validDebriefJson }],
    })

    const result = await generateDebrief(makePick())
    expect(result.quality_rating).toBe(8)
  })

  it('uses claude-haiku model for cost efficiency', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: validDebriefJson }],
    })

    await generateDebrief(makePick())
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-haiku-4-5-20251001' })
    )
  })

  it('max_tokens is 300', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: validDebriefJson }],
    })

    await generateDebrief(makePick())
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ max_tokens: 300 }))
  })

  it('strips markdown code fences from response', async () => {
    const fencedJson = '```json\n' + validDebriefJson + '\n```'
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: fencedJson }],
    })

    const result = await generateDebrief(makePick())
    expect(result.summary).not.toContain('```')
  })

  it('handles API error gracefully — returns fallback debrief', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API timeout'))

    const result = await generateDebrief(makePick())
    expect(result.summary).toContain('Debrief unavailable')
    expect(result.quality_rating).toBe(0)
    expect(Array.isArray(result.factors)).toBe(true)
  })

  it('handles malformed JSON from Claude gracefully', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'This is not JSON at all!' }],
    })

    const result = await generateDebrief(makePick())
    expect(result.summary).toContain('Debrief unavailable')
    expect(result.quality_rating).toBe(0)
  })

  it('includes favorite and underdog names in prompt', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: validDebriefJson }],
    })

    await generateDebrief(makePick({ fav_won: false, winner: 'Calgary Flames' }))

    const callArgs = mockCreate.mock.calls[0][0] as { messages: { content: string }[] }
    const promptText = callArgs.messages[0].content
    expect(promptText).toContain('Edmonton Oilers')
    expect(promptText).toContain('Calgary Flames')
  })

  it('limits factors array to 3 items even if Claude returns more', async () => {
    const manyFactors = JSON.stringify({
      summary: 'Test',
      factors: ['f1', 'f2', 'f3', 'f4', 'f5'],
      lesson: 'lesson',
      quality_rating: 7,
    })
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: manyFactors }],
    })

    const result = await generateDebrief(makePick())
    expect(result.factors.length).toBeLessThanOrEqual(3)
  })
})

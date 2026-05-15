import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock Anthropic SDK ────────────────────────────────────────────────────────
// Must be set up BEFORE importing the module under test

const mockCreate = vi.fn()

vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate }
  },
}))

// Import AFTER mock is set up
import { ocrReceipt } from '@/lib/receipts/ocr'

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockClaudeResponse(json: Record<string, unknown>) {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text: JSON.stringify(json) }],
  })
}

function mockClaudeParseError() {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text: 'not valid json' }],
  })
}

const SAMPLE_IMAGE = Buffer.from('fake-jpeg-data')
const SAMPLE_PDF = Buffer.from('fake-pdf-data')

const VALID_OCR = {
  vendor: 'Costco Wholesale',
  date: '2026-05-10',
  pretax: 47.62,
  tax_amount: 2.38,
  total: 50.00,
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
  mockCreate.mockReset()
})

describe('ocrReceipt — haiku model used by default', () => {
  it('calls claude-haiku-4-5-20251001 for image input', async () => {
    mockClaudeResponse(VALID_OCR)

    await ocrReceipt(SAMPLE_IMAGE, 'image/jpeg')

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-haiku-4-5-20251001' }),
    )
  })

  it('calls claude-haiku-4-5-20251001 for PDF input', async () => {
    mockClaudeResponse(VALID_OCR)

    await ocrReceipt(SAMPLE_PDF, 'application/pdf')

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-haiku-4-5-20251001' }),
    )
  })
})

describe('ocrReceipt — sonnet fallback on JSON parse error', () => {
  it('falls back to claude-sonnet-4-6 if haiku returns unparseable JSON (for PDF)', async () => {
    // PDF path: haiku fails → sonnet called
    mockClaudeParseError()   // haiku attempt 1 fails
    mockClaudeResponse(VALID_OCR) // sonnet succeeds

    const result = await ocrReceipt(SAMPLE_PDF, 'application/pdf')

    expect(result.ocr_model).toBe('sonnet')
    // Verify sonnet was actually called
    const calls = mockCreate.mock.calls
    expect(calls.length).toBe(2)
    expect(calls[1][0].model).toBe('claude-sonnet-4-6')
  })
})

describe('ocrReceipt — OcrResult shape', () => {
  it('returns vendor, date, total, and ocr_model', async () => {
    mockClaudeResponse(VALID_OCR)

    const result = await ocrReceipt(SAMPLE_IMAGE, 'image/jpeg')

    expect(result.vendor).toBe('Costco Wholesale')
    expect(result.date).toBe('2026-05-10')
    expect(result.total).toBe(50)
    expect(['haiku', 'sonnet', 'regex']).toContain(result.ocr_model)
  })

  it('normalizes pretax and tax_amount field names', async () => {
    mockClaudeResponse(VALID_OCR)

    const result = await ocrReceipt(SAMPLE_IMAGE, 'image/jpeg')

    expect(result.pre_tax).toBe(47.62)
    expect(result.tax).toBe(2.38)
  })
})

describe('ocrReceipt — API key not configured', () => {
  it('throws if ANTHROPIC_API_KEY is absent', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')

    await expect(ocrReceipt(SAMPLE_IMAGE, 'image/jpeg')).rejects.toThrow(
      'ANTHROPIC_API_KEY not configured',
    )
  })
})

describe('ocrReceipt — line_items', () => {
  it('returns empty array when Claude returns no line_items', async () => {
    mockClaudeResponse({ ...VALID_OCR, line_items: undefined })

    const result = await ocrReceipt(SAMPLE_IMAGE, 'image/jpeg')

    expect(result.line_items).toEqual([])
  })
})

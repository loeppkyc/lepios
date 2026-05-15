/**
 * OCR pipeline for receipt images and PDFs.
 *
 * Decision tree:
 *   PDF  → Claude document API (haiku), returns JSON
 *   image → server-side sharp resize (max 2500px, quality 88)
 *           → attempt regex extraction (vendor, date, total, GST)
 *           → if regex confidence < 0.7 → Claude Vision API (haiku)
 *           → on JSON parse error ×2 → fallback to claude-sonnet-4-6
 *
 * Model costs:
 *   haiku   — primary, cheap (~0.25/MTok input)
 *   sonnet  — fallback only on parse failure (×10 cost)
 *   regex   — free, used when pattern match confidence ≥ 0.7
 */

import Anthropic from '@anthropic-ai/sdk'
import type { DocumentBlockParam } from '@anthropic-ai/sdk/resources/messages/messages'

// ── TODO: tune with real data — threshold below which regex is deemed unreliable
const REGEX_CONFIDENCE_THRESHOLD = 0.7 // placeholder constant

export interface OcrResult {
  vendor: string
  date: string          // YYYY-MM-DD
  pre_tax?: number
  tax?: number
  total: number
  category?: string
  line_items: LineItem[]
  ocr_model: 'haiku' | 'sonnet' | 'regex'
}

export interface LineItem {
  description: string
  amount: number
  qty?: number
}

interface RawOcrJson {
  vendor?: string | null
  date?: string | null
  pretax?: number | null
  pre_tax?: number | null
  tax_amount?: number | null
  tax?: number | null
  total?: number | null
  total_paid?: number | null
  suggested_category?: string | null
  line_items?: LineItem[] | null
}

const EXTRACTION_PROMPT = `Extract information from this receipt. Return ONLY a valid JSON object with no markdown, no code fences, no explanation.

{
  "vendor": "store or business name",
  "date": "YYYY-MM-DD purchase date",
  "pretax": subtotal before tax as number or null,
  "tax_amount": GST/HST/PST tax line as number or null,
  "total": grand total paid including tax as number,
  "suggested_category": null,
  "line_items": []
}

Rules:
- total is required; pretax and tax_amount may be null
- date MUST be YYYY-MM-DD format
- Return null for any value you cannot determine confidently`

// ── Regex extraction ──────────────────────────────────────────────────────────

const TOTAL_PATTERNS = [
  /total[:\s]+\$?([\d,]+\.\d{2})/i,
  /grand\s+total[:\s]+\$?([\d,]+\.\d{2})/i,
  /amount\s+due[:\s]+\$?([\d,]+\.\d{2})/i,
  /balance\s+due[:\s]+\$?([\d,]+\.\d{2})/i,
]
const GST_PATTERNS = [
  /(?:gst|hst|tax)[:\s]+\$?([\d,]+\.\d{2})/i,
]
const DATE_PATTERNS = [
  /(\d{4}[-\/]\d{2}[-\/]\d{2})/,
  /(\d{2}[-\/]\d{2}[-\/]\d{4})/,
]

function tryRegex(text: string): { result: Partial<OcrResult>; confidence: number } {
  const fields: Partial<OcrResult> = { line_items: [] }
  let matched = 0
  const total = 4 // vendor, date, total, tax

  for (const pat of TOTAL_PATTERNS) {
    const m = text.match(pat)
    if (m) { fields.total = parseFloat(m[1].replace(',', '')); matched++; break }
  }
  for (const pat of GST_PATTERNS) {
    const m = text.match(pat)
    if (m) { fields.tax = parseFloat(m[1].replace(',', '')); matched++; break }
  }
  for (const pat of DATE_PATTERNS) {
    const m = text.match(pat)
    if (m) {
      const raw = m[1]
      // Normalize DD/MM/YYYY → YYYY-MM-DD
      if (/^\d{2}[-\/]\d{2}[-\/]\d{4}$/.test(raw)) {
        const parts = raw.split(/[-\/]/)
        fields.date = `${parts[2]}-${parts[1]}-${parts[0]}`
      } else {
        fields.date = raw.replace(/\//g, '-')
      }
      matched++
      break
    }
  }
  // Vendor: first non-empty line of receipt text
  const firstLine = text.split('\n').find((l) => l.trim().length > 2)
  if (firstLine) { fields.vendor = firstLine.trim(); matched++ }

  return { result: fields, confidence: matched / total }
}

// ── Claude API calls ──────────────────────────────────────────────────────────

function parseOcrJson(raw: string): RawOcrJson | null {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  try {
    return JSON.parse(cleaned) as RawOcrJson
  } catch {
    return null
  }
}

function normalizeRaw(raw: RawOcrJson, model: 'haiku' | 'sonnet'): OcrResult | null {
  const total = raw.total ?? raw.total_paid
  const vendor = raw.vendor
  if (!total || !vendor) return null

  const date = raw.date ?? new Date().toISOString().slice(0, 10)
  const pre_tax = raw.pretax ?? raw.pre_tax ?? undefined
  const tax = raw.tax_amount ?? raw.tax ?? undefined

  return {
    vendor,
    date,
    pre_tax: pre_tax !== undefined && pre_tax !== null ? Number(pre_tax) : undefined,
    tax: tax !== undefined && tax !== null ? Number(tax) : undefined,
    total: Number(total),
    category: raw.suggested_category ?? undefined,
    line_items: Array.isArray(raw.line_items) ? raw.line_items : [],
    ocr_model: model,
  }
}

async function callClaude(
  client: Anthropic,
  imageBase64: string,
  mimeType: string,
  model: 'claude-haiku-4-5-20251001' | 'claude-sonnet-4-6',
): Promise<RawOcrJson | null> {
  const msg = await client.messages.create({
    model,
    max_tokens: 400,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
              data: imageBase64,
            },
          },
          { type: 'text', text: EXTRACTION_PROMPT },
        ],
      },
    ],
  })
  const block = msg.content[0]
  const raw = block.type === 'text' ? block.text : ''
  return parseOcrJson(raw)
}

async function callClaudePdf(
  client: Anthropic,
  pdfBase64: string,
  model: 'claude-haiku-4-5-20251001' | 'claude-sonnet-4-6',
): Promise<RawOcrJson | null> {
  const docBlock: DocumentBlockParam = {
    type: 'document',
    source: {
      type: 'base64',
      media_type: 'application/pdf',
      data: pdfBase64,
    },
  }
  const msg = await client.messages.create({
    model,
    max_tokens: 400,
    messages: [
      {
        role: 'user',
        content: [docBlock, { type: 'text', text: EXTRACTION_PROMPT }],
      },
    ],
  })
  const block = msg.content[0]
  const raw = block.type === 'text' ? block.text : ''
  return parseOcrJson(raw)
}

// ── Sharp wrapper ─────────────────────────────────────────────────────────────
// Sharp is an optional peer dependency. If absent, image is passed through unresized.

async function resizeImage(buffer: Buffer): Promise<{ buffer: Buffer; mimeType: string }> {
  try {
    // Dynamic import so the module isn't required at build time
    const sharp = (await import('sharp')).default
    const resized = await sharp(buffer)
      .resize({ width: 2500, height: 2500, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer()
    return { buffer: resized, mimeType: 'image/jpeg' }
  } catch {
    // sharp not installed or resize failed — pass through
    return { buffer, mimeType: 'image/jpeg' }
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function ocrReceipt(buffer: Buffer, mimeType: string): Promise<OcrResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured')
  }
  const client = new Anthropic({ apiKey })

  // ── PDF path ─────────────────────────────────────────────────────────────
  if (mimeType === 'application/pdf') {
    const pdfBase64 = buffer.toString('base64')
    const parsed = await callClaudePdf(client, pdfBase64, 'claude-haiku-4-5-20251001')
    if (parsed) {
      const normalized = normalizeRaw(parsed, 'haiku')
      if (normalized) return normalized
    }
    // Haiku parse failed — retry with sonnet
    const fallback = await callClaudePdf(client, pdfBase64, 'claude-sonnet-4-6')
    if (fallback) {
      const normalized = normalizeRaw(fallback, 'sonnet')
      if (normalized) return normalized
    }
    throw new Error('OCR failed: could not extract receipt data from PDF')
  }

  // ── Image path ────────────────────────────────────────────────────────────
  const { buffer: resized, mimeType: resizedMime } = await resizeImage(buffer)
  const imageBase64 = resized.toString('base64')

  // Try regex first (free)
  const { result: regexResult, confidence } = tryRegex(
    buffer.toString('utf8').replace(/[^\x20-\x7E\n]/g, ' ')
  )

  if (
    confidence >= REGEX_CONFIDENCE_THRESHOLD &&
    regexResult.total !== undefined &&
    regexResult.vendor !== undefined &&
    regexResult.date !== undefined
  ) {
    return {
      vendor: regexResult.vendor!,
      date: regexResult.date!,
      pre_tax: regexResult.pre_tax,
      tax: regexResult.tax,
      total: regexResult.total!,
      line_items: [],
      ocr_model: 'regex',
    }
  }

  // Regex confidence < threshold — use Claude Vision haiku
  const haikusResult = await callClaude(client, imageBase64, resizedMime, 'claude-haiku-4-5-20251001')
  if (haikusResult) {
    const normalized = normalizeRaw(haikusResult, 'haiku')
    if (normalized) return normalized
  }

  // Haiku parse failed twice — fallback to sonnet
  const haiku2 = await callClaude(client, imageBase64, resizedMime, 'claude-haiku-4-5-20251001')
  if (haiku2) {
    const normalized = normalizeRaw(haiku2, 'haiku')
    if (normalized) return normalized
  }

  // Both haiku attempts failed — use sonnet
  const sonnetResult = await callClaude(client, imageBase64, resizedMime, 'claude-sonnet-4-6')
  if (sonnetResult) {
    const normalized = normalizeRaw(sonnetResult, 'sonnet')
    if (normalized) return normalized
  }

  throw new Error('OCR failed: could not extract receipt data from image')
}

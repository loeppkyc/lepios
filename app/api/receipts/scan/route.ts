import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { CATEGORIES } from '@/lib/types/expenses'
import type { OcrResult } from '@/lib/types/receipts'

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
type AllowedType = (typeof ALLOWED_TYPES)[number]

const MAX_BYTES = 4.5 * 1024 * 1024 // 4.5 MB — Vercel body limit

const EXTRACTION_PROMPT = `Extract information from this receipt image. Return ONLY a valid JSON object with no other text, markdown, or explanation.

{
  "vendor": "store or business name from the top of the receipt",
  "date": "purchase date in YYYY-MM-DD format",
  "pretax": subtotal before tax as a number (e.g. 45.23) or null,
  "tax_amount": GST/HST/PST tax line as a number (e.g. 2.26) or null,
  "total": final grand total paid including tax as a number (e.g. 47.49) or null,
  "suggested_category": best matching category from the list below or null
}

Valid categories: ${CATEGORIES.join(', ')}

Rules:
- pretax: the subtotal BEFORE any tax — not the total
- tax_amount: the specific tax line (5% GST, 13% HST, etc.)
- total: the grand total paid INCLUDING tax
- Use null for any value you cannot determine confidently
- date: use the transaction/purchase date on the receipt, YYYY-MM-DD
- suggested_category: pick the single best match based on vendor and items purchased`

export async function POST(request: Request) {
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'multipart/form-data required' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file field required' }, { status: 400 })
  }

  if (!ALLOWED_TYPES.includes(file.type as AllowedType)) {
    return NextResponse.json(
      { error: `Unsupported file type ${file.type}. Upload JPEG, PNG, or WebP.` },
      { status: 400 }
    )
  }

  const bytes = await file.arrayBuffer()
  if (bytes.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: 'File too large — max 4.5 MB' }, { status: 400 })
  }

  const base64 = Buffer.from(bytes).toString('base64')

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  let raw: string
  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: file.type as AllowedType, data: base64 },
            },
            { type: 'text', text: EXTRACTION_PROMPT },
          ],
        },
      ],
    })
    const block = msg.content[0]
    raw = block.type === 'text' ? block.text : ''
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: `OCR failed: ${msg}` }, { status: 502 })
  }

  // Strip markdown code fences if Claude wrapped the JSON
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  let result: OcrResult
  try {
    result = JSON.parse(cleaned) as OcrResult
  } catch {
    return NextResponse.json({ error: 'OCR returned unparseable response', raw }, { status: 502 })
  }

  return NextResponse.json(result)
}

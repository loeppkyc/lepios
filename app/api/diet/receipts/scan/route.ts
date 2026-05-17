import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { badRequest, logDietEvent, requireDietUser, serverError } from '../../_lib/auth'
import { logClaudeTokens } from '@/lib/ai/log-tokens'
import type { ReceiptCategory } from '@/lib/diet/types'

export const dynamic = 'force-dynamic'

const VALID_CATEGORIES = new Set([
  'Produce', 'Dairy', 'Meat', 'Bakery', 'Frozen',
  'Pantry', 'Beverage', 'Snack', 'Discount', 'Other',
])

const SCAN_PROMPT = `You are reading a grocery store receipt. Extract every purchased item.
Return ONLY a valid JSON object — no markdown, no code fences, no explanation.

{
  "store": "store name string",
  "date": "YYYY-MM-DD or null",
  "items": [
    {
      "item": "product description",
      "price": 4.99,
      "qty": 1,
      "unit": "count",
      "category": "Produce",
      "calories_per_serving": 50,
      "protein_g": 2.0,
      "carbs_g": 10.0,
      "fat_g": 0.5
    }
  ]
}

Rules:
- category must be one of: Produce, Dairy, Meat, Bakery, Frozen, Pantry, Beverage, Snack, Discount, Other
- Estimate typical nutrition per standard serving for each item. Use null when genuinely uncertain.
- Negative prices are discounts or coupons — include them with category Discount.
- qty defaults to 1 and unit to "count" unless the receipt shows otherwise.`

interface ScannedItem {
  item: string
  price: number
  qty: number
  unit: string
  category: ReceiptCategory
  calories_per_serving: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
}

interface ScanResponse {
  store: string
  date: string | null
  items: ScannedItem[]
}

function sanitize(raw: unknown): ScanResponse {
  if (!raw || typeof raw !== 'object') throw new Error('Claude did not return an object')
  const r = raw as Record<string, unknown>
  const store = typeof r.store === 'string' && r.store ? r.store : 'Unknown Store'
  const date = typeof r.date === 'string' ? r.date : null
  const rawItems = Array.isArray(r.items) ? r.items : []

  const items: ScannedItem[] = rawItems
    .filter((i) => i && typeof i === 'object')
    .map((i) => {
      const row = i as Record<string, unknown>
      const category = VALID_CATEGORIES.has(String(row.category ?? ''))
        ? (String(row.category) as ReceiptCategory)
        : 'Other'
      return {
        item: typeof row.item === 'string' ? row.item : 'Unknown Item',
        price: typeof row.price === 'number' ? row.price : 0,
        qty: typeof row.qty === 'number' && row.qty > 0 ? row.qty : 1,
        unit: typeof row.unit === 'string' && row.unit ? row.unit : 'count',
        category,
        calories_per_serving: typeof row.calories_per_serving === 'number' ? row.calories_per_serving : null,
        protein_g: typeof row.protein_g === 'number' ? row.protein_g : null,
        carbs_g: typeof row.carbs_g === 'number' ? row.carbs_g : null,
        fat_g: typeof row.fat_g === 'number' ? row.fat_g : null,
      }
    })
    .filter((i) => i.item !== 'Unknown Item' || i.price !== 0)

  return { store, date, items }
}

export async function POST(request: Request) {
  const auth = await requireDietUser()
  if (!auth.ok) return auth.response

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return badRequest('Expected multipart/form-data')
  }

  const file = formData.get('file')
  if (!(file instanceof File)) return badRequest('file field is required')

  const mimeType = file.type || 'image/jpeg'
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
  if (!allowed.includes(mimeType)) return badRequest('Unsupported file type')

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return serverError('ANTHROPIC_API_KEY not configured')

  const arrayBuffer = await file.arrayBuffer()
  const base64 = Buffer.from(arrayBuffer).toString('base64')

  const client = new Anthropic({ apiKey })

  let rawText = ''
  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
                data: base64,
              },
            },
            { type: 'text', text: SCAN_PROMPT },
          ],
        },
      ],
    })
    logClaudeTokens(msg, 'diet-receipt-scan')
    const block = msg.content[0]
    rawText = block.type === 'text' ? block.text : ''
  } catch (err) {
    return serverError(`Claude API error: ${err instanceof Error ? err.message : String(err)}`)
  }

  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    return serverError('OCR result could not be parsed as JSON')
  }

  let result: ScanResponse
  try {
    result = sanitize(parsed)
  } catch (err) {
    return serverError(err instanceof Error ? err.message : 'Unexpected OCR shape')
  }

  await logDietEvent(auth.supabase, {
    user: auth.user,
    action: 'receipt.scan',
    summary: `${result.store} — ${result.items.length} items extracted`,
  })

  return NextResponse.json(result)
}

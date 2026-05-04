import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { CATEGORIES } from '@/lib/types/expenses'

// Vercel body limit is 4.5 MB but CSV text is tiny; 50 KB covers ~500 transactions
const MAX_CSV_CHARS = 50_000

export interface ParsedTransaction {
  date: string
  vendor: string
  amount: number
  suggested_category: string | null
  notes: string
}

function buildPrompt(account: string, csv: string): string {
  return `You are parsing a bank or credit card statement CSV for a Canadian small business (Amazon book reselling).

Account: ${account}

Extract all EXPENSE transactions (debits, charges, money leaving the account).
Skip: credits, refunds, payments received, transfers between own accounts, interest charges, annual fee credits.

For each expense return a JSON object with these fields:
{
  "date": "YYYY-MM-DD",
  "vendor": "clean merchant name (remove location codes, asterisks, transaction IDs, trailing card numbers)",
  "amount": positive dollar amount as a number,
  "suggested_category": one category from the valid list below or null if uncertain,
  "notes": ""
}

Valid categories: ${CATEGORIES.join(', ')}

Business context — common expense patterns:
- Books / pallets → "Inventory — Books (Pallets)"
- Amazon advertising → "Amazon Advertising"
- Courier / Canada Post / FedEx → "Shipping & Delivery"
- Phone / internet → "Phone & Internet"
- Staples / office → "Office Supplies"
- Software / SaaS → "Software & Subscriptions"
- Bank fees → "Bank Charges"
- Insurance → "Insurance"
- Fuel / Shell / Petro → "Vehicle — Fuel"
- Tesla charging → "Vehicle — Tesla Charging"
- Parking → "Vehicle — Parking"

CSV data:
${csv}

Return ONLY a JSON array. No markdown, no explanation.`
}

export async function POST(request: Request) {
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'multipart/form-data required' }, { status: 400 })
  }

  const file = formData.get('file')
  const account = formData.get('account')

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file field required' }, { status: 400 })
  }
  if (typeof account !== 'string' || !account.trim()) {
    return NextResponse.json({ error: 'account field required' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const fullText = await file.text()
  const csvText = fullText.slice(0, MAX_CSV_CHARS)
  const truncated = fullText.length > MAX_CSV_CHARS

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  let raw: string
  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: buildPrompt(account.trim(), csvText) }],
    })
    const block = msg.content[0]
    raw = block.type === 'text' ? block.text : ''
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: `AI parsing failed: ${msg}` }, { status: 502 })
  }

  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  let transactions: ParsedTransaction[]
  try {
    const parsed: unknown = JSON.parse(cleaned)
    if (!Array.isArray(parsed)) throw new Error('expected array')
    transactions = parsed as ParsedTransaction[]
  } catch {
    return NextResponse.json({ error: 'AI returned unparseable response', raw }, { status: 502 })
  }

  return NextResponse.json({
    transactions,
    truncated,
    account: account.trim(),
    totalLines: fullText.split('\n').length,
  })
}

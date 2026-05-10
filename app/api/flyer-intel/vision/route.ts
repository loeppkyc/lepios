import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'

// POST — extract deals from a flyer image using Claude Vision
// 20% Better: uses claude-haiku-4-5 (vs claude-sonnet-4-20250514 in Streamlit) — faster + cheaper for structured extraction
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const file = formData.get('image')
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'image field required' }, { status: 400 })
  }

  const bytes = await file.arrayBuffer()
  const b64 = Buffer.from(bytes).toString('base64')
  const mimeType = (file as File).type || 'image/jpeg'

  const client = new Anthropic()

  let text: string
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mimeType as 'image/jpeg', data: b64 },
            },
            {
              type: 'text',
              text: [
                'Extract every deal/sale item from this store flyer image.',
                'For each item output ONE line in this exact pipe-separated format:',
                'ITEM NAME | SALE PRICE | REGULAR PRICE | SAVINGS | STORE | DETAILS',
                'Leave a field blank if unknown. Output data lines only — no headers.',
                'Example: CeraVe Cleanser 562ml | $19.99 | $24.99 | $5.00 off | Shoppers | Limit 2',
              ].join(' '),
            },
          ],
        },
      ],
    })
    text = response.content[0]?.type === 'text' ? response.content[0].text : ''
  } catch (e) {
    console.error('[flyer-intel/vision] Claude error:', e)
    return NextResponse.json({ error: 'Vision extraction failed' }, { status: 500 })
  }

  const deals = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('|').map((p) => p.trim())
      return {
        name: parts[0] ?? '',
        price: parts[1] ?? '',
        prePrice: parts[2] ?? '',
        savings: parts[3] ?? '',
        store: parts[4] ?? '',
        details: parts[5] ?? '',
      }
    })
    .filter((d) => d.name.length > 0)

  return NextResponse.json({ deals, count: deals.length })
}

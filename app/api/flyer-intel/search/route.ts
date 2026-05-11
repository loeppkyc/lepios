import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface FlippItem {
  name?: string
  description?: string
  current_price?: number
  price_text?: string
  pre_price_text?: string
  merchant_name?: string
  brand?: string
  valid_from?: string
  valid_to?: string
  cutout_image_url?: string
  image_url?: string
  category?: string
  discount_text?: string
}

interface FlippResponse {
  items?: FlippItem[]
}

// GET — search Flipp Canadian flyer API
// Public API — no auth key required, just postal code
export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q') ?? ''
  const postalCode = searchParams.get('postal') ?? 'T6H'
  const merchantId = searchParams.get('merchant_id') // optional store filter
  const limit = Math.min(Number(searchParams.get('limit') ?? '30'), 100)

  if (!query && !merchantId) {
    return NextResponse.json({ error: 'q or merchant_id required' }, { status: 400 })
  }

  const url = new URL('https://backflipp.wishabi.com/flipp/items/search')
  url.searchParams.set('locale', 'en-ca')
  url.searchParams.set('postal_code', postalCode)
  url.searchParams.set('limit', String(limit))
  if (query) url.searchParams.set('q', query)
  if (merchantId) url.searchParams.set('merchant_id', merchantId)

  let res: Response
  try {
    res = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
        Accept: 'application/json',
      },
    })
  } catch (e) {
    console.error('[flyer-intel/search] network error:', e)
    return NextResponse.json({ error: 'Flipp API unreachable' }, { status: 502 })
  }

  if (!res.ok) {
    return NextResponse.json({ error: `Flipp returned ${res.status}` }, { status: 502 })
  }

  let data: FlippResponse
  try {
    data = (await res.json()) as FlippResponse
  } catch {
    return NextResponse.json({ error: 'Flipp response parse failed' }, { status: 502 })
  }

  const items = (data.items ?? []).map((item) => ({
    name: item.name ?? '',
    description: item.description ?? '',
    price: item.current_price ?? item.price_text ?? '',
    prePrice: item.pre_price_text ?? '',
    store: item.merchant_name ?? '',
    brand: item.brand ?? '',
    validFrom: item.valid_from ?? '',
    validTo: item.valid_to ?? '',
    imageUrl: item.cutout_image_url ?? item.image_url ?? '',
    category: item.category ?? '',
    savings: item.discount_text ?? '',
  }))

  return NextResponse.json({ items, count: items.length })
}

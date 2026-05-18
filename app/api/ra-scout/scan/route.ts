import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { keepaConfigured, keepaFetch } from '@/lib/keepa/client'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

type Verdict = 'BUY' | 'WATCH' | 'SKIP'

interface ScanResult {
  set_number: string
  name: string | null
  asin: string | null
  amazon_price_cad: number | null
  fba_fee_est_cad: number | null
  buy_price_cad: number | null
  net_margin_pct: number | null
  verdict: Verdict
}

function fbaFeeEst(price: number): number {
  return price > 80 ? 7.0 : 4.5
}

function computeVerdict(marginPct: number): Verdict {
  if (marginPct >= 30) return 'BUY'
  if (marginPct >= 15) return 'WATCH'
  return 'SKIP'
}

async function detectSetNumbers(imageBase64: string, mediaType: string): Promise<string[]> {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    system:
      'You are an OCR assistant. Extract LEGO set numbers from shelf images. LEGO set numbers are 4-6 digits, printed prominently on the top-left corner of the box. Return ONLY a JSON array of strings, e.g. ["10313", "75192"]. If no set numbers are visible, return [].',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: imageBase64,
            },
          },
          { type: 'text', text: 'Extract all LEGO set numbers visible in this image.' },
        ],
      },
    ],
  })

  const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '[]'
  const parsed = JSON.parse(text) as unknown
  if (!Array.isArray(parsed)) throw new Error('Claude did not return a JSON array')
  return (parsed as unknown[]).filter((x) => typeof x === 'string') as string[]
}

async function enrichSetNumber(
  setNumber: string,
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<ScanResult> {
  const base: ScanResult = {
    set_number: setNumber,
    name: null,
    asin: null,
    amazon_price_cad: null,
    fba_fee_est_cad: null,
    buy_price_cad: null,
    net_margin_pct: null,
    verdict: 'SKIP',
  }

  // Check lego_asin_catalog first
  const { data: catalogRow } = await supabase
    .from('lego_asin_catalog')
    .select('asin, name')
    .eq('set_number', setNumber)
    .maybeSingle()

  let asin: string | null = catalogRow?.asin ?? null
  let name: string | null = catalogRow?.name ?? null

  // If not in catalog, try Keepa search
  if (!asin && keepaConfigured()) {
    try {
      const key = process.env.KEEPA_API_KEY ?? ''
      const searchUrl = `https://api.keepa.com/search?key=${key}&domain=6&type=product&term=LEGO+${setNumber}`
      const res = await fetch(searchUrl)
      if (res.ok) {
        const data = (await res.json()) as { products?: Array<{ asin?: string; title?: string }> }
        const match = data.products?.find((p) => p.title?.includes(setNumber) && p.asin)
        if (match?.asin) {
          asin = match.asin
          name = match.title ?? null
        }
      }
    } catch (e) {
      console.error(`[ra-scout] Keepa search error for set ${setNumber}:`, e)
    }
  }

  if (!asin) return { ...base, name }

  // Get current price from Keepa
  if (!keepaConfigured()) {
    return { ...base, asin, name, verdict: 'SKIP' }
  }

  const { product } = await keepaFetch(asin, 6)
  if (!product) return { ...base, asin, name, verdict: 'SKIP' }

  const keepaPrice = product.stats?.current?.[0]
  if (!keepaPrice || keepaPrice < 0) return { ...base, asin, name, verdict: 'SKIP' }

  const amazonPriceCad = keepaPrice / 100
  const fbaFee = fbaFeeEst(amazonPriceCad)
  // FBA margin: what % of the Amazon price is left after FBA fee
  const marginPct = ((amazonPriceCad - fbaFee) / amazonPriceCad) * 100
  const verdict = computeVerdict(marginPct)

  if (!name && product.title) name = product.title

  return {
    set_number: setNumber,
    name,
    asin,
    amazon_price_cad: Math.round(amazonPriceCad * 100) / 100,
    fba_fee_est_cad: fbaFee,
    buy_price_cad: null,
    net_margin_pct: Math.round(marginPct * 10) / 10,
    verdict,
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let imageBase64: string | null = null
  let mediaType = 'image/jpeg'
  let locationNote: string | null = null

  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData()
    const file = form.get('file') as File | null
    if (file) {
      const buffer = await file.arrayBuffer()
      imageBase64 = Buffer.from(buffer).toString('base64')
      mediaType = file.type || 'image/jpeg'
    }
    locationNote = (form.get('location_note') as string | null) ?? null
  } else {
    const body = (await request.json()) as {
      image_base64?: string
      media_type?: string
      location_note?: string
    }
    imageBase64 = body.image_base64 ?? null
    mediaType = body.media_type ?? 'image/jpeg'
    locationNote = body.location_note ?? null
  }

  if (!imageBase64) {
    return NextResponse.json({ error: 'No image provided' }, { status: 400 })
  }

  // Step 1: Claude vision OCR
  let detectedSetNumbers: string[]
  try {
    detectedSetNumbers = await detectSetNumbers(imageBase64, mediaType)
  } catch (e) {
    console.error('[ra-scout] Claude vision error:', e)
    return NextResponse.json({ error: 'Could not parse set numbers from image' }, { status: 502 })
  }

  // Limit to 20 sets
  const setsToProcess = detectedSetNumbers.slice(0, 20)

  // Step 2: Enrich each set number
  const resultsSettled = await Promise.allSettled(
    setsToProcess.map((sn) => enrichSetNumber(sn, supabase))
  )

  const results: ScanResult[] = resultsSettled.map((r, i) => {
    if (r.status === 'fulfilled') return r.value
    console.error(`[ra-scout] enrichSetNumber failed for ${setsToProcess[i]}:`, r.reason)
    return {
      set_number: setsToProcess[i],
      name: null,
      asin: null,
      amazon_price_cad: null,
      fba_fee_est_cad: null,
      buy_price_cad: null,
      net_margin_pct: null,
      verdict: 'SKIP' as Verdict,
    }
  })

  const profitableCount = results.filter((r) => r.verdict === 'BUY').length

  // Step 3: Persist scan
  const { data: inserted, error: insertError } = await supabase
    .from('ra_scout_scans')
    .insert({
      location_note: locationNote ?? null,
      detected_set_numbers: detectedSetNumbers,
      results: results,
      profitable_count: profitableCount,
      scanned_by: user.id,
    })
    .select('id')
    .single()

  if (insertError) {
    console.error('[ra-scout] insert error:', insertError)
    // Still return results even if persist fails
    return NextResponse.json({
      scan_id: null,
      detected: detectedSetNumbers,
      results,
    })
  }

  return NextResponse.json({
    scan_id: inserted.id,
    detected: detectedSetNumbers,
    results,
  })
}

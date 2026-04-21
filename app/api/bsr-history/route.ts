import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getBsrHistory } from '@/lib/keepa/history'
import { logEvent, logError } from '@/lib/knowledge/client'

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const asin = searchParams.get('asin')?.trim()
  if (!asin) return NextResponse.json({ error: 'asin is required' }, { status: 400 })

  let result: Awaited<ReturnType<typeof getBsrHistory>>
  try {
    result = await getBsrHistory(asin)
  } catch (err) {
    await logError('pageprofit', 'bsr_sparkline', err instanceof Error ? err : new Error(String(err)), {
      actor: 'user',
      entity: asin,
      inputSummary: `ASIN: ${asin}`,
      meta: { asin },
    })
    return NextResponse.json({ error: 'Failed to fetch BSR history' }, { status: 500 })
  }

  // Log tokensLeft on cache-miss calls so audit trail is maintained
  if (!result.fromCache && result.tokensLeft !== null) {
    void logEvent('pageprofit', 'bsr_sparkline', {
      actor: 'user',
      status: 'success',
      entity: asin,
      inputSummary: `ASIN: ${asin}`,
      outputSummary: `${result.points.length} BSR points fetched`,
      meta: { asin, keepa_tokens_left: result.tokensLeft },
    })
  }

  return NextResponse.json(result)
}

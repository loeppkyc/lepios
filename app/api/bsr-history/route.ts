import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getBsrHistory } from '@/lib/keepa/history'

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const asin = searchParams.get('asin')?.trim()
  if (!asin) return NextResponse.json({ error: 'asin is required' }, { status: 400 })

  const result = await getBsrHistory(asin)

  // Log tokensLeft to agent_events on cache-miss calls so audit trail is maintained
  if (!result.fromCache && result.tokensLeft !== null) {
    await supabase.from('agent_events').insert({
      domain: 'pageprofit',
      action: 'bsr_sparkline',
      actor: 'user',
      status: 'success',
      input_summary: `ASIN: ${asin}`,
      output_summary: `${result.points.length} BSR points fetched`,
      meta: { asin, keepa_tokens_left: result.tokensLeft },
    })
  }

  return NextResponse.json(result)
}

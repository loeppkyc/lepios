import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  let accountKey: string
  let yearMonth: string

  try {
    const body = (await request.json()) as { accountKey?: unknown; yearMonth?: unknown }
    if (typeof body.accountKey !== 'string' || typeof body.yearMonth !== 'string') {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }
    accountKey = body.accountKey
    yearMonth = body.yearMonth
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    return NextResponse.json({ error: 'invalid_year_month' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: existing } = await supabase
    .from('statement_coverage_overrides')
    .select('id')
    .eq('account_key', accountKey)
    .eq('year_month', yearMonth)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('statement_coverage_overrides')
      .delete()
      .eq('account_key', accountKey)
      .eq('year_month', yearMonth)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ status: 'removed' })
  } else {
    const { error } = await supabase
      .from('statement_coverage_overrides')
      .insert({ account_key: accountKey, year_month: yearMonth })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ status: 'added' })
  }
}

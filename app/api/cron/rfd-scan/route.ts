// GET /api/cron/rfd-scan
// Pulls RFD hot deals RSS, matches keywords, stores new deals, sends Telegram for matches.
// Protected by requireCronSecret (F22).

import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'
import { fetchRfdHotDeals } from '@/lib/scraper/rfd'
import { sendDailyBot } from '@/lib/telegram/daily-bot'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

interface WatchKeywordRow {
  keyword: string
  category: string
}

interface RfdDealRow {
  rfd_guid: string
  title: string
  description: string | null
  store: string | null
  rfd_url: string
  deal_url: string | null
  posted_at: string | null
  keywords_matched: string[]
  category: string
}

export async function GET(request: Request) {
  // auth: see lib/auth/cron-secret.ts (F22)
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  const db = createServiceClient()
  const started = Date.now()

  // 1. Load active keywords
  const { data: kwRows, error: kwErr } = await db
    .from('rfd_watch_keywords')
    .select('keyword, category')
    .eq('is_active', true)
    .returns<WatchKeywordRow[]>()

  if (kwErr) {
    return NextResponse.json(
      { ok: false, error: `keyword load: ${kwErr.message}` },
      { status: 500 }
    )
  }

  const keywords = kwRows ?? []

  // 2. Fetch RSS
  const deals = await fetchRfdHotDeals(keywords)
  const dealsFound = deals.length

  if (dealsFound === 0) {
    await db.from('agent_events').insert({
      domain: 'rfd',
      action: 'rfd-scan',
      actor: 'cron_rfd_scan',
      status: 'warning',
      duration_ms: Date.now() - started,
      output_summary: 'RSS returned 0 items',
    })
    return NextResponse.json({
      ok: true,
      deals_found: 0,
      deals_new: 0,
      deals_alerted: 0,
      duration_ms: Date.now() - started,
    })
  }

  // 3. Upsert into rfd_deals, track truly new ones
  const rows: RfdDealRow[] = deals.map((d) => ({
    rfd_guid: d.guid,
    title: d.title,
    description: d.description || null,
    store: d.store,
    rfd_url: d.rfdUrl,
    deal_url: d.dealUrl,
    posted_at: d.postedAt ? d.postedAt.toISOString() : null,
    keywords_matched: d.keywordsMatched,
    category: d.category,
  }))

  // Fetch existing guids to determine which are new
  const guids = rows.map((r) => r.rfd_guid)
  const { data: existing } = await db
    .from('rfd_deals')
    .select('rfd_guid')
    .in('rfd_guid', guids)
    .returns<{ rfd_guid: string }[]>()

  const existingSet = new Set((existing ?? []).map((r) => r.rfd_guid))
  const newDeals = deals.filter((d) => !existingSet.has(d.guid))
  const dealsNew = newDeals.length

  if (rows.length > 0) {
    await db.from('rfd_deals').upsert(rows, { onConflict: 'rfd_guid', ignoreDuplicates: true })
  }

  // 4. Telegram alerts for new deals with keyword matches (max 5 per message)
  const alertable = newDeals.filter((d) => d.keywordsMatched.length > 0)
  let dealsAlerted = 0

  const BATCH_SIZE = 5
  for (let i = 0; i < alertable.length; i += BATCH_SIZE) {
    const batch = alertable.slice(i, i + BATCH_SIZE)
    const lines = batch.map((d) => {
      const storePart = d.store ? `\nStore: ${d.store}` : ''
      const kwPart = `\nMatched: ${d.keywordsMatched.join(', ')}`
      return `${d.title}${storePart}${kwPart}\n${d.rfdUrl}`
    })
    const text = `🔔 RFD deal alert:\n\n${lines.join('\n\n')}`
    await sendDailyBot(text)
    dealsAlerted += batch.length
  }

  const durationMs = Date.now() - started

  // 5. Log to agent_events
  await db.from('agent_events').insert({
    domain: 'rfd',
    action: 'rfd-scan',
    actor: 'cron_rfd_scan',
    status: 'success',
    duration_ms: durationMs,
    output_summary: `found=${dealsFound} new=${dealsNew} alerted=${dealsAlerted}`,
    meta: { deals_found: dealsFound, deals_new: dealsNew, deals_alerted: dealsAlerted },
  })

  return NextResponse.json({
    ok: true,
    deals_found: dealsFound,
    deals_new: dealsNew,
    deals_alerted: dealsAlerted,
    duration_ms: durationMs,
  })
}

export async function POST(request: Request) {
  return GET(request)
}

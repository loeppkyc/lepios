import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireCronSecret } from '@/lib/auth/cron-secret'

export const revalidate = 0

const MAX_NOTES_LENGTH = 500
const r2 = (n: number) => Math.round(n * 100) / 100
const isPersonal = (category: string) => category.startsWith('personal_')

// ── GET /api/net-worth/snapshot — cron-secret, idempotent on today's UTC date ──
// Called by daily cron to ensure a snapshot exists without Colin clicking manually.
// Returns the existing snapshot if one was already created today.
export async function GET(request: Request): Promise<NextResponse> {
  // auth: see lib/auth/cron-secret.ts (F22)
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  const db = createServiceClient()
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD UTC

  // Idempotency check: return existing snapshot if already created today.
  const { data: existing, error: lookupErr } = await db
    .from('net_worth_snapshots')
    .select('id, snapshot_date, total_assets, total_liabilities, net_worth, breakdown, notes, created_at')
    .eq('snapshot_date', today)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (lookupErr) return NextResponse.json({ error: lookupErr.message }, { status: 500 })
  if (existing) return NextResponse.json({ snapshot: existing, created: false })

  // No snapshot for today — compute from balance_sheet_entries.
  const { data: entries, error: entriesErr } = await db
    .from('balance_sheet_entries')
    .select('account_type, category, balance')
    .in('account_type', ['asset', 'liability'])

  if (entriesErr) return NextResponse.json({ error: entriesErr.message }, { status: 500 })

  let totalAssets = 0
  let totalLiabilities = 0
  let businessSum = 0
  let personalSum = 0
  const byCategory: Record<string, number> = {}

  for (const e of entries ?? []) {
    const bal = Number(e.balance)
    const signed = e.account_type === 'asset' ? bal : -bal
    if (e.account_type === 'asset') totalAssets += bal
    else totalLiabilities += bal
    if (isPersonal(e.category)) personalSum += signed
    else businessSum += signed
    const key = `${e.account_type}:${e.category}`
    byCategory[key] = r2((byCategory[key] ?? 0) + bal)
  }

  const netWorth = r2(totalAssets - totalLiabilities)
  const breakdown = {
    by_category: byCategory,
    by_pillar: { business: r2(businessSum), personal: r2(personalSum) },
  }

  const { data: created, error: insertErr } = await db
    .from('net_worth_snapshots')
    .insert({
      total_assets: r2(totalAssets),
      total_liabilities: r2(totalLiabilities),
      net_worth: netWorth,
      breakdown,
    })
    .select('id, snapshot_date, total_assets, total_liabilities, net_worth, breakdown, notes, created_at')
    .single()

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })
  return NextResponse.json({ snapshot: created, created: true })
}

export async function POST(request: Request) {
  let body: Record<string, unknown> = {}
  try {
    const text = await request.text()
    if (text) body = JSON.parse(text) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const rawNotes = body.notes
  if (rawNotes !== undefined && rawNotes !== null && typeof rawNotes !== 'string') {
    return NextResponse.json({ error: 'notes must be string or null' }, { status: 400 })
  }
  const trimmedNotes = typeof rawNotes === 'string' ? rawNotes.trim() : null
  if (trimmedNotes && trimmedNotes.length > MAX_NOTES_LENGTH) {
    return NextResponse.json(
      { error: `notes exceeds ${MAX_NOTES_LENGTH} char limit` },
      { status: 400 }
    )
  }
  const notes: string | null = trimmedNotes && trimmedNotes.length > 0 ? trimmedNotes : null

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: entries, error: entriesErr } = await supabase
    .from('balance_sheet_entries')
    .select('account_type, category, balance')
    .in('account_type', ['asset', 'liability'])

  if (entriesErr) return NextResponse.json({ error: entriesErr.message }, { status: 500 })

  let totalAssets = 0
  let totalLiabilities = 0
  let businessSum = 0
  let personalSum = 0
  const byCategory: Record<string, number> = {}

  for (const e of entries ?? []) {
    const bal = Number(e.balance)
    const signed = e.account_type === 'asset' ? bal : -bal
    if (e.account_type === 'asset') totalAssets += bal
    else totalLiabilities += bal
    if (isPersonal(e.category)) personalSum += signed
    else businessSum += signed
    const key = `${e.account_type}:${e.category}`
    byCategory[key] = r2((byCategory[key] ?? 0) + bal)
  }

  const netWorth = r2(totalAssets - totalLiabilities)
  const breakdown = {
    by_category: byCategory,
    by_pillar: { business: r2(businessSum), personal: r2(personalSum) },
  }

  const { data, error } = await supabase
    .from('net_worth_snapshots')
    .insert({
      total_assets: r2(totalAssets),
      total_liabilities: r2(totalLiabilities),
      net_worth: netWorth,
      breakdown,
      notes,
    })
    .select(
      'id, snapshot_date, total_assets, total_liabilities, net_worth, breakdown, notes, created_at'
    )
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ snapshot: data })
}

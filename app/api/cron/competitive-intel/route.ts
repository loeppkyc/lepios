/**
 * POST /api/cron/competitive-intel
 *
 * Daily AI research scanner that:
 *   1. Scrapes arXiv, Papers With Code, and OpenReview in parallel
 *   2. Scores each paper with the keyword scorer
 *   3. Upserts to competitive_intel (ON CONFLICT DO NOTHING for dedup)
 *   4. For newly flagged items (relevance >= threshold, not yet fed):
 *      - Injects a task_queue review task
 *      - Fires a Telegram outbound_notification for high-score items (>= 0.75)
 *      - Marks fed_to_sprint = true
 *   5. Logs to agent_events (F18 observability)
 *
 * Auth: requireCronSecret (F22) — called FIRST.
 * Schedule: pg_cron daily at 9 AM UTC (migration 0273 — NOT Vercel cron).
 * maxDuration: 60s — three parallel fetches + Supabase writes.
 */

import { NextResponse } from 'next/server'
import { requireCronSecret, getCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'
import { fetchArxiv, fetchPapersWithCode, fetchOpenReview } from '@/lib/competitive-intel/scraper'
import { scoreItem } from '@/lib/competitive-intel/scorer'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: Request): Promise<NextResponse> {
  // auth: see lib/auth/cron-secret.ts (F22) — FIRST
  const authError = requireCronSecret(request)
  if (authError) return authError

  const db = createServiceClient()
  const started = Date.now()

  // ── 1. Check COMPETITIVE_INTEL_ENABLED ─────────────────────────────────────
  const { data: configRows } = await db
    .from('harness_config')
    .select('key, value')
    .in('key', ['COMPETITIVE_INTEL_ENABLED', 'COMPETITIVE_INTEL_RELEVANCE_THRESHOLD'])

  const configMap = Object.fromEntries((configRows ?? []).map((r) => [r.key, r.value as string]))

  if (configMap['COMPETITIVE_INTEL_ENABLED'] === 'false') {
    return NextResponse.json({ ok: true, skipped: true, reason: 'COMPETITIVE_INTEL_ENABLED=false' })
  }

  const threshold = parseFloat(configMap['COMPETITIVE_INTEL_RELEVANCE_THRESHOLD'] ?? '0.50')

  // ── 2. Scrape all 3 sources in parallel ────────────────────────────────────
  const [arxivItems, pwcItems, orItems] = await Promise.all([
    fetchArxiv(),
    fetchPapersWithCode(),
    fetchOpenReview(),
  ])

  const allItems = [...arxivItems, ...pwcItems, ...orItems]
  const sourcesFetched = 3
  const itemsFetched = allItems.length

  if (itemsFetched === 0) {
    await db.from('agent_events').insert({
      domain: 'competitive_intel',
      action: 'competitive_intel.scan',
      actor: 'cron_competitive_intel',
      status: 'warning',
      duration_ms: Date.now() - started,
      output_summary: 'All sources returned 0 items',
      meta: { sources_fetched: sourcesFetched, items_fetched: 0, items_new: 0, items_flagged: 0, items_fed_to_sprint: 0 },
    })
    return NextResponse.json({
      ok: true,
      fetched: 0,
      new_items: 0,
      flagged: 0,
      fed_to_sprint: 0,
      duration_ms: Date.now() - started,
    })
  }

  // ── 3. Score each item and build upsert rows ───────────────────────────────
  const rows = allItems.map((item) => {
    const score = scoreItem(item.title, item.abstract_snippet)
    return {
      source: item.source,
      url: item.url,
      title: item.title,
      abstract_snippet: item.abstract_snippet,
      relevance_score: score,
      flagged: score >= threshold,
      fed_to_sprint: false,
      scraped_at: new Date().toISOString(),
    }
  })

  // ── 4. Upsert to competitive_intel (ON CONFLICT (source, url) DO NOTHING) ──
  // Insert only — do not overwrite existing scores or fed_to_sprint state
  const { data: insertedRows, error: upsertErr } = await db
    .from('competitive_intel')
    .upsert(rows, { onConflict: 'source,url', ignoreDuplicates: true })
    .select('id, source, url, title, relevance_score, flagged, fed_to_sprint')

  if (upsertErr) {
    console.error('[competitive-intel] upsert error:', upsertErr.message)
    return NextResponse.json({ error: upsertErr.message }, { status: 500 })
  }

  const itemsNew = (insertedRows ?? []).length

  // ── 5. Find flagged unfed items — query fresh to catch pre-existing ones too ─
  const { data: flaggedUnfed, error: flagErr } = await db
    .from('competitive_intel')
    .select('id, source, url, title, relevance_score')
    .eq('flagged', true)
    .eq('fed_to_sprint', false)
    .order('relevance_score', { ascending: false })

  if (flagErr) {
    console.error('[competitive-intel] flagged query error:', flagErr.message)
    return NextResponse.json({ error: flagErr.message }, { status: 500 })
  }

  const toFeed = flaggedUnfed ?? []
  let itemsFlagged = toFeed.length
  let itemsFedToSprint = 0

  // ── 6. Sprint injection + Telegram for high-score items ───────────────────
  for (const item of toFeed) {
    const score = item.relevance_score as number
    const title = item.title as string
    const url = item.url as string
    const source = item.source as string
    const intelId = item.id as string

    // Priority: 1 for top tier, 2 for mid, 3 for baseline flagged
    const priority = score >= 0.8 ? 1 : score >= 0.6 ? 2 : 3

    // Inject task_queue row
    const { error: taskErr } = await db.from('task_queue').insert({
      task: `[CompIntel] Review: "${title.slice(0, 80)}"`,
      description: `${title}\n\nURL: ${url}\n\nScore: ${score.toFixed(2)} | Source: ${source}`,
      priority,
      source: 'cron',
      status: 'queued',
      metadata: {
        task_type_label: 'competitive_intel_review',
        competitive_intel_id: intelId,
        source,
        url,
        relevance_score: score,
      },
    })

    if (taskErr) {
      console.warn('[competitive-intel] task_queue insert error:', taskErr.message)
      continue
    }

    // Telegram notification for high-relevance items (>= 0.75)
    if (score >= 0.75) {
      const scoreStr = (score * 100).toFixed(0)
      const text = [
        `[CompIntel] High-relevance paper (${scoreStr}% match)`,
        `Source: ${source}`,
        `Title: ${title}`,
        `URL: ${url}`,
      ].join('\n')

      await db.from('outbound_notifications').insert({
        channel: 'telegram',
        payload: { text },
        status: 'pending',
        requires_response: false,
        correlation_id: `competitive_intel_${intelId}`,
      })
    }

    // Mark fed_to_sprint = true
    await db.from('competitive_intel').update({ fed_to_sprint: true }).eq('id', intelId)

    itemsFedToSprint++
  }

  // ── 7. Drain outbound_notifications if any were queued ────────────────────
  if (itemsFedToSprint > 0) {
    const secret = getCronSecret()
    const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://lepios-one.vercel.app'
    try {
      await fetch(`${base}/api/harness/notifications-drain`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}` },
      })
    } catch {
      // Non-blocking — pg_cron drain will catch it
    }
  }

  const durationMs = Date.now() - started

  // ── 8. F18 observability — log to agent_events ────────────────────────────
  await db.from('agent_events').insert({
    domain: 'competitive_intel',
    action: 'competitive_intel.scan',
    actor: 'cron_competitive_intel',
    status: 'success',
    duration_ms: durationMs,
    output_summary: `fetched=${itemsFetched} new=${itemsNew} flagged=${itemsFlagged} fed=${itemsFedToSprint}`,
    meta: {
      sources_fetched: sourcesFetched,
      items_fetched: itemsFetched,
      items_new: itemsNew,
      items_flagged: itemsFlagged,
      items_fed_to_sprint: itemsFedToSprint,
      duration_ms: durationMs,
    },
  })

  return NextResponse.json({
    ok: true,
    fetched: itemsFetched,
    new_items: itemsNew,
    flagged: itemsFlagged,
    fed_to_sprint: itemsFedToSprint,
    duration_ms: durationMs,
  })
}

// pg_cron may use GET
export async function GET(request: Request): Promise<NextResponse> {
  return POST(request)
}

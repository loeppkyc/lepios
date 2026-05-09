import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { upsertHeartbeat } from '@/lib/orchestrator/heartbeat'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
// Max 55s — knowledge export at 10k rows is ~15 MB, well within Vercel's 60s limit
export const maxDuration = 55

const KNOWLEDGE_COLUMNS =
  'id,created_at,updated_at,category,domain,entity,title,problem,solution,context,confidence,times_used,times_helpful,last_used_at,source_events,tags,embedding_id,content_hash'

export async function GET(request: Request) {
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized
  void upsertHeartbeat().catch(() => {})

  const db = createServiceClient()
  const today = new Date().toISOString().slice(0, 10)
  const started = Date.now()

  try {
    // Knowledge — skip embedding (vector, re-generatable) and fts (tsvector, re-generatable)
    const { data: knowledgeRows, error: kErr } = await db
      .from('knowledge')
      .select(KNOWLEDGE_COLUMNS)
      .order('created_at')
    if (kErr) throw new Error(`knowledge query: ${kErr.message}`)

    const { data: convRows, error: cErr } = await db
      .from('conversations')
      .select('*')
      .order('created_at')
    if (cErr) throw new Error(`conversations query: ${cErr.message}`)

    const { data: msgRows, error: mErr } = await db
      .from('messages')
      .select('*')
      .order('created_at')
    if (mErr) throw new Error(`messages query: ${mErr.message}`)

    const knowledgeNdjson = (knowledgeRows ?? []).map((r) => JSON.stringify(r)).join('\n')
    const chatNdjson = [
      ...(convRows ?? []).map((r) => JSON.stringify({ _table: 'conversations', ...r })),
      ...(msgRows ?? []).map((r) => JSON.stringify({ _table: 'messages', ...r })),
    ].join('\n')

    const { error: kUpErr } = await db.storage
      .from('backups')
      .upload(
        `knowledge-${today}.ndjson`,
        new Blob([knowledgeNdjson], { type: 'application/x-ndjson' }),
        { upsert: true },
      )
    if (kUpErr) throw new Error(`knowledge upload: ${kUpErr.message}`)

    const { error: cUpErr } = await db.storage
      .from('backups')
      .upload(
        `chat-${today}.ndjson`,
        new Blob([chatNdjson], { type: 'application/x-ndjson' }),
        { upsert: true },
      )
    if (cUpErr) throw new Error(`chat upload: ${cUpErr.message}`)

    const knowledgeCount = knowledgeRows?.length ?? 0
    const convCount = convRows?.length ?? 0
    const msgCount = msgRows?.length ?? 0

    await db.from('agent_events').insert({
      domain: 'backup',
      action: 'backup.export',
      actor: 'cron_backup',
      status: 'success',
      duration_ms: Date.now() - started,
      output_summary: `knowledge=${knowledgeCount} conversations=${convCount} messages=${msgCount}`,
      meta: {
        files: [`knowledge-${today}.ndjson`, `chat-${today}.ndjson`],
        knowledge_rows: knowledgeCount,
        conv_rows: convCount,
        msg_rows: msgCount,
      },
    })

    return NextResponse.json({ ok: true, knowledge_rows: knowledgeCount, conv_rows: convCount, msg_rows: msgCount })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)

    try {
      await db.from('agent_events').insert({
        domain: 'backup',
        action: 'backup.export',
        actor: 'cron_backup',
        status: 'error',
        duration_ms: Date.now() - started,
        error_message: msg,
      })
    } catch {
      // best-effort log
    }

    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}

export async function POST(request: Request) {
  return GET(request)
}

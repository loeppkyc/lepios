/**
 * One-time migration: notification_failed agent_events → outbound_notifications queue.
 *
 * Run: npx tsx scripts/migrate-notification-failed-events.ts
 *
 * What it does:
 *   1. Queries agent_events WHERE action='notification_failed'
 *   2. Skips rows already marked as migrated (meta.migrated_to_outbound_notifications set)
 *   3. Inserts each into outbound_notifications with status='pending' so drain retries
 *   4. Updates the original agent_event row with meta.migrated_to_outbound_notifications=<new_id>
 *   5. Prints a summary: found / migrated / skipped
 *
 * Results of the 2026-04-24 run (4 rows found, all migrated):
 *   b79bb7a0 → sprint-4-C status update (acceptance_doc_ready) — stale, migrated for audit
 *   4e3fbb17 → sprint-4 Chunk C workaround note — stale, migrated for audit
 *   f2a4be5b → sprint-4-D awaiting_grounding message — migrated with original intended_message
 *   e0fd4579 → harness-polish branch-naming escalation — migrated, drain will deliver
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

type AgentEvent = {
  id: string
  action: string
  task_type: string | null
  status: string
  meta: Record<string, unknown>
  occurred_at: string
}

function buildMessageText(event: AgentEvent): string {
  const meta = event.meta

  // If coordinator stored the intended message, use it verbatim
  if (typeof meta.intended_message === 'string' && meta.intended_message.length > 0) {
    return meta.intended_message
  }

  // Otherwise reconstruct from available context
  const parts: string[] = ['[Recovered notification — original delivery failed]']
  if (meta.chunk_id || meta.chunk) {
    parts.push(`Chunk: ${meta.chunk_id ?? meta.chunk}`)
  }
  if (meta.sprint_id || meta.sprint) {
    parts.push(`Sprint: ${meta.sprint_id ?? meta.sprint}`)
  }
  if (meta.task_id) {
    parts.push(`Task: ${String(meta.task_id).slice(0, 8)}`)
  }
  if (meta.intended_status) {
    parts.push(`Status update: ${meta.intended_status}`)
  }
  if (meta.colin_action_required) {
    parts.push(`Action required: ${meta.colin_action_required}`)
  }
  if (meta.acceptance_doc) {
    parts.push(`Acceptance doc: ${meta.acceptance_doc}`)
  }
  if (meta.workaround) {
    parts.push(`Workaround: ${meta.workaround}`)
  }
  return parts.join('\n')
}

async function run() {
  const { data: events, error: fetchErr } = await db
    .from('agent_events')
    .select('id, action, task_type, status, meta, occurred_at')
    .eq('action', 'notification_failed')
    .order('occurred_at', { ascending: true })

  if (fetchErr) {
    console.error('Failed to query agent_events:', fetchErr.message)
    process.exit(1)
  }

  const rows = (events ?? []) as AgentEvent[]
  console.log(`Found ${rows.length} notification_failed event(s)`)

  let migrated = 0
  let skipped = 0
  const skippedReasons: string[] = []

  for (const event of rows) {
    const meta = event.meta

    // Already migrated in a previous run
    if (meta.migrated_to_outbound_notifications) {
      skipped++
      skippedReasons.push(`${event.id.slice(0, 8)}: already migrated → ${meta.migrated_to_outbound_notifications}`)
      continue
    }

    const messageText = buildMessageText(event)
    const correlationId = (meta.task_id as string | undefined)?.slice(0, 8) ?? null

    // Insert into outbound_notifications
    const { data: inserted, error: insertErr } = await db
      .from('outbound_notifications')
      .insert({
        channel: 'telegram',
        chat_id: TELEGRAM_CHAT_ID ?? null,
        payload: { text: messageText, parse_mode: 'Markdown' },
        correlation_id: correlationId,
        requires_response: false,
        status: 'pending',
      })
      .select('id')
      .single()

    if (insertErr || !inserted) {
      console.error(`  ✗ ${event.id.slice(0, 8)}: insert failed — ${insertErr?.message}`)
      skipped++
      skippedReasons.push(`${event.id.slice(0, 8)}: insert error — ${insertErr?.message}`)
      continue
    }

    const newId = (inserted as { id: string }).id

    // Mark original agent_event as migrated (preserves audit trail)
    const { error: updateErr } = await db
      .from('agent_events')
      .update({
        meta: {
          ...meta,
          migrated_to_outbound_notifications: newId,
          migrated_at: new Date().toISOString(),
        },
      })
      .eq('id', event.id)

    if (updateErr) {
      console.warn(`  ⚠ ${event.id.slice(0, 8)}: migrated (${newId.slice(0, 8)}) but meta update failed — ${updateErr.message}`)
    } else {
      console.log(`  ✓ ${event.id.slice(0, 8)} → outbound ${newId.slice(0, 8)} (${event.task_type ?? 'no task_type'})`)
    }

    migrated++
  }

  console.log(`\nSummary: ${rows.length} found, ${migrated} migrated, ${skipped} skipped`)
  if (skippedReasons.length > 0) {
    for (const r of skippedReasons) console.log(`  skip: ${r}`)
  }
}

run().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})

/**
 * Telegram coordinator command handlers.
 *
 * Handles /run, /queue add, /queue run, /queue status, /halt commands
 * sent to the bot. Each handler is fire-and-forget from the webhook;
 * errors are swallowed so the webhook always returns 200.
 *
 * Commands:
 *   /run <task>         — insert task + trigger pickup
 *   /queue add <task>   — insert task (no immediate pickup)
 *   /queue run          — trigger pickup of top queued task
 *   /queue status       — reply with queue depth summary
 *   /halt               — set HARNESS_HALTED=true in harness_config
 *   /resume             — set HARNESS_HALTED=false in harness_config
 */

import { createServiceClient } from '@/lib/supabase/service'
import { postMessage } from '@/lib/orchestrator/telegram'

// ── Helpers ───────────────────────────────────────────────────────────────────

async function insertTask(task: string, immediate: boolean): Promise<string | null> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('task_queue')
    .insert({
      task,
      priority: 3,
      source: 'colin-telegram',
      metadata: { fired_via: 'telegram_command', immediate },
    })
    .select('id')
    .single()

  if (error || !data?.id) return null
  return data.id as string
}

async function triggerPickup(): Promise<void> {
  const db = createServiceClient()
  const { data } = await db
    .from('harness_config')

    .select('value')
    .eq('key', 'CRON_SECRET')
    .maybeSingle()
  const secret = data?.value as string | undefined
  if (!secret) return
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://lepios-one.vercel.app'
  await fetch(`${base}/api/cron/task-pickup`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret}` },
  }).catch(() => {})
}

// ── Command handlers ──────────────────────────────────────────────────────────

/** /run <task> — insert + immediately trigger pickup */
export async function handleRunCommand(text: string): Promise<void> {
  const task = text.replace(/^\/run\s*/i, '').trim()
  if (!task) {
    await postMessage('Usage: /run <task description>').catch(() => {})
    return
  }

  const taskId = await insertTask(task, true)
  if (!taskId) {
    await postMessage('Failed to queue task — DB error.').catch(() => {})
    return
  }

  await triggerPickup()
  await postMessage(
    `Queued + pickup triggered\nTask: ${task.slice(0, 80)}\nID: ${taskId.slice(0, 8)}`
  ).catch(() => {})
}

/** /queue add <task> — insert without triggering pickup */
export async function handleQueueAddCommand(text: string): Promise<void> {
  const task = text.replace(/^\/queue\s+add\s*/i, '').trim()
  if (!task) {
    await postMessage('Usage: /queue add <task description>').catch(() => {})
    return
  }

  const taskId = await insertTask(task, false)
  if (!taskId) {
    await postMessage('Failed to add to queue — DB error.').catch(() => {})
    return
  }

  await postMessage(
    `Added to queue (not yet picked up)\nTask: ${task.slice(0, 80)}\nID: ${taskId.slice(0, 8)}`
  ).catch(() => {})
}

/** /queue run — trigger pickup of top queued task */
export async function handleQueueRunCommand(): Promise<void> {
  const db = createServiceClient()
  const { count } = await db
    .from('task_queue')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'queued')

  if ((count ?? 0) === 0) {
    await postMessage('Queue is empty — nothing to run.').catch(() => {})
    return
  }

  await triggerPickup()
  await postMessage(`Pickup triggered — ${count} task(s) in queue.`).catch(() => {})
}

/** /queue status — show queue depth by status */
export async function handleQueueStatusCommand(): Promise<void> {
  const db = createServiceClient()
  const { data } = await db
    .from('task_queue')
    .select('status')
    .in('status', ['queued', 'claimed', 'running'])

  if (!data) {
    await postMessage('Could not read queue status.').catch(() => {})
    return
  }

  const rows = data as { status: string }[]
  const queued = rows.filter((r) => r.status === 'queued').length
  const running = rows.filter((r) => r.status === 'running' || r.status === 'claimed').length

  const { data: haltRow } = await db
    .from('harness_config')
    .select('value')
    .eq('key', 'HARNESS_HALTED')
    .maybeSingle()
  const halted = haltRow?.value === 'true'

  const lines = [
    `Queue: ${queued} queued / ${running} running`,
    halted ? 'HALTED — /resume to re-enable loop' : 'Loop enabled',
  ]
  await postMessage(lines.join('\n')).catch(() => {})
}

/** /halt — set HARNESS_HALTED=true */
export async function handleHaltCommand(): Promise<void> {
  const db = createServiceClient()
  const { error } = await db
    .from('harness_config')
    .update({ value: 'true' })
    .eq('key', 'HARNESS_HALTED')

  if (error) {
    await postMessage('Failed to set halt flag — DB error.').catch(() => {})
    return
  }

  await postMessage(
    'Coordinator loop halted.\nIn-flight task will finish; no new pickups until /resume.'
  ).catch(() => {})
}

/** /resume — set HARNESS_HALTED=false */
export async function handleResumeCommand(): Promise<void> {
  const db = createServiceClient()
  const { error } = await db
    .from('harness_config')
    .update({ value: 'false' })
    .eq('key', 'HARNESS_HALTED')

  if (error) {
    await postMessage('Failed to clear halt flag — DB error.').catch(() => {})
    return
  }

  await postMessage('Coordinator loop resumed.').catch(() => {})
}

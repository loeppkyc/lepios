/**
 * Telegram coordinator command handlers.
 *
 * Handles /run, /queue add, /queue run, /queue status, /halt, /resume
 * sent to the bot. Each handler is fire-and-forget from the webhook;
 * errors are swallowed so the webhook always returns 200.
 *
 * Commands:
 *   /run <task>              — insert task + trigger pickup
 *   /run continuous          — self-prioritize: pick top leverage gap + trigger
 *   /queue add <task>        — insert task (no immediate pickup)
 *   /queue run               — trigger pickup of top queued task
 *   /queue run continuous    — same but with self-prioritization
 *   /queue status            — reply with queue depth summary
 *   /halt                    — set HARNESS_HALTED=true in harness_config
 *   /resume                  — set HARNESS_HALTED=false; resume continuous run if preserved
 */

import { createServiceClient } from '@/lib/supabase/service'
import { postMessage } from '@/lib/orchestrator/telegram'
import { autoPickModule, logPickDecision } from '@/lib/harness/auto-pick'
import { hasDoneState, draftDoneState } from '@/lib/harness/done-state-drafter'

// ── Helpers ───────────────────────────────────────────────────────────────────

async function insertTask(
  task: string,
  immediate: boolean,
  metadata: Record<string, unknown> = {}
): Promise<string | null> {
  const db = createServiceClient()
  const { data, error } = await db
    .from('task_queue')
    .insert({
      task,
      priority: 3,
      source: 'colin-telegram',
      metadata: { fired_via: 'telegram_command', immediate, ...metadata },
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

// Creates a coordinator_run_state row and saves its id to harness_config.
// Returns the new run_id, or null on error.
async function startContinuousRun(initialTarget: string): Promise<string | null> {
  try {
    const db = createServiceClient()

    // Prevent double-start: check for active run
    const { data: existing } = await db
      .from('coordinator_run_state')
      .select('id')
      .eq('status', 'running')
      .maybeSingle()

    if (existing?.id) {
      await postMessage(
        `Continuous run already active (${(existing.id as string).slice(0, 8)}). Send /halt first to restart.`
      ).catch(() => {})
      return null
    }

    const { data, error } = await db
      .from('coordinator_run_state')
      .insert({
        mode: 'continuous',
        status: 'running',
        current_target: initialTarget,
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (error || !data?.id) return null
    const runId = data.id as string

    // Save to harness_config so complete/route.ts can look it up
    await db.from('harness_config').update({ value: runId }).eq('key', 'HARNESS_CONTINUOUS_RUN_ID')

    return runId
  } catch {
    return null
  }
}

// ── Continuous mode pick flow ─────────────────────────────────────────────────

async function runContinuousPickAndQueue(excludeIds: string[] = []): Promise<void> {
  // 1. Auto-pick highest leverage module
  const pick = await autoPickModule(excludeIds)

  if (!pick.ok) {
    await postMessage(`Continuous mode: no eligible module found — ${pick.reason}`).catch(() => {})
    return
  }

  // 2. Check / draft done_state
  let draftNote = ''
  if (!pick.has_done_state) {
    const draft = await draftDoneState(pick.module_id, pick.module_name)
    if (draft.drafted) {
      draftNote = `\nDone-state auto-drafted and appended to leverage-targets.md.`
    } else if (draft.reason.includes('already exists')) {
      draftNote = '' // Silently continue
    } else {
      // No context — skip this module, try next
      const skipMsg = `Skipping ${pick.module_id} — no context to draft done_state: ${draft.reason}. Trying next...`
      await postMessage(skipMsg).catch(() => {})
      return runContinuousPickAndQueue([...excludeIds, pick.module_id])
    }
  }

  // 3. Create run state row
  const runId = await startContinuousRun(pick.module_id)
  if (!runId) return // Error already telegraphed by startContinuousRun

  // 4. Log pick to decisions_log
  await logPickDecision(pick, runId)

  // 5. Insert task into queue
  const taskDescription = `[continuous] Build/advance module: ${pick.module_id} — ${pick.module_name} (leverage: ${pick.leverage_score.toFixed(1)})`
  const taskId = await insertTask(taskDescription, true, {
    continuous_run_id: runId,
    module_id: pick.module_id,
    module_name: pick.module_name,
    leverage_score: pick.leverage_score,
  })

  if (!taskId) {
    await postMessage('Continuous mode: failed to queue task — DB error.').catch(() => {})
    return
  }

  // 6. Update run state with current task id
  try {
    const db = createServiceClient()
    await db
      .from('coordinator_run_state')
      .update({ current_task_id: taskId, modules_attempted_count: 1 })
      .eq('id', runId)
  } catch {
    // Non-fatal
  }

  // 7. Trigger pickup
  await triggerPickup()

  // 8. Telegram notification
  const lines = [
    `Continuous mode started`,
    `Target: ${pick.module_id} — ${pick.module_name}`,
    `Score: ${pick.leverage_score.toFixed(1)} (weight=${pick.weight}, completion=${pick.completion_pct}%)`,
    `Pick reason: ${pick.reason}`,
    draftNote,
    `Run ID: ${runId.slice(0, 8)}`,
  ].filter(Boolean)
  await postMessage(lines.join('\n')).catch(() => {})
}

// ── Command handlers ──────────────────────────────────────────────────────────

/** /run <task> or /run continuous */
export async function handleRunCommand(text: string): Promise<void> {
  const body = text.replace(/^\/run\s*/i, '').trim()

  if (body.toLowerCase() === 'continuous') {
    await runContinuousPickAndQueue()
    return
  }

  if (!body) {
    await postMessage('Usage: /run <task description>  or  /run continuous').catch(() => {})
    return
  }

  const taskId = await insertTask(body, true)
  if (!taskId) {
    await postMessage('Failed to queue task — DB error.').catch(() => {})
    return
  }

  await triggerPickup()
  await postMessage(
    `Queued + pickup triggered\nTask: ${body.slice(0, 80)}\nID: ${taskId.slice(0, 8)}`
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

/** /queue run [continuous] — trigger pickup; continuous flag enables self-prioritization */
export async function handleQueueRunCommand(text?: string): Promise<void> {
  const isContinuous = /continuous/i.test(text ?? '')

  if (isContinuous) {
    await runContinuousPickAndQueue()
    return
  }

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

  // Also check for preserved continuous run
  const { data: runRow } = await db
    .from('harness_config')
    .select('value')
    .eq('key', 'HARNESS_CONTINUOUS_RUN_ID')
    .maybeSingle()
  const continuousRunId = (runRow?.value as string | undefined)?.trim() ?? ''

  const lines = [
    `Queue: ${queued} queued / ${running} running`,
    halted ? 'HALTED — /resume to re-enable loop' : 'Loop enabled',
    continuousRunId
      ? `Continuous run preserved: ${continuousRunId.slice(0, 8)} (send /resume to continue)`
      : '',
  ].filter(Boolean)
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

/** /resume — clear halt flag; resume continuous run if one is preserved */
export async function handleResumeCommand(): Promise<void> {
  const db = createServiceClient()

  // Clear halt flag
  const { error } = await db
    .from('harness_config')
    .update({ value: 'false' })
    .eq('key', 'HARNESS_HALTED')

  if (error) {
    await postMessage('Failed to clear halt flag — DB error.').catch(() => {})
    return
  }

  // Check for preserved continuous run
  const { data: runIdRow } = await db
    .from('harness_config')
    .select('value')
    .eq('key', 'HARNESS_CONTINUOUS_RUN_ID')
    .maybeSingle()
  const savedRunId = ((runIdRow?.value as string | undefined) ?? '').trim()

  if (!savedRunId) {
    await postMessage('Coordinator loop resumed.').catch(() => {})
    return
  }

  // Look up the preserved run
  const { data: runData } = await db
    .from('coordinator_run_state')
    .select('id, status, current_target, modules_shipped, modules_shipped_count')
    .eq('id', savedRunId)
    .maybeSingle()

  if (!runData || runData.status !== 'halted_quota') {
    await postMessage(
      'Coordinator loop resumed. (No preserved continuous run found — run /run continuous to start fresh.)'
    ).catch(() => {})
    return
  }

  // Resume: update status + clear halt flag on run state
  await db
    .from('coordinator_run_state')
    .update({ status: 'running', resumed_at: new Date().toISOString() })
    .eq('id', savedRunId)
  await db
    .from('harness_config')
    .update({ value: savedRunId })
    .eq('key', 'HARNESS_CONTINUOUS_RUN_ID')

  // Re-pick: exclude already shipped modules
  const shippedIds = (runData.modules_shipped as string[]) ?? []
  const target = runData.current_target as string | null

  await postMessage(
    [
      `Continuous run resumed (${savedRunId.slice(0, 8)})`,
      `Previously shipped: ${runData.modules_shipped_count ?? 0} module(s)`,
      target ? `Resuming from: ${target}` : `Picking next module...`,
    ].join('\n')
  ).catch(() => {})

  // Re-pick and queue
  await runContinuousPickAndQueue(shippedIds)
}

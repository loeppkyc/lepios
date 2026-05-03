/**
 * Work-Budget Parser + State Machine
 *
 * Handles /budget Telegram text commands:
 *   /budget 2h30m → open 150-minute session
 *   /budget stop  → cancel active session
 *   /budget status → show remaining time + task count
 *
 * State machine: idle | active | drained | stopped
 * No active session = idle.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { telegram } from '@/lib/harness/arms-legs/telegram'
import { fsRead, fsExists } from '@/lib/harness/arms-legs/fs'
import { logEvent as logKnowledgeEvent } from '@/lib/knowledge/client'
import { recordAttribution } from '@/lib/attribution/writer'
import {
  getActiveSession,
  stopSession,
  buildStatusMessage,
  sendDrainSummary,
  type WorkBudgetSession,
} from './tracker'
import { runCalibration } from './calibrator'
import { estimateTask } from './estimator'
import { execSync } from 'child_process'
import { join } from 'path'

// ── Types ─────────────────────────────────────────────────────────────────────

type TgMessage = {
  message_id: number
  chat: { id: number }
  text?: string
}

type SupabaseClient = ReturnType<typeof createServiceClient>

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_BUDGET_MINUTES = 480 // 8h
const MIN_BUDGET_MINUTES = 10

// ── Parser regex ──────────────────────────────────────────────────────────────
// Matches: /budget 2h30m, /budget 90m, /budget 2h, /budget stop, /budget status

const BUDGET_REGEX = /^\/budget\s+((\d+)h((\d+)m)?|(\d+)m|stop|status)$/i

export interface ParsedBudget {
  type: 'time' | 'stop' | 'status'
  minutes?: number
}

export function parseBudgetCommand(text: string): ParsedBudget | null {
  const match = BUDGET_REGEX.exec(text.trim())
  if (!match) return null

  const raw = match[1].toLowerCase()

  if (raw === 'stop') return { type: 'stop' }
  if (raw === 'status') return { type: 'status' }

  // Parse time: Nh, NhMm, Nm
  const hoursOnlyMatch = /^(\d+)h$/.exec(raw)
  const hoursMinutesMatch = /^(\d+)h(\d+)m$/.exec(raw)
  const minutesOnlyMatch = /^(\d+)m$/.exec(raw)

  let minutes = 0
  if (hoursOnlyMatch) {
    minutes = parseInt(hoursOnlyMatch[1], 10) * 60
  } else if (hoursMinutesMatch) {
    minutes = parseInt(hoursMinutesMatch[1], 10) * 60 + parseInt(hoursMinutesMatch[2], 10)
  } else if (minutesOnlyMatch) {
    minutes = parseInt(minutesOnlyMatch[1], 10)
  } else {
    return null
  }

  return { type: 'time', minutes }
}

// ── Telegram reply helper ─────────────────────────────────────────────────────

async function sendTelegramReply(chatId: number, text: string): Promise<void> {
  await telegram(text, { chatId: String(chatId), agentId: 'work_budget' }).catch(() => {})
}

// ── Self-generated work: doc gaps (§5 Phase 2) ────────────────────────────────
// Returns number of tasks inserted.

async function generateDocGapTasks(db: SupabaseClient): Promise<number> {
  try {
    // Check how many doc gap tasks already exist in this budget window
    const { count: existing } = await db
      .from('task_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'queued')
      .filter('metadata->>task_type_label', 'eq', 'doc_gap')

    if ((existing ?? 0) >= 5) return 0

    const docsPath = join(process.cwd(), 'docs')
    let output = ''
    try {
      output = execSync(
        `grep -rl "TODO\\|PENDING\\|TBD\\|\\[ \\]" "${docsPath}" --include="*.md" 2>/dev/null`,
        { encoding: 'utf8', timeout: 5000 }
      )
    } catch {
      // grep exits non-zero when no matches
      return 0
    }

    const files = output
      .trim()
      .split('\n')
      .filter(Boolean)
      .slice(0, 5 - (existing ?? 0))

    let inserted = 0
    for (const filePath of files) {
      let preview = ''
      try {
        const content = await fsRead(filePath, 'work_budget')
        const todoLines = content
          .split('\n')
          .filter((line) => /TODO|PENDING|TBD|\[ \]/.test(line))
          .slice(0, 3)
          .map((l) => l.trim())
        const count = todoLines.length
        preview = `${count} incomplete items found: ${todoLines.join(' | ').slice(0, 200)}`
      } catch {
        preview = 'incomplete items found'
      }

      const { error } = await db.from('task_queue').insert({
        task: `Complete doc gaps in ${filePath}`,
        description: preview,
        metadata: { task_type_label: 'doc_gap', source_file: filePath },
        priority: 7,
        status: 'queued',
        source: 'work_budget_self_gen',
      })
      if (!error) inserted++
    }

    return inserted
  } catch {
    return 0
  }
}

// ── Self-generated work: test gaps (§5 Phase 3) ───────────────────────────────
// Returns number of tasks inserted.

async function generateTestGapTasks(db: SupabaseClient): Promise<number> {
  try {
    const { count: existing } = await db
      .from('task_queue')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'queued')
      .filter('metadata->>task_type_label', 'eq', 'test_gap')

    if ((existing ?? 0) >= 3) return 0

    let output = ''
    try {
      output = execSync(
        `git log --name-only --format='' -20 | grep '\\.ts$' | grep -v '\\.test\\.' | sort -u`,
        { encoding: 'utf8', timeout: 5000, cwd: process.cwd() }
      )
    } catch {
      return 0
    }

    const changedFiles = output.trim().split('\n').filter(Boolean)
    const testsPath = join(process.cwd(), 'tests')

    let inserted = 0
    for (const filePath of changedFiles) {
      const baseName = filePath.split('/').pop()?.replace(/\.ts$/, '') ?? ''
      if (!baseName) continue

      // Check if a test file exists
      const testFile = join(testsPath, `${baseName}.test.ts`)
      const testExists = await fsExists(testFile, 'work_budget')

      if (testExists) continue
      if (inserted >= 3 - (existing ?? 0)) break

      const { error } = await db.from('task_queue').insert({
        task: `Add missing tests for ${filePath}`,
        description: 'No test file found. Changed in last 20 commits.',
        metadata: { task_type_label: 'test_gap', source_file: filePath },
        priority: 8,
        status: 'queued',
        source: 'work_budget_self_gen',
      })
      if (!error) inserted++
    }

    return inserted
  } catch {
    return 0
  }
}

// ── Check queue for eligible tasks ───────────────────────────────────────────

async function hasEligibleQueuedTasks(db: SupabaseClient): Promise<boolean> {
  const { count } = await db
    .from('task_queue')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'queued')

  return (count ?? 0) > 0
}

// ── Open new budget session ───────────────────────────────────────────────────

async function openBudgetSession(
  minutes: number,
  chatId: number,
  db: SupabaseClient
): Promise<WorkBudgetSession | null> {
  const { data, error } = await db
    .from('work_budget_sessions')
    .insert({
      status: 'active',
      budget_minutes: minutes,
      source: 'telegram',
      telegram_chat_id: String(chatId),
    })
    .select('*')
    .maybeSingle()

  if (error) return null
  return (data as WorkBudgetSession | null) ?? null
}

// ── Main command handler ──────────────────────────────────────────────────────

export async function handleBudgetCommand(message: TgMessage, db: SupabaseClient): Promise<void> {
  const text = message.text ?? ''
  const chatId = message.chat.id

  const parsed = parseBudgetCommand(text)

  // Unrecognized format
  if (!parsed) {
    await sendTelegramReply(
      chatId,
      'Invalid /budget format. Try: /budget 2h30m, /budget 90m, /budget stop, /budget status'
    )
    return
  }

  const activeSession = await getActiveSession()

  // ── /budget status ──────────────────────────────────────────────────────────
  if (parsed.type === 'status') {
    if (!activeSession) {
      await sendTelegramReply(chatId, 'No active budget session. Use /budget Xh to start one.')
      return
    }
    const statusMsg = await buildStatusMessage(activeSession)
    await sendTelegramReply(chatId, statusMsg)
    return
  }

  // ── /budget stop ────────────────────────────────────────────────────────────
  if (parsed.type === 'stop') {
    if (!activeSession) {
      await sendTelegramReply(chatId, 'No active budget session to stop.')
      return
    }

    const stopped = await stopSession(activeSession.id)
    const completedCount = stopped?.completed_count ?? activeSession.completed_count
    const usedMinutes = stopped?.used_minutes ?? activeSession.used_minutes

    await sendTelegramReply(
      chatId,
      `Budget stopped. ${completedCount} tasks completed in ${usedMinutes} minutes.`
    )

    // Fire budget summary notification for stopped session
    if (stopped) {
      void sendDrainSummary(stopped)
    }

    // F17: log stop event
    void logKnowledgeEvent('work_budget', 'work_budget.stopped', {
      actor: 'colin',
      status: 'success',
      meta: {
        session_id: activeSession.id,
        budget_minutes: activeSession.budget_minutes,
        used_minutes: usedMinutes,
        completed_count: completedCount,
      },
    })

    // Attribution: session closed
    void recordAttribution(
      { actor_type: 'human', actor_id: 'telegram' },
      { type: 'work_budget_sessions', id: activeSession.id },
      'budget_session_closed',
      {
        used_minutes: usedMinutes,
        completed_count: completedCount,
        close_reason: 'stopped',
      }
    )
    return
  }

  // ── /budget Xh[Mm] or Nm ────────────────────────────────────────────────────
  const minutes = parsed.minutes!

  // Validate limits
  if (minutes < MIN_BUDGET_MINUTES) {
    await sendTelegramReply(chatId, '10 minute minimum — not enough time to complete a task.')
    return
  }

  if (minutes > MAX_BUDGET_MINUTES) {
    await sendTelegramReply(
      chatId,
      '8h max per budget window. Use /budget 8h or split across sessions.'
    )
    return
  }

  // Reject if already active
  if (activeSession) {
    await sendTelegramReply(
      chatId,
      'Budget already active. Use /budget status or /budget stop first.'
    )
    return
  }

  // Open new session
  const session = await openBudgetSession(minutes, chatId, db)
  if (!session) {
    await sendTelegramReply(chatId, 'Failed to open budget session. Try again.')
    return
  }

  const hoursDisplay =
    minutes >= 60
      ? `${Math.floor(minutes / 60)}h${minutes % 60 > 0 ? `${minutes % 60}m` : ''}`
      : `${minutes}m`
  await sendTelegramReply(chatId, `Budget window open: ${hoursDisplay}. Starting now.`)

  // F17: log open event
  void logKnowledgeEvent('work_budget', 'work_budget.opened', {
    actor: 'colin',
    status: 'success',
    meta: {
      session_id: session.id,
      budget_minutes: minutes,
      used_minutes: 0,
      completed_count: 0,
    },
  })

  // Attribution: session opened
  void recordAttribution(
    { actor_type: 'human', actor_id: 'telegram' },
    { type: 'work_budget_sessions', id: session.id },
    'budget_session_opened',
    { budget_minutes: minutes, source: 'telegram' }
  )
}

// ── Self-work pipeline runner ─────────────────────────────────────────────────
// Called from pickup-runner when queue is empty during a budget session.

export async function runSelfGeneratedWorkPipeline(
  session: WorkBudgetSession,
  db: SupabaseClient
): Promise<{ tasksGenerated: number; exhausted: boolean }> {
  // Phase 1: improvement proposals are already in task_queue — check first
  if (await hasEligibleQueuedTasks(db)) {
    return { tasksGenerated: 0, exhausted: false }
  }

  // Phase 2: doc gaps
  const docGaps = await generateDocGapTasks(db)
  if (docGaps > 0) return { tasksGenerated: docGaps, exhausted: false }

  // Phase 3: test gaps
  const testGaps = await generateTestGapTasks(db)
  if (testGaps > 0) return { tasksGenerated: testGaps, exhausted: false }

  // Phase 4: halt — all tiers exhausted
  return { tasksGenerated: 0, exhausted: true }
}

// Re-export estimateTask so pickup-runner only needs to import from this module
export { estimateTask }
export { runCalibration }

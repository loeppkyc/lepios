import * as fs from 'node:fs'
import * as path from 'node:path'
import { createServiceClient } from '@/lib/supabase/service'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CronEntry {
  path: string
  schedule: string
}

export interface CronScheduleDetail {
  path: string
  schedule: string
  is_hourly: boolean
}

export interface CronRegistrationResult {
  passed: boolean
  reason: string
  details: {
    hourly_count: number
    schedules: CronScheduleDetail[]
  }
}

// ── Pure logic — testable without fs or network ───────────────────────────────

function isHourlyCron(schedule: string): boolean {
  const parts = schedule.trim().split(/\s+/)
  if (parts.length !== 5) return false
  const hourField = parts[1]
  // Hourly if hour field is wildcard, step, or comma-list
  return hourField === '*' || hourField.startsWith('*/') || hourField.includes(',')
}

export function checkCronLimits(crons: CronEntry[]): {
  passed: boolean
  reason: string
  hourly_count: number
  schedules: CronScheduleDetail[]
} {
  const schedules: CronScheduleDetail[] = crons.map((c) => ({
    path: c.path,
    schedule: c.schedule,
    is_hourly: isHourlyCron(c.schedule),
  }))

  const hourlySchedules = schedules.filter((s) => s.is_hourly)
  const hourly_count = hourlySchedules.length

  if (hourly_count > 0) {
    const listed = hourlySchedules.map((s) => `${s.schedule} → ${s.path}`).join(', ')
    return {
      passed: false,
      reason: `Hobby plan violation: ${hourly_count} hourly cron(s) detected — ${listed}`,
      hourly_count,
      schedules,
    }
  }

  return {
    passed: true,
    reason: `${crons.length} crons registered, 0 hourly — Hobby plan compliant`,
    hourly_count: 0,
    schedules,
  }
}

// ── harness_config read ───────────────────────────────────────────────────────

async function readChatId(): Promise<string | null> {
  try {
    const db = createServiceClient()
    const { data, error } = await db
      .from('harness_config')
      .select('value')
      .eq('key', 'TELEGRAM_CHAT_ID')
      .maybeSingle()
    if (error || !data) return null
    return data.value || null
  } catch {
    return null
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runCronRegistrationSmoke(
  baseUrl: string,
  cronsOverride?: CronEntry[]
): Promise<CronRegistrationResult> {
  const db = createServiceClient()

  let crons: CronEntry[]

  if (cronsOverride !== undefined) {
    crons = cronsOverride
  } else {
    try {
      const vercelJsonPath = path.join(process.cwd(), 'vercel.json')
      const raw = fs.readFileSync(vercelJsonPath, 'utf-8')
      const parsed = JSON.parse(raw) as { crons?: CronEntry[] }
      crons = parsed.crons ?? []
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const result: CronRegistrationResult = {
        passed: false,
        reason: `vercel.json read failed: ${msg}`,
        details: { hourly_count: 0, schedules: [] },
      }

      try {
        await db.from('agent_events').insert({
          domain: 'harness',
          action: 'smoke_test_failed',
          actor: 'cron-registration',
          status: 'error',
          meta: { reason: result.reason, base_url: baseUrl },
        })
      } catch {
        // Non-fatal
      }

      try {
        await db.from('task_queue').insert({
          task: 'Investigate cron registration smoke test failure',
          description: result.reason,
          priority: 1,
          status: 'queued',
          source: 'cron',
          metadata: { reason: result.reason, base_url: baseUrl },
        })
      } catch {
        // Non-fatal
      }

      return result
    }
  }

  const { passed, reason, hourly_count, schedules } = checkCronLimits(crons)

  if (passed) {
    try {
      await db.from('agent_events').insert({
        domain: 'harness',
        action: 'smoke_test_passed',
        actor: 'cron-registration',
        status: 'success',
        meta: { cron_count: crons.length, hourly_count, base_url: baseUrl },
      })
    } catch {
      // Non-fatal
    }
  } else {
    const chatId = await readChatId()

    const alertText = [
      'Cron registration smoke test FAILED',
      `base_url: ${baseUrl}`,
      `reason: ${reason}`,
    ].join('\n')

    const correlationId = `cron-smoke-fail-${Date.now()}`

    try {
      await db.from('agent_events').insert({
        domain: 'harness',
        action: 'smoke_test_failed',
        actor: 'cron-registration',
        status: 'error',
        meta: { reason, hourly_count, base_url: baseUrl },
      })
    } catch {
      // Non-fatal
    }

    try {
      await db.from('outbound_notifications').insert({
        channel: 'telegram',
        payload: { text: alertText },
        correlation_id: correlationId,
        requires_response: false,
        ...(chatId ? { chat_id: chatId } : {}),
      })
    } catch {
      // Non-fatal
    }

    try {
      await db.from('task_queue').insert({
        task: 'Investigate cron registration smoke test failure',
        description: reason,
        priority: 1,
        status: 'queued',
        source: 'cron',
        metadata: { hourly_count, base_url: baseUrl },
      })
    } catch {
      // Non-fatal
    }
  }

  return {
    passed,
    reason,
    details: { hourly_count, schedules },
  }
}

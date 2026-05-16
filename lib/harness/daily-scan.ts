// Daily scan agent — iterative full-pass algorithm, SCAN phase.
// Reads system state (DB + harness health), calls Claude to rank gaps,
// queues top tasks, writes summary to daily_scan_log.
// Triggered by pg_cron or manual POST to /api/cron/daily-scan.

import Anthropic from '@anthropic-ai/sdk'
import { createServiceClient } from '@/lib/supabase/service'
import { logClaudeTokens } from '@/lib/ai/log-tokens'

const MODEL = 'claude-sonnet-4-6'

// ── System prompt (cached — stable across runs) ──────────────────────────────

const SYSTEM_PROMPT = `You are the LepiOS daily scan agent. Your job is to analyze the current state of the system and identify the highest-leverage gaps to fix or build.

LepiOS is Colin Loeppky's life/business command center built in Next.js + Supabase. It is live at lepios-one.vercel.app. The system has:
- An autonomous harness that picks up tasks from task_queue and runs coordinator/builder agents
- 60+ cockpit pages covering Amazon sales, bookkeeping, Keepa scanning, retail arb, health, diet, bets, trading
- A digital twin that answers questions about Colin's business
- Circuit breakers and health monitoring (Facebook resilience model)

Colin's priorities (in order):
1. Things that make or save money (Amazon, bookkeeping accuracy, retail arb, deal finding)
2. Things that save time (automation, reducing manual steps)
3. Things that reduce risk (circuit breakers, error detection, self-repair)
4. Measurement and observability (improvement_log, F18 metrics)

When ranking tasks:
- Prefer tasks that are actionable NOW (no external dependencies blocking them)
- Prefer tasks that connect to real dollars or real decisions
- Deprioritize cosmetic improvements
- Deprioritize things that need hardware (GPU, Docker) unless cheap to spec

Your output MUST be a valid JSON array (no markdown, no preamble) with this exact structure:
[
  {
    "task": "kebab-case-slug",
    "description": "One sentence: what it does and why it matters to Colin",
    "priority": <integer 1-10, 10=highest>,
    "reason": "One sentence: why this is high priority NOW"
  }
]

Produce 3–7 tasks. Do not repeat tasks already in the pending list.`

// ── Main scan function ────────────────────────────────────────────────────────

export interface ScanResult {
  tasksQueued: number
  taskIds: string[]
  summary: string
  durationMs: number
}

export async function runDailyScan(): Promise<ScanResult> {
  const startMs = Date.now()
  const svc = createServiceClient()

  // 1. Gather system state
  const [pendingTasks, recentErrors, staleMetrics, harnessConfig] = await Promise.all([
    svc
      .from('task_queue')
      .select('task, description, status, priority, created_at')
      .in('status', ['queued', 'approved'])
      .order('priority', { ascending: false })
      .limit(20),
    svc
      .from('agent_events')
      .select('domain, action, error_message, occurred_at')
      .eq('status', 'error')
      .order('occurred_at', { ascending: false })
      .limit(20),
    svc
      .from('improvement_log')
      .select('component, metric, value, recorded_at, is_baseline')
      .order('recorded_at', { ascending: false })
      .limit(30),
    svc
      .from('harness_config')
      .select('key, value')
      .eq('is_secret', false)
      .in('key', ['gpu_day_score', 'orb_day_score', 'business_review_pct', 'HARNESS_STATE'])
      .limit(10),
  ])

  const stateSnapshot = {
    pending_tasks: (pendingTasks.data ?? []).map((t) => ({
      task: t.task,
      description: t.description,
      status: t.status,
      priority: t.priority,
    })),
    recent_errors: (recentErrors.data ?? []).map((e) => ({
      domain: e.domain,
      action: e.action,
      error: e.error_message,
      when: e.occurred_at,
    })),
    improvement_gaps: (staleMetrics.data ?? [])
      .filter((m) => m.is_baseline && m.value === 0)
      .map((m) => ({ component: m.component, metric: m.metric })),
    harness_state: Object.fromEntries(
      (harnessConfig.data ?? []).map((r) => [r.key, r.value])
    ),
  }

  // 2. Ask Claude to rank gaps
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const userMessage = `Current system state as of ${new Date().toISOString()}:

PENDING TASKS IN QUEUE (${stateSnapshot.pending_tasks.length}):
${JSON.stringify(stateSnapshot.pending_tasks, null, 2)}

RECENT ERRORS (${stateSnapshot.recent_errors.length}):
${JSON.stringify(stateSnapshot.recent_errors, null, 2)}

COMPONENTS WITH ZERO BASELINE METRICS (${stateSnapshot.improvement_gaps.length}):
${JSON.stringify(stateSnapshot.improvement_gaps, null, 2)}

HARNESS STATE:
${JSON.stringify(stateSnapshot.harness_state, null, 2)}

Based on this state, identify the top 3–7 highest-leverage tasks to queue. Skip anything already in PENDING TASKS.`

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userMessage }],
  })

  logClaudeTokens(response, 'harness')

  const raw = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '[]'

  let proposals: Array<{ task: string; description: string; priority: number; reason: string }> = []
  try {
    proposals = JSON.parse(raw)
    if (!Array.isArray(proposals)) proposals = []
  } catch {
    proposals = []
  }

  // 3. Insert new tasks (skip slugs already queued)
  const existingSlugs = new Set(stateSnapshot.pending_tasks.map((t) => t.task))
  const toInsert = proposals.filter((p) => p.task && !existingSlugs.has(p.task))

  const insertedIds: string[] = []
  for (const p of toInsert) {
    const { data } = await svc
      .from('task_queue')
      .insert({
        task: p.task,
        description: p.description,
        priority: Math.min(10, Math.max(1, Math.round(p.priority))),
        status: 'queued',
        source: 'cron',
        metadata: { scan_reason: p.reason, scan_source: 'daily-scan' },
      })
      .select('id')
      .single()
    if (data?.id) insertedIds.push(data.id)
  }

  const durationMs = Date.now() - startMs

  // 4. Build plain-English summary
  const summary =
    toInsert.length > 0
      ? `Daily scan queued ${toInsert.length} tasks: ${toInsert.map((t) => t.task).join(', ')}. Top priority: ${toInsert[0]?.task ?? '(none)'} — ${toInsert[0]?.reason ?? ''}`
      : `Daily scan found no new tasks to queue. ${stateSnapshot.pending_tasks.length} tasks already pending.`

  // 5. Write to daily_scan_log
  await svc.from('daily_scan_log').insert({
    health_scores: stateSnapshot.harness_state,
    top_gaps: toInsert.map((t) => ({ component: t.task, gap: t.description, priority: t.priority, reason: t.reason })),
    tasks_queued: insertedIds.length,
    task_ids: insertedIds,
    summary,
    model: MODEL,
    duration_ms: durationMs,
    meta: { error_count: stateSnapshot.recent_errors.length, pending_before: stateSnapshot.pending_tasks.length },
  })

  return { tasksQueued: insertedIds.length, taskIds: insertedIds, summary, durationMs }
}

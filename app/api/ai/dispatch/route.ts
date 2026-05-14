import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { hydrateOllamaConfig, generate, OllamaUnreachableError } from '@/lib/ollama/client'
import { createServiceClient } from '@/lib/supabase/service'
import { logEvent } from '@/lib/knowledge/client'

// Keywords that indicate a task requires coordinator-tier reasoning.
// Any match → skip Ollama, queue for coordinator. See docs/decisions/ai-dispatch-routing.md.
const COORDINATOR_KEYWORDS = [
  'migrate',
  'schema',
  'database',
  'supabase',
  'acceptance doc',
  'sprint',
  'grounding',
  'approval',
  'architect',
  'design',
  'refactor',
  'pr',
  'pull request',
  'deploy',
  'cron',
  'migration',
]

export function classifyTask(task: string): 'ollama' | 'coordinator' {
  if (task.length > 300) return 'coordinator'
  const lower = task.toLowerCase()
  if (COORDINATOR_KEYWORDS.some((kw) => lower.includes(kw))) return 'coordinator'
  return 'ollama'
}

export async function POST(request: Request): Promise<NextResponse> {
  // auth: see lib/auth/cron-secret.ts (F22)
  const unauthorized = requireCronSecret(request)
  if (unauthorized) return unauthorized

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const raw = (body as Record<string, unknown> | null) ?? {}
  const task = typeof raw.task === 'string' ? raw.task.trim() : ''
  if (!task) {
    return NextResponse.json(
      { error: 'Missing required field: task (non-empty string)' },
      { status: 400 }
    )
  }

  await hydrateOllamaConfig()

  const tier = classifyTask(task)
  const t0 = Date.now()

  if (tier === 'ollama') {
    try {
      const result = await generate(task, { task: 'general' })
      void logEvent('ai_dispatch', 'ai_dispatch.routed', {
        actor: 'system',
        status: 'success',
        durationMs: Date.now() - t0,
        meta: { routed_to: 'ollama', task_slug: task.slice(0, 100) },
      })
      return NextResponse.json({
        routed_to: 'ollama',
        text: result.text,
        confidence: result.confidence,
        model: result.model,
      })
    } catch (err) {
      if (!(err instanceof OllamaUnreachableError)) throw err
      // Ollama unreachable → fall through to coordinator path
    }
  }

  // Coordinator path: task classified as coordinator-tier, or Ollama was unreachable.
  const db = createServiceClient()
  const { data: inserted, error } = await db
    .from('task_queue')
    .insert({
      task,
      description: 'Dispatched by POST /api/ai/dispatch',
      metadata: { dispatcher: 'ai_dispatch_v1', original_tier: tier },
      priority: 5,
      status: 'queued',
      source: 'ai_dispatch',
    })
    .select('id')
    .single()

  if (error) {
    void logEvent('ai_dispatch', 'ai_dispatch.routed', {
      actor: 'system',
      status: 'failure',
      errorMessage: error.message,
      errorType: 'db_insert_failed',
      durationMs: Date.now() - t0,
      meta: { routed_to: 'coordinator', task_slug: task.slice(0, 100) },
    })
    return NextResponse.json({ error: 'Failed to queue task' }, { status: 500 })
  }

  const taskId = (inserted as { id: string }).id
  void logEvent('ai_dispatch', 'ai_dispatch.routed', {
    actor: 'system',
    status: 'success',
    durationMs: Date.now() - t0,
    meta: { routed_to: 'coordinator', task_slug: task.slice(0, 100), task_id: taskId },
  })

  return NextResponse.json({ routed_to: 'coordinator', task_id: taskId })
}

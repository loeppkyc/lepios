// CRITICAL: Do NOT use the names ActionType, ActionResult, CapabilityCheck, or CapabilityResult
// here — those are already defined in lib/security/types.ts.

// Source of truth: capability_registry table, populated by migrations 0045 + 0062 + 0065.
export type Capability =
  // net (8)
  | 'net.outbound.*'
  | 'net.outbound.telegram'
  | 'net.outbound.vercel.deploy'
  | 'net.outbound.vercel.read'
  | 'net.outbound.supabase'
  | 'net.outbound.anthropic'
  | 'net.outbound.github'
  | 'net.outbound.openai'
  // db (10)
  | 'db.read.*'
  | 'db.read.knowledge'
  | 'db.read.agent_events'
  | 'db.read.task_queue'
  | 'db.write.agent_events'
  | 'db.write.task_queue'
  | 'db.write.outbound_notifications'
  | 'db.write.session_handoffs'
  | 'db.write.agent_actions'
  | 'db.migrate'
  // fs (3)
  | 'fs.read'
  | 'fs.write'
  | 'fs.delete'
  // shell (1)
  | 'shell.run'
  // git (4)
  | 'git.commit'
  | 'git.push'
  | 'git.force_push'
  | 'git.branch'
  // secret (7)
  | 'secret.read.*'
  | 'secret.read.SUPABASE_SERVICE_ROLE_KEY'
  | 'secret.read.CRON_SECRET'
  | 'secret.read.TELEGRAM_BOT_TOKEN_ALERTS'
  | 'secret.read.TELEGRAM_BOT_TOKEN_BUILDER'
  | 'secret.read.TELEGRAM_BOT_TOKEN_DAILY'
  | 'secret.read.TELEGRAM_CHAT_ID'
  // sandbox (4)
  | 'sandbox.create'
  | 'sandbox.execute'
  | 'sandbox.escape'
  | 'sandbox.run'
  // tool (3)
  | 'tool.self_repair.read.agent_events'
  | 'tool.self_repair.draft_fix'
  | 'tool.self_repair.open_pr'
  // browser (5) — migration 0065
  | 'browser.navigate'
  | 'browser.screenshot'
  | 'browser.evaluate'
  | 'browser.click'
  | 'browser.fill'
  // gmail (2) — migration 0066
  | 'gmail.search'
  | 'gmail.get'

export interface HandlerContext {
  capability: Capability
  agentId: string
  taskId?: string
  runId?: string
  capAuditId: string // audit_id from the cap_check row
}

export type ArmsLegsHandler<TPayload, TResult> = (
  payload: TPayload,
  ctx: HandlerContext
) => Promise<TResult>

export interface ActionEnvelope<TPayload = unknown> {
  capability: Capability
  payload: TPayload
  caller: {
    agent: string
    runId?: string
    taskId?: string
  }
  timeoutMs?: number // default 30_000, clamped to 120_000
}

export type DispatchResult<TResult = unknown> =
  | {
      ok: true
      data: TResult
      durationMs: number
      capability: Capability
      capAuditId: string
    }
  | {
      ok: false
      error: {
        code: 'capability_denied' | 'handler_error' | 'timeout' | 'no_handler'
        message: string
        retriable: boolean
      }
      durationMs: number
      capability: Capability
      capAuditId: string | null
    }

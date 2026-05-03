import { createServiceClient } from '@/lib/supabase/service'
import { checkCapability } from '@/lib/security/capability'
import { CapabilityDeniedError } from '@/lib/security/types'
import type {
  ActionEnvelope,
  ArmsLegsHandler,
  Capability,
  DispatchResult,
  HandlerContext,
} from './types'

// ── Internal timeout error ────────────────────────────────────────────────────

class TimeoutError extends Error {
  constructor() {
    super('Handler timed out')
    this.name = 'TimeoutError'
  }
}

// ── Timeout constants ─────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 120_000

// ── Handler registry ──────────────────────────────────────────────────────────

// Module-level registry. Populated by registerHandler() calls (e.g. from http-handlers.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handlerRegistry = new Map<string, ArmsLegsHandler<any, any>>()

// ── Register ──────────────────────────────────────────────────────────────────

export function registerHandler<TPayload, TResult>(
  capability: Capability,
  handler: ArmsLegsHandler<TPayload, TResult>
): void {
  if (handlerRegistry.has(capability)) {
    throw new Error(`Handler already registered for capability "${capability}"`)
  }
  handlerRegistry.set(capability, handler)
}

// ── Retriable classification ──────────────────────────────────────────────────

function isRetriable(err: unknown): boolean {
  // CapabilityDeniedError is never retriable (access control decision)
  if (err instanceof CapabilityDeniedError) return false
  // Timeout is not retriable — it would just time out again
  if (err instanceof TimeoutError) return false
  // HTTP 4xx errors are not retriable
  if (err instanceof Error) {
    const msg = err.message
    if (msg.includes('invalid_') || /\b4\d{2}\b/.test(msg)) return false
  }
  return true
}

// ── Non-fatal agent_events logging ───────────────────────────────────────────

async function logDispatchEvent(opts: {
  action: string
  actor: string
  status: 'success' | 'error' | 'warning'
  durationMs: number
  capability: Capability
  capAuditId: string | null
  taskId?: string
  runId?: string
  errorMessage?: string
  errorClass?: string
  retriable?: boolean
  timeoutMs?: number
}): Promise<void> {
  try {
    const db = createServiceClient()
    await db.from('agent_events').insert({
      domain: 'arms_legs',
      action: opts.action,
      actor: opts.actor,
      status: opts.status,
      duration_ms: opts.durationMs,
      error_message: opts.errorMessage ?? null,
      meta: {
        capability: opts.capability,
        cap_audit_id: opts.capAuditId,
        task_id: opts.taskId ?? null,
        run_id: opts.runId ?? null,
        ...(opts.retriable !== undefined ? { retriable: opts.retriable } : {}),
        ...(opts.errorClass !== undefined ? { error_class: opts.errorClass } : {}),
        ...(opts.timeoutMs !== undefined ? { timeout_ms: opts.timeoutMs } : {}),
      },
    })
  } catch {
    // Logging must never break the caller
  }
}

// ── runAction ─────────────────────────────────────────────────────────────────

export async function runAction<TPayload, TResult>(
  envelope: ActionEnvelope<TPayload>
): Promise<DispatchResult<TResult>> {
  const { capability, payload, caller } = envelope
  const agentId = caller.agent
  const taskId = caller.taskId
  const runId = caller.runId

  // Step 1: No-handler guard — return immediately, no audit row
  const handler = handlerRegistry.get(capability) as ArmsLegsHandler<TPayload, TResult> | undefined

  if (!handler) {
    return {
      ok: false,
      error: {
        code: 'no_handler',
        message: `No handler registered for capability "${capability}"`,
        retriable: false,
      },
      durationMs: 0,
      capability,
      capAuditId: null,
    }
  }

  // Step 2: Capability check — never throws
  const dispatchCheckStart = Date.now()
  const capResult = await checkCapability({
    agentId,
    capability,
    context: { taskId, runId },
  })

  if (!capResult.allowed) {
    const durationMs = Date.now() - dispatchCheckStart
    await logDispatchEvent({
      action: 'arms_legs.dispatch.denied',
      actor: agentId,
      status: 'warning',
      durationMs,
      capability,
      capAuditId: capResult.audit_id,
      taskId,
      runId,
    })
    return {
      ok: false,
      error: {
        code: 'capability_denied',
        message: capResult.reason,
        retriable: false,
      },
      durationMs,
      capability,
      capAuditId: capResult.audit_id,
    }
  }

  // Step 3: Timeout setup
  const clampedTimeout = Math.min(envelope.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)

  // Step 4: Handler execution with timeout
  const handlerCtx: HandlerContext = {
    capability,
    agentId,
    taskId,
    runId,
    capAuditId: capResult.audit_id,
  }

  const handlerStart = Date.now()

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new TimeoutError()), clampedTimeout)
  })

  try {
    const data = await Promise.race([handler(payload, handlerCtx), timeoutPromise])
    clearTimeout(timeoutHandle)

    const durationMs = Date.now() - handlerStart
    // Step 5d: Success log
    await logDispatchEvent({
      action: 'arms_legs.dispatch.ok',
      actor: agentId,
      status: 'success',
      durationMs,
      capability,
      capAuditId: capResult.audit_id,
      taskId,
      runId,
    })

    return {
      ok: true,
      data,
      durationMs,
      capability,
      capAuditId: capResult.audit_id,
    }
  } catch (err) {
    clearTimeout(timeoutHandle)
    const durationMs = Date.now() - handlerStart

    if (err instanceof TimeoutError) {
      // Step 5b: Timeout log
      await logDispatchEvent({
        action: 'arms_legs.dispatch.timeout',
        actor: agentId,
        status: 'error',
        durationMs,
        capability,
        capAuditId: capResult.audit_id,
        taskId,
        runId,
        timeoutMs: clampedTimeout,
      })
      return {
        ok: false,
        error: {
          code: 'timeout',
          message: err.message,
          retriable: false,
        },
        durationMs,
        capability,
        capAuditId: capResult.audit_id,
      }
    }

    // Step 5c: Handler error log
    const errorMessage = err instanceof Error ? err.message : String(err)
    const errorClass = err instanceof Error ? err.constructor.name : 'UnknownError'
    const retriable = isRetriable(err)

    await logDispatchEvent({
      action: 'arms_legs.dispatch.error',
      actor: agentId,
      status: 'error',
      durationMs,
      capability,
      capAuditId: capResult.audit_id,
      taskId,
      runId,
      errorMessage,
      errorClass,
      retriable,
    })

    return {
      ok: false,
      error: {
        code: 'handler_error',
        message: errorMessage,
        retriable,
      },
      durationMs,
      capability,
      capAuditId: capResult.audit_id,
    }
  }
}

// ── Test-only registry reset ──────────────────────────────────────────────────
// Only exported in test environments to allow test isolation.

export function _resetHandlerRegistryForTests(): void {
  if (process.env.NODE_ENV !== 'test' && process.env.VITEST === undefined) {
    throw new Error('_resetHandlerRegistryForTests() must only be called in test environments')
  }
  handlerRegistry.clear()
}

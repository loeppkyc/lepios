/**
 * chat_ui tool registry — Slice 1.
 *
 * Each tool is one file in lib/orb/tools/{name}.ts exporting a ChatTool.
 * buildTools() maps registered tools into AI SDK 6's tool record, wiring:
 *   - capability check via checkCapability() (deny returns structured result, no throw)
 *   - 30s execution timeout (acceptance D.1)
 *   - agent_events outcome logging (ok / error / timeout, with correlation_id)
 *
 * Spec: docs/harness/CHAT_UI_SPEC.md §AD2, §M1.
 */

import type { Tool } from 'ai'
import { z } from 'zod'
import { checkCapability } from '@/lib/security/capability'
import { createServiceClient } from '@/lib/supabase/service'

export interface ChatToolContext {
  agentId: 'chat_ui'
  conversationId: string
  userId: string
  toolCallId: string
}

export interface ChatTool<P = unknown, R = unknown> {
  name: string
  description: string
  parameters: z.ZodSchema<P>
  capability: string
  execute: (args: P, ctx: ChatToolContext) => Promise<R>
}

export type ChatToolResult<R> =
  | { allowed: true; result: R; auditId: string }
  | { allowed: false; reason: string; auditId: string }

export const TOOL_TIMEOUT_MS = 30_000

class ToolTimeoutError extends Error {
  constructor(public readonly toolName: string) {
    super(`Tool ${toolName} exceeded ${TOOL_TIMEOUT_MS}ms timeout`)
    this.name = 'ToolTimeoutError'
  }
}

// Registered tools — slice 4: getHarnessRollup + queryTwin + sendTelegramMessage + queueTask + listAgentEvents
import { harnessRollupTool } from './harness-rollup'
import { twinQueryTool } from './twin-query'
import { sendTelegramTool } from './send-telegram'
import { queueTaskTool } from './queue-task'
import { listAgentEventsTool } from './list-agent-events'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const REGISTERED: ChatTool<any, any>[] = [
  harnessRollupTool,
  twinQueryTool,
  sendTelegramTool,
  queueTaskTool,
  listAgentEventsTool,
]

async function logToolEvent(
  action: string,
  opts: {
    tool: string
    correlationId: string
    conversationId: string
    userId: string
    toolCallId: string
    durationMs: number
    error?: string
  },
): Promise<void> {
  try {
    const db = createServiceClient()
    await db.from('agent_events').insert({
      domain: 'chat_ui',
      action,
      actor: 'chat_ui',
      status: action.endsWith('.ok') ? 'success' : 'error',
      duration_ms: opts.durationMs,
      error_message: opts.error ?? null,
      meta: {
        tool: opts.tool,
        correlation_id: opts.correlationId,
        conversation_id: opts.conversationId,
        user_id: opts.userId,
        tool_call_id: opts.toolCallId,
        durationMs: opts.durationMs,
      },
    })
  } catch {
    // logging must never break the caller
  }
}

export function buildTools(ctx: ChatToolContext): Record<string, Tool> {
  return Object.fromEntries(
    REGISTERED.map((t) => [
      t.name,
      // tool() overload inference breaks with any-typed schemas; cast directly.
      ({
        description: t.description,
        parameters: t.parameters,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        execute: async (args: any, { toolCallId }: { toolCallId: string }) => {
          const callCtx: ChatToolContext = { ...ctx, toolCallId }

          // Cap-check: use checkCapability (not requireCapability) — deny returns
          // structured result per AD3, never throws.
          const cap = await checkCapability({
            agentId: ctx.agentId,
            capability: t.capability,
            context: { sessionId: ctx.conversationId, reason: t.name },
          })

          if (!cap.allowed) {
            return {
              allowed: false,
              reason: cap.reason,
              auditId: cap.audit_id,
            } satisfies ChatToolResult<never>
          }

          const t0 = Date.now()
          try {
            const result = await Promise.race([
              t.execute(args as Parameters<typeof t.execute>[0], callCtx),
              new Promise<never>((_, reject) =>
                setTimeout(
                  () => reject(new ToolTimeoutError(t.name)),
                  TOOL_TIMEOUT_MS,
                ),
              ),
            ])
            await logToolEvent('chat_ui.tool.ok', {
              tool: t.name,
              correlationId: cap.audit_id,
              conversationId: ctx.conversationId,
              userId: ctx.userId,
              toolCallId,
              durationMs: Date.now() - t0,
            })
            return { allowed: true, result, auditId: cap.audit_id } satisfies ChatToolResult<unknown>
          } catch (err) {
            const isTimeout = err instanceof ToolTimeoutError
            await logToolEvent(isTimeout ? 'chat_ui.tool.timeout' : 'chat_ui.tool.error', {
              tool: t.name,
              correlationId: cap.audit_id,
              conversationId: ctx.conversationId,
              userId: ctx.userId,
              toolCallId,
              durationMs: Date.now() - t0,
              error: String(err),
            })
            throw err
          }
        },
      }) as unknown as Tool,
    ]),
  )
}

/**
 * push_bash_automation — Executor (Slice 1)
 *
 * Handles execution for each tier:
 *   - block  → write audit row, return immediately (never execute)
 *   - confirm → write audit row with status='pending', send plain Telegram alert
 *   - auto   → run via runInSandbox(), write audit row with result
 */

import { runInSandbox } from '@/lib/harness/sandbox/runtime'
import { createServiceClient } from '@/lib/supabase/service'
import { telegram } from '@/lib/harness/arms-legs'
import { buildPushBashCallback } from '@/lib/harness/telegram-buttons'
import type { PolicyDecision, DecisionContext } from './policy'

// 8 KB — smaller than sandbox's 256 KB; enough for shell commands
const STDOUT_MAX = 8 * 1024

export interface ExecutionResult {
  decisionId: string
  tier: string
  status: string
  exitCode?: number | null
  stdout?: string
  stderr?: string
  reason: string
}

export async function executeDecision(
  cmd: string,
  decision: PolicyDecision,
  context?: DecisionContext
): Promise<ExecutionResult> {
  const db = createServiceClient()

  // ── Block tier ─────────────────────────────────────────────────────────────
  if (decision.tier === 'block') {
    const { data } = await db
      .from('push_bash_decisions')
      .insert({
        cmd,
        tier: 'block',
        reason: decision.reason,
        status: 'blocked',
        agent_id: context?.agentId ?? null,
        context: context ? (context as Record<string, unknown>) : null,
      })
      .select('id')
      .single()

    return {
      decisionId: data?.id ?? '',
      tier: 'block',
      status: 'blocked',
      reason: decision.reason,
    }
  }

  // ── Confirm tier ───────────────────────────────────────────────────────────
  if (decision.tier === 'confirm') {
    const { data } = await db
      .from('push_bash_decisions')
      .insert({
        cmd,
        tier: 'confirm',
        reason: decision.reason,
        status: 'pending',
        agent_id: context?.agentId ?? null,
        context: context ? (context as Record<string, unknown>) : null,
      })
      .select('id')
      .single()

    const decisionId = data?.id ?? ''

    const nl = '\n'
    const pb = '\u23F8'
    const confirmText =
      pb + ' push_bash confirm' + nl + '`' + cmd.substring(0, 200) + '`' + nl + decision.reason

    const tgResult = await telegram(confirmText, {
      bot: 'alerts',
      agentId: 'push_bash_automation',
      replyMarkup: {
        inline_keyboard: [
          [
            { text: '\u2705 Approve', callback_data: buildPushBashCallback('approve', decisionId) },
            { text: '\uD83D\uDEAB Deny', callback_data: buildPushBashCallback('deny', decisionId) },
          ],
        ],
      },
    }).catch(() => null)

    if (tgResult?.messageId) {
      await db
        .from('push_bash_decisions')
        .update({ telegram_message_id: tgResult.messageId })
        .eq('id', decisionId)
        .catch(() => {})
    }

    return {
      decisionId,
      tier: 'confirm',
      status: 'pending',
      reason: decision.reason,
    }
  }

  // ── Auto tier — run via sandbox ────────────────────────────────────────────
  const sandboxResult = await runInSandbox(cmd, {
    agentId: context?.agentId ?? 'push_bash_automation',
    capability: 'sandbox.run',
    scope: { fs: { allowedPaths: ['.'] } },
    timeoutMs: 120_000,
    reason: context?.reason ?? `push_bash auto: ${cmd.substring(0, 100)}`,
  })

  const status = 'auto_executed'
  const { data } = await db
    .from('push_bash_decisions')
    .insert({
      cmd,
      tier: 'auto',
      reason: decision.reason,
      status,
      sandbox_run_id: sandboxResult.runId,
      exit_code: sandboxResult.exitCode,
      stdout_trunc: sandboxResult.stdout.substring(0, STDOUT_MAX),
      stderr_trunc: sandboxResult.stderr.substring(0, STDOUT_MAX),
      agent_id: context?.agentId ?? null,
      context: context ? (context as Record<string, unknown>) : null,
    })
    .select('id')
    .single()

  return {
    decisionId: data?.id ?? '',
    tier: 'auto',
    status,
    exitCode: sandboxResult.exitCode,
    stdout: sandboxResult.stdout.substring(0, STDOUT_MAX),
    stderr: sandboxResult.stderr.substring(0, STDOUT_MAX),
    reason: decision.reason,
  }
}

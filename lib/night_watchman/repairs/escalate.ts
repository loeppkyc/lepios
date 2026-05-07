// Escalate path — issue Telegram alert via daily-bot, leave incident open.
//
// Used for:
//   - any check that fails RLS/auth/schema/secrets (never auto-repair)
//   - severity = critical
//   - per-check 24h cap reached (loop guard)
//   - safe-list / sandbox repair returned failure or not_applicable

import { sendDailyBot } from '@/lib/telegram/daily-bot'
import { renderHumanRequiredAlert } from '@/lib/telegram/templates'
import type { CheckResult, RepairContext, RepairResult } from '../types'

export async function escalate(
  result: CheckResult,
  ctx: RepairContext,
  reason: string
): Promise<RepairResult & { telegramMessageId?: number }> {
  if (ctx.dryRun) {
    return {
      outcome: 'escalated',
      evidence: {
        reason,
        dry_run: true,
        would_send: renderHumanRequiredAlert(result, reason),
      },
      resolved: false,
    }
  }
  const text = renderHumanRequiredAlert(result, reason)
  const sendResult = await sendDailyBot(text)
  return {
    outcome: 'escalated',
    evidence: {
      reason,
      telegram: { ok: sendResult.ok, error: sendResult.error ?? null },
      message_preview: text.slice(0, 200),
    },
    resolved: false,
    telegramMessageId: sendResult.messageId,
  }
}

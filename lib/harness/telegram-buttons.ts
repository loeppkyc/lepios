import { postMessage } from '@/lib/orchestrator/telegram'
import { telegram } from '@/lib/harness/arms-legs/telegram'

export function buildCallbackData(action: 'up' | 'dn', agentEventId: string): string {
  return `tf:${action}:${agentEventId}`
}

export function parseCallbackData(
  data: string
): { action: 'up' | 'dn'; agentEventId: string } | null {
  const parts = data.split(':')
  if (parts.length !== 3 || parts[0] !== 'tf') return null
  if (parts[1] !== 'up' && parts[1] !== 'dn') return null
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  if (!uuidRe.test(parts[2])) return null
  return { action: parts[1] as 'up' | 'dn', agentEventId: parts[2] }
}

export function buildGateCallbackData(action: 'rollback', mergeSha: string): string {
  void action // discriminator reserved for future gate actions
  return `dg:rb:${mergeSha.slice(0, 8)}`
}

export function buildGatePromoteCallbackData(commitSha: string): string {
  return `dg:promote:${commitSha.slice(0, 8)}`
}

export function buildGateAbortCallbackData(commitSha: string): string {
  return `dg:abort:${commitSha.slice(0, 8)}`
}

export function parseGateCallbackData(
  data: string
):
  | { action: 'rollback'; mergeShaPrefix: string }
  | { action: 'promote'; commitShaPrefix: string }
  | { action: 'abort'; commitShaPrefix: string }
  | null {
  const parts = data.split(':')
  if (parts.length !== 3 || parts[0] !== 'dg') return null

  if (parts[1] === 'rb') {
    if (!/^[0-9a-f]{8}$/.test(parts[2])) return null
    return { action: 'rollback', mergeShaPrefix: parts[2] }
  }

  if (parts[1] === 'promote' || parts[1] === 'abort') {
    if (!/^[0-9a-f]{8}$/.test(parts[2])) return null
    return { action: parts[1] as 'promote' | 'abort', commitShaPrefix: parts[2] }
  }

  return null
}

// ── Improvement Engine callback parser ───────────────────────────────────────

/**
 * Parses callback_data for improvement engine approve/review/dismiss actions.
 * Format: improve_<action>:<chunk_id>
 * Examples:
 *   improve_approve_all:sprint-5-e1
 *   improve_review:sprint-5-e1
 *   improve_dismiss:sprint-5-e1
 */
export function parseImproveCallbackData(
  data: string
): { action: 'approve_all' | 'review' | 'dismiss'; chunkId: string } | null {
  const m = data.match(/^improve_(approve_all|review|dismiss):(.+)$/)
  if (!m) return null
  return { action: m[1] as 'approve_all' | 'review' | 'dismiss', chunkId: m[2] }
}

export function isAllowedUser(telegramUserId: number): boolean {
  const allowed = process.env.TELEGRAM_ALLOWED_USER_ID
  if (!allowed) return false
  return telegramUserId === Number(allowed)
}

// Sends text with 👍/👎 inline keyboard when TELEGRAM_THUMBS_ENABLED is set.
// Falls back to plain postMessage when the flag is absent or bot config is missing.
export async function sendMessageWithButtons(agentEventId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID

  if (!process.env.TELEGRAM_THUMBS_ENABLED || !token || !chatId) {
    return postMessage(text)
  }

  const result = await telegram(text, {
    agentId: 'harness',
    replyMarkup: {
      inline_keyboard: [
        [
          { text: '👍', callback_data: buildCallbackData('up', agentEventId) },
          { text: '👎', callback_data: buildCallbackData('dn', agentEventId) },
        ],
      ],
    },
  })
  if (!result.ok) {
    throw new Error(`Telegram API error: ${result.error}`)
  }
}
// -- push_bash_automation callback builder + parser

export function buildPushBashCallback(action: 'approve' | 'deny', decisionId: string): string {
  return `pb:${action}:${decisionId}`
}

export function parsePushBashCallbackData(
  data: string
): { action: 'approve' | 'deny'; decisionId: string } | null {
  const m = data.match(
    /^pb:(approve|deny):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/
  )
  if (!m) return null
  return { action: m[1] as 'approve' | 'deny', decisionId: m[2] }
}

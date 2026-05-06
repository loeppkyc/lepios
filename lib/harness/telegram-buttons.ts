import { postMessage } from '@/lib/orchestrator/telegram'

export function buildCallbackData(action: 'up' | 'dn', agentEventId: string): string {
  return `tf:${action}:${agentEventId}`
}

// ── Approval / grounding callback builders and parsers ────────────────────────
//
// Short format (all well under 64-byte Telegram limit):
//   ap:{first_8_chars_of_task_id}   → Approve       (11 bytes)
//   re:{first_8_chars_of_task_id}   → Reject/revise (11 bytes)
//   gp:{first_8_chars_of_task_id}   → Grounding pass (11 bytes)
//   gpart:{first_8_chars_of_task_id} → Grounding partial (14 bytes)
//   gf:{first_8_chars_of_task_id}   → Grounding fail (11 bytes)
//
// The receiver does a prefix-lookup against task_queue.id to resolve
// the full UUID. See webhook/route.ts handleApprovalCallback.

export type ApprovalAction = 'ap' | 're' | 'gp' | 'gpart' | 'gf'

export function buildApprovalCallbackData(action: ApprovalAction, taskId: string): string {
  const id8 = taskId.replace(/-/g, '').slice(0, 8)
  return `${action}:${id8}`
}

export function parseApprovalCallbackData(
  data: string
): { action: ApprovalAction; id8: string } | null {
  const m = data.match(/^(ap|re|gp|gpart|gf):([0-9a-f]{8})$/)
  if (!m) return null
  return { action: m[1] as ApprovalAction, id8: m[2] }
}

/**
 * Sends a Telegram message with Approve / Reject inline buttons using the
 * short callback_data format. The taskId is the full UUID from task_queue.id.
 * Falls back to plain postMessage when bot config is absent.
 */
export async function sendApprovalButtons(taskId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID

  if (!token || !chatId) {
    return postMessage(text)
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'Approve',
              callback_data: buildApprovalCallbackData('ap', taskId),
            },
            {
              text: 'Reject',
              callback_data: buildApprovalCallbackData('re', taskId),
            },
          ],
        ],
      },
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Telegram API error ${res.status}: ${body}`)
  }
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

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: {
        inline_keyboard: [
          [
            { text: '👍', callback_data: buildCallbackData('up', agentEventId) },
            { text: '👎', callback_data: buildCallbackData('dn', agentEventId) },
          ],
        ],
      },
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Telegram API error ${res.status}: ${body}`)
  }
}

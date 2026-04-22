import { postMessage } from '@/lib/orchestrator/telegram'

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

export function parseGateCallbackData(
  data: string
): { action: 'rollback'; mergeShaPrefix: string } | null {
  const parts = data.split(':')
  if (parts.length !== 3 || parts[0] !== 'dg') return null
  if (parts[1] !== 'rb') return null
  if (!/^[0-9a-f]{8}$/.test(parts[2])) return null
  return { action: 'rollback', mergeShaPrefix: parts[2] }
}

export function isAllowedUser(telegramUserId: number): boolean {
  const allowed = process.env.TELEGRAM_ALLOWED_USER_ID
  if (!allowed) return false
  return telegramUserId === Number(allowed)
}

// Sends text with 👍/👎 inline keyboard when TELEGRAM_THUMBS_ENABLED is set.
// Falls back to plain postMessage when the flag is absent or bot config is missing.
export async function sendMessageWithButtons(
  agentEventId: string,
  text: string
): Promise<void> {
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
        inline_keyboard: [[
          { text: '👍', callback_data: buildCallbackData('up', agentEventId) },
          { text: '👎', callback_data: buildCallbackData('dn', agentEventId) },
        ]],
      },
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Telegram API error ${res.status}: ${body}`)
  }
}

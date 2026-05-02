import { httpRequest } from './http'

// Env var names as used throughout the repo (verified by audit 2026-05-02):
//   TELEGRAM_BOT_TOKEN       — builder/trigger bot (default)
//   TELEGRAM_ALERTS_BOT_TOKEN — alerts bot
//   TELEGRAM_CHAT_ID         — Colin's default chat ID

export type TelegramBot = 'builder' | 'alerts'

export interface TelegramOptions {
  bot?: TelegramBot
  chatId?: string
  agentId?: string
  parseMode?: 'Markdown' | 'HTML'
  replyMarkup?: unknown
}

export interface TelegramResult {
  ok: boolean
  messageId?: number
  error?: string
}

export async function telegram(
  message: string,
  options: TelegramOptions = {}
): Promise<TelegramResult> {
  const { bot = 'builder', chatId, agentId = 'harness', parseMode, replyMarkup } = options

  const token =
    bot === 'alerts' ? process.env.TELEGRAM_ALERTS_BOT_TOKEN : process.env.TELEGRAM_BOT_TOKEN

  const effectiveChatId = chatId ?? process.env.TELEGRAM_CHAT_ID

  if (!token) {
    const varName = bot === 'alerts' ? 'TELEGRAM_ALERTS_BOT_TOKEN' : 'TELEGRAM_BOT_TOKEN'
    return { ok: false, error: `${varName} is not set` }
  }
  if (!effectiveChatId) {
    return { ok: false, error: 'TELEGRAM_CHAT_ID is not set' }
  }

  const payload: Record<string, unknown> = {
    chat_id: effectiveChatId,
    text: message,
  }
  if (parseMode) payload.parse_mode = parseMode
  if (replyMarkup) payload.reply_markup = replyMarkup

  const result = await httpRequest({
    url: `https://api.telegram.org/bot${token}/sendMessage`,
    method: 'POST',
    capability: 'net.outbound.telegram',
    agentId,
    body: payload,
  })

  if (!result.ok) {
    return { ok: false, error: result.error ?? `Telegram API error ${result.status}` }
  }

  try {
    const parsed = JSON.parse(result.body) as {
      ok: boolean
      result?: { message_id: number }
    }
    return { ok: parsed.ok, messageId: parsed.result?.message_id }
  } catch {
    return { ok: result.ok }
  }
}

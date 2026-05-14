import { getSecret } from '@/lib/security/secrets'
import { httpRequest } from '@/lib/harness/arms-legs/http'
import { postSms } from './sms'

export class MissingTelegramConfigError extends Error {
  override readonly name = 'MissingTelegramConfigError'
  constructor() {
    super('TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID env var is not set')
  }
}

/**
 * Broadcasts a message to Colin via Telegram and SMS (if configured).
 */
export async function postMessage(text: string): Promise<void> {
  // 1. Telegram (Primary)
  const token = await getSecret('TELEGRAM_BOT_TOKEN', { agentId: 'system' }).catch(
    () => process.env.TELEGRAM_BOT_TOKEN
  )
  const chatId = process.env.TELEGRAM_CHAT_ID

  if (token && chatId) {
    const url = `https://api.telegram.org/bot${token}/sendMessage`
    await httpRequest({
      url,
      method: 'POST',
      capability: 'net.outbound.telegram',
      agentId: 'orchestrator',
      body: { chat_id: chatId, text },
    }).catch((err) => console.error(`Telegram post failed: ${err}`))
  }

  // 2. SMS (Backup/Direct)
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_TO_NUMBER) {
    await postSms(text).catch((err) => console.error(`SMS broadcast failed: ${err}`))
  }

  if (!token && !process.env.TWILIO_ACCOUNT_SID) {
    throw new MissingTelegramConfigError()
  }
}

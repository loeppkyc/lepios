import { getSecret } from '@/lib/security/secrets'
import { httpRequest } from '@/lib/harness/arms-legs/http'

export class MissingTelegramConfigError extends Error {
  override readonly name = 'MissingTelegramConfigError'
  constructor() {
    super('TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID env var is not set')
  }
}

export async function postMessage(text: string): Promise<void> {
  // getSecret provides capability audit trail; falls back to process.env on DB unavailability
  const token = await getSecret('TELEGRAM_BOT_TOKEN', { agentId: 'system' }).catch(
    () => process.env.TELEGRAM_BOT_TOKEN
  )
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) throw new MissingTelegramConfigError()

  const url = `https://api.telegram.org/bot${token}/sendMessage`
  const result = await httpRequest({
    url,
    method: 'POST',
    capability: 'net.outbound.telegram',
    agentId: 'orchestrator',
    body: { chat_id: chatId, text },
  })
  if (!result.ok) {
    throw new Error(`Telegram API error ${result.status}: ${result.body}`)
  }
}

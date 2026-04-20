export class MissingTelegramConfigError extends Error {
  override readonly name = 'MissingTelegramConfigError'
  constructor() {
    super('TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID env var is not set')
  }
}

export async function postMessage(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) throw new MissingTelegramConfigError()

  const url = `https://api.telegram.org/bot${token}/sendMessage`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Telegram API error ${res.status}: ${body}`)
  }
}

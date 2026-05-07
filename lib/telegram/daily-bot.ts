// Telegram daily-bot client (loeppky_daily_bot).
//
// Token lives in Supabase Vault under name 'telegram_bot_token_daily'. Reading
// uses vault.decrypted_secrets (service_role only). Falls back to env
// TELEGRAM_BOT_TOKEN if vault read fails — bootstrap path so we don't break
// before the manual Vault-secret-creation step lands.

import { createServiceClient } from '@/lib/supabase/service'

type Db = ReturnType<typeof createServiceClient>

const VAULT_SECRET_NAME = 'telegram_bot_token_daily'
const TG_API_BASE = 'https://api.telegram.org/bot'

let cachedToken: { token: string; expiresAt: number } | null = null
const TOKEN_CACHE_MS = 5 * 60 * 1000 // 5 minutes — long enough to amortize
// a scan, short enough to pick up rotations.

async function readTokenFromVault(db: Db): Promise<string | null> {
  try {
    const { data, error } = await db
      .schema('vault' as never)
      .from('decrypted_secrets')
      .select('decrypted_secret')
      .eq('name', VAULT_SECRET_NAME)
      .maybeSingle<{ decrypted_secret: string }>()
    if (error || !data) return null
    return data.decrypted_secret
  } catch {
    return null
  }
}

async function getDailyBotToken(): Promise<string | null> {
  const now = Date.now()
  if (cachedToken && cachedToken.expiresAt > now) return cachedToken.token
  const db = createServiceClient()
  const fromVault = await readTokenFromVault(db)
  const token = fromVault ?? process.env.TELEGRAM_BOT_TOKEN ?? null
  if (!token) return null
  cachedToken = { token, expiresAt: now + TOKEN_CACHE_MS }
  return token
}

async function getChatId(db: Db): Promise<string | null> {
  const { data } = await db
    .from('harness_config')
    .select('value')
    .eq('key', 'TELEGRAM_CHAT_ID')
    .maybeSingle<{ value: string }>()
  return data?.value ?? null
}

export interface DailyBotResult {
  ok: boolean
  messageId?: number
  error?: string
}

/**
 * Send a Telegram message via loeppky_daily_bot. Returns the message_id on
 * success (used for the night_watchman_incidents.telegram_message_ids audit
 * trail).
 *
 * NEVER logs the token. Errors describe what failed without leaking the token.
 */
export async function sendDailyBot(
  text: string,
  parseMode?: 'Markdown' | 'HTML'
): Promise<DailyBotResult> {
  const token = await getDailyBotToken()
  if (!token) {
    return {
      ok: false,
      error:
        'daily-bot token not configured (vault.secrets.telegram_bot_token_daily missing and TELEGRAM_BOT_TOKEN env empty)',
    }
  }
  const db = createServiceClient()
  const chatId = await getChatId(db)
  if (!chatId) {
    return { ok: false, error: 'TELEGRAM_CHAT_ID not in harness_config' }
  }
  try {
    const res = await fetch(`${TG_API_BASE}${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      }),
    })
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      result?: { message_id?: number }
      description?: string
    }
    if (!res.ok || !json.ok) {
      return { ok: false, error: json.description ?? `HTTP ${res.status}` }
    }
    return { ok: true, messageId: json.result?.message_id }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/** Reset cached token — for tests + after manual rotation. */
export function _clearDailyBotTokenCacheForTests(): void {
  cachedToken = null
}

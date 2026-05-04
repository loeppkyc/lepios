/**
 * sendTelegramMessage — chat_ui Slice 4 action tool.
 *
 * Queues a Telegram message via outbound_notifications drain.
 * Approval-gated: call with dryRun: true (default) to preview,
 * then dryRun: false after Colin confirms in the conversation.
 */

import { z } from 'zod'
import type { ChatTool } from './registry'
import { createServiceClient } from '@/lib/supabase/service'

type Input = { text: string; dryRun?: boolean }
type Output = { sent: boolean; preview: string; notification_id?: string }

async function readTelegramChatId(): Promise<string | null> {
  try {
    const db = createServiceClient()
    const { data, error } = await db
      .from('harness_config')
      .select('value')
      .eq('key', 'TELEGRAM_CHAT_ID')
      .maybeSingle()
    if (error || !data) return null
    return data.value ?? null
  } catch {
    return null
  }
}

export const sendTelegramTool: ChatTool<Input, Output> = {
  name: 'sendTelegramMessage',
  description:
    "Sends a message to Colin via Telegram (loeppky_daily_bot). " +
    "ALWAYS call with dryRun: true first — show the preview text to Colin and get his " +
    "explicit confirmation in the conversation before calling with dryRun: false.",
  parameters: z.object({
    text: z.string().min(1).max(4096).describe('Message text to send'),
    dryRun: z
      .boolean()
      .optional()
      .default(true)
      .describe('true = preview only (default); false = actually send'),
  }),
  capability: 'tool.chat_ui.action.telegram',
  execute: async ({ text, dryRun }) => {
    if (dryRun !== false) {
      return { sent: false, preview: text }
    }
    const chatId = await readTelegramChatId()
    const db = createServiceClient()
    const { data, error } = await db
      .from('outbound_notifications')
      .insert({
        channel: 'telegram',
        payload: { text },
        correlation_id: `chat_ui-${Date.now()}`,
        requires_response: false,
        ...(chatId ? { chat_id: chatId } : {}),
      })
      .select('id')
      .single()
    if (error) throw new Error(`Failed to queue notification: ${error.message}`)
    return { sent: true, preview: text, notification_id: data.id }
  },
}

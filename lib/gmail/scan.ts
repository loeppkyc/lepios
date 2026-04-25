import type { gmail_v1 } from 'googleapis'
import type { SupabaseClient } from '@supabase/supabase-js'
import { KNOWN_INVOICE_SENDERS, KNOWN_INLINE_SENDERS } from './senders'

export interface GmailMessage {
  messageId: string
  fromAddress: string
  subject: string
  sentAt: Date | null
  hasAttachment: boolean
}

/**
 * Two-pass Gmail scan for invoice/receipt/statement-related messages.
 *
 * Pass 1: keyword query on subject line
 * Pass 2: known-sender query (FROM known domains — catches messages without keywords)
 *
 * Deduplicates by messageId across both passes.
 * Returns a flat array of GmailMessage — no DB writes.
 */
export async function scanMessages(
  service: gmail_v1.Gmail,
  afterDate: Date,
  maxResults = 500
): Promise<GmailMessage[]> {
  // Format date as YYYY/MM/DD for Gmail query syntax
  const y = afterDate.getUTCFullYear()
  const m = String(afterDate.getUTCMonth() + 1).padStart(2, '0')
  const d = String(afterDate.getUTCDate()).padStart(2, '0')
  const dateStr = `${y}/${m}/${d}`

  const allKnownSenders = [...KNOWN_INVOICE_SENDERS, ...KNOWN_INLINE_SENDERS]
  const fromClause = allKnownSenders.map((s) => `from:${s}`).join(' OR ')

  const queries = [
    `after:${dateStr} subject:(invoice OR receipt OR bill OR statement OR confirmation OR order)`,
    `after:${dateStr} (${fromClause})`,
  ]

  const seen = new Set<string>()
  const results: GmailMessage[] = []

  for (const query of queries) {
    let pageToken: string | undefined = undefined

    do {
      const resp: { data: gmail_v1.Schema$ListMessagesResponse } = await service.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 100,
        pageToken,
      })

      const messages = resp.data.messages ?? []
      for (const stub of messages) {
        if (results.length >= maxResults) break
        if (!stub.id || seen.has(stub.id)) continue
        seen.add(stub.id)

        try {
          const full = await service.users.messages.get({
            userId: 'me',
            id: stub.id,
            format: 'metadata',
            metadataHeaders: ['From', 'Subject', 'Date'],
          })

          const headers: Record<string, string> = {}
          for (const h of full.data.payload?.headers ?? []) {
            if (h.name && h.value) headers[h.name] = h.value
          }

          const fromAddress = headers['From'] ?? ''
          const subject = headers['Subject'] ?? ''
          const dateHeader = headers['Date']
          const sentAt = dateHeader ? new Date(dateHeader) : null

          // Detect attachment presence via labelIds or parts
          const hasAttachment =
            (full.data.payload?.mimeType ?? '').includes('multipart') &&
            (full.data.payload?.parts ?? []).some((p) => p.filename && p.filename.length > 0)

          results.push({
            messageId: stub.id,
            fromAddress,
            subject,
            sentAt: sentAt && !isNaN(sentAt.getTime()) ? sentAt : null,
            hasAttachment,
          })
        } catch {
          // Skip individual message fetch errors — continue scan
          continue
        }
      }

      pageToken = resp.data.nextPageToken ?? undefined
    } while (pageToken && results.length < maxResults)
  }

  return results
}

/**
 * Returns only messages whose messageId is NOT already in gmail_messages.
 * This is the dedup gate — prevents re-processing on subsequent cron runs.
 */
export async function filterNewMessages(
  messages: GmailMessage[],
  db: SupabaseClient
): Promise<GmailMessage[]> {
  if (messages.length === 0) return []

  const messageIds = messages.map((m) => m.messageId)

  const { data, error } = await db
    .from('gmail_messages')
    .select('message_id')
    .in('message_id', messageIds)

  if (error) {
    // On error, treat all as new to avoid silent data loss
    return messages
  }

  const existingIds = new Set((data ?? []).map((r: { message_id: string }) => r.message_id))
  return messages.filter((m) => !existingIds.has(m.messageId))
}

/**
 * Batch inserts messages into gmail_messages.
 * onConflict: message_id → ignore (idempotent, safe to re-run).
 */
export async function insertMessages(messages: GmailMessage[], db: SupabaseClient): Promise<void> {
  if (messages.length === 0) return

  const rows = messages.map((m) => ({
    message_id: m.messageId,
    from_address: m.fromAddress,
    subject: m.subject,
    sent_at: m.sentAt ? m.sentAt.toISOString() : null,
    has_attachment: m.hasAttachment,
    scan_labels: [],
  }))

  await db.from('gmail_messages').upsert(rows, { onConflict: 'message_id', ignoreDuplicates: true })
}

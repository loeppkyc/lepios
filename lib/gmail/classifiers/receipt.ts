import type { gmail_v1 } from 'googleapis'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { GmailMessage } from '../scan'
import type { KnownSender } from './types'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReceiptClassificationResult {
  message_id: string
  confidence: 'high' | 'medium'
  vendor_hint: string | null
  /** First 200 chars of body — for quick display without loading body_text */
  body_preview: string | null
  /** Up to 4000 chars — cached so extraction phase never re-fetches Gmail */
  body_text: string | null
  classified_at: Date
}

// ── Constants ─────────────────────────────────────────────────────────────────

const RECEIPT_SUBJECT_RE =
  /receipt|ereceipt|purchase|payment|transaction|confirmation|invoice|order|summary/i
const PROMO_SUBJECT_RE = /offer|promo|coupon|newsletter|savings/i
// Amazon seller disbursement — income, not expense; skip regardless of trust level
const AMAZON_INCOME_RE = /your payment is on the way|amazon payment notification/i

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractDomain(fromAddress: string): string {
  const match = fromAddress.match(/@([^>\s]+)/)
  return match ? match[1].toLowerCase() : fromAddress.toLowerCase()
}

function extractVendorHint(fromAddress: string): string | null {
  const nameMatch = fromAddress.match(/^([^<]+)</)
  if (nameMatch) {
    const name = nameMatch[1].trim().replace(/^["']|["']$/g, '')
    return name || null
  }
  const emailMatch = fromAddress.match(/^([^@]+)@/)
  return emailMatch ? emailMatch[1] : null
}

function htmlToText(html: string): string {
  let text = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
  text = text.replace(/<[^>]+>/g, ' ')
  return text.replace(/\s+/g, ' ').trim()
}

// Ports Streamlit's _extract_body_text: prefers text/plain, falls back to HTML.
export function extractBodyText(payload: gmail_v1.Schema$MessagePart): string {
  const mimeType = payload.mimeType ?? ''
  const bodyData = payload.body?.data ?? ''

  if (mimeType === 'text/plain' && bodyData) {
    return Buffer.from(bodyData, 'base64url').toString('utf-8')
  }

  if (mimeType === 'text/html' && bodyData) {
    return htmlToText(Buffer.from(bodyData, 'base64url').toString('utf-8'))
  }

  const parts = payload.parts ?? []
  let plain = ''
  let htmlFallback = ''

  for (const part of parts) {
    const subMime = part.mimeType ?? ''
    const subData = part.body?.data ?? ''

    if (subMime === 'text/plain' && subData) {
      plain += Buffer.from(subData, 'base64url').toString('utf-8')
    } else if (subMime === 'text/html' && subData && !plain) {
      htmlFallback = htmlToText(Buffer.from(subData, 'base64url').toString('utf-8'))
    } else if (subMime.startsWith('multipart/')) {
      plain += extractBodyText(part)
    }
  }

  return plain || htmlFallback
}

// ── Classifier ────────────────────────────────────────────────────────────────

/**
 * Classifies a single message as an inline receipt (or null if not a receipt).
 *
 * Confidence mapping (F19 upgrade over Streamlit — Streamlit had no confidence):
 *   high   — sender in gmail_known_senders with trust_level='trusted'
 *   medium — sender trust_level='review' OR not in known_senders but keyword match
 *   null   — trust_level='ignore', promo subject, Amazon income email, body < 100 chars
 *
 * Re-fetches format='full' only for messages that pass the first-pass filter.
 * body_text cached up to 4000 chars so extraction phase never re-fetches.
 */
export async function classifyReceipt(
  message: GmailMessage,
  service: gmail_v1.Gmail,
  knownSenders: Map<string, KnownSender>
): Promise<ReceiptClassificationResult | null> {
  const domain = extractDomain(message.fromAddress)
  const sender = knownSenders.get(message.fromAddress.toLowerCase()) ?? knownSenders.get(domain)

  if (sender?.trust_level === 'ignore') return null

  const fromLower = message.fromAddress.toLowerCase()
  const subjectLower = message.subject.toLowerCase()

  // Skip Amazon seller disbursement regardless of sender trust level
  if (
    (fromLower.includes('amazon.ca') || fromLower.includes('amazon.com')) &&
    AMAZON_INCOME_RE.test(subjectLower)
  ) {
    return null
  }

  // Skip promotional emails
  if (PROMO_SUBJECT_RE.test(subjectLower)) return null

  const isKnownInlineSender = sender?.sender_type === 'inline_receipt'
  const hasReceiptKeyword = RECEIPT_SUBJECT_RE.test(subjectLower)

  // First-pass: must be a known inline sender OR have a receipt keyword
  if (!isKnownInlineSender && !hasReceiptKeyword) return null

  // Re-fetch full message to extract body text
  let fullPayload: gmail_v1.Schema$MessagePart
  try {
    const resp = await service.users.messages.get({
      userId: 'me',
      id: message.messageId,
      format: 'full',
    })
    fullPayload = resp.data.payload ?? {}
  } catch {
    return null
  }

  const body = extractBodyText(fullPayload)

  // Body too short to be a real receipt (Streamlit rule: < 100 chars)
  if (body.trim().length < 100) return null

  const confidence: 'high' | 'medium' = sender?.trust_level === 'trusted' ? 'high' : 'medium'
  const bodyText = body.slice(0, 4000)

  return {
    message_id: message.messageId,
    confidence,
    vendor_hint: extractVendorHint(message.fromAddress),
    body_preview: bodyText.slice(0, 200) || null,
    body_text: bodyText || null,
    classified_at: new Date(),
  }
}

// ── Persist ───────────────────────────────────────────────────────────────────

/**
 * Batch upserts receipt classification records into gmail_receipt_classifications.
 * Appends 'inline_receipt' to scan_labels on each processed message (idempotent).
 */
export async function insertReceiptClassifications(
  results: ReceiptClassificationResult[],
  db: SupabaseClient
): Promise<void> {
  if (results.length === 0) return

  const rows = results.map((r) => ({
    message_id: r.message_id,
    confidence: r.confidence,
    vendor_hint: r.vendor_hint,
    body_preview: r.body_preview,
    body_text: r.body_text,
    classified_at: r.classified_at.toISOString(),
  }))

  await db
    .from('gmail_receipt_classifications')
    .upsert(rows, { onConflict: 'message_id', ignoreDuplicates: true })

  await db.rpc('append_scan_labels_batch', {
    p_message_ids: results.map((r) => r.message_id),
    p_label: 'inline_receipt',
  })
}

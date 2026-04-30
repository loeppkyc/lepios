import type { gmail_v1 } from 'googleapis'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { GmailMessage } from '../scan'
import type { KnownSender } from './types'

export type { KnownSender }

// ── Types ─────────────────────────────────────────────────────────────────────

export interface InvoiceClassificationResult {
  message_id: string
  confidence: 'high' | 'medium' | 'low'
  attachment_name: string | null
  vendor_hint: string | null
  classified_at: Date
}

// ── Constants ─────────────────────────────────────────────────────────────────

const INVOICE_SUBJECT_RE = /invoice|receipt|bill|folio|statement|confirmation|order/i

// ── Helpers ───────────────────────────────────────────────────────────────────

export function extractDomain(fromAddress: string): string {
  const match = fromAddress.match(/@([^>\s]+)/)
  return match ? match[1].toLowerCase() : fromAddress.toLowerCase()
}

export function extractVendorHint(fromAddress: string): string | null {
  const nameMatch = fromAddress.match(/^([^<]+)</)
  if (nameMatch) {
    const name = nameMatch[1].trim().replace(/^["']|["']$/g, '')
    return name || null
  }
  const emailMatch = fromAddress.match(/^([^@]+)@/)
  return emailMatch ? emailMatch[1] : null
}

// Junk filter: returns true if the attachment should be skipped.
// Ports Streamlit's scan_invoices junk logic verbatim.
export function isJunkAttachment(filename: string, size: number): boolean {
  const fl = filename.toLowerCase()
  if (/^(outlook-|image0|logo)/.test(fl)) return true
  if (/^(screenshot|whatsapp|gmail_-_|gmail -)/.test(fl)) return true
  // Generic image filenames (image001.png, image.png) — likely inline signature
  if (/^image.*\.(png|jpg|jpeg)$/.test(fl)) return true
  // Tiny images under 5 KB — likely signature logo
  if (size > 0 && size < 5000 && /\.(png|jpg|jpeg)$/.test(fl)) return true
  return false
}

function isDocumentAttachment(filename: string, size: number): boolean {
  return /\.(pdf|jpg|jpeg|png)$/i.test(filename) && !isJunkAttachment(filename, size)
}

// Walk MIME parts recursively (matches Streamlit's _get_parts generator).
function* walkParts(
  payload: gmail_v1.Schema$MessagePart
): Generator<{ filename: string; size: number }> {
  for (const part of payload.parts ?? []) {
    if (part.filename && part.filename.length > 0) {
      yield { filename: part.filename, size: part.body?.size ?? 0 }
    }
    if (part.parts) yield* walkParts(part)
  }
}

// ── Classifier ────────────────────────────────────────────────────────────────

/**
 * Classifies a single message as an invoice (or null if not an invoice).
 *
 * Confidence mapping (F19 upgrade over Streamlit — Streamlit had no confidence):
 *   high   — sender in gmail_known_senders with trust_level='trusted'
 *   medium — sender in gmail_known_senders with trust_level='review'
 *   low    — sender not in gmail_known_senders, matched via subject keyword only
 *   null   — sender trust_level='ignore', or no attachment, or all attachments are junk
 *
 * Re-fetches format='full' only for messages that pass the first-pass filter
 * (has_attachment=true AND known-sender OR keyword match). Keeps bulk scan fast.
 */
export async function classifyInvoice(
  message: GmailMessage,
  service: gmail_v1.Gmail,
  knownSenders: Map<string, KnownSender>
): Promise<InvoiceClassificationResult | null> {
  if (!message.hasAttachment) return null

  const domain = extractDomain(message.fromAddress)
  const sender = knownSenders.get(message.fromAddress.toLowerCase()) ?? knownSenders.get(domain)

  if (sender?.trust_level === 'ignore') return null

  const hasKeyword = INVOICE_SUBJECT_RE.test(message.subject)
  const isKnownSender = sender !== undefined

  // First-pass: skip if neither a known sender nor a keyword match
  if (!hasKeyword && !isKnownSender) return null

  // Re-fetch full message to walk MIME parts for attachment names
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

  // Find first valid document attachment after junk filter
  let attachmentName: string | null = null
  for (const { filename, size } of walkParts(fullPayload)) {
    if (isDocumentAttachment(filename, size)) {
      attachmentName = filename
      break
    }
  }

  if (!attachmentName) return null

  // Map trust_level → confidence
  let confidence: 'high' | 'medium' | 'low'
  if (sender?.trust_level === 'trusted') {
    confidence = 'high'
  } else if (sender?.trust_level === 'review') {
    confidence = 'medium'
  } else {
    confidence = 'low'
  }

  return {
    message_id: message.messageId,
    confidence,
    attachment_name: attachmentName,
    vendor_hint: extractVendorHint(message.fromAddress),
    classified_at: new Date(),
  }
}

// ── Persist ───────────────────────────────────────────────────────────────────

/**
 * Batch upserts invoice classification records into gmail_invoice_classifications.
 * Appends 'invoice' to scan_labels on each processed message (idempotent).
 */
export async function insertInvoiceClassifications(
  results: InvoiceClassificationResult[],
  db: SupabaseClient
): Promise<void> {
  if (results.length === 0) return

  const rows = results.map((r) => ({
    message_id: r.message_id,
    confidence: r.confidence,
    attachment_name: r.attachment_name,
    vendor_hint: r.vendor_hint,
    classified_at: r.classified_at.toISOString(),
  }))

  await db
    .from('gmail_invoice_classifications')
    .upsert(rows, { onConflict: 'message_id', ignoreDuplicates: true })

  await db.rpc('append_scan_labels_batch', {
    p_message_ids: results.map((r) => r.message_id),
    p_label: 'invoice',
  })
}

import type { SupabaseClient } from '@supabase/supabase-js'
import type { KnownSender } from './types'
import { extractDomain } from './invoice'

// ── Learning loop ─────────────────────────────────────────────────────────────
// Ports Streamlit's save_learned_sender() to LepiOS.
// Identifies sender domains from classification results that are NOT already
// in gmail_known_senders and upserts them with trust_level='review'.
//
// This closes the self-improving loop: new senders discovered via keyword scan
// are persisted so future scans can weight them with trust_level scoring.

export interface NewSenderDomain {
  email_address: string
  sender_type: 'invoice' | 'inline_receipt'
}

/**
 * Returns sender domains that appear in fromAddresses but are absent from knownSenders.
 * Deduplicates within the batch. Only returns domains with a '.' (filters garbage strings).
 */
export function collectNewSenderDomains(
  fromAddresses: string[],
  knownSenders: Map<string, KnownSender>,
  senderType: 'invoice' | 'inline_receipt'
): NewSenderDomain[] {
  const seen = new Set<string>()
  const result: NewSenderDomain[] = []

  for (const from of fromAddresses) {
    const domain = extractDomain(from)
    if (!domain.includes('.')) continue
    if (seen.has(domain)) continue
    seen.add(domain)

    // Only collect domains absent from the known-senders map
    if (!knownSenders.has(from.toLowerCase()) && !knownSenders.has(domain)) {
      result.push({ email_address: domain, sender_type: senderType })
    }
  }

  return result
}

/**
 * Upserts newly-discovered sender domains into gmail_known_senders.
 * Uses created_by='classifier' (added to CHECK constraint in migration 0055).
 * ignoreDuplicates: if domain already exists (e.g. added by a concurrent run), skip.
 */
export async function learnSenderDomains(
  newDomains: NewSenderDomain[],
  db: SupabaseClient
): Promise<void> {
  if (newDomains.length === 0) return

  const rows = newDomains.map((d) => ({
    email_address: d.email_address,
    sender_type: d.sender_type,
    trust_level: 'review',
    created_by: 'classifier',
  }))

  await db
    .from('gmail_known_senders')
    .upsert(rows, { onConflict: 'email_address', ignoreDuplicates: true })
}

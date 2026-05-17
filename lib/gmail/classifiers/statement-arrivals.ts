import type { SupabaseClient } from '@supabase/supabase-js'
import type { GmailMessage } from '../scan'

// ── Config types ──────────────────────────────────────────────────────────────

interface StatementArrivalAccount {
  account_name: string
  sender_domains: string[]
  subject_patterns: RegExp[]
}

export interface StatementArrivalResult {
  message_id: string // FK to gmail_messages.message_id
  account_name: string
  arrival_date: Date
  statement_period_start: Date | null // null in v1 — date extraction deferred
  statement_period_end: Date | null // null in v1 — date extraction deferred
  attachment_name: string | null // null in v1 — filename hydration deferred
  confidence: 'high' | 'medium'
}

// ── Real business accounts — confirmed from gmail_messages DB query 2026-05-17 ──
// Sender domains verified: alerts@td.com, TD.eStatementNoReplyAccount@td.com,
// AmericanExpress@welcome.americanexpress.com
const STATEMENT_ACCOUNTS: StatementArrivalAccount[] = [
  {
    account_name: 'TD Chequing',
    sender_domains: ['td.com'],
    subject_patterns: [
      /td bank.*online banking statement/i,
      /td bank.*statement.*available/i,
      /your td.*statement.*available/i,
      /td.*chequing.*statement/i,
    ],
  },
  {
    account_name: 'Amex Business',
    sender_domains: ['americanexpress.com', 'welcome.americanexpress.com'],
    subject_patterns: [
      /american express.*online statement/i,
      /your.*amex.*statement/i,
      /american express.*statement.*ready/i,
    ],
  },
  {
    account_name: 'Amex Bonvoy',
    sender_domains: ['americanexpress.com', 'welcome.americanexpress.com'],
    subject_patterns: [
      /bonvoy.*statement/i,
      /marriott.*statement/i,
      /amex.*bonvoy.*statement/i,
    ],
  },
  {
    account_name: 'TD Visa',
    sender_domains: ['td.com'],
    subject_patterns: [
      /td.*visa.*statement/i,
      /aeroplan.*visa.*statement/i,
      /td.*visa.*available/i,
    ],
  },
  {
    account_name: 'TD USD Chequing',
    sender_domains: ['td.com'],
    subject_patterns: [
      /td.*usd.*statement/i,
      /td.*us dollar.*statement/i,
      /td.*foreign.*statement/i,
    ],
  },
  // CIBC and Canadian Tire CC: no email statement notification detected in DB.
  // These accounts use manual overrides only (Colin marks cells via the UI).
]

// ── Exclusion list — known non-bank statement senders ──────────────────────────
const EXCLUDED_SENDERS = [
  'interactivebrokers.com', // IB daily activity statements
  'newton.co', // Newton crypto statements
  'aws.com', // AWS billing
  'invoicing@aws.com',
]

// ── Classifier ───────────────────────────────────────────────────────────────

/**
 * Classifies a single message as a statement arrival (or null if no match).
 *
 * Confidence rules:
 *   high   — FROM address contains a known sender_domain AND subject matches a pattern
 *   medium — subject matches a pattern but sender not in any STATEMENT_ACCOUNTS domain list
 *   null   — no match
 *
 * knownSenders: Set<string> of email_address values from gmail_known_senders
 * (used for confidence scoring only — all messages are classified, not filtered).
 */
export function classifyStatementArrival(
  message: GmailMessage,
  // knownSenders: used only for future confidence adjustments; not filtered on in v1
  _knownSenders: Set<string>
): StatementArrivalResult | null {
  const fromLower = message.fromAddress.toLowerCase()
  const subjectLower = message.subject.toLowerCase()

  // Exclude known non-bank statement senders before checking accounts
  if (EXCLUDED_SENDERS.some((s) => fromLower.includes(s.toLowerCase()))) return null

  for (const account of STATEMENT_ACCOUNTS) {
    const senderMatch = account.sender_domains.some((domain) =>
      fromLower.includes(domain.toLowerCase())
    )
    const subjectMatch = account.subject_patterns.some((pattern) => pattern.test(subjectLower))

    if (subjectMatch) {
      const confidence: 'high' | 'medium' = senderMatch ? 'high' : 'medium'
      const arrivalDate = message.sentAt ?? new Date()

      return {
        message_id: message.messageId,
        account_name: account.account_name,
        arrival_date: arrivalDate,
        statement_period_start: null,
        statement_period_end: null,
        attachment_name: null,
        confidence,
      }
    }
  }

  return null
}

// ── Insert + label update ─────────────────────────────────────────────────────

/**
 * Batch inserts statement arrival records into gmail_statement_arrivals.
 * onConflict: message_id → ignore (idempotent).
 *
 * After insert, updates gmail_messages.scan_labels to include 'statement_arrival'
 * for each processed message_id so downstream queries can filter by classifier.
 */
export async function insertStatementArrivals(
  results: StatementArrivalResult[],
  db: SupabaseClient
): Promise<void> {
  if (results.length === 0) return

  const rows = results.map((r) => ({
    message_id: r.message_id,
    account_name: r.account_name,
    arrival_date: r.arrival_date.toISOString().slice(0, 10), // date string YYYY-MM-DD
    statement_period_start: r.statement_period_start
      ? r.statement_period_start.toISOString().slice(0, 10)
      : null,
    statement_period_end: r.statement_period_end
      ? r.statement_period_end.toISOString().slice(0, 10)
      : null,
    attachment_name: r.attachment_name,
    confidence: r.confidence,
  }))

  await db
    .from('gmail_statement_arrivals')
    .upsert(rows, { onConflict: 'message_id', ignoreDuplicates: true })

  // Update scan_labels on each processed message to record classifier ran.
  // Uses append_scan_label RPC defined in migration 0022 to do array_append safely.
  const messageIds = results.map((r) => r.message_id)
  await db.rpc('append_scan_labels_batch', {
    p_message_ids: messageIds,
    p_label: 'statement_arrival',
  })
}

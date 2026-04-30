// Shared types for Gmail classifier modules.
// Imported by invoice.ts, receipt.ts, and learn-senders.ts.

export interface KnownSender {
  trust_level: 'trusted' | 'review' | 'ignore'
  sender_type: string
}

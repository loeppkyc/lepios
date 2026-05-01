/**
 * Dry-run: classifies last 30 days of Gmail without writing to DB.
 * Outputs counts + 10 sample invoices + 10 sample receipts for spot-check.
 *
 * Usage:
 *   npx tsx scripts/classify-dryrun.ts
 *
 * Requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 * and NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
 */
import 'dotenv/config'
import { createGmailService } from '../lib/gmail/client'
import { scanMessages } from '../lib/gmail/scan'
import { classifyInvoice, type InvoiceClassificationResult } from '../lib/gmail/classifiers/invoice'
import { classifyReceipt, type ReceiptClassificationResult } from '../lib/gmail/classifiers/receipt'
import type { KnownSender } from '../lib/gmail/classifiers/types'
import { createClient } from '@supabase/supabase-js'
import type { GmailMessage } from '../lib/gmail/scan'

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? ''
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }

  const db = createClient(supabaseUrl, supabaseKey)

  console.log('Authenticating Gmail...')
  const service = await createGmailService()

  // Last 30 days
  const afterDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  console.log(`Scanning from ${afterDate.toISOString().slice(0, 10)}...`)

  const rawMessages = await scanMessages(service, afterDate, 500)
  console.log(`Scanned: ${rawMessages.length} messages`)

  // Load known senders from DB
  const { data: knownSenderRows } = await db
    .from('gmail_known_senders')
    .select('email_address, trust_level, sender_type')

  const knownSendersMap = new Map<string, KnownSender>(
    (knownSenderRows ?? []).map(
      (r: { email_address: string; trust_level: string; sender_type: string }) => [
        r.email_address.toLowerCase(),
        {
          trust_level: r.trust_level as 'trusted' | 'review' | 'ignore',
          sender_type: r.sender_type,
        },
      ]
    )
  )
  console.log(`Known senders loaded: ${knownSendersMap.size}`)

  // Run classifiers (no DB writes)
  const invoiceResults: Array<
    InvoiceClassificationResult & { fromAddress: string; subject: string }
  > = []
  const receiptResults: Array<
    ReceiptClassificationResult & { fromAddress: string; subject: string }
  > = []
  let skippedCount = 0

  for (const msg of rawMessages) {
    const [invoice, receipt] = await Promise.allSettled([
      classifyInvoice(msg, service, knownSendersMap),
      classifyReceipt(msg, service, knownSendersMap),
    ])

    let classified = false
    if (invoice.status === 'fulfilled' && invoice.value) {
      invoiceResults.push({ ...invoice.value, fromAddress: msg.fromAddress, subject: msg.subject })
      classified = true
    }
    if (receipt.status === 'fulfilled' && receipt.value) {
      receiptResults.push({ ...receipt.value, fromAddress: msg.fromAddress, subject: msg.subject })
      classified = true
    }
    if (!classified) skippedCount++
  }

  // Count by confidence
  const invoiceCounts = { high: 0, medium: 0, low: 0 }
  for (const r of invoiceResults) invoiceCounts[r.confidence]++
  const receiptCounts = { high: 0, medium: 0 }
  for (const r of receiptResults) {
    if (r.confidence === 'high') receiptCounts.high++
    else receiptCounts.medium++
  }

  console.log('\n═══ CLASSIFICATION COUNTS ═══')
  console.log(
    `Invoices:  high=${invoiceCounts.high}  medium=${invoiceCounts.medium}  low=${invoiceCounts.low}  total=${invoiceResults.length}`
  )
  console.log(
    `Receipts:  high=${receiptCounts.high}  medium=${receiptCounts.medium}  total=${receiptResults.length}`
  )
  console.log(`Unclassified (skipped): ${skippedCount}`)

  // Spot-check samples
  function sample<T>(arr: T[], n: number): T[] {
    if (arr.length <= n) return arr
    const shuffled = [...arr].sort(() => Math.random() - 0.5)
    return shuffled.slice(0, n)
  }

  const invoiceSample = sample(invoiceResults, 10)
  const receiptSample = sample(receiptResults, 10)

  console.log('\n═══ INVOICE SAMPLE (up to 10) ═══')
  for (const r of invoiceSample) {
    console.log(`[${r.confidence.toUpperCase()}] ${r.message_id}`)
    console.log(`  From:       ${r.fromAddress}`)
    console.log(`  Subject:    ${r.subject}`)
    console.log(`  Attachment: ${r.attachment_name}`)
    console.log(`  Vendor:     ${r.vendor_hint}`)
    console.log()
  }

  console.log('\n═══ RECEIPT SAMPLE (up to 10) ═══')
  for (const r of receiptSample) {
    console.log(`[${r.confidence.toUpperCase()}] ${r.message_id}`)
    console.log(`  From:    ${r.fromAddress}`)
    console.log(`  Subject: ${r.subject}`)
    console.log(`  Preview: ${r.body_preview?.slice(0, 120)}`)
    console.log(`  Vendor:  ${r.vendor_hint}`)
    console.log()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

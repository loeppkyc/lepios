import { NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/cron-secret'
import { createServiceClient } from '@/lib/supabase/service'
import { ocrReceipt } from '@/lib/receipts/ocr'
import { matchReceipt, AUTO_CONFIRM_THRESHOLD } from '@/lib/receipts/match'
import type { BankTransaction } from '@/lib/receipts/match'
import { google } from 'googleapis'

// ── POST /api/receipts/gmail-scan ─────────────────────────────────────────────
// Cron-triggered Gmail scan. Protected by CRON_SECRET (F22).
// Reads Gmail OAuth creds from harness_config (never process.env).
// Schedule: 0 9 * * * (9:00 AM UTC = 3:00 AM MDT) — daily.
//
// NOTE: This cron cannot be added to vercel.json — already at 18-cron Hobby limit.
// Trigger manually or via pg_cron. See handoff for details.

export async function POST(request: Request) {
  // F22 — MANDATORY: requireCronSecret must be first line of handler
  const authError = requireCronSecret(request)
  if (authError) return authError

  const supabase = createServiceClient()

  // ── Read Gmail OAuth credentials from harness_config (S-L1 pattern) ────────
  const { data: configRows, error: configErr } = await supabase
    .from('harness_config')
    .select('key, value')
    .in('key', ['gmail_client_id', 'gmail_client_secret', 'gmail_refresh_token', 'gmail_trusted_domains', 'gmail_skip_domains'])

  if (configErr) {
    return NextResponse.json({ error: `harness_config read failed: ${configErr.message}` }, { status: 500 })
  }

  const cfg: Record<string, string> = {}
  for (const row of configRows ?? []) {
    cfg[row.key] = row.value as string
  }

  if (!cfg.gmail_client_id || !cfg.gmail_client_secret || !cfg.gmail_refresh_token) {
    return NextResponse.json({ error: 'gmail_credentials_missing' }, { status: 500 })
  }

  const trustedDomains: string[] = cfg.gmail_trusted_domains
    ? (JSON.parse(cfg.gmail_trusted_domains) as string[])
    : ['amazon.com', 'amazon.ca', 'costco.ca', 'canadiantire.ca', 'staples.ca']

  const skipDomains: string[] = cfg.gmail_skip_domains
    ? (JSON.parse(cfg.gmail_skip_domains) as string[])
    : ['.gov', '.gov.ca']

  // ── Initialize Gmail client ──────────────────────────────────────────────
  const oauth2Client = new google.auth.OAuth2(
    cfg.gmail_client_id,
    cfg.gmail_client_secret,
  )
  oauth2Client.setCredentials({ refresh_token: cfg.gmail_refresh_token })

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

  // Query: receipts/invoices from the last 24h
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const afterDate = yesterday.toISOString().slice(0, 10).replace(/-/g, '/')

  let messageIds: string[] = []
  try {
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: `after:${afterDate} has:attachment (invoice OR receipt OR statement OR order)`,
      maxResults: 50,
    })
    messageIds = (listRes.data.messages ?? []).map((m) => m.id!).filter(Boolean)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: `Gmail API error: ${msg}` }, { status: 502 })
  }

  const stats = { scanned: messageIds.length, imported: 0, skipped: 0, errors: 0 }

  // ── Load recent transactions for matching ────────────────────────────────
  // bank_transactions table may not exist — gracefully skip if absent
  let transactions: BankTransaction[] = []
  try {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const { data: txnData } = await supabase
      .from('bank_transactions')
      .select('id, date, description, amount')
      .gte('date', thirtyDaysAgo.toISOString().slice(0, 10))
      .limit(500)
    transactions = (txnData ?? []) as BankTransaction[]
  } catch {
    // bank_transactions not yet available — skip matching
  }

  // ── Process each message ─────────────────────────────────────────────────
  for (const messageId of messageIds) {
    try {
      // Dedup: skip if already imported
      const { data: existing } = await supabase
        .from('receipt_lines')
        .select('id')
        .eq('source_email_id', messageId)
        .maybeSingle()

      if (existing) { stats.skipped++; continue }

      // Fetch message details
      const msgRes = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      })
      const message = msgRes.data

      // Determine sender domain for trust level
      const fromHeader = (message.payload?.headers ?? []).find((h) => h.name === 'From')
      const fromValue = fromHeader?.value ?? ''
      const domainMatch = fromValue.match(/@([a-z0-9.-]+)/i)
      const senderDomain = domainMatch ? domainMatch[1].toLowerCase() : ''

      const isSkip = skipDomains.some((d) => senderDomain.endsWith(d))
      if (isSkip) { stats.skipped++; continue }

      const isTrusted = trustedDomains.some((d) => senderDomain.endsWith(d))

      // Find first PDF or image attachment
      type GmailPart = {
        mimeType?: string
        body?: { attachmentId?: string; size?: number }
        parts?: GmailPart[]
      }

      function findAttachment(parts: GmailPart[] | undefined): { attachmentId: string; mimeType: string } | null {
        if (!parts) return null
        const SUPPORTED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
        // Prefer PDF
        for (const part of parts) {
          if (part.mimeType === 'application/pdf' && part.body?.attachmentId) {
            return { attachmentId: part.body.attachmentId, mimeType: 'application/pdf' }
          }
        }
        // Fall back to image
        for (const part of parts) {
          if (SUPPORTED.includes(part.mimeType ?? '') && part.body?.attachmentId) {
            return { attachmentId: part.body.attachmentId, mimeType: part.mimeType! }
          }
          // Recurse into nested parts
          const nested = findAttachment(part.parts)
          if (nested) return nested
        }
        return null
      }

      const attachment = findAttachment(message.payload?.parts as GmailPart[])
      if (!attachment) { stats.skipped++; continue }

      // Download attachment
      const attRes = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: attachment.attachmentId,
      })
      const attData = attRes.data.data
      if (!attData) { stats.skipped++; continue }

      // Gmail uses URL-safe base64; convert to standard
      const buffer = Buffer.from(attData.replace(/-/g, '+').replace(/_/g, '/'), 'base64')

      // Run OCR
      const ocr = await ocrReceipt(buffer, attachment.mimeType)

      // Insert receipt_lines row
      const receiptDate = ocr.date ?? new Date().toISOString().slice(0, 10)
      const { data: inserted, error: insertErr } = await supabase
        .from('receipt_lines')
        .insert({
          receipt_date: receiptDate,
          vendor: ocr.vendor,
          pre_tax: ocr.pre_tax ?? null,
          tax: ocr.tax ?? null,
          total: ocr.total,
          category: ocr.category ?? null,
          line_items: ocr.line_items,
          source: 'gmail',
          source_email_id: messageId,
          ocr_model: ocr.ocr_model,
          ocr_raw: null,
          reconciled: false,
          notes: isTrusted ? null : 'Unverified sender — please review',
        })
        .select('id')
        .single()

      if (insertErr || !inserted) {
        stats.errors++
        continue
      }

      // Run match pipeline
      if (transactions.length > 0) {
        const receiptForMatch = {
          id: inserted.id as string,
          receipt_date: receiptDate,
          vendor: ocr.vendor,
          total: ocr.total,
        }
        const candidates = matchReceipt(receiptForMatch, transactions)
        const best = candidates[0]

        if (best && best.match_confidence >= AUTO_CONFIRM_THRESHOLD) {
          await supabase.from('receipt_matches').insert({
            receipt_id: inserted.id,
            transaction_id: best.transaction_id,
            match_confidence: best.match_confidence,
            auto_confirmed: true,
            confirmed_at: new Date().toISOString(),
            confirmed_by: 'system',
          })
          await supabase
            .from('receipt_lines')
            .update({ reconciled: true })
            .eq('id', inserted.id)
        }
      }

      stats.imported++
    } catch (e: unknown) {
      stats.errors++
    }
  }

  // ── Log to agent_events (F18) ─────────────────────────────────────────────
  void supabase.from('agent_events').insert({
    domain: 'receipts',
    action: 'gmail_scan',
    status: stats.errors > 0 ? 'partial' : 'success',
    meta: stats,
  })

  return NextResponse.json(stats)
}

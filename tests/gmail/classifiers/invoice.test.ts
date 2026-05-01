import { describe, it, expect, vi } from 'vitest'
import type { gmail_v1 } from 'googleapis'
import {
  classifyInvoice,
  isJunkAttachment,
  extractDomain,
  extractVendorHint,
  insertInvoiceClassifications,
} from '@/lib/gmail/classifiers/invoice'
import type { KnownSender } from '@/lib/gmail/classifiers/types'
import type { GmailMessage } from '@/lib/gmail/scan'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeMessage(overrides: Partial<GmailMessage> = {}): GmailMessage {
  return {
    messageId: 'msg-001',
    fromAddress: 'Amazon.ca <auto-confirm@amazon.ca>',
    subject: 'Invoice from Amazon.ca',
    sentAt: new Date('2026-04-01T10:00:00Z'),
    hasAttachment: true,
    ...overrides,
  }
}

function makeKnownSenders(
  entries: Array<[string, Partial<KnownSender>]>
): Map<string, KnownSender> {
  return new Map(
    entries.map(([domain, s]) => [
      domain,
      { trust_level: s.trust_level ?? 'trusted', sender_type: s.sender_type ?? 'invoice' },
    ])
  )
}

function makePDFPayload(
  files: Array<{ filename: string; size?: number; mimeType?: string }>
): gmail_v1.Schema$MessagePart {
  return {
    mimeType: 'multipart/mixed',
    parts: [
      { mimeType: 'text/plain', body: { data: Buffer.from('Order details').toString('base64') } },
      ...files.map((f) => ({
        mimeType: f.mimeType ?? 'application/pdf',
        filename: f.filename,
        body: { size: f.size ?? 50000, attachmentId: 'attach-id' },
      })),
    ],
  }
}

function makeGmailService(payload: gmail_v1.Schema$MessagePart) {
  return {
    users: {
      messages: {
        get: vi.fn().mockResolvedValue({ data: { payload } }),
      },
    },
  } as unknown as gmail_v1.Gmail
}

// ── isJunkAttachment ───────────────────────────────────────────────────────────

describe('isJunkAttachment', () => {
  it('flags outlook- prefix', () => expect(isJunkAttachment('outlook-logo.png', 10000)).toBe(true))
  it('flags image0 prefix', () => expect(isJunkAttachment('image001.png', 10000)).toBe(true))
  it('flags logo prefix', () => expect(isJunkAttachment('logo.png', 10000)).toBe(true))
  it('flags screenshot prefix', () => expect(isJunkAttachment('screenshot.png', 10000)).toBe(true))
  it('flags tiny image under 5KB', () => expect(isJunkAttachment('photo.jpg', 4999)).toBe(true))
  it('allows PDF regardless of size', () =>
    expect(isJunkAttachment('invoice.pdf', 100)).toBe(false))
  it('allows large image', () => expect(isJunkAttachment('receipt.jpg', 50000)).toBe(false))
  it('flags image.png (generic image name)', () =>
    expect(isJunkAttachment('image.png', 10000)).toBe(true))
})

// ── extractDomain ─────────────────────────────────────────────────────────────

describe('extractDomain', () => {
  it('extracts domain from display name + email', () => {
    expect(extractDomain('Amazon.ca <auto-confirm@amazon.ca>')).toBe('amazon.ca')
  })
  it('extracts domain from bare email', () => {
    expect(extractDomain('noreply@td.com')).toBe('td.com')
  })
  it('returns lowercased domain as-is when no @', () => {
    expect(extractDomain('amazon.ca')).toBe('amazon.ca')
  })
})

// ── extractVendorHint ─────────────────────────────────────────────────────────

describe('extractVendorHint', () => {
  it('extracts display name before <', () => {
    expect(extractVendorHint('Amazon.ca <auto-confirm@amazon.ca>')).toBe('Amazon.ca')
  })
  it('extracts local part when no display name', () => {
    expect(extractVendorHint('noreply@td.com')).toBe('noreply')
  })
  it('strips surrounding quotes from display name', () => {
    expect(extractVendorHint('"TELUS Billing" <billing@telus.com>')).toBe('TELUS Billing')
  })
})

// ── classifyInvoice ───────────────────────────────────────────────────────────

describe('classifyInvoice — high confidence (trusted sender)', () => {
  it('returns high confidence for trusted sender with invoice keyword + PDF', async () => {
    const knownSenders = makeKnownSenders([['amazon.ca', { trust_level: 'trusted' }]])
    const service = makeGmailService(makePDFPayload([{ filename: 'invoice-2026.pdf' }]))

    const result = await classifyInvoice(makeMessage(), service, knownSenders)

    expect(result).not.toBeNull()
    expect(result!.confidence).toBe('high')
    expect(result!.attachment_name).toBe('invoice-2026.pdf')
    expect(result!.message_id).toBe('msg-001')
    expect(result!.vendor_hint).toBe('Amazon.ca')
  })

  it('returns high confidence for trusted sender even without invoice keyword in subject', async () => {
    const knownSenders = makeKnownSenders([['telus.com', { trust_level: 'trusted' }]])
    const service = makeGmailService(makePDFPayload([{ filename: 'telus-bill.pdf' }]))
    const msg = makeMessage({
      fromAddress: 'billing@telus.com',
      subject: 'Your TELUS Account',
    })

    const result = await classifyInvoice(msg, service, knownSenders)

    expect(result).not.toBeNull()
    expect(result!.confidence).toBe('high')
  })
})

describe('classifyInvoice — medium confidence (review sender)', () => {
  it('returns medium confidence for review-level sender with keyword + PDF', async () => {
    const knownSenders = makeKnownSenders([['newvendor.ca', { trust_level: 'review' }]])
    const service = makeGmailService(makePDFPayload([{ filename: 'receipt.pdf' }]))
    const msg = makeMessage({
      fromAddress: 'billing@newvendor.ca',
      subject: 'Your receipt',
    })

    const result = await classifyInvoice(msg, service, knownSenders)

    expect(result).not.toBeNull()
    expect(result!.confidence).toBe('medium')
  })
})

describe('classifyInvoice — low confidence (unknown sender, keyword-only)', () => {
  it('returns low confidence for unknown sender matched via subject keyword', async () => {
    const knownSenders = new Map<string, KnownSender>()
    const service = makeGmailService(makePDFPayload([{ filename: 'doc.pdf' }]))
    const msg = makeMessage({
      fromAddress: 'info@randomstore.com',
      subject: 'Invoice #1234',
    })

    const result = await classifyInvoice(msg, service, knownSenders)

    expect(result).not.toBeNull()
    expect(result!.confidence).toBe('low')
  })
})

describe('classifyInvoice — skip cases', () => {
  it('returns null for sender with trust_level=ignore', async () => {
    const knownSenders = makeKnownSenders([['spam.ca', { trust_level: 'ignore' }]])
    const service = makeGmailService(makePDFPayload([{ filename: 'invoice.pdf' }]))
    const msg = makeMessage({ fromAddress: 'noreply@spam.ca', subject: 'Invoice' })

    expect(await classifyInvoice(msg, service, knownSenders)).toBeNull()
  })

  it('returns null when hasAttachment=false', async () => {
    const knownSenders = makeKnownSenders([['amazon.ca', { trust_level: 'trusted' }]])
    const service = makeGmailService({ mimeType: 'text/plain', parts: [] })
    const msg = makeMessage({ hasAttachment: false })

    expect(await classifyInvoice(msg, service, knownSenders)).toBeNull()
  })

  it('returns null when no keyword and sender not in known list', async () => {
    const knownSenders = new Map<string, KnownSender>()
    const service = makeGmailService(makePDFPayload([{ filename: 'photo.pdf' }]))
    const msg = makeMessage({
      fromAddress: 'news@unknown.com',
      subject: 'Weekly newsletter',
    })

    expect(await classifyInvoice(msg, service, knownSenders)).toBeNull()
  })

  it('returns null when all attachments are junk (outlook logo)', async () => {
    const knownSenders = makeKnownSenders([['amazon.ca', { trust_level: 'trusted' }]])
    const junkPayload = makePDFPayload([
      { filename: 'outlook-logo.png', size: 10000 },
      { filename: 'image001.png', size: 10000 },
    ])
    const service = makeGmailService(junkPayload)

    expect(await classifyInvoice(makeMessage(), service, knownSenders)).toBeNull()
  })
})

describe('classifyInvoice — junk filter with valid attachment present', () => {
  it('returns first non-junk PDF when mixed with junk image attachments', async () => {
    const knownSenders = makeKnownSenders([['amazon.ca', { trust_level: 'trusted' }]])
    const payload = makePDFPayload([
      { filename: 'outlook-logo.png', size: 2000 },
      { filename: 'invoice-amazon.pdf', size: 80000 },
      { filename: 'image001.png', size: 5000 },
    ])
    const service = makeGmailService(payload)

    const result = await classifyInvoice(makeMessage(), service, knownSenders)

    expect(result).not.toBeNull()
    expect(result!.attachment_name).toBe('invoice-amazon.pdf')
  })
})

// ── insertInvoiceClassifications ──────────────────────────────────────────────

describe('insertInvoiceClassifications', () => {
  it('calls upsert on gmail_invoice_classifications with correct fields', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: null })
    const rpcMock = vi.fn().mockResolvedValue({ error: null })
    const db = {
      from: vi.fn().mockReturnValue({ upsert: upsertMock }),
      rpc: rpcMock,
    }

    const result = {
      message_id: 'msg-abc',
      confidence: 'high' as const,
      attachment_name: 'receipt.pdf',
      vendor_hint: 'Amazon.ca',
      classified_at: new Date('2026-04-01'),
    }

    await insertInvoiceClassifications(
      [result],
      db as unknown as Parameters<typeof insertInvoiceClassifications>[1]
    )

    expect(db.from).toHaveBeenCalledWith('gmail_invoice_classifications')
    expect(upsertMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          message_id: 'msg-abc',
          confidence: 'high',
          attachment_name: 'receipt.pdf',
        }),
      ]),
      { onConflict: 'message_id', ignoreDuplicates: true }
    )
    expect(rpcMock).toHaveBeenCalledWith('append_scan_labels_batch', {
      p_message_ids: ['msg-abc'],
      p_label: 'invoice',
    })
  })

  it('is a no-op for empty results', async () => {
    const db = { from: vi.fn(), rpc: vi.fn() }
    await insertInvoiceClassifications([], db as never)
    expect(db.from).not.toHaveBeenCalled()
    expect(db.rpc).not.toHaveBeenCalled()
  })
})

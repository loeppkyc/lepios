import { describe, it, expect, vi } from 'vitest'
import type { gmail_v1 } from 'googleapis'
import {
  classifyReceipt,
  insertReceiptClassifications,
  extractBodyText,
} from '@/lib/gmail/classifiers/receipt'
import type { KnownSender } from '@/lib/gmail/classifiers/types'
import type { GmailMessage } from '@/lib/gmail/scan'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeMessage(overrides: Partial<GmailMessage> = {}): GmailMessage {
  return {
    messageId: 'msg-001',
    fromAddress: 'receipts@walmart.ca',
    subject: 'Your Walmart eReceipt',
    sentAt: new Date('2026-04-01T10:00:00Z'),
    hasAttachment: false,
    ...overrides,
  }
}

function makeKnownSenders(
  entries: Array<[string, Partial<KnownSender>]>
): Map<string, KnownSender> {
  return new Map(
    entries.map(([domain, s]) => [
      domain,
      {
        trust_level: s.trust_level ?? 'trusted',
        sender_type: s.sender_type ?? 'inline_receipt',
      },
    ])
  )
}

function makeBodyPayload(bodyText: string): gmail_v1.Schema$MessagePart {
  return {
    mimeType: 'text/plain',
    body: { data: Buffer.from(bodyText).toString('base64url') },
  }
}

function makeHtmlPayload(html: string): gmail_v1.Schema$MessagePart {
  return {
    mimeType: 'text/html',
    body: { data: Buffer.from(html).toString('base64url') },
  }
}

function makeMultipartPayload(plainText: string): gmail_v1.Schema$MessagePart {
  return {
    mimeType: 'multipart/alternative',
    parts: [
      {
        mimeType: 'text/plain',
        body: { data: Buffer.from(plainText).toString('base64url') },
      },
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

const REAL_RECEIPT_BODY =
  'Thank you for shopping at Walmart! ' +
  'Order #W-20260401-9876. ' +
  'Total: $47.82 (includes GST). ' +
  'Items: Tide Pods x1 $12.97, Bananas x1 $1.49, Paper Towels x2 $16.98, Milk 2L x1 $3.99. ' +
  'Subtotal: $45.43, GST: $2.39. ' +
  'Payment: Visa ending 4321.'

// ── extractBodyText ───────────────────────────────────────────────────────────

describe('extractBodyText', () => {
  it('extracts text/plain body data', () => {
    const body = 'Hello world receipt text'
    const payload = makeBodyPayload(body)
    expect(extractBodyText(payload)).toBe(body)
  })

  it('strips HTML tags from text/html body', () => {
    const payload = makeHtmlPayload('<p>Order total: <strong>$47.82</strong></p>')
    const result = extractBodyText(payload)
    expect(result).toContain('Order total:')
    expect(result).toContain('$47.82')
    expect(result).not.toContain('<p>')
    expect(result).not.toContain('<strong>')
  })

  it('extracts text/plain from multipart/alternative', () => {
    const payload = makeMultipartPayload('Your receipt is enclosed.')
    expect(extractBodyText(payload)).toContain('Your receipt')
  })
})

// ── classifyReceipt ───────────────────────────────────────────────────────────

describe('classifyReceipt — high confidence (trusted inline sender)', () => {
  it('returns high confidence for trusted walmart.ca sender with receipt body', async () => {
    const knownSenders = makeKnownSenders([['walmart.ca', { trust_level: 'trusted' }]])
    const service = makeGmailService(makeBodyPayload(REAL_RECEIPT_BODY))

    const result = await classifyReceipt(makeMessage(), service, knownSenders)

    expect(result).not.toBeNull()
    expect(result!.confidence).toBe('high')
    expect(result!.message_id).toBe('msg-001')
    expect(result!.vendor_hint).toBe('receipts')
    expect(result!.body_text).not.toBeNull()
    expect(result!.body_text!.length).toBeGreaterThan(50)
    expect(result!.body_preview).not.toBeNull()
    expect(result!.body_preview!.length).toBeLessThanOrEqual(200)
  })

  it('stores body_text up to 4000 chars', async () => {
    const longBody = 'A'.repeat(5000)
    const knownSenders = makeKnownSenders([['walmart.ca', { trust_level: 'trusted' }]])
    const service = makeGmailService(makeBodyPayload(longBody))

    const result = await classifyReceipt(makeMessage(), service, knownSenders)

    expect(result).not.toBeNull()
    expect(result!.body_text!.length).toBe(4000)
    expect(result!.body_preview!.length).toBe(200)
  })
})

describe('classifyReceipt — medium confidence (keyword-only or review sender)', () => {
  it('returns medium confidence for unknown sender with receipt keyword in subject', async () => {
    const knownSenders = new Map<string, KnownSender>()
    const service = makeGmailService(makeBodyPayload(REAL_RECEIPT_BODY))
    const msg = makeMessage({
      fromAddress: 'orders@localstore.ca',
      subject: 'Your purchase receipt from Local Store',
    })

    const result = await classifyReceipt(msg, service, knownSenders)

    expect(result).not.toBeNull()
    expect(result!.confidence).toBe('medium')
  })

  it('returns medium confidence for review-level known sender', async () => {
    const knownSenders = makeKnownSenders([
      ['newshop.ca', { trust_level: 'review', sender_type: 'inline_receipt' }],
    ])
    const service = makeGmailService(makeBodyPayload(REAL_RECEIPT_BODY))
    const msg = makeMessage({
      fromAddress: 'noreply@newshop.ca',
      subject: 'Your order confirmation',
    })

    const result = await classifyReceipt(msg, service, knownSenders)

    expect(result).not.toBeNull()
    expect(result!.confidence).toBe('medium')
  })
})

describe('classifyReceipt — skip cases', () => {
  it('returns null for Amazon payment notification (seller income, not expense)', async () => {
    const knownSenders = makeKnownSenders([['amazon.ca', { trust_level: 'trusted' }]])
    const service = makeGmailService(makeBodyPayload(REAL_RECEIPT_BODY))
    const msg = makeMessage({
      fromAddress: 'payments@amazon.ca',
      subject: 'Your payment is on the way',
    })

    expect(await classifyReceipt(msg, service, knownSenders)).toBeNull()
  })

  it('returns null for Amazon payment notification (amazon.com variant)', async () => {
    const knownSenders = makeKnownSenders([['amazon.com', { trust_level: 'trusted' }]])
    const service = makeGmailService(makeBodyPayload(REAL_RECEIPT_BODY))
    const msg = makeMessage({
      fromAddress: 'noreply@amazon.com',
      subject: 'Amazon Payment Notification',
    })

    expect(await classifyReceipt(msg, service, knownSenders)).toBeNull()
  })

  it('returns null for promotional subject (contains "promo")', async () => {
    const knownSenders = makeKnownSenders([['walmart.ca', { trust_level: 'trusted' }]])
    const service = makeGmailService(makeBodyPayload(REAL_RECEIPT_BODY))
    const msg = makeMessage({ subject: 'Weekend promo — save 20%!' })

    expect(await classifyReceipt(msg, service, knownSenders)).toBeNull()
  })

  it('returns null for promotional subject (contains "newsletter")', async () => {
    const knownSenders = makeKnownSenders([['walmart.ca', { trust_level: 'trusted' }]])
    const service = makeGmailService(makeBodyPayload(REAL_RECEIPT_BODY))
    const msg = makeMessage({ subject: 'Walmart newsletter — this week only' })

    expect(await classifyReceipt(msg, service, knownSenders)).toBeNull()
  })

  it('returns null when trust_level=ignore', async () => {
    const knownSenders = makeKnownSenders([['spammer.ca', { trust_level: 'ignore' }]])
    const service = makeGmailService(makeBodyPayload(REAL_RECEIPT_BODY))
    const msg = makeMessage({ fromAddress: 'billing@spammer.ca', subject: 'Your receipt' })

    expect(await classifyReceipt(msg, service, knownSenders)).toBeNull()
  })

  it('returns null when body is under 100 chars', async () => {
    const knownSenders = makeKnownSenders([['walmart.ca', { trust_level: 'trusted' }]])
    const service = makeGmailService(makeBodyPayload('Short body.'))

    expect(await classifyReceipt(makeMessage(), service, knownSenders)).toBeNull()
  })

  it('returns null when no keyword and sender not in known list', async () => {
    const knownSenders = new Map<string, KnownSender>()
    const service = makeGmailService(makeBodyPayload(REAL_RECEIPT_BODY))
    const msg = makeMessage({
      fromAddress: 'news@randomsite.com',
      subject: 'Check out our new arrivals',
    })

    expect(await classifyReceipt(msg, service, knownSenders)).toBeNull()
  })
})

// ── insertReceiptClassifications ──────────────────────────────────────────────

describe('insertReceiptClassifications', () => {
  it('calls upsert on gmail_receipt_classifications with correct fields', async () => {
    const upsertMock = vi.fn().mockResolvedValue({ error: null })
    const rpcMock = vi.fn().mockResolvedValue({ error: null })
    const db = {
      from: vi.fn().mockReturnValue({ upsert: upsertMock }),
      rpc: rpcMock,
    }

    const result = {
      message_id: 'msg-xyz',
      confidence: 'high' as const,
      vendor_hint: 'Walmart',
      body_preview: 'Thank you for shopping',
      body_text: 'Thank you for shopping at Walmart! Total: $47.82',
      classified_at: new Date('2026-04-01'),
    }

    await insertReceiptClassifications(
      [result],
      db as unknown as Parameters<typeof insertReceiptClassifications>[1]
    )

    expect(db.from).toHaveBeenCalledWith('gmail_receipt_classifications')
    expect(upsertMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          message_id: 'msg-xyz',
          confidence: 'high',
          body_text: 'Thank you for shopping at Walmart! Total: $47.82',
        }),
      ]),
      { onConflict: 'message_id', ignoreDuplicates: true }
    )
    expect(rpcMock).toHaveBeenCalledWith('append_scan_labels_batch', {
      p_message_ids: ['msg-xyz'],
      p_label: 'inline_receipt',
    })
  })

  it('is a no-op for empty results', async () => {
    const db = { from: vi.fn(), rpc: vi.fn() }
    await insertReceiptClassifications([], db as never)
    expect(db.from).not.toHaveBeenCalled()
    expect(db.rpc).not.toHaveBeenCalled()
  })
})

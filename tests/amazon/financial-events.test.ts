import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseFinancialEventPages } from '@/lib/amazon/financial-events'
import type { FinancialEventsPage } from '@/lib/amazon/financial-events'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockSpFetch } = vi.hoisted(() => ({
  mockSpFetch: vi.fn(),
}))

vi.mock('@/lib/amazon/client', () => ({
  spFetch: mockSpFetch,
}))

vi.mock('@/lib/knowledge/client', () => ({
  logEvent: vi.fn().mockResolvedValue(null),
}))

// ── Fixtures ──────────────────────────────────────────────────────────────────

const GROUP_ID = 'FEG-TEST-001'

function makeShipmentEvent(
  orderId: string,
  charges: Array<{ ChargeType: string; amount: number }>,
  fees: Array<{ FeeType: string; amount: number }>
) {
  return {
    AmazonOrderId: orderId,
    PostedDate: '2026-04-01T08:00:00Z',
    ItemList: [
      {
        QuantityShipped: 1,
        ItemChargeList: charges.map((c) => ({
          ChargeType: c.ChargeType,
          ChargeAmount: { CurrencyAmount: c.amount, CurrencyCode: 'CAD' },
        })),
        ItemFeeList: fees.map((f) => ({
          FeeType: f.FeeType,
          FeeAmount: { CurrencyAmount: f.amount, CurrencyCode: 'CAD' },
        })),
      },
    ],
  }
}

function makeRefundEvent(orderId: string, charges: Array<{ ChargeType: string; amount: number }>) {
  return {
    AmazonOrderId: orderId,
    PostedDate: '2026-04-02T10:00:00Z',
    ItemList: [
      {
        ItemChargeList: charges.map((c) => ({
          ChargeType: c.ChargeType,
          ChargeAmount: { CurrencyAmount: c.amount, CurrencyCode: 'CAD' },
        })),
      },
    ],
  }
}

function makeServiceFeeEvent(fees: Array<{ FeeType: string; amount: number }>) {
  return {
    PostedDate: '2026-04-03T12:00:00Z',
    FeeList: fees.map((f) => ({
      FeeType: f.FeeType,
      FeeAmount: { CurrencyAmount: f.amount, CurrencyCode: 'CAD' },
    })),
  }
}

function makePage(events: Partial<FinancialEventsPage>): FinancialEventsPage {
  return {
    ShipmentEventList: [],
    RefundEventList: [],
    ServiceFeeEventList: [],
    ...events,
  }
}

// ── 1. parseFinancialEventPages — ShipmentEvent ───────────────────────────────

describe('parseFinancialEventPages — ShipmentEvent', () => {
  it('extracts gross from Principal + ShippingCharge + GiftwrapCharge', () => {
    const page = makePage({
      ShipmentEventList: [
        makeShipmentEvent(
          'AMZ-001',
          [
            { ChargeType: 'Principal', amount: 25.99 },
            { ChargeType: 'ShippingCharge', amount: 5.0 },
            { ChargeType: 'GiftwrapCharge', amount: 1.5 },
          ],
          []
        ),
      ],
    })
    const result = parseFinancialEventPages(GROUP_ID, [page])
    expect(result.events[0].gross_contribution).toBe(32.49)
    expect(result.gross_total).toBe(32.49)
  })

  it('excludes non-revenue charge types from gross', () => {
    const page = makePage({
      ShipmentEventList: [
        makeShipmentEvent(
          'AMZ-002',
          [
            { ChargeType: 'Principal', amount: 20.0 },
            { ChargeType: 'Promotion', amount: -2.0 }, // not a revenue type
            { ChargeType: 'Tax', amount: 1.5 }, // not a revenue type
          ],
          []
        ),
      ],
    })
    const result = parseFinancialEventPages(GROUP_ID, [page])
    expect(result.events[0].gross_contribution).toBe(20.0)
  })

  it('extracts fees as absolute value from ItemFeeList', () => {
    const page = makePage({
      ShipmentEventList: [
        makeShipmentEvent(
          'AMZ-003',
          [{ ChargeType: 'Principal', amount: 25.99 }],
          [
            { FeeType: 'ReferralFee', amount: -3.9 },
            { FeeType: 'FBAPerUnitFulfillmentFee', amount: -3.22 },
          ]
        ),
      ],
    })
    const result = parseFinancialEventPages(GROUP_ID, [page])
    expect(result.events[0].fees_contribution).toBe(7.12)
    expect(result.events[0].refunds_contribution).toBe(0)
  })

  it('accumulates charges and fees across multiple items in one event', () => {
    const event = {
      AmazonOrderId: 'AMZ-MULTI',
      PostedDate: '2026-04-01T08:00:00Z',
      ItemList: [
        {
          QuantityShipped: 1,
          ItemChargeList: [
            { ChargeType: 'Principal', ChargeAmount: { CurrencyAmount: 10.0, CurrencyCode: 'CAD' } },
          ],
          ItemFeeList: [
            { FeeType: 'ReferralFee', FeeAmount: { CurrencyAmount: -1.5, CurrencyCode: 'CAD' } },
          ],
        },
        {
          QuantityShipped: 2,
          ItemChargeList: [
            { ChargeType: 'Principal', ChargeAmount: { CurrencyAmount: 20.0, CurrencyCode: 'CAD' } },
          ],
          ItemFeeList: [
            { FeeType: 'ReferralFee', FeeAmount: { CurrencyAmount: -3.0, CurrencyCode: 'CAD' } },
          ],
        },
      ],
    }
    const result = parseFinancialEventPages(GROUP_ID, [makePage({ ShipmentEventList: [event] })])
    expect(result.events[0].gross_contribution).toBe(30.0)
    expect(result.events[0].fees_contribution).toBe(4.5)
  })

  it('handles missing ItemList gracefully', () => {
    const page = makePage({
      ShipmentEventList: [{ AmazonOrderId: 'AMZ-EMPTY', PostedDate: '2026-04-01T00:00:00Z' }],
    })
    const result = parseFinancialEventPages(GROUP_ID, [page])
    expect(result.events).toHaveLength(1)
    expect(result.events[0].gross_contribution).toBe(0)
    expect(result.events[0].fees_contribution).toBe(0)
  })

  it('stores amazon_order_id from AmazonOrderId field', () => {
    const page = makePage({
      ShipmentEventList: [
        makeShipmentEvent('AMZ-ORDER-XYZ', [{ ChargeType: 'Principal', amount: 10 }], []),
      ],
    })
    const result = parseFinancialEventPages(GROUP_ID, [page])
    expect(result.events[0].amazon_order_id).toBe('AMZ-ORDER-XYZ')
    expect(result.events[0].event_type).toBe('ShipmentEvent')
  })

  it('refunds_contribution is always 0 for ShipmentEvents', () => {
    const page = makePage({
      ShipmentEventList: [
        makeShipmentEvent('AMZ-005', [{ ChargeType: 'Principal', amount: 30.0 }], []),
      ],
    })
    const result = parseFinancialEventPages(GROUP_ID, [page])
    expect(result.events[0].refunds_contribution).toBe(0)
  })
})

// ── 2. parseFinancialEventPages — RefundEvent ─────────────────────────────────

describe('parseFinancialEventPages — RefundEvent', () => {
  it('extracts refunds from negative ItemChargeList amounts', () => {
    const page = makePage({
      RefundEventList: [
        makeRefundEvent('AMZ-006', [
          { ChargeType: 'Principal', amount: -25.99 },
          { ChargeType: 'ShippingCharge', amount: -5.0 },
        ]),
      ],
    })
    const result = parseFinancialEventPages(GROUP_ID, [page])
    expect(result.events[0].refunds_contribution).toBe(30.99)
    expect(result.refunds_total).toBe(30.99)
  })

  it('ignores non-negative amounts in RefundEvent (should not add to refunds)', () => {
    const page = makePage({
      RefundEventList: [
        makeRefundEvent('AMZ-007', [
          { ChargeType: 'Principal', amount: -20.0 },
          { ChargeType: 'SomeFee', amount: 2.0 }, // positive — should be ignored
        ]),
      ],
    })
    const result = parseFinancialEventPages(GROUP_ID, [page])
    expect(result.events[0].refunds_contribution).toBe(20.0)
  })

  it('gross_contribution and fees_contribution are always 0 for RefundEvents', () => {
    const page = makePage({
      RefundEventList: [
        makeRefundEvent('AMZ-008', [{ ChargeType: 'Principal', amount: -10.0 }]),
      ],
    })
    const result = parseFinancialEventPages(GROUP_ID, [page])
    expect(result.events[0].gross_contribution).toBe(0)
    expect(result.events[0].fees_contribution).toBe(0)
  })

  it('stores amazon_order_id from RefundEvent', () => {
    const page = makePage({
      RefundEventList: [
        makeRefundEvent('AMZ-REFUND-999', [{ ChargeType: 'Principal', amount: -5.0 }]),
      ],
    })
    const result = parseFinancialEventPages(GROUP_ID, [page])
    expect(result.events[0].amazon_order_id).toBe('AMZ-REFUND-999')
    expect(result.events[0].event_type).toBe('RefundEvent')
  })
})

// ── 3. parseFinancialEventPages — ServiceFeeEvent ─────────────────────────────

describe('parseFinancialEventPages — ServiceFeeEvent', () => {
  it('extracts fees as absolute value from FeeList', () => {
    const page = makePage({
      ServiceFeeEventList: [
        makeServiceFeeEvent([{ FeeType: 'SponsoredProductCampaignFee', amount: -15.5 }]),
      ],
    })
    const result = parseFinancialEventPages(GROUP_ID, [page])
    expect(result.events[0].fees_contribution).toBe(15.5)
    expect(result.fees_total).toBe(15.5)
  })

  it('amazon_order_id is null for ServiceFeeEvent', () => {
    const page = makePage({
      ServiceFeeEventList: [makeServiceFeeEvent([{ FeeType: 'PPCFee', amount: -5.0 }])],
    })
    const result = parseFinancialEventPages(GROUP_ID, [page])
    expect(result.events[0].amazon_order_id).toBeNull()
    expect(result.events[0].event_type).toBe('ServiceFeeEvent')
  })

  it('gross and refunds are always 0 for ServiceFeeEvent', () => {
    const page = makePage({
      ServiceFeeEventList: [makeServiceFeeEvent([{ FeeType: 'PPCFee', amount: -10.0 }])],
    })
    const result = parseFinancialEventPages(GROUP_ID, [page])
    expect(result.events[0].gross_contribution).toBe(0)
    expect(result.events[0].refunds_contribution).toBe(0)
  })

  it('accumulates fees across multiple entries in FeeList', () => {
    const page = makePage({
      ServiceFeeEventList: [
        makeServiceFeeEvent([
          { FeeType: 'PPCCampaign1', amount: -10.0 },
          { FeeType: 'PPCCampaign2', amount: -5.25 },
        ]),
      ],
    })
    const result = parseFinancialEventPages(GROUP_ID, [page])
    expect(result.events[0].fees_contribution).toBe(15.25)
  })
})

// ── 4. Aggregation reconciliation ────────────────────────────────────────────

describe('parseFinancialEventPages — aggregation reconciliation', () => {
  // Mixed page: 1 ShipmentEvent + 1 RefundEvent + 1 ServiceFeeEvent
  // gross  = 25.99 + 5.00 = 30.99
  // fees   = 3.90 + 3.22 (from shipment) + 15.50 (from service fee) = 22.62
  // refunds = 25.99 + 5.00 = 30.99

  const mixedPage = makePage({
    ShipmentEventList: [
      makeShipmentEvent(
        'AMZ-S1',
        [
          { ChargeType: 'Principal', amount: 25.99 },
          { ChargeType: 'ShippingCharge', amount: 5.0 },
        ],
        [
          { FeeType: 'ReferralFee', amount: -3.9 },
          { FeeType: 'FBAPerUnitFulfillmentFee', amount: -3.22 },
        ]
      ),
    ],
    RefundEventList: [
      makeRefundEvent('AMZ-R1', [
        { ChargeType: 'Principal', amount: -25.99 },
        { ChargeType: 'ShippingCharge', amount: -5.0 },
      ]),
    ],
    ServiceFeeEventList: [
      makeServiceFeeEvent([{ FeeType: 'SponsoredProductCampaignFee', amount: -15.5 }]),
    ],
  })

  it('gross_total equals sum of gross_contribution across all events', () => {
    const result = parseFinancialEventPages(GROUP_ID, [mixedPage])
    const summedGross = result.events.reduce((s, e) => s + e.gross_contribution, 0)
    expect(result.gross_total).toBe(Math.round(summedGross * 100) / 100)
  })

  it('fees_total equals sum of fees_contribution across all events', () => {
    const result = parseFinancialEventPages(GROUP_ID, [mixedPage])
    const summedFees = result.events.reduce((s, e) => s + e.fees_contribution, 0)
    expect(result.fees_total).toBe(Math.round(summedFees * 100) / 100)
  })

  it('refunds_total equals sum of refunds_contribution across all events', () => {
    const result = parseFinancialEventPages(GROUP_ID, [mixedPage])
    const summedRefunds = result.events.reduce((s, e) => s + e.refunds_contribution, 0)
    expect(result.refunds_total).toBe(Math.round(summedRefunds * 100) / 100)
  })

  it('correct event count: 1 shipment + 1 refund + 1 service fee = 3 events', () => {
    const result = parseFinancialEventPages(GROUP_ID, [mixedPage])
    expect(result.events).toHaveLength(3)
    expect(result.events.filter((e) => e.event_type === 'ShipmentEvent')).toHaveLength(1)
    expect(result.events.filter((e) => e.event_type === 'RefundEvent')).toHaveLength(1)
    expect(result.events.filter((e) => e.event_type === 'ServiceFeeEvent')).toHaveLength(1)
  })

  it('exact mixed totals: gross=30.99, fees=22.62, refunds=30.99', () => {
    const result = parseFinancialEventPages(GROUP_ID, [mixedPage])
    expect(result.gross_total).toBe(30.99)
    expect(result.fees_total).toBe(22.62)
    expect(result.refunds_total).toBe(30.99)
  })

  it('empty pages → all totals zero, no events', () => {
    const result = parseFinancialEventPages(GROUP_ID, [])
    expect(result.events).toHaveLength(0)
    expect(result.gross_total).toBe(0)
    expect(result.fees_total).toBe(0)
    expect(result.refunds_total).toBe(0)
    expect(result.skipped_event_types).toEqual([])
  })

  it('multi-page accumulation: totals span across pages correctly', () => {
    const page1 = makePage({
      ShipmentEventList: [
        makeShipmentEvent('AMZ-P1', [{ ChargeType: 'Principal', amount: 10.0 }], []),
      ],
    })
    const page2 = makePage({
      ShipmentEventList: [
        makeShipmentEvent('AMZ-P2', [{ ChargeType: 'Principal', amount: 20.0 }], []),
      ],
    })
    const result = parseFinancialEventPages(GROUP_ID, [page1, page2])
    expect(result.events).toHaveLength(2)
    expect(result.gross_total).toBe(30.0)
  })
})

// ── 5. Skipped event type detection ──────────────────────────────────────────

describe('parseFinancialEventPages — skipped event types', () => {
  it('detects non-empty unrecognised EventList keys', () => {
    const page: FinancialEventsPage = {
      ShipmentEventList: [],
      RefundEventList: [],
      ServiceFeeEventList: [],
      AdjustmentEventList: [{ someField: 'someValue' }],
      ChargebackEventList: [{ anotherField: 1 }],
    }
    const result = parseFinancialEventPages(GROUP_ID, [page])
    expect(result.skipped_event_types).toContain('AdjustmentEvent')
    expect(result.skipped_event_types).toContain('ChargebackEvent')
  })

  it('ignores empty unrecognised EventList arrays', () => {
    const page: FinancialEventsPage = {
      ShipmentEventList: [],
      AdjustmentEventList: [], // empty — should not be flagged
    }
    const result = parseFinancialEventPages(GROUP_ID, [page])
    expect(result.skipped_event_types).not.toContain('AdjustmentEvent')
  })

  it('does not flag known handled event types as skipped', () => {
    const page = makePage({
      ShipmentEventList: [
        makeShipmentEvent('AMZ-K1', [{ ChargeType: 'Principal', amount: 5.0 }], []),
      ],
    })
    const result = parseFinancialEventPages(GROUP_ID, [page])
    expect(result.skipped_event_types).not.toContain('ShipmentEvent')
    expect(result.skipped_event_types).not.toContain('RefundEvent')
    expect(result.skipped_event_types).not.toContain('ServiceFeeEvent')
  })

  it('returns sorted skipped_event_types for deterministic output', () => {
    const page: FinancialEventsPage = {
      ZebraEventList: [{ x: 1 }],
      AardvarkEventList: [{ x: 2 }],
    }
    const result = parseFinancialEventPages(GROUP_ID, [page])
    expect(result.skipped_event_types[0]).toBe('AardvarkEvent')
    expect(result.skipped_event_types[1]).toBe('ZebraEvent')
  })
})

// ── 6. Event IDs ──────────────────────────────────────────────────────────────

describe('parseFinancialEventPages — event IDs', () => {
  it('generates unique IDs for distinct events in the same group', () => {
    const page = makePage({
      ShipmentEventList: [
        makeShipmentEvent('AMZ-ID1', [{ ChargeType: 'Principal', amount: 10 }], []),
        makeShipmentEvent('AMZ-ID2', [{ ChargeType: 'Principal', amount: 20 }], []),
      ],
    })
    const result = parseFinancialEventPages(GROUP_ID, [page])
    const ids = result.events.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length) // all unique
  })

  it('generates deterministic IDs: same input → same IDs', () => {
    const page = makePage({
      ShipmentEventList: [
        makeShipmentEvent('AMZ-DET', [{ ChargeType: 'Principal', amount: 15 }], []),
      ],
    })
    const result1 = parseFinancialEventPages(GROUP_ID, [page])
    const result2 = parseFinancialEventPages(GROUP_ID, [page])
    expect(result1.events[0].id).toBe(result2.events[0].id)
  })

  it('IDs differ across group_ids for identical event data', () => {
    const page = makePage({
      ShipmentEventList: [
        makeShipmentEvent('AMZ-SAME', [{ ChargeType: 'Principal', amount: 10 }], []),
      ],
    })
    const r1 = parseFinancialEventPages('FEG-GROUP-A', [page])
    const r2 = parseFinancialEventPages('FEG-GROUP-B', [page])
    expect(r1.events[0].id).not.toBe(r2.events[0].id)
  })
})

// ── 7. upsertFinancialEventsForGroup — idempotency ───────────────────────────

describe('upsertFinancialEventsForGroup — idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  function makeApiPageResponse(page: FinancialEventsPage, nextToken?: string) {
    return {
      payload: {
        FinancialEvents: page,
        ...(nextToken ? { NextToken: nextToken } : {}),
      },
    }
  }

  function makeDb() {
    const deletedGroups: string[] = []
    const insertedBatches: unknown[][] = []
    const updatedGroups: string[] = []

    const mockEq = vi.fn().mockImplementation((col: string, val: string) => {
      if (col === 'group_id') deletedGroups.push(val)
      if (col === 'id') updatedGroups.push(val)
      return Promise.resolve({ error: null })
    })
    const mockDelete = vi.fn().mockReturnValue({ eq: mockEq })
    const mockInsert = vi.fn().mockImplementation((rows: unknown[]) => {
      insertedBatches.push(Array.isArray(rows) ? rows : [rows])
      return Promise.resolve({ error: null })
    })
    const mockUpdateEq = vi.fn().mockResolvedValue({ error: null })
    const mockUpdate = vi.fn().mockReturnValue({ eq: mockUpdateEq })

    const db = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'amazon_financial_events') return { delete: mockDelete, insert: mockInsert }
        if (table === 'amazon_settlements') return { update: mockUpdate }
        return {}
      }),
      _deletedGroups: deletedGroups,
      _insertedBatches: insertedBatches,
      _updatedGroups: updatedGroups,
    }

    return db
  }

  it('re-running does not duplicate events: delete called once per run', async () => {
    const page = makePage({
      ShipmentEventList: [
        makeShipmentEvent('AMZ-IDEM', [{ ChargeType: 'Principal', amount: 20.0 }], []),
      ],
    })
    mockSpFetch.mockResolvedValue(makeApiPageResponse(page))

    const db = makeDb()
    const { upsertFinancialEventsForGroup } = await import('@/lib/amazon/financial-events')

    const result1 = await upsertFinancialEventsForGroup(GROUP_ID, db as never)
    const result2 = await upsertFinancialEventsForGroup(GROUP_ID, db as never)

    // Both runs return the same totals
    expect(result1.events_inserted).toBe(result2.events_inserted)
    expect(result1.gross).toBe(result2.gross)
    expect(result1.fees_total).toBe(result2.fees_total)
    expect(result1.refunds_total).toBe(result2.refunds_total)

    // Delete is called once per run (not skipped on second run)
    expect(db._deletedGroups).toHaveLength(2)
    expect(db._deletedGroups[0]).toBe(GROUP_ID)
    expect(db._deletedGroups[1]).toBe(GROUP_ID)

    // Insert is called once per run
    expect(db._insertedBatches).toHaveLength(2)
    expect((db._insertedBatches[0] as unknown[]).length).toBe(
      (db._insertedBatches[1] as unknown[]).length
    )
  })

  it('settlement totals unchanged after second run', async () => {
    const page = makePage({
      ShipmentEventList: [
        makeShipmentEvent(
          'AMZ-TOT',
          [{ ChargeType: 'Principal', amount: 45.0 }],
          [{ FeeType: 'ReferralFee', amount: -6.75 }]
        ),
      ],
    })
    mockSpFetch.mockResolvedValue(makeApiPageResponse(page))

    const db = makeDb()
    const { upsertFinancialEventsForGroup } = await import('@/lib/amazon/financial-events')

    const r1 = await upsertFinancialEventsForGroup(GROUP_ID, db as never)
    const r2 = await upsertFinancialEventsForGroup(GROUP_ID, db as never)

    expect(r1.gross).toBe(45.0)
    expect(r1.fees_total).toBe(6.75)
    expect(r2.gross).toBe(r1.gross)
    expect(r2.fees_total).toBe(r1.fees_total)
  })

  it('skips insert when group has zero events', async () => {
    mockSpFetch.mockResolvedValue(makeApiPageResponse(makePage({})))

    const db = makeDb()
    const { upsertFinancialEventsForGroup } = await import('@/lib/amazon/financial-events')
    const result = await upsertFinancialEventsForGroup(GROUP_ID, db as never)

    expect(result.events_inserted).toBe(0)
    expect(db._insertedBatches).toHaveLength(0) // no insert call when nothing to insert
    expect(db._deletedGroups).toHaveLength(1) // delete still runs (idempotency: clears stale data)
  })

  it('throws and propagates when SP-API fetch fails', async () => {
    mockSpFetch.mockRejectedValueOnce(new Error('SP-API 429'))
    const db = makeDb()
    const { upsertFinancialEventsForGroup } = await import('@/lib/amazon/financial-events')

    await expect(upsertFinancialEventsForGroup(GROUP_ID, db as never)).rejects.toThrow('SP-API 429')
  })

  it('throws when delete fails', async () => {
    mockSpFetch.mockResolvedValue(makeApiPageResponse(makePage({})))

    const mockEq = vi.fn().mockResolvedValue({ error: { message: 'delete constraint' } })
    const db = {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'amazon_financial_events') return { delete: vi.fn().mockReturnValue({ eq: mockEq }), insert: vi.fn() }
        return { update: vi.fn().mockReturnValue({ eq: vi.fn() }) }
      }),
    }

    const { upsertFinancialEventsForGroup } = await import('@/lib/amazon/financial-events')
    await expect(upsertFinancialEventsForGroup(GROUP_ID, db as never)).rejects.toThrow(
      'Delete failed'
    )
  })
})

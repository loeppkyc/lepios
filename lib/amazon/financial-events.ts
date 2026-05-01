import { createHash } from 'crypto'
import { spFetch } from './client'
import type { SupabaseClient } from '@supabase/supabase-js'

// ── SP-API response shapes ────────────────────────────────────────────────────

interface AmountObj {
  CurrencyAmount?: number | string | null
  CurrencyCode?: string
}

interface ItemCharge {
  ChargeType: string
  ChargeAmount?: AmountObj
}

interface ItemFee {
  FeeType?: string
  FeeAmount?: AmountObj
}

interface ShipmentItem {
  QuantityShipped?: number
  ItemChargeList?: ItemCharge[]
  ItemFeeList?: ItemFee[]
}

interface ShipmentEvent {
  AmazonOrderId?: string
  PostedDate?: string
  OrderDate?: string
  TransactionPostedDate?: string
  ItemList?: ShipmentItem[]
}

interface RefundItem {
  ItemChargeList?: ItemCharge[]
}

interface RefundEvent {
  AmazonOrderId?: string
  PostedDate?: string
  OrderDate?: string
  TransactionPostedDate?: string
  ItemList?: RefundItem[]
}

interface ServiceFeeEvent {
  PostedDate?: string
  OrderDate?: string
  TransactionPostedDate?: string
  FeeList?: ItemFee[]
}

export interface FinancialEventsPage {
  ShipmentEventList?: ShipmentEvent[]
  RefundEventList?: RefundEvent[]
  ServiceFeeEventList?: ServiceFeeEvent[]
  [key: string]: unknown
}

interface FinancialEventsApiResponse {
  payload?: {
    FinancialEvents?: FinancialEventsPage
    NextToken?: string
  }
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface ParsedFinancialEvent {
  id: string
  group_id: string
  amazon_order_id: string | null
  event_type: 'ShipmentEvent' | 'RefundEvent' | 'ServiceFeeEvent'
  posted_date: string | null
  gross_contribution: number
  fees_contribution: number
  refunds_contribution: number
  raw_json: Record<string, unknown>
}

export interface ParseResult {
  events: ParsedFinancialEvent[]
  gross_total: number
  fees_total: number
  refunds_total: number
  skipped_event_types: string[]
}

export interface UpsertResult {
  group_id: string
  events_inserted: number
  gross: number
  fees_total: number
  refunds_total: number
  skipped_event_types: string[]
}

// ── Constants ─────────────────────────────────────────────────────────────────

const KNOWN_EVENT_TYPE_KEYS = new Set([
  'ShipmentEventList',
  'RefundEventList',
  'ServiceFeeEventList',
])

const REVENUE_CHARGE_TYPES = new Set(['Principal', 'ShippingCharge', 'GiftwrapCharge'])

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseAmount(obj?: AmountObj | null): number {
  if (!obj) return 0
  const raw = obj.CurrencyAmount
  return Number(raw ?? 0)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function postedDateEdmonton(event: {
  PostedDate?: string
  OrderDate?: string
  TransactionPostedDate?: string
}): string | null {
  const raw = event.PostedDate ?? event.OrderDate ?? event.TransactionPostedDate
  if (!raw) return null
  try {
    const dt = new Date(raw)
    // Use Intl for correct DST handling (MST/MDT)
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Edmonton',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(dt)
  } catch {
    return null
  }
}

function makeEventId(
  groupId: string,
  eventType: string,
  orderId: string | null,
  index: number
): string {
  const key = `${groupId}|${eventType}|${orderId ?? ''}|${index}`
  return createHash('sha256').update(key).digest('hex').slice(0, 32)
}

// ── SP-API fetch ──────────────────────────────────────────────────────────────

export async function fetchFinancialEventsForGroup(
  groupId: string
): Promise<FinancialEventsPage[]> {
  const pages: FinancialEventsPage[] = []
  let params: Record<string, string> | undefined

  while (true) {
    const data = await spFetch<FinancialEventsApiResponse>(
      `/finances/v0/financialEventGroups/${encodeURIComponent(groupId)}/financialEvents`,
      { method: 'GET', ...(params ? { params } : {}) }
    )

    const fe = data.payload?.FinancialEvents
    if (fe) pages.push(fe)

    const nextToken = data.payload?.NextToken
    if (!nextToken) break
    params = { NextToken: nextToken }

    await new Promise((r) => setTimeout(r, 500))
  }

  return pages
}

// ── Parse — pure, testable ────────────────────────────────────────────────────

export function parseFinancialEventPages(
  groupId: string,
  pages: FinancialEventsPage[]
): ParseResult {
  const events: ParsedFinancialEvent[] = []
  const skippedTypes = new Set<string>()
  let shipIdx = 0
  let refIdx = 0
  let svcIdx = 0

  for (const fe of pages) {
    // Detect unhandled event types (non-empty arrays of unrecognised event keys)
    for (const key of Object.keys(fe)) {
      if (
        key.endsWith('EventList') &&
        !KNOWN_EVENT_TYPE_KEYS.has(key) &&
        Array.isArray(fe[key]) &&
        (fe[key] as unknown[]).length > 0
      ) {
        skippedTypes.add(key.replace(/List$/, ''))
      }
    }

    // ── ShipmentEvents: revenue + fees ───────────────────────────────────────
    for (const event of fe.ShipmentEventList ?? []) {
      let gross = 0
      let fees = 0

      for (const item of event.ItemList ?? []) {
        for (const charge of item.ItemChargeList ?? []) {
          if (REVENUE_CHARGE_TYPES.has(charge.ChargeType)) {
            gross += parseAmount(charge.ChargeAmount)
          }
        }
        for (const fee of item.ItemFeeList ?? []) {
          fees += Math.abs(parseAmount(fee.FeeAmount))
        }
      }

      events.push({
        id: makeEventId(groupId, 'ShipmentEvent', event.AmazonOrderId ?? null, shipIdx++),
        group_id: groupId,
        amazon_order_id: event.AmazonOrderId ?? null,
        event_type: 'ShipmentEvent',
        posted_date: postedDateEdmonton(event),
        gross_contribution: round2(gross),
        fees_contribution: round2(fees),
        refunds_contribution: 0,
        raw_json: event as unknown as Record<string, unknown>,
      })
    }

    // ── RefundEvents: refunds only ────────────────────────────────────────────
    for (const event of fe.RefundEventList ?? []) {
      let refunds = 0

      for (const item of event.ItemList ?? []) {
        for (const charge of item.ItemChargeList ?? []) {
          const amt = parseAmount(charge.ChargeAmount)
          if (amt < 0) refunds += Math.abs(amt)
        }
      }

      events.push({
        id: makeEventId(groupId, 'RefundEvent', event.AmazonOrderId ?? null, refIdx++),
        group_id: groupId,
        amazon_order_id: event.AmazonOrderId ?? null,
        event_type: 'RefundEvent',
        posted_date: postedDateEdmonton(event),
        gross_contribution: 0,
        fees_contribution: 0,
        refunds_contribution: round2(refunds),
        raw_json: event as unknown as Record<string, unknown>,
      })
    }

    // ── ServiceFeeEvents: fees only (PPC advertising) ─────────────────────────
    for (const event of fe.ServiceFeeEventList ?? []) {
      let fees = 0

      for (const fee of event.FeeList ?? []) {
        fees += Math.abs(parseAmount(fee.FeeAmount))
      }

      events.push({
        id: makeEventId(groupId, 'ServiceFeeEvent', null, svcIdx++),
        group_id: groupId,
        amazon_order_id: null,
        event_type: 'ServiceFeeEvent',
        posted_date: postedDateEdmonton(event),
        gross_contribution: 0,
        fees_contribution: round2(fees),
        refunds_contribution: 0,
        raw_json: event as unknown as Record<string, unknown>,
      })
    }
  }

  return {
    events,
    gross_total: round2(events.reduce((s, e) => s + e.gross_contribution, 0)),
    fees_total: round2(events.reduce((s, e) => s + e.fees_contribution, 0)),
    refunds_total: round2(events.reduce((s, e) => s + e.refunds_contribution, 0)),
    skipped_event_types: [...skippedTypes].sort(),
  }
}

// ── Upsert — delete-then-insert for idempotency ───────────────────────────────

export async function upsertFinancialEventsForGroup(
  groupId: string,
  supabase: SupabaseClient
): Promise<UpsertResult> {
  const pages = await fetchFinancialEventsForGroup(groupId)
  const parsed = parseFinancialEventPages(groupId, pages)

  // Delete existing events for this group (idempotency: re-run is safe)
  const { error: deleteError } = await supabase
    .from('amazon_financial_events')
    .delete()
    .eq('group_id', groupId)

  if (deleteError) {
    throw new Error(`Delete failed for group ${groupId}: ${deleteError.message}`)
  }

  if (parsed.events.length > 0) {
    const { error: insertError } = await supabase
      .from('amazon_financial_events')
      .insert(parsed.events)

    if (insertError) {
      throw new Error(`Insert failed for group ${groupId}: ${insertError.message}`)
    }
  }

  // Update settlement row with computed totals
  const { error: updateError } = await supabase
    .from('amazon_settlements')
    .update({
      gross: parsed.gross_total,
      fees_total: parsed.fees_total,
      refunds_total: parsed.refunds_total,
      skipped_event_types:
        parsed.skipped_event_types.length > 0 ? parsed.skipped_event_types : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', groupId)

  if (updateError) {
    throw new Error(`Settlement update failed for group ${groupId}: ${updateError.message}`)
  }

  return {
    group_id: groupId,
    events_inserted: parsed.events.length,
    gross: parsed.gross_total,
    fees_total: parsed.fees_total,
    refunds_total: parsed.refunds_total,
    skipped_event_types: parsed.skipped_event_types,
  }
}

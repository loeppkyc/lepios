import { createServiceClient } from '@/lib/supabase/service'
import type { SpOrderItem } from './orders'

interface CacheRow {
  order_id: string
  order_item_id: string
  asin: string | null
  seller_sku: string | null
  title: string | null
  quantity_ordered: number | null
  quantity_shipped: number | null
  item_price_amount: number | null
  item_price_currency: string | null
  item_tax_amount: number | null
  item_tax_currency: string | null
  promotion_discount_amount: number | null
  shipping_price_amount: number | null
  shipping_tax_amount: number | null
  raw_json: Record<string, unknown>
  fetched_at: string
}

function rowToItem(row: CacheRow): SpOrderItem {
  return {
    OrderItemId: row.order_item_id,
    ASIN: row.asin ?? undefined,
    Title: row.title ?? undefined,
    QuantityOrdered: row.quantity_ordered ?? 0,
    ItemPrice:
      row.item_price_amount != null
        ? { Amount: String(row.item_price_amount), CurrencyCode: row.item_price_currency ?? 'CAD' }
        : undefined,
    ItemTax:
      row.item_tax_amount != null
        ? { Amount: String(row.item_tax_amount), CurrencyCode: row.item_tax_currency ?? 'CAD' }
        : undefined,
    ShippingPrice:
      row.shipping_price_amount != null
        ? { Amount: String(row.shipping_price_amount), CurrencyCode: 'CAD' }
        : undefined,
    ShippingTax:
      row.shipping_tax_amount != null
        ? { Amount: String(row.shipping_tax_amount), CurrencyCode: 'CAD' }
        : undefined,
    PromotionDiscount:
      row.promotion_discount_amount != null
        ? { Amount: String(row.promotion_discount_amount), CurrencyCode: 'CAD' }
        : undefined,
  }
}

function itemToInsert(orderId: string, item: SpOrderItem): Omit<CacheRow, 'fetched_at'> {
  // SellerSKU and QuantityShipped exist in the SP-API response but are not yet
  // in the SpOrderItem TypeScript type — read from the raw object until the type is extended.
  const raw = item as unknown as Record<string, unknown>
  return {
    order_id: orderId,
    order_item_id: item.OrderItemId,
    asin: item.ASIN ?? null,
    seller_sku: (raw['SellerSKU'] as string | undefined) ?? null,
    title: item.Title ?? null,
    quantity_ordered: item.QuantityOrdered,
    quantity_shipped: (raw['QuantityShipped'] as number | undefined) ?? null,
    item_price_amount: item.ItemPrice != null ? Number(item.ItemPrice.Amount) : null,
    item_price_currency: item.ItemPrice?.CurrencyCode ?? null,
    item_tax_amount: item.ItemTax != null ? Number(item.ItemTax.Amount) : null,
    item_tax_currency: item.ItemTax?.CurrencyCode ?? null,
    promotion_discount_amount:
      item.PromotionDiscount != null ? Number(item.PromotionDiscount.Amount) : null,
    shipping_price_amount: item.ShippingPrice != null ? Number(item.ShippingPrice.Amount) : null,
    shipping_tax_amount: item.ShippingTax != null ? Number(item.ShippingTax.Amount) : null,
    raw_json: raw,
  }
}

/**
 * Returns cached items for a single order, or null if not cached.
 */
export async function getOrderItemsCached(orderId: string): Promise<SpOrderItem[] | null> {
  const db = createServiceClient()
  const { data, error } = await db.from('amazon_order_items').select('*').eq('order_id', orderId)

  if (error || !data || data.length === 0) return null
  return (data as CacheRow[]).map(rowToItem)
}

/**
 * Batch fetch cached items for many orders in a single query.
 * Returns a Map of orderId → items[]. Orders with no cache entry are absent from the map.
 */
export async function getOrderItemsBatch(orderIds: string[]): Promise<Map<string, SpOrderItem[]>> {
  if (orderIds.length === 0) return new Map()

  const db = createServiceClient()
  const { data, error } = await db.from('amazon_order_items').select('*').in('order_id', orderIds)

  if (error || !data) return new Map()

  const result = new Map<string, SpOrderItem[]>()
  for (const row of data as CacheRow[]) {
    const existing = result.get(row.order_id) ?? []
    existing.push(rowToItem(row))
    result.set(row.order_id, existing)
  }
  return result
}

/**
 * Upsert fetched items for one order into the cache.
 * fetched_at is set to now() on every write — acts as the freshness timestamp.
 */
export async function upsertOrderItems(orderId: string, items: SpOrderItem[]): Promise<void> {
  if (items.length === 0) return

  const db = createServiceClient()
  const rows = items.map((item) => ({
    ...itemToInsert(orderId, item),
    fetched_at: new Date().toISOString(),
  }))

  const { error } = await db
    .from('amazon_order_items')
    .upsert(rows, { onConflict: 'order_id,order_item_id' })

  if (error) {
    // Non-fatal: log and continue — caller proceeds with live data even if cache write fails.
    console.error('[order-items-cache] upsert failed', { orderId, error: error.message })
  }
}

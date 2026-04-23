import { NextResponse } from 'next/server'
import { spApiConfigured } from '@/lib/amazon/client'
import { fetchFbaInventory, type FbaInventoryResult } from '@/lib/amazon/inventory'

// Constraint B-8: 30-minute server-side cache — do NOT use force-dynamic here
export const revalidate = 1800

export interface FbaInventoryResponse extends FbaInventoryResult {}

export async function GET() {
  if (!spApiConfigured()) {
    return NextResponse.json({ error: 'SP-API credentials not configured' }, { status: 503 })
  }

  try {
    const result = await fetchFbaInventory()

    // Kill signal 4: if fetch took this code path we're within response;
    // kill signal handled by the 120s Vercel function timeout naturally.
    return NextResponse.json(result satisfies FbaInventoryResponse)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)

    // Kill signal 2: 403 — FBA Inventory role revoked
    if (message.includes('403')) {
      return NextResponse.json(
        { error: `SP-API FBA Inventory returned 403 — role may have been revoked: ${message}` },
        { status: 502 }
      )
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }
}

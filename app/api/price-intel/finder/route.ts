import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logEvent } from '@/lib/knowledge/client'
import { productFinder } from '@/lib/keepa/finder'
import type { ProductFinderFilters } from '@/lib/keepa/finder'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let filters: ProductFinderFilters
  try {
    filters = (await request.json()) as ProductFinderFilters
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { products, tokensLeft } = await productFinder(filters)

  void logEvent('keepa', 'product_finder_query', {
    actor: 'user',
    status: 'success',
    outputSummary: `${products.length} products returned, tokensLeft=${tokensLeft ?? 'unknown'}`,
  })

  return NextResponse.json({ products, count: products.length, tokensLeft })
}

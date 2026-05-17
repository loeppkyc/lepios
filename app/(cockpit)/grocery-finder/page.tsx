// F18: bench=product_coverage_pct (target ≥80% of household staples with current price); surface=grocery-finder page coverage pill + morning_digest top deals
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fetchGroceryProducts } from '@/lib/diet/queries'
import { logEvent } from '@/lib/knowledge/client'
import { GroceryFinderClient } from './_components/GroceryFinderClient'

export const dynamic = 'force-dynamic'

export default async function GroceryFinderPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  void logEvent('grocery-finder', 'page.viewed', { actor: 'user', status: 'success' })
  const products = await fetchGroceryProducts(supabase)

  const productIds = products.map((p) => p.id)
  const { data: rawHistory } =
    productIds.length > 0
      ? await supabase
          .from('grocery_price_history')
          .select('grocery_product_id, price, scraped_at')
          .in('grocery_product_id', productIds)
          .order('scraped_at', { ascending: false })
          .limit(productIds.length * 10)
      : { data: [] }

  // Group by grocery_product_id, keep last 8 entries per product (already DESC so first 8 = most recent)
  const priceHistory: Record<string, Array<{ price: number; recorded_at: string }>> = {}
  for (const row of rawHistory ?? []) {
    const pid = row.grocery_product_id as string
    if (!priceHistory[pid]) priceHistory[pid] = []
    if (priceHistory[pid].length < 8) {
      priceHistory[pid].push({ price: row.price as number, recorded_at: row.scraped_at as string })
    }
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--color-base)', padding: '24px' }}>
      <div
        style={{
          height: 2,
          backgroundColor: 'var(--color-rail)',
          boxShadow: '0 0 12px var(--color-rail-glow)',
          marginBottom: 24,
        }}
      />

      <div style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-heading)',
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            margin: 0,
          }}
        >
          Grocery Finder
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-small)',
            color: 'var(--color-text-muted)',
            margin: '4px 0 0',
            letterSpacing: '0.04em',
          }}
        >
          Edmonton store price tracker — scraper-ready
        </p>
      </div>

      <GroceryFinderClient initialProducts={products} priceHistory={priceHistory} />
    </div>
  )
}

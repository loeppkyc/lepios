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

      <GroceryFinderClient initialProducts={products} />
    </div>
  )
}

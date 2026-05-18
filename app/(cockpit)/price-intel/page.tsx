// F18: bench=keepa_price_intel_queries; surface=agent_events keepa.product_finder/category/seller + morning_digest token usage
// TODO: Wire into CockpitSidebar.tsx once feat/ra-scout merges (nav entry: 'Price Intel', icon: TrendingUp, href: '/price-intel')
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logEvent } from '@/lib/knowledge/client'
import { PriceIntelClient } from './_components/PriceIntelClient'

export const metadata = { title: 'Price Intel — LepiOS' }

export default async function PriceIntelPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  void logEvent('keepa', 'page.viewed', { actor: 'user', status: 'success', entity: 'price-intel' })

  return <PriceIntelClient />
}

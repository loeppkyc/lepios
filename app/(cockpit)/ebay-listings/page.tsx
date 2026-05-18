// F18: bench=ebay_listings_load_latency<400ms; surface=ebay-listings page views in morning_digest
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logEvent } from '@/lib/knowledge/client'
import { EbayListingsClient } from './_components/EbayListingsClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'eBay Listings — LepiOS' }

export default async function EbayListingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  void logEvent('ebay-listings', 'page.viewed', { actor: 'user', status: 'success' })

  const { data: listings } = await supabase
    .from('ebay_listings')
    .select('*')
    .order('created_at', { ascending: false })

  return <EbayListingsClient initialListings={listings ?? []} />
}

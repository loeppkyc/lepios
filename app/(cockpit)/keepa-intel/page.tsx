// F18: bench=Streamlit_keepa_intel token_burn_per_scan; surface=agent_events keepa.deals.scan + morning_digest token usage line
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logEvent } from '@/lib/knowledge/client'
import { KeepaIntelClient } from './_components/KeepaIntelClient'

export const dynamic = 'force-dynamic'

export default async function KeepaIntelPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  void logEvent('keepa-intel', 'page.viewed', { actor: 'user', status: 'success' })
  return <KeepaIntelClient />
}
